// Passages du texte libre d'une fiche (synthèse, sections) : la même découpe que les documents. Pur, sans module `node:`.
import { plier } from '@mnemo/commun';
import { empreinte } from './empreinte.ts';
import { lignesBrutes } from './fiche.ts';
import type { Fiche } from './fiche.ts';
import { decouperDocument, ligneDeContexte, prefixeDe } from './passages.ts';
import type { Contexte } from './passages.ts';
import { TITRE_CONTENU } from './source.ts';

/** Ancre des passages de la synthèse (texte placé avant la première section). */
export const ANCRE_SYNTHESE = 'synthese';
const ANCRE_PAR_DEFAUT = 'section';

const RE_SYNTHESE = new RegExp(`#${ANCRE_SYNTHESE}(?:~[0-9a-f]+(?:-\\d+)?)?$`, 'u');
/** Vrai pour l'identifiant d'un passage de synthèse (`chemin#synthese`, `chemin#synthese~3fa9c1`…). */
export function estPassageDeSynthese(id: string): boolean {
	return RE_SYNTHESE.test(id);
}

/**
 * Un passage de fiche : `ancre` se cite `chemin#ancre` ; `prefixe` est le contexte (titre de la fiche › titres) ;
 * `ligneContexte` : la synthèse de la fiche (`ligneDeContexte`), vide pour un passage de la synthèse elle-même.
 */
export type PassageDeFiche = { ancre: string; texte: string; prefixe: string; titres: string[]; ligneContexte: string };

/** Ancre lisible d'une section : son titre sans accents, en minuscules, mots joints par « - » (« section » s'il n'en reste rien). */
export function ancreDeSection(titre: string): string {
	const ancre = plier(titre)
		.replace(/[^\p{L}\p{N}]+/gu, '-')
		.replace(/^-+|-+$/gu, '');
	return ancre === '' ? ANCRE_PAR_DEFAUT : ancre;
}

const normaliser = (texte: string): string => texte.normalize('NFC').replace(/\s+/gu, ' ').trim();

/**
 * Passages du texte libre d'une fiche : la synthèse, chaque section hors informations et relations, puis les lignes de ces
 * deux sections que Mnemo n'a pas pu lire (`lignesBrutes` : du texte écrit à la main), découpées par
 * `decouperDocument` (titres, puis coupes par le contenu ; secrets masqués). Rien de ce qui change à chaque écriture
 * n'entre dans l'ancre ni dans le préfixe vectorisé, pour qu'un passage inchangé garde son vecteur :
 * - ancre : le titre le plus profond du passage (`###` compris ; `synthese` pour la synthèse) ; si plusieurs passages
 *   partagent ce titre, chacun reçoit `~` et 6 caractères de l'empreinte de son texte (`-2`… pour un texte en double).
 *   Une référence servie désigne donc toujours le même texte, ou plus rien ;
 * - préfixe : titre de la fiche › titres (ni date, ni référence) ; la ligne de contexte (synthèse) ne change qu'avec elle.
 * Une fiche `source` laisse sa section « Contenu » aux passages de document (note amorcée). Une consigne n'a pas de
 * passages : son texte est l'élément consigne.
 */
export function passagesDeFiche(fiche: Fiche): PassageDeFiche[] {
	if (fiche.type === 'consigne') return [];
	const textes: { synthese: boolean; markdown: string }[] = [];
	if (fiche.synthese.trim() !== '') textes.push({ synthese: true, markdown: fiche.synthese });
	for (const section of fiche.autresSections) {
		if (fiche.type === 'source' && section.titre === TITRE_CONTENU) continue;
		if (section.corps.trim() === '') continue;
		textes.push({ synthese: false, markdown: `## ${section.titre}\n\n${section.corps}` });
	}
	for (const { titre, lignes } of lignesBrutes(fiche)) textes.push({ synthese: false, markdown: `## ${titre}\n\n${lignes.join('\n')}` });
	const contexte: Contexte = { titre: fiche.titre, date: null, auteur: null, ficheSource: '' };
	const bruts: { base: string; texte: string; titres: string[]; synthese: boolean }[] = [];
	const ligne = ligneDeContexte(fiche.synthese);
	for (const { synthese, markdown } of textes) {
		for (const p of decouperDocument(markdown, contexte, undefined, 'contenu').passages) {
			const titre = p.titres.at(-1);
			let base = titre === undefined ? ANCRE_SYNTHESE : ancreDeSection(titre);
			// « #synthese » ne désigne que la synthèse : une section « Synthèse » a sa propre ancre.
			if (base === ANCRE_SYNTHESE && !(synthese && titre === undefined)) base = `section-${ANCRE_SYNTHESE}`;
			bruts.push({ base, texte: p.texte, titres: p.titres, synthese });
		}
	}
	const parBase = new Map<string, number>();
	for (const b of bruts) parBase.set(b.base, (parBase.get(b.base) ?? 0) + 1);
	const prises = new Set<string>();
	return bruts.map(({ base, texte, titres, synthese }) => {
		let ancre = base;
		if (parBase.get(base)! > 1) {
			const premiere = `${base}~${empreinte(normaliser(texte)).slice(0, 6)}`;
			ancre = premiere;
			for (let n = 2; prises.has(ancre); n++) ancre = `${premiere}-${n}`;
		}
		prises.add(ancre);
		return { ancre, texte, prefixe: prefixeDe(contexte, titres), titres, ligneContexte: synthese ? '' : ligne };
	});
}
