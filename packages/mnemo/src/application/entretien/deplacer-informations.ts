import { positionDeFiche } from '../../domaine/chemin.ts';
import { lireFiche, retenirPlusHauteAncre, TYPE_PAR_DEFAUT } from '../../domaine/fiche.ts';
import type { Fiche, LigneDeFait } from '../../domaine/fiche.ts';
import { reecrireLiens } from '../../domaine/liens-ecrits.ts';
import { ancreDeLigneBrute, ancreDeSuite, lienRenumerote, ligneRenumerotee, renumerotation, renvoisDeLigneBrute } from '../../domaine/renumerotation.ts';
import { ancreDeFait, aujourdhui, avecIdentifiant, cheminDeFiche, cheminExistant, dossiersManquants, ecrireEtCommiter, enFichier, ficheVide, motifCheminInvalide, motifTitreInvalide, refuse, texteDeFiche } from '../commun.ts';
import type { Resultat } from '../commun.ts';
import type { Dependances } from '../ports.ts';
import { motifIntouchable, reecrituresASignaler } from './garde.ts';
import { lireLaMemoire, relationsAssainies } from './memoire-lue.ts';

/**
 * Déplace les informations `ancres` de la fiche `id` dans la fiche `dans` ; `titreSiNouvelle` : crée `dans` si elle
 * n'existe pas, avec ce titre (type de l'origine).
 */
export type DemandeDeplacementInformations = { action: 'deplacer_informations'; id: string; ancres: string[]; dans: string; titreSiNouvelle?: string };

const lire = (chemin: string, texte: string): Fiche | string => {
	try {
		return lireFiche(chemin, texte);
	} catch (erreur) {
		return erreur instanceof Error ? erreur.message : String(erreur);
	}
};

/**
 * Lignes (indices dans `faits`) des informations qui partent : les demandées, et celles que leurs renvois lient dans la
 * fiche d'origine, de proche en proche (barrée invalidée par une partante, partante invalidée par une autre, contradiction
 * dans un sens ou dans l'autre), ancrées ou non. Un renvoi ne s'écrit que vers une ancre de la même fiche
 * (`domaine/fait.ts`) : ainsi, aucun ne traverse deux fiches.
 */
function informationsQuiPartent(faits: readonly LigneDeFait[], demandees: readonly string[]): { lignes: Set<number>; ancres: Set<string> } {
	const lignes = new Set<number>();
	const ancres = new Set(demandees);
	let change = true;
	while (change) {
		change = false;
		faits.forEach((ligne, i) => {
			if (!('fait' in ligne)) return;
			const { ancre, contredit, invalidePar } = ligne.fait;
			const renvois = [contredit, invalidePar].filter((a): a is string => a !== undefined);
			const part = lignes.has(i) || (ancre !== undefined && ancres.has(ancre)) || renvois.some((a) => ancres.has(a));
			if (!part) return;
			if (!lignes.has(i)) {
				lignes.add(i);
				change = true;
			}
			for (const a of [...renvois, ...(ancre === undefined ? [] : [ancre])]) {
				if (ancres.has(a)) continue;
				ancres.add(a);
				change = true;
			}
		});
	}
	return { lignes, ancres };
}

/**
 * Déplace des informations d'une fiche à une autre, en un commit `mnemo: deplace_informations <origine> → <cible>` : chacune
 * garde tout (texte, catégorie, nature, sources et citations, dates, confiance, à confirmer, contradiction) et reçoit une
 * ancre dans la cible, à la suite de la plus haute ; les informations liées par un renvoi suivent (`informationsQuiPartent`),
 * leurs renvois remappés ; tout lien `[[origine#^f-X]]` vers une partante (par chemin, avec ou sans `.md`, nom, titre ou
 * alias) est réécrit vers `[[cible#^f-Y]]`, dans toute la mémoire. Rien n'est laissé à l'origine : git garde l'historique.
 * Refusé : cible = origine, ancre absente ou d'une ligne illisible, cible absente sans `titreSiNouvelle`, consigne, profil,
 * chemin fixe. Appelant sous verrou.
 */
