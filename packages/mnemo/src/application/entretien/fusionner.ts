import { nomDeLaFiche } from '../../domaine/chemin.ts';
import { lireFiche } from '../../domaine/fiche.ts';
import type { Fiche, LigneDeRelation } from '../../domaine/fiche.ts';
import { reecrireLiens } from '../../domaine/liens-ecrits.ts';
import { lienRenumerote, ligneRenumerotee, renumerotation } from '../../domaine/renumerotation.ts';
import { CLES_D_ORIGINE, originesImportees, verserOrigines } from '../../domaine/origines-importees.ts';
import { aujourdhui, avecIdentifiant, cheminDeFiche, cheminExistant, ecrireEtCommiter, motifCheminInvalide, refuse, texteDeFiche } from '../commun.ts';
import type { Resultat } from '../commun.ts';
import { normaliserTitre } from '../liens.ts';
import type { Dependances } from '../ports.ts';
import { motifIntouchable, reecrituresASignaler } from './garde.ts';
import { lireLaMemoire, relationsAssainies } from './memoire-lue.ts';
import type { MemoireLue } from './memoire-lue.ts';

/** Verse la fiche `id` dans la fiche `dans`, puis supprime `id`. */
export type DemandeFusion = { action: 'fusionner'; id: string; dans: string };

