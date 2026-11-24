/**
 * Lots d'informations proposés par l'archiviste (« À arbitrer » de Mémoire › Archiviste) : leur intitulé
 * (« 3 doublons proposés dans Module stocks »), une information du lot lue depuis ses lignes écrites, et ce que change une
 * ligne du lot, en une ou deux lignes courtes (sources versées, confiance, absorbées).
 */
import type { GenreLotVue, InformationDuLotVue, LigneDeLotVue, LotVue } from '@mnemo/contrat';
import { analyserCorroboration, analyserFait } from '../memoire/rendu-fiche.tsx';
import { titreFiche } from '../sessions/servis.ts';

/** Nom de ce que compte un lot, au singulier et au pluriel, avec l'accord de « proposé ». */
const NOMS: Record<GenreLotVue, { un: string; plusieurs: string; propose: string; proposes: string }> = {
	fusionner: { un: 'doublon', plusieurs: 'doublons', propose: 'proposé', proposes: 'proposés' },
	supprimer: { un: 'suppression', plusieurs: 'suppressions', propose: 'proposée', proposes: 'proposées' },
	confirmer: { un: 'confirmation', plusieurs: 'confirmations', propose: 'proposée', proposes: 'proposées' },
};

const ETIQUETTES: Record<GenreLotVue, string> = { fusionner: 'Doublons', supprimer: 'Suppressions', confirmer: 'Confirmations' };

const pluriel = (n: number, un: string, plusieurs: string) => `${n} ${n === 1 ? un : plusieurs}`;

/** Titre de la fiche du lot : celui que donne le service, sinon tiré du chemin. */
export function titreDuLot(lot: LotVue): string {
	return lot.titre ?? titreFiche(lot.fiche);
}

/** Étiquette du genre, en tête de l'entrée (« Doublons | Module stocks »). */
export function etiquetteLot(genre: GenreLotVue): string {
	return ETIQUETTES[genre] ?? genre;
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
export function compteEnMots(genre: GenreLotVue, n: number): string {
	return genre === 'fusionner' ? pluriel(n, 'doublon', 'doublons') : pluriel(n, 'ligne', 'lignes');
}

/** « 11 doublons proposés dans Module stocks » (les absorbées), « 1 suppression proposée dans … » (les lignes). */
export function intituleLot(lot: LotVue): string {
	const n = compteLot(lot);
	const nom = NOMS[lot.genre] ?? { un: lot.genre, plusieurs: lot.genre, propose: 'proposé', proposes: 'proposés' };
	return n === 1 ? `1 ${nom.un} ${nom.propose} dans ${titreDuLot(lot)}` : `${n} ${nom.plusieurs} ${nom.proposes} dans ${titreDuLot(lot)}`;
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
export function texteInformation(info: InformationDuLotVue): string {
	return lireInformation(info)?.texte ?? `${info.ancre} (absente)`;
}

const pourcent = (n: number) => `${n} %`;

/** « confiance 30 % → 51 % » si elle change ; « confiance 51 % » si elle n'était pas écrite ; null sinon. */
function changementDeConfiance(avant: InformationLue | null, apres: InformationLue | null): string | null {
	const a = avant?.confiance ?? null;
	const b = apres?.confiance ?? null;
	if (b === null || a === b) return null;
	return a === null ? `confiance ${pourcent(b)}` : `confiance ${pourcent(a)} → ${pourcent(b)}`;
}

/**
 * Ce que change une ligne du lot, en lignes courtes : fusion → « + source X · confiance 30 % → 51 % » puis « absorbe :
 * « … » » ; suppression → « supprimée » ; confirmation → « confirmée » (et la confiance si elle change). Différence entre
 * `avant` (la gardée ou la visée d'abord) et `apres`.
 */
export function resumeChangement(ligne: LigneDeLotVue, genre: GenreLotVue): string[] {
	const visee = ligne.avant[0] ? lireInformation(ligne.avant[0]) : null;
	const apres = ligne.apres ? lireInformation(ligne.apres) : null;
	const confiance = changementDeConfiance(visee, apres);
	if (genre === 'supprimer') return ['supprimée'];
	if (genre === 'confirmer') return [['confirmée', confiance].filter((x) => x !== null).join(' · ')];
	const connues = new Set(visee?.sources ?? []);
	const nouvelles = [...new Set((apres?.sources ?? []).filter((x) => !connues.has(x)))];
	const versees = nouvelles.length === 0 ? null : `+ ${nouvelles.length === 1 ? 'source' : 'sources'} ${nouvelles.join(', ')}`;
	const premiere = [versees, confiance].filter((x) => x !== null).join(' · ') || 'aucune source nouvelle';
	const absorbees = ligne.avant.slice(1).map((i) => `« ${texteInformation(i)} »`);
	return absorbees.length === 0 ? [premiere] : [premiere, `absorbe : ${absorbees.join(', ')}`];
}
