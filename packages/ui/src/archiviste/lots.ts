/**
 * Lots d'informations proposés par l'archiviste (« À arbitrer » de Mémoire › Archiviste) : leur intitulé
 * (« 3 doublons proposés dans Module stocks »), une information du lot lue depuis ses lignes écrites, et ce que change une
 * ligne du lot, en une ou deux lignes courtes (sources versées, confiance, absorbées).
 */
import type { GenreLotVue, InformationDuLotVue, LigneDeLotVue, LotVue } from '@mnemo/contrat';
import { analyserCorroboration, analyserFait } from '../memoire/rendu-fiche.tsx';
import { TEXTES, type Textes } from '../langue/textes.ts';
import { titreFiche } from '../sessions/servis.ts';

type TextesLots = Textes['archiviste']['lots'];

/** Titre de la fiche du lot : celui que donne le service, sinon tiré du chemin. */
export function titreDuLot(lot: LotVue): string {
	return lot.titre ?? titreFiche(lot.fiche);
}

/** Étiquette du genre, en tête de l'entrée (« Doublons | Module stocks »). */
export function etiquetteLot(genre: GenreLotVue, t: TextesLots = TEXTES.fr.archiviste.lots): string {
	return t.etiquettes[genre] ?? genre;
}

/**
 * Ce que compte une ligne : pour une fusion, ses doublons (les absorbées ; à défaut de la ligne proposée, les visées moins la
 * gardée) ; sinon 1.
 */
export function compteDeLigne(ligne: LigneDeLotVue, genre: GenreLotVue): number {
	if (genre !== 'fusionner') return 1;
	return 'absorber' in ligne.ligne ? ligne.ligne.absorber.length : Math.max(0, ligne.avant.length - 1);
}

/** Ce que comptent les lignes `indices` du lot (toutes par défaut). */
export function compteLot(lot: LotVue, indices?: readonly number[]): number {
	const choisies = indices === undefined ? lot.lignes : lot.lignes.filter((l) => indices.includes(l.indice));
	return choisies.reduce((n, l) => n + compteDeLigne(l, lot.genre), 0);
}

/** « 3 doublons » (fusion : les absorbées), « 2 lignes » (sinon). */
export function compteEnMots(genre: GenreLotVue, n: number, t: TextesLots = TEXTES.fr.archiviste.lots): string {
	return t.compte(genre, n);
}

/** « 11 doublons proposés dans Module stocks » (les absorbées), « 1 suppression proposée dans … » (les lignes). */
export function intituleLot(lot: LotVue, t: TextesLots = TEXTES.fr.archiviste.lots): string {
	return t.intitule(lot.genre, compteLot(lot), titreDuLot(lot));
}

/** Une information lue de ses lignes écrites : énoncé, catégorie, barrée, confiance écrite (%), mentions de source. */
export type InformationLue = { texte: string; categorie: string | null; barre: boolean; confiance: number | null; sources: string[] };

const RE_PUCE = /^\s*[-*]\s+/u;
const RE_CONFIANCE = /^confiance (\d+(?:[.,]\d+)?) %$/u;

/** L'information telle qu'écrite (sa ligne, sa citation, ses corroborations) ; null si elle est absente (aucune ligne). */
export function lireInformation(info: InformationDuLotVue): InformationLue | null {
	const [premiere, ...suite] = info.lignes;
	if (premiere === undefined) return null;
	const fait = analyserFait(premiere.replace(RE_PUCE, ''));
	const confiance = fait.meta.map((m) => RE_CONFIANCE.exec(m)?.[1]).find((x) => x !== undefined);
	const sources = [...fait.meta.filter((m) => m.startsWith('src: ')).map((m) => m.slice(5).trim()), ...suite.flatMap((l) => analyserCorroboration(l)?.source ?? [])];
	return { texte: fait.texte || info.ancre, categorie: fait.categorie, barre: fait.barre, confiance: confiance === undefined ? null : Number(confiance.replace(',', '.')), sources };
}

/** Texte d'une information ; absente : son ancre, dite absente. */
export function texteInformation(info: InformationDuLotVue, t: TextesLots = TEXTES.fr.archiviste.lots): string {
	return lireInformation(info)?.texte ?? t.absente(info.ancre);
}

/** « confiance 30 % → 51 % » si elle change ; « confiance 51 % » si elle n'était pas écrite ; null sinon. */
function changementDeConfiance(avant: InformationLue | null, apres: InformationLue | null, t: TextesLots): string | null {
	const a = avant?.confiance ?? null;
	const b = apres?.confiance ?? null;
	if (b === null || a === b) return null;
	return t.changement.confiance(a, b);
}

/**
 * Ce que change une ligne du lot, en lignes courtes : fusion → « + source X · confiance 30 % → 51 % » puis « absorbe :
 * « … » » ; suppression → « supprimée » ; confirmation → « confirmée » (et la confiance si elle change). Différence entre
 * `avant` (la gardée ou la visée d'abord) et `apres`.
 */
export function resumeChangement(ligne: LigneDeLotVue, genre: GenreLotVue, t: TextesLots = TEXTES.fr.archiviste.lots): string[] {
	const visee = ligne.avant[0] ? lireInformation(ligne.avant[0]) : null;
	const apres = ligne.apres ? lireInformation(ligne.apres) : null;
	const confiance = changementDeConfiance(visee, apres, t);
	const c = t.changement;
	if (genre === 'supprimer') return [c.supprimee];
	if (genre === 'confirmer') return [[c.confirmee, confiance].filter((x) => x !== null).join(c.separateur)];
	const connues = new Set(visee?.sources ?? []);
	const nouvelles = [...new Set((apres?.sources ?? []).filter((x) => !connues.has(x)))];
	const versees = nouvelles.length === 0 ? null : c.sources(nouvelles);
	const premiere = [versees, confiance].filter((x) => x !== null).join(c.separateur) || c.aucuneSource;
	const absorbees = ligne.avant.slice(1).map((i) => texteInformation(i, t));
	return absorbees.length === 0 ? [premiere] : [premiere, c.absorbe(absorbees)];
}