/** Relations des deux fiches, sans doublon (même verbe vers la même fiche) ni relation de la fiche vers elle-même. */
function relationsReunies(memoire: MemoireLue, dans: string, lignes: LigneDeRelation[]): LigneDeRelation[] {
	const vues = new Set<string>();
	const reunies: LigneDeRelation[] = [];
	for (const r of lignes) {
		if ('brute' in r) {
			reunies.push(r);
			continue;
		}
		const visee = memoire.designee(r.cible.split(/[#|]/u)[0]!);
		if (visee === dans) continue;
		const cle = `${r.verbe}\u0000${visee ?? r.cible}`;
		if (vues.has(cle)) continue;
		vues.add(cle);
		reunies.push(r);
	}
	return reunies;
}

/**
 * Fusionne la fiche `id` dans la fiche `dans`, en un commit : ses informations (ancres renumérotées à la suite, renvois
 * suivis), sa synthèse, ses sections (ajoutées à la section de même titre), ses relations, ses alias, son titre et son nom
 * (en alias) et ses autres propriétés absentes de `dans` y sont versés ; ses origines d'import (notes de Claude Code
 * qu'elle portait) sont ajoutées aux `origines` de `dans`, avec leur empreinte, pour qu'un réimport ne les recrée pas ;
 * tout lien vers `id` (par chemin, nom, titre ou alias, `#^ancre` suivie) est réécrit vers `dans` ; `id` est supprimée.
 * Appelant sous verrou.
 */
export async function fusionnerFiches(dep: Dependances, demande: DemandeFusion): Promise<Resultat> {
	const id = cheminDeFiche(demande.id);
	if (id === null) return refuse(motifCheminInvalide(demande.id));
	const dans = cheminDeFiche(demande.dans);
	if (dans === null) return refuse(motifCheminInvalide(demande.dans));
	if (id === dans) return refuse('Une fiche ne se fusionne pas dans elle-même.');
	for (const chemin of [id, dans]) {
		const variante = await cheminExistant(dep, chemin);
		if (variante !== null) return refuse(variante);
	}
	const memoire = await lireLaMemoire(dep);
	const lues: Fiche[] = [];
	for (const chemin of [id, dans]) {
		const texte = memoire.textes.get(chemin);
		if (texte === undefined) return refuse(`La fiche ${chemin} n'existe pas.`);
		try {
			lues.push(lireFiche(chemin, texte));
		} catch (erreur) {
			return refuse(erreur instanceof Error ? erreur.message : String(erreur));
		}
	}
	const [absorbeeLue, receveuseLue] = lues as [Fiche, Fiche];
	const intouchable = motifIntouchable(id, absorbeeLue.type, memoire.textes.keys(), true) ?? motifIntouchable(dans, receveuseLue.type, memoire.textes.keys(), false);
	if (intouchable !== null) return refuse(intouchable);

	const table = renumerotation(absorbeeLue.faits, receveuseLue);
	// `#^ancre` suivie ; une ancre absente de la fiche absorbée est retirée, comme à la suppression
	const reecrire = (texte: string) => reecrireLiens(texte, (cible, suite) => (memoire.designee(cible) === id ? lienRenumerote(cible, suite, id, dans, table) : null));

	const absorbee = lireFiche(id, reecrire(memoire.textes.get(id)!));
	const receveuse = lireFiche(dans, reecrire(memoire.textes.get(dans)!));
	const versees = absorbee.faits.filter((l) => 'fait' in l || l.brute.some((b) => b.trim() !== '')).map((l) => ligneRenumerotee(l, table));
	receveuse.faits = [...receveuse.faits, ...versees];
	if (absorbee.synthese !== '' && !receveuse.synthese.includes(absorbee.synthese)) {
		receveuse.synthese = receveuse.synthese === '' ? absorbee.synthese : `${receveuse.synthese}\n\n${absorbee.synthese}`;
	}
	for (const section of absorbee.autresSections) {
		const meme = receveuse.autresSections.find((s) => s.titre === section.titre);
		if (meme === undefined) receveuse.autresSections.push({ ...section });
		else if (section.corps !== '' && !meme.corps.includes(section.corps)) meme.corps = meme.corps === '' ? section.corps : `${meme.corps}\n\n${section.corps}`;
	}
	const relations = relationsReunies(memoire, dans, [...receveuse.relations, ...absorbee.relations.filter((r) => !('brute' in r) || r.brute.trim() !== '')]);
	const relationsVersees = relations.length - receveuse.relations.filter((r) => relations.includes(r)).length;
	receveuse.relations = relations;
	const connus = new Set([receveuse.titre, nomDeLaFiche(dans), ...receveuse.alias].map(normaliserTitre));
	const aliasVerses: string[] = [];
	for (const nom of [absorbee.titre, nomDeLaFiche(id), ...absorbee.alias]) {
		const cle = normaliserTitre(nom);
		if (cle === '' || connus.has(cle)) continue;
		connus.add(cle);
		aliasVerses.push(nom.trim());
	}
	receveuse.alias = [...receveuse.alias, ...aliasVerses];
	for (const [cle, valeur] of Object.entries(absorbee.donnees)) if (!(cle in receveuse.donnees) && !CLES_D_ORIGINE.includes(cle)) receveuse.donnees[cle] = valeur;
	// les notes de Claude Code que l'absorbée portait : le prochain import les tient pour connues tant qu'elles n'ont pas changé
	const origines = verserOrigines(receveuse, originesImportees(absorbee));
	receveuse.updated = aujourdhui(dep);

	const autres: { chemin: string; texte: string }[] = [];
	for (const [chemin, texte] of memoire.textes) {
		if (chemin === id || chemin === dans) continue;
		const neuf = reecrire(texte);
		if (neuf !== texte) autres.push({ chemin, texte: avecIdentifiant(dep, chemin, relationsAssainies(dep, memoire, chemin, neuf)) });
	}
	const commit = await ecrireEtCommiter(dep, [{ chemin: dans, texte: texteDeFiche(dep, receveuse) }, ...autres], `mnemo: fusionne ${id} → ${dans}`, [id]);
	const ancres = [...table.values()];
	const aSignaler = reecrituresASignaler(memoire.textes, autres.map((f) => f.chemin));
	const changements = [
		`${id} versée puis supprimée`,
		`${versees.length} ligne(s) d'informations versée(s)${ancres.length === 0 ? '' : ` (ancres ${ancres[0]!} à ${ancres[ancres.length - 1]!})`}`,
		...(relationsVersees > 0 ? [`${relationsVersees} relation(s) versée(s)`] : []),
		...(aliasVerses.length > 0 ? [`alias ajoutés : ${aliasVerses.join(', ')}`] : []),
		...(origines.length > 0 ? [`origines d'import reportées : ${origines.join(', ')}`] : []),
		...(autres.length > 0 ? [`liens réécrits dans ${autres.length} fiche(s)`] : []),
		...(aSignaler.length > 0 ? [`à signaler à l'utilisateur : liens réécrits dans ${aSignaler.join(', ')}`] : []),
	];
	return { statut: 'ecrit', fiche: dans, aConfirmer: false, commit, changements };
}
