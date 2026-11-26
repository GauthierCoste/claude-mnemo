/**
 * Le rapport d'apprentissage de la note en texte (`.mnemo/apprentissage-note.txt`, sortie de `mnemo banc contexte --apprendre`) :
 * données, puis par niveau la décision, les tirages, la stabilité, les pertes comparées et la grille. Aucun texte de fiche ni de
 * message.
 */
import type { RapportDApprentissage, RapportDeNiveau } from './apprendre-note.ts';
import type { MesuresDAcceptation } from '../domaine/acceptation-note.ts';

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
		`silences avec injection ${m.silencesAvecInjection} / ${m.silences} (${m.sessionsSilence} sessions)`,
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
		if (n.implicites.utilisees + n.implicites.ecartees > 0) {
			lignes.push(`  paires implicites des gestes : ${n.implicites.utilisees} apprises, ${n.implicites.ecartees} laissées (une variable de la configuration manque)`);
		}
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
	lignes.push('', ecrits.length === 0 ? 'Modèle non écrit : le modèle actuel est gardé.' : `Écrits : ${ecrits.join(', ')}`);
	return lignes.join('\n');
}
