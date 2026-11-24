// Calculs sur les vecteurs du « sens » : pur, sans entrée-sortie ni module `node:`.
import { empreinte } from './empreinte.ts';
import { tronquerTexte } from './texte.ts';

const LIMITE_TEXTE = 2000;
const OCTETS_PAR_VALEUR = 4;
const PETIT_BOUTISTE = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;

type Voisin = { id: string; similarite: number };

/** Vecteur de norme 1 ; un vecteur nul est rendu inchangé. */
export function normaliser(v: Float32Array): Float32Array {
	let somme = 0;
	for (const x of v) somme += x * x;
	if (somme === 0 || !Number.isFinite(somme)) return v;
	const norme = Math.sqrt(somme);

	return Float32Array.from(v, (x) => x / norme);
}

/** Similarité cosinus ; 0 si l'un des vecteurs est nul ; erreur si les dimensions diffèrent. */
export function cosinus(a: Float32Array, b: Float32Array): number {
	if (a.length !== b.length) throw new Error(`Dimensions différentes : ${a.length} et ${b.length}.`);
	let produit = 0;
	let na = 0;
	let nb = 0;
	for (let i = 0; i < a.length; i++) {
		const x = a[i]!;
		const y = b[i]!;
		produit += x * y;
		na += x * x;
		nb += y * y;
	}
	if (na === 0 || nb === 0) return 0;

	const valeur = produit / (Math.sqrt(na) * Math.sqrt(nb));

	return Number.isFinite(valeur) ? Math.min(1, Math.max(-1, valeur)) : 0;
}

/** Vrai si `a` est un moins bon voisin que `b` : similarité plus basse, ou égale avec un id plus grand. */
function pire(a: Voisin, b: Voisin): boolean {
	return a.similarite < b.similarite || (a.similarite === b.similarite && a.id > b.id);
}

/**
 * Les `limite` candidats les plus proches de `requete`, du plus proche au moins proche (égalités : id croissant).
 * Tas borné : la liste n'est ni gardée ni triée en entier (les candidats peuvent venir d'un générateur).
 */
export function plusProches(
	requete: Float32Array,
	candidats: Iterable<{ id: string; vecteur: Float32Array }>,
	limite: number,
): Voisin[] {
	if (!(limite >= 1)) return [];
	const tas: Voisin[] = []; // le pire des retenus à la racine
	const echanger = (i: number, j: number): void => {
		[tas[i], tas[j]] = [tas[j]!, tas[i]!];
	};
	const monter = (debut: number): void => {
		let i = debut;
		while (i > 0) {
			const parent = (i - 1) >> 1;
			if (!pire(tas[i]!, tas[parent]!)) break;
			echanger(i, parent);
			i = parent;
		}
	};
	const descendre = (): void => {
		let i = 0;
		for (;;) {
			const g = 2 * i + 1;
			const d = g + 1;
			let pireIndice = i;
			if (g < tas.length && pire(tas[g]!, tas[pireIndice]!)) pireIndice = g;
			if (d < tas.length && pire(tas[d]!, tas[pireIndice]!)) pireIndice = d;
			if (pireIndice === i) return;
			echanger(i, pireIndice);
			i = pireIndice;
		}
	};

	for (const { id, vecteur } of candidats) {
		const voisin = { id, similarite: cosinus(requete, vecteur) };
		if (tas.length < limite) {
			tas.push(voisin);
			monter(tas.length - 1);
		} else if (pire(tas[0]!, voisin)) {
			tas[0] = voisin;
			descendre();
		}
	}

	return tas.sort((a, b) => b.similarite - a.similarite || a.id.localeCompare(b.id));
}

/** Float32 petit-boutiste, quelle que soit la plate-forme. */
export function encoderVecteur(v: Float32Array): Uint8Array {
	const octets = new Uint8Array(v.length * OCTETS_PAR_VALEUR);
	const vue = new DataView(octets.buffer);
	v.forEach((x, i) => vue.setFloat32(i * OCTETS_PAR_VALEUR, x, true));

	return octets;
}

export function decoderVecteur(octets: Uint8Array, dimension: number): Float32Array {
	if (octets.length !== dimension * OCTETS_PAR_VALEUR) {
		throw new Error(`Vecteur illisible : ${octets.length} octets pour une dimension de ${dimension} (${dimension * OCTETS_PAR_VALEUR} attendus).`);
	}
	// Plate-forme petit-boutiste (presque toutes) : copie directe des octets, bien plus rapide (cache de dizaines de milliers de vecteurs).
	if (PETIT_BOUTISTE) {
		const copie = new Uint8Array(octets.byteLength);
		copie.set(octets);
		return new Float32Array(copie.buffer);
	}
	const vue = new DataView(octets.buffer, octets.byteOffset, octets.byteLength);

	return Float32Array.from({ length: dimension }, (_, i) => vue.getFloat32(i * OCTETS_PAR_VALEUR, true));
}

/** Texte soumis au modèle : préfixe de contexte, ligne vide, texte ; au plus 2 000 caractères (points de code). */
export function texteAVectoriser(prefixe: string, texte: string): string {
	return tronquerTexte(prefixe === '' ? texte : `${prefixe}\n\n${texte}`, LIMITE_TEXTE);
}

/**
 * Version du préfixe indexé (texte cherché et vectorisé autour d'un élément) : elle entre dans l'empreinte de sens, pour
 * qu'un changement de la façon de bâtir le préfixe rende périmés les vecteurs calculés avant. 2 : ligne de contexte.
 */
export const VERSION_PREFIXE = 2;

/** Préfixe indexé d'un passage : son préfixe servi, puis sa ligne de contexte (synthèse, résumé du document) s'il en a une. */
export function prefixeIndexe(prefixe: string, ligneContexte: string): string {
	if (ligneContexte === '') return prefixe;
	return prefixe === '' ? ligneContexte : `${prefixe}\n${ligneContexte}`;
}

/** Empreinte du texte vectorisé (préfixe indexé, texte), version du préfixe comprise : un vecteur d'une autre empreinte est à refaire. */
export function empreinteSens(prefixe: string, texte: string): string {
	return empreinte(`${VERSION_PREFIXE}\u0000${texteAVectoriser(prefixe, texte)}`);
}