export async function deplacerInformations(dep: Dependances, demande: DemandeDeplacementInformations): Promise<Resultat> {
	const id = cheminDeFiche(demande.id);
	if (id === null) return refuse(motifCheminInvalide(demande.id));
	const dans = cheminDeFiche(demande.dans);
	if (dans === null) return refuse(motifCheminInvalide(demande.dans));
	if (id === dans) return refuse('Les informations sont déjà dans cette fiche : une autre fiche attendue dans `dans`.');
	if (demande.ancres.length === 0) return refuse('Aucune information à déplacer : au moins une ancre attendue dans `ancres`.');
	const demandees: string[] = [];
	for (const brut of demande.ancres) {
		const vise = ancreDeFait(brut, id);
		if ('motif' in vise) return refuse(vise.motif);
		if (!demandees.includes(vise.ancre)) demandees.push(vise.ancre);
	}
	for (const chemin of [id, dans]) {
		const variante = await cheminExistant(dep, chemin);
		if (variante !== null) return refuse(variante);
	}

	const memoire = await lireLaMemoire(dep);
	const texteOrigine = memoire.textes.get(id);
	if (texteOrigine === undefined) return refuse(`La fiche ${id} n'existe pas.`);
	const origineLue = lire(id, texteOrigine);
	if (typeof origineLue === 'string') return refuse(origineLue);
	const intouchable = motifIntouchable(id, origineLue.type, [], false);
	if (intouchable !== null) return refuse(intouchable);

	const texteCible = memoire.textes.get(dans);
	let cibleLue: Fiche;
	let creees: Fiche[] = [];
	if (texteCible !== undefined) {
		const lue = lire(dans, texteCible);
		if (typeof lue === 'string') return refuse(lue);
		cibleLue = lue;
	} else {
		const titre = demande.titreSiNouvelle?.trim();
		if (titre === undefined || titre === '') return refuse(`La fiche ${dans} n'existe pas : donner \`titreSiNouvelle\` pour la créer, ou une fiche existante.`);
		const motifTitre = motifTitreInvalide(titre);
		if (motifTitre !== null) return refuse(motifTitre);
		// une fiche de dossier n'a de sens qu'à la place d'un dossier (`d/d.md`)
		const type = origineLue.type === 'dossier' && positionDeFiche(dans) === dans ? TYPE_PAR_DEFAUT : origineLue.type;
		cibleLue = ficheVide(dep, dans, type, titre);
		const dossiers = await dossiersManquants(dep, dans);
		if (typeof dossiers === 'string') return refuse(dossiers);
		creees = dossiers;
	}
	const intouchableCible = motifIntouchable(dans, cibleLue.type, [], false);
	if (intouchableCible !== null) return refuse(intouchableCible);

	const lisibles = new Set<string>();
	const illisibles = new Map<string, string>();
	for (const ligne of origineLue.faits) {
		if ('fait' in ligne) {
			if (ligne.fait.ancre !== undefined) lisibles.add(ligne.fait.ancre);
		} else for (const brute of ligne.brute) {
			const ancre = ancreDeLigneBrute(brute);
			if (ancre !== undefined) illisibles.set(ancre, brute);
		}
	}
	for (const ancre of demandees) {
		if (illisibles.has(ancre)) return refuse(`L'information ^${ancre} de ${id} est une ligne illisible : la corriger avant de la déplacer.`);
		if (!lisibles.has(ancre)) return refuse(`L'information ^${ancre} n'existe pas dans ${id}.`);
	}
	const { lignes: partantes, ancres: partent } = informationsQuiPartent(origineLue.faits, demandees);
	for (const ancre of partent) {
		if (illisibles.has(ancre)) return refuse(`L'information ^${ancre} de ${id}, liée par un renvoi à une information déplacée, est une ligne illisible : la corriger d'abord.`);
	}
	// une ligne illisible qui reste ne peut pas suivre ses renvois : elle viserait une information partie
	for (const ligne of origineLue.faits) {
		if (!('brute' in ligne)) continue;
		const renvoi = ligne.brute.flatMap(renvoisDeLigneBrute).find((a) => partent.has(a));
		if (renvoi !== undefined) return refuse(`Une ligne illisible de ${id} renvoie à l'information ^${renvoi}, qui partirait : la corriger d'abord.`);
	}

	const table = renumerotation(origineLue.faits.filter((_, i) => partantes.has(i)), cibleLue);
	const reecrire = (texte: string) =>
		reecrireLiens(texte, (cible, suite) => {
			if (memoire.designee(cible) !== id) return null;
			const ancre = ancreDeSuite(suite);
			return ancre !== null && table.has(ancre) ? lienRenumerote(cible, suite, id, dans, table) : null;
		});

	const jour = aujourdhui(dep);
	const origine = lireFiche(id, reecrire(texteOrigine));
	// réécrire un lien ne change pas le découpage des lignes : les indices restent ceux de la lecture
	if (origine.faits.length !== origineLue.faits.length) return refuse(`La fiche ${id} se relit autrement une fois ses liens réécrits : la corriger à la main.`);
	const versees = origine.faits.filter((_, i) => partantes.has(i)).map((l) => ligneRenumerotee(l, table));
	origine.faits = origine.faits.filter((_, i) => !partantes.has(i));
	// les numéros des parties ne resservent pas à l'origine (une information sans ancre en reçoit une au-dessus)
	retenirPlusHauteAncre(origineLue, origine);
	origine.updated = jour;
	const receveuse = texteCible === undefined ? cibleLue : lireFiche(dans, reecrire(texteCible));
	receveuse.faits = [...receveuse.faits, ...versees];
	receveuse.updated = jour;

	const autres: { chemin: string; texte: string }[] = [];
	for (const [chemin, texte] of memoire.textes) {
		if (chemin === id || chemin === dans) continue;
		const neuf = reecrire(texte);
		if (neuf !== texte) autres.push({ chemin, texte: avecIdentifiant(dep, chemin, relationsAssainies(dep, memoire, chemin, neuf)) });
	}
	// une relation de la cible vers `[[origine#^f-X]]` déplacée la viserait elle-même : retirée, comme les doublons
	const aEcrire = [
		{ chemin: dans, texte: relationsAssainies(dep, memoire, dans, texteDeFiche(dep, receveuse)) },
		{ chemin: id, texte: relationsAssainies(dep, memoire, id, texteDeFiche(dep, origine)) },
		...autres,
		...creees.map((f) => enFichier(dep, f)),
	];
	const commit = await ecrireEtCommiter(dep, aEcrire, `mnemo: deplace_informations ${id} → ${dans}`);
	const suivies = [...table.keys()].filter((a) => !demandees.includes(a));
	const aSignaler = reecrituresASignaler(memoire.textes, autres.map((f) => f.chemin));
	const changements = [
		...(texteCible === undefined ? [`fiche ${dans} créée (type ${receveuse.type})`] : []),
		`${versees.length} information(s) déplacée(s) de ${id} : ${[...table].map(([de, vers]) => `^${de} → ^${vers}`).join(', ')}`,
		...(suivies.length > 0 ? [`liées par un renvoi, déplacées aussi : ${suivies.map((a) => `^${a}`).join(', ')}`] : []),
		...(autres.length > 0 ? [`liens réécrits dans ${autres.length} autre(s) fiche(s)`] : []),
		...(aSignaler.length > 0 ? [`à signaler à l'utilisateur : liens réécrits dans ${aSignaler.join(', ')}`] : []),
	];
	return { statut: 'ecrit', fiche: dans, aConfirmer: false, commit, changements };
}
