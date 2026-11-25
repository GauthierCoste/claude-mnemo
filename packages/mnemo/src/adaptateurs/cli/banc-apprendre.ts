/**
 * `mnemo banc contexte --apprendre` : apprend la note de confiance sur les jugements du banc (spec classement vivant § 4.3),
 * écrit les coefficients de la mémoire (`.mnemo/coefficients-note.json`, que le service charge) et le rapport, en texte et en
 * JSON, dans `.mnemo/` (local, aucun texte de fiche ni de message). `--module <chemin>` écrit aussi le module de données
 * TypeScript (développement : la valeur par défaut du dépôt), jamais sous `node_modules`.
 */
import { rename, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { apprendreNote, jeuDApprentissage } from '../../application/apprendre-note.ts';
import type { RapportDApprentissage, RapportDeNiveau } from '../../application/apprendre-note.ts';
import type { CasContexte } from '../../application/banc-contexte.ts';
import type { MesuresDAcceptation } from '../../domaine/acceptation-note.ts';
import { DOSSIER_LOCAL } from '../../domaine/dossier-memoire.ts';
import { jsonDeCoefficients, moduleDeCoefficients } from '../../domaine/modele-de-note.ts';
import type { IdentiteDesModeles } from '../../domaine/modele-de-note.ts';
import { fichierDesCoefficients } from '../../infra/coefficients-note-fichier.ts';
import { ErreurCli } from './erreurs.ts';

export { fichierDesCoefficients, ggufInstalles } from '../../infra/coefficients-note-fichier.ts';

/** Un module de développement ne s'écrit jamais dans une installation (`node_modules`). */
export function verifierCheminDuModule(chemin: string): string {
	const absolu = resolve(chemin);
	if (absolu.split(sep).includes('node_modules')) throw new ErreurCli(`--module : refusé sous node_modules (${absolu}).`);
	return absolu;
}

const pourcent = (x: number | null) => (x === null ? '-' : `${(Math.round(x * 1000) / 10).toLocaleString('fr-FR')} %`);
const nombre = (x: number | null, chiffres = 2) => (x === null ? '-' : x.toFixed(chiffres));
const NOMS: Record<RapportDeNiveau['niveau'], string> = { complets: 'Complets', sens: 'Sens seul' };

function mesuresEnTexte(m: MesuresDAcceptation): string {
	return [
		`${m.injections} injections (${m.nonJugees} non jugées, ${m.horsPileFausses} hors pile fausses, ${m.sessions} sessions, ${nombre(m.injectionsParMessage)} par message)`,
		`précision ${pourcent(m.precisionPessimiste)} (jugées seules ${pourcent(m.precision)})`,
		`Wilson ${pourcent(m.wilsonBassePessimiste)}`,
		`bootstrap 2,5 % ${pourcent(m.bootstrapP025)}`,
		`pente ${nombre(m.pente)} (ordonnée ${nombre(m.ordonnee)})`,
		`ECE ${nombre(m.ece, 3)}`,
		`silences servis ${m.silencesAvecInjection} / ${m.silences} (${m.sessionsSilence} sessions)`,
		`rappel ${pourcent(m.rappel)}, atteintes ${pourcent(m.utilesAtteintes)}, 10 premières ${pourcent(m.rappel10)}`,
	].join(', ');
}

/** Le rapport lisible : données, puis par niveau la décision, les tirages, la stabilité, les pertes comparées et la grille. */
export function rapportEnTexte(r: RapportDApprentissage, ecrits: readonly string[]): string {
	const lignes = [
		`Apprentissage de la note du ${r.date} : ${r.messages} messages (${r.messagesManuels} étiquetés à la main), ${r.sessions} sessions réelles, ${r.paires.pertinentes} pertinentes / ${r.paires.nonPertinentes} non pertinentes dans la pile`,
		`  hors de l'apprentissage : ${r.indecises} indécises (comptées fausses si injectées), ${r.empreintesChangees} fiches changées depuis l'extraction ; hors pile : ${r.horsPile.pertinentes} pertinentes / ${r.horsPile.jugees} jugées`,
		`  identité des modèles : ${r.identite.manquante} cas sans identité, ${r.identite.differente} cas d'autres modèles écartés`,
	];
	if (r.zApproche) lignes.push("  z-score du cosinus approché (écart type des candidates du message) : jamais essayé tant que le banc n'enregistre pas cosinusZ");
	for (const n of r.niveaux) {
		const m = n.modele;
		lignes.push('', `${NOMS[n.niveau]} : ${m.accepte ? 'ACCEPTÉ' : 'refusé'}${m.refus.length === 0 ? '' : ` (${m.refus.join(' ; ')})`}`);
		if (n.retenue === null) continue;
		const poids = Object.entries(m.poids).map(([v, w]) => `${v} ${w.toFixed(3)}`).join(', ');
		lignes.push(`  modèle : biais ${m.biais.toFixed(3)} ; ${poids} ; λ ${m.lambda} ; ${m.converge ? 'convergé' : 'NON CONVERGÉ'} ; ${m.paires} paires, ${m.messages} messages, ${m.sessions} sessions`);
		if (n.mediane !== null) lignes.push(`  médiane des découpages (seuil 90 %) : ${mesuresEnTexte(n.mediane)} ; pire précision ${pourcent(n.pirePrecision)}`);
		for (const t of n.tirages) lignes.push(`    découpage ${t.graine} : ${mesuresEnTexte(t.mesures)}${t.nonConverges === 0 ? '' : ` ; ${t.nonConverges} / ${t.apprentissages} apprentissages non convergés`}`);
		lignes.push(`  configurations choisies aux plis : ${n.stabilite.map((s) => `${s.configuration} (${s.fois})`).join(' · ')}`);
		lignes.push('  pertes sur tout le jeu (validation croisée, 4 plis) :');
		for (const p of n.pertes) {
			const retenue = n.retenue.requete === p.requete && n.retenue.methode === p.methode && n.retenue.avecApriori === p.avecApriori && n.retenue.lambda === p.lambda;
			lignes.push(`    ${retenue ? '▸' : ' '} requête ${p.requete}, cosinus ${p.methode === 'mediane' ? 'médiane' : 'z-score'}, ${p.avecApriori ? 'avec' : 'sans'} a priori, λ ${p.lambda} : ${nombre(p.perte, 4)} sur ${p.paires} paires`);
		}
		lignes.push('  seuils (par message porteur : utiles injectées, utiles en piste, part des utiles atteintes, injections à tort) :');
		for (const c of n.grille) {
			lignes.push(`    injection ${pourcent(c.seuil)}, pistes ${pourcent(c.seuilPiste)} : ${nombre(c.utilesInjectees, 3)}, ${nombre(c.utilesEnPiste, 3)}, ${pourcent(c.partUtilesAtteintes)}, ${nombre(c.injectionsATort, 3)}`);
		}
		lignes.push(`  fiabilité : ${n.fiabilite.filter((t) => t.paires > 0).map((t) => `[${pourcent(t.de)} ; ${pourcent(t.a)}[ ${t.paires} paires, p ${pourcent(t.pMoyen)}, observé ${pourcent(t.frequence)}`).join(' · ')}`);
	}
	lignes.push('', `Écrits : ${ecrits.join(', ')}`);
	return lignes.join('\n');
}

async function ecrireEntier(fichier: string, texte: string): Promise<void> {
	const provisoire = `${fichier}.${process.pid}.tmp`;
	await writeFile(provisoire, texte);
	await rename(provisoire, fichier);
}

/**
 * Apprend sur les cas du banc et écrit les coefficients (`.mnemo/coefficients-note.json`, et le module `module` s'il est donné)
 * et le rapport (`.mnemo/apprentissage-note.txt` et `.json`). `empreinteDe` : empreintes actuelles des fiches (null : non
 * vérifiées) ; `installes` : identité des modèles installés.
 */
export async function apprendreAuBanc(
	racine: string,
	cas: readonly CasContexte[],
	options: { empreinteDe: ReadonlyMap<string, string> | null; empreintes: 'exclure' | 'garder'; date: string; installes: IdentiteDesModeles; module?: string; graines?: readonly number[] },
): Promise<{ rapport: RapportDApprentissage; texte: string }> {
	const module = options.module === undefined ? undefined : verifierCheminDuModule(options.module);
	const jeu = jeuDApprentissage(cas, options.empreinteDe, { empreintes: options.empreintes, installes: options.installes });
	const rapport = apprendreNote(jeu, { date: options.date, ...(options.graines === undefined ? {} : { graines: options.graines }) });
	const coefficients = fichierDesCoefficients(racine);
	await ecrireEntier(coefficients, jsonDeCoefficients(rapport.coefficients));
	if (module !== undefined) await ecrireEntier(module, moduleDeCoefficients(rapport.coefficients));
	const texte = rapportEnTexte(rapport, [coefficients, ...(module === undefined ? [] : [module])]);
	await ecrireEntier(join(racine, DOSSIER_LOCAL, 'apprentissage-note.json'), `${JSON.stringify(rapport, null, 2)}\n`);
	await ecrireEntier(join(racine, DOSSIER_LOCAL, 'apprentissage-note.txt'), `${texte}\n`);
	return { rapport, texte };
}
