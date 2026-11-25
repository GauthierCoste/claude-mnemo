/**
 * `mnemo banc contexte --apprendre` : apprend la note de confiance sur les jugements du banc (spec classement vivant § 4.3),
 * écrit le module de coefficients (`domaine/coefficients-note.ts`, données seules) et le rapport, en texte et en JSON, dans
 * `.mnemo/` (local, aucun texte de fiche ni de message).
 */
import { rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { apprendreNote, jeuDApprentissage } from '../../application/apprendre-note.ts';
import type { LigneDeConfiguration, RapportDApprentissage, RapportDeNiveau } from '../../application/apprendre-note.ts';
import type { CasContexte } from '../../application/banc-contexte.ts';
import type { MesuresDInjection } from '../../domaine/acceptation-note.ts';
import { DOSSIER_LOCAL } from '../../domaine/dossier-memoire.ts';
import { moduleDeCoefficients } from '../../domaine/modele-de-note.ts';
import { piecesPourPlateforme } from '../../infra/modeles/catalogue.ts';

/** Le module de coefficients du code qui tourne. */
export const MODULE_DES_COEFFICIENTS = join(import.meta.dirname, '..', '..', 'domaine', 'coefficients-note.ts');

/** Fichiers GGUF du sens et du reranker de cette plateforme : nom du fichier et début du SHA-256. */
export function ggufInstalles(): { sens: string | null; reranker: string | null } {
	const pieces = piecesPourPlateforme(process.platform, process.arch) ?? [];
	const identite = (nom: string) => {
		const p = pieces.find((x) => x.nom === nom);
		return p === undefined ? null : `${p.fichier}@${p.sha256.slice(0, 12)}`;
	};
	return { sens: identite('sens'), reranker: identite('reranker') };
}

const pourcent = (x: number | null) => (x === null ? '-' : `${(Math.round(x * 1000) / 10).toLocaleString('fr-FR')} %`);
const NOMS: Record<RapportDeNiveau['niveau'], string> = { complets: 'Complets', sens: 'Sens seul' };

function mesuresEnTexte(m: MesuresDInjection): string {
	return [
		`${m.injections} injections (${m.nonJugees} non jugées, ${m.sessions} sessions, ${m.injectionsParMessage.toFixed(2)} par message)`,
		`précision ${pourcent(m.precisionPessimiste)} (jugées seules ${pourcent(m.precision)})`,
		`Wilson ${pourcent(m.wilsonBassePessimiste)}`,
		`silences servis ${m.silencesAvecInjection} / ${m.silences}`,
		`rappel ${pourcent(m.rappel)}`,
	].join(', ');
}

function configurationEnTexte(c: LigneDeConfiguration, retenue: boolean): string {
	const nom = `requête ${c.requete}, cosinus ${c.methode === 'mediane' ? 'médiane' : 'z-score'}, ${c.avecApriori ? 'avec' : 'sans'} a priori`;
	const marques = [retenue ? 'retenue' : null, c.selectionnable ? null : 'non retenable', c.accepte ? 'acceptable' : null].filter((x) => x !== null);
	return `    ${retenue ? '▸' : ' '} ${nom}, λ ${c.lambda} : perte ${c.perte === null ? '-' : c.perte.toFixed(4)} sur ${c.paires} paires, ECE ${c.ece === null ? '-' : c.ece.toFixed(3)} ; ${mesuresEnTexte(c.mesures)}${marques.length === 0 ? '' : ` [${marques.join(', ')}]`}`;
}

/** Le rapport lisible : données, puis par niveau les configurations comparées, la courbe des seuils et la décision. */
export function rapportEnTexte(r: RapportDApprentissage, moduleEcrit: string): string {
	const lignes = [
		`Apprentissage de la note du ${r.date} : ${r.messages} messages, ${r.sessions} sessions, ${r.paires.pertinentes} pertinentes / ${r.paires.nonPertinentes} non pertinentes dans la pile`,
		`  écartées : ${r.indecises} indécises, ${r.empreintesChangees} fiches changées depuis l'extraction ; hors pile : ${r.horsPile.pertinentes} pertinentes / ${r.horsPile.jugees} jugées (rappel seulement)`,
	];
	if (r.zApproche) lignes.push("  z-score du cosinus approché (écart type des candidates du message) : mesuré, jamais retenu tant que le banc n'enregistre pas cosinusZ");
	for (const n of r.niveaux) {
		const m = n.modele;
		lignes.push('', `${NOMS[n.niveau]} : ${m.accepte ? 'ACCEPTÉ' : 'refusé'}${m.refus.length === 0 ? '' : ` (${m.refus.join(' ; ')})`}`);
		if (n.retenue === null) continue;
		const poids = Object.entries(m.poids).map(([v, w]) => `${v} ${w.toFixed(3)}`).join(', ');
		lignes.push(`  modèle : biais ${m.biais.toFixed(3)} ; ${poids} ; abstention ${m.abstention === null ? 'non' : m.abstention} ; ${m.paires} paires, ${m.messages} messages, ${m.sessions} sessions`);
		lignes.push('  configurations (validation croisée groupée par session, seuil 90 %) :');
		n.configurations.forEach((c, i) => lignes.push(configurationEnTexte(c, i === n.retenue)));
		lignes.push('  abstention par message (écart à la suivante) :');
		for (const a of n.abstentions) lignes.push(`      ${a.valeur} : ${mesuresEnTexte(a.mesures)}, ${a.mesures.abstenus} messages abstenus`);
		lignes.push('  courbe du seuil :');
		for (const c of n.courbe) lignes.push(`      ${pourcent(c.seuil)} : ${mesuresEnTexte(c)}`);
		lignes.push(`  fiabilité : ${n.fiabilite.filter((t) => t.paires > 0).map((t) => `[${pourcent(t.de)} ; ${pourcent(t.a)}[ ${t.paires} paires, p ${pourcent(t.pMoyen)}, observé ${pourcent(t.frequence)}`).join(' · ')}`);
	}
	lignes.push('', `Module écrit : ${moduleEcrit}`);
	return lignes.join('\n');
}

async function ecrireEntier(fichier: string, texte: string): Promise<void> {
	const provisoire = `${fichier}.${process.pid}.tmp`;
	await writeFile(provisoire, texte);
	await rename(provisoire, fichier);
}

/**
 * Apprend sur les cas du banc et écrit le module (`module`, celui du code qui tourne par défaut) et le rapport
 * (`.mnemo/apprentissage-note.txt` et `.json`). `empreinteDe` : empreintes actuelles des fiches (null : non vérifiées).
 */
export async function apprendreAuBanc(
	racine: string,
	cas: readonly CasContexte[],
	options: { empreinteDe: ReadonlyMap<string, string> | null; empreintes: 'exclure' | 'garder'; date: string; module?: string },
): Promise<{ rapport: RapportDApprentissage; texte: string }> {
	const jeu = jeuDApprentissage(cas, options.empreinteDe, options.empreintes);
	const rapport = apprendreNote(jeu, { date: options.date, gguf: ggufInstalles() });
	const module = options.module ?? MODULE_DES_COEFFICIENTS;
	await ecrireEntier(module, moduleDeCoefficients(rapport.coefficients));
	const texte = rapportEnTexte(rapport, module);
	await ecrireEntier(join(racine, DOSSIER_LOCAL, 'apprentissage-note.json'), `${JSON.stringify(rapport, null, 2)}\n`);
	await ecrireEntier(join(racine, DOSSIER_LOCAL, 'apprentissage-note.txt'), `${texte}\n`);
	return { rapport, texte };
}
