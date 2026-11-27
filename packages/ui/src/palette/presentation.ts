/**
 * Présentation d'un résultat du moteur dans la palette : genre, titre, chemin court et extrait découpé en segments
 * (surlignés ou non) — des segments de texte, rendus en éléments React, jamais en HTML.
 */
import type { TrouveRechercheVue } from '@mnemo/contrat';
import { plier } from '@mnemo/commun';
import { TEXTES, type Textes } from '../langue/textes.ts';
import { estDocument } from './resultats.ts';

export type Segment = { texte: string; surligne: boolean };

/** Longueur visée d'un extrait (caractères), et contexte gardé avant le premier mot trouvé. */
export const LONGUEUR_EXTRAIT = 160;
const AVANT_EXTRAIT = 40;
const SEPARATEUR_CONTEXTE = ' › ';

/** Libellé du genre d'un résultat (lu aussi par les lecteurs d'écran). */
export function libelleGenre(t: Pick<TrouveRechercheVue, 'genre' | 'chemin' | 'typeFiche'>, genres: Textes['coquille']['palette']['genres'] = TEXTES.fr.coquille.palette.genres): string {
	if (estDocument(t.typeFiche)) return t.genre === 'fiche' ? genres.document : genres.passageDocument;
	return genres[t.genre];
}

/** Titre de la fiche du résultat : sa première ligne pour une fiche, sinon le titre tiré du contexte, ou le nom du fichier. */
export function titreDe(t: Pick<TrouveRechercheVue, 'genre' | 'chemin' | 'texte' | 'contexte'>): string {
	if (t.genre === 'fiche') return t.texte.split('\n')[0]!.trim() || nomDe(t.chemin);
	const rang = t.chemin.replace(/\.md$/u, '').split('/').length - 1;
	return t.contexte.split(SEPARATEUR_CONTEXTE)[rang]?.trim() || nomDe(t.chemin);
}

/** Texte où chercher l'extrait : la synthèse d'une fiche (après son titre), sinon le texte de l'élément. */
export function corpsDe(t: Pick<TrouveRechercheVue, 'genre' | 'texte'>): string {
	const texte = t.genre === 'fiche' ? t.texte.split('\n').slice(1).join(' ') : t.texte;
	return texte.replace(/\s+/gu, ' ').trim();
}

const nomDe = (chemin: string) => chemin.replace(/\.md$/u, '').split('/').pop() ?? chemin;

/** Dossier de la fiche, court : « racine », ou les deux derniers dossiers précédés de « …/ » au-delà de trois. */
export function cheminCourt(chemin: string, racine: string = TEXTES.fr.coquille.arbre.racine): string {
	const dossiers = chemin.split('#')[0]!.split('/').slice(0, -1);
	if (dossiers.length === 0) return racine;
	return dossiers.length > 3 ? `…/${dossiers.slice(-2).join('/')}` : dossiers.join('/');
}

/** Texte plié caractère par caractère, avec pour chaque caractère plié l'indice du caractère d'origine. */
function plierAvecIndices(texte: string): { plie: string; origine: number[] } {
	let plie = '';
	const origine: number[] = [];
	for (let i = 0; i < texte.length; ) {
		const point = texte.codePointAt(i)!;
		const car = String.fromCodePoint(point);
		const p = plier(car);
		for (let k = 0; k < p.length; k++) origine.push(i);
		plie += p;
		i += car.length;
	}
	origine.push(texte.length);
	return { plie, origine };
}

/**
 * Intervalles [début, fin) du texte d'origine à surligner, fusionnés : dans chaque mot du texte (sans accents ni casse),
 * le début qui est un mot cherché (« stoc » dans « stocks »), ou le mot entier quand il est le mot cherché à une
 * terminaison près (« stock » pour « stocks » : le moteur trouve aussi ces formes).
 */
function intervalles(texte: string, mots: readonly string[]): [number, number][] {
	const { plie, origine } = plierAvecIndices(texte);
	const bruts: [number, number][] = [];
	for (const jeton of plie.matchAll(/[\p{L}\p{N}]+/gu)) {
		const t = jeton[0];
		const debut = jeton.index;
		let fin = debut;
		for (const m of mots) {
			if (t.startsWith(m)) fin = Math.max(fin, debut + m.length);
			else if (t.length >= 4 && m.startsWith(t) && m.length - t.length <= 2) fin = debut + t.length;
		}
		if (fin > debut) bruts.push([origine[debut]!, origine[fin] ?? texte.length]);
	}
	const fusion: [number, number][] = [];
	for (const [d, f] of bruts) {
		const dernier = fusion.at(-1);
		if (dernier && d <= dernier[1]) dernier[1] = Math.max(dernier[1], f);
		else fusion.push([d, f]);
	}
	return fusion;
}

/** Découpe un texte en segments, les mots surlignés. */
export function surligner(texte: string, mots: readonly string[]): Segment[] {
	const segments: Segment[] = [];
	let curseur = 0;
	for (const [d, f] of intervalles(texte, mots)) {
		if (d > curseur) segments.push({ texte: texte.slice(curseur, d), surligne: false });
		segments.push({ texte: texte.slice(d, f), surligne: true });
		curseur = f;
	}
	if (curseur < texte.length) segments.push({ texte: texte.slice(curseur), surligne: false });
	return segments;
}

/**
 * Extrait d'au plus `LONGUEUR_EXTRAIT` caractères autour du premier mot trouvé (le début du texte si aucun), « … » aux
 * coupures, mots surlignés ; vide si le texte l'est.
 */
export function extrait(texte: string, mots: readonly string[], longueur = LONGUEUR_EXTRAIT): Segment[] {
	if (texte === '') return [];
	const premier = intervalles(texte, mots)[0]?.[0] ?? 0;
	let debut = premier > AVANT_EXTRAIT ? premier - AVANT_EXTRAIT : 0;
	// début sur une frontière de mot
	if (debut > 0) {
		const espace = texte.indexOf(' ', debut);
		if (espace >= 0 && espace < premier) debut = espace + 1;
	}
	const fin = Math.min(texte.length, debut + longueur);
	const morceau = `${debut > 0 ? '…' : ''}${texte.slice(debut, fin)}${fin < texte.length ? '…' : ''}`;
	return surligner(morceau, mots);
}
