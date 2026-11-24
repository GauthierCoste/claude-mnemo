// Contenu d'un document lu par morceaux (voir `Contenu`) : en mémoire, lu en entier sous une borne, haché en flux.
import { hacheurOctets } from '../domaine/empreinte.ts';
import { avertissementEncodage, ECHANTILLON_NATURE, ENCODAGE_DE_REPLI, marqueDOrdre } from '@mnemo/commun';
import type { Encodage } from '@mnemo/commun';
import { motifSiNonCherchable } from '../domaine/source.ts';
import { tailleLisible } from '@mnemo/commun';
import { ErreurExtraction } from './ports.ts';
import type { Contenu } from './ports.ts';

/** Taille des morceaux lus d'un document (hachage, lecture entière, découpage d'une boîte). */
export const MORCEAU = 4 * 1024 * 1024;

/** Un contenu déjà en mémoire (pièce jointe décodée, tests). */
export function contenuEnMemoire(octets: Uint8Array): Contenu {
	return {
		taille: octets.byteLength,
		async lire(position, longueur) {
			return octets.subarray(Math.min(position, octets.byteLength), Math.min(position + longueur, octets.byteLength));
		},
	};
}

/** Les morceaux du contenu, dans l'ordre, de `debut` à `fin` (exclue). */
export async function* morceaux(contenu: Contenu, debut = 0, fin = contenu.taille, taille = MORCEAU): AsyncGenerator<Uint8Array> {
	let position = debut;
	while (position < fin) {
		const lu = await contenu.lire(position, Math.min(taille, fin - position));
		if (lu.byteLength === 0) throw new Error('contenu plus court que sa taille annoncée');
		position += lu.byteLength;
		yield lu;
	}
}

/** Octets de `debut` à `fin` (exclue), en un tampon : réservé aux plages bornées par l'appelant. */
export async function lirePlage(contenu: Contenu, debut: number, fin: number): Promise<Uint8Array> {
	const tampon = new Uint8Array(fin - debut);
	let rempli = 0;
	for await (const m of morceaux(contenu, debut, fin)) {
		tampon.set(m, rempli);
		rempli += m.byteLength;
	}
	return tampon;
}

/**
 * Le contenu entier en un tampon, s'il ne dépasse pas `max` octets ; sinon `ErreurExtraction` « <format> trop volumineux » :
 * pour les bibliothèques qui exigent le fichier en mémoire (PDF, Word, un courriel).
 */
export async function lireEntier(contenu: Contenu, max: number, format: string): Promise<Uint8Array> {
	if (contenu.taille > max) {
		throw new ErreurExtraction(`${format} trop volumineux pour être extrait : ${tailleLisible(contenu.taille)} (${tailleLisible(max)} au plus pour ce format).`);
	}
	return lirePlage(contenu, 0, contenu.taille);
}

/**
 * Le contenu, haché au fil des lectures qui le parcourent dans l'ordre (le balayage d'une extraction) : `empreinte()` lit
 * seulement ce qui n'a pas été parcouru (rien après un balayage complet) et rend celle d'`empreinteContenu`.
 */
export function contenuHache(contenu: Contenu): { contenu: Contenu; empreinte(): Promise<string> } {
	const h = hacheurOctets();
	let suivant = 0;
	const ajouter = (position: number, octets: Uint8Array): void => {
		if (position > suivant || position + octets.byteLength <= suivant) return;
		h.ajouter(octets.subarray(suivant - position));
		suivant = position + octets.byteLength;
	};
	return {
		contenu: {
			taille: contenu.taille,
			async lire(position, longueur) {
				const octets = await contenu.lire(position, longueur);
				ajouter(position, octets);
				return octets;
			},
		},
		async empreinte() {
			for await (const m of morceaux(contenu, suivant)) ajouter(suivant, m);
			return h.resultat();
		},
	};
}

/** Empreinte (`empreinteOctets`) du contenu entier, calculée morceau par morceau. */
export async function empreinteContenu(contenu: Contenu): Promise<string> {
	const h = hacheurOctets();
	for await (const m of morceaux(contenu)) h.ajouter(m);
	return h.resultat();
}

/** Avertissement d'un texte extrait coupé à `max` caractères (`TEXTE_MAX_DOCUMENT`). */
export function texteCoupe(max: number): string {
	return `texte extrait coupé après ${max} caractères (limite par document) : la suite n'est pas indexée`;
}

/**
 * Le texte d'un fichier, décodé en flux et arrêté après `texteMax` caractères (`coupe`) : encodage de sa marque d'ordre
 * des octets, sinon UTF-8 strict, sinon (UTF-8 invalide) Windows-1252 en relisant depuis le début. `avertissements` dit
 * l'encodage quand ce n'est pas l'UTF-8. Un fichier binaire est refusé (`motifSiNonCherchable`).
 */
export async function lireTexte(chemin: string, contenu: Contenu, texteMax: number): Promise<{ texte: string; coupe: boolean; avertissements: string[] }> {
	const debut = await debutDe(contenu);
	const motif = motifSiNonCherchable(chemin, debut);
	if (motif !== null) throw new ErreurExtraction(motif);
	const marque = marqueDOrdre(debut);
	const decoder = async (encodage: Encodage, strict: boolean): Promise<{ texte: string; coupe: boolean }> => {
		const decodeur = new TextDecoder(encodage, { fatal: strict, ignoreBOM: true });
		const parts: string[] = [];
		let longueur = 0;
		let coupe = false;
		// le début déjà lu sert de premier morceau : rien n'est lu deux fois
		const suite = async function* (): AsyncGenerator<Uint8Array> {
			yield debut.subarray(marque?.longueur ?? 0);
			yield* morceaux(contenu, debut.byteLength);
		};
		for await (const m of suite()) {
			const t = decodeur.decode(m, { stream: true });
			parts.push(t);
			longueur += t.length;
			if (longueur > texteMax) {
				coupe = true;
				break;
			}
		}
		if (!coupe) parts.push(decodeur.decode());
		const texte = parts.join('');
		return texte.length > texteMax ? { texte: texte.slice(0, texteMax), coupe: true } : { texte, coupe };
	};
	const avec = (lu: { texte: string; coupe: boolean }, encodage: Encodage, suppose: boolean) => {
		const avis = avertissementEncodage(encodage, suppose);
		return { ...lu, avertissements: avis === null ? [] : [avis] };
	};
	if (marque !== null) return avec(await decoder(marque.encodage, false), marque.encodage, false);
	try {
		return avec(await decoder('utf-8', true), 'utf-8', false);
	} catch (erreur) {
		// UTF-8 invalide : `TextDecoder` strict lève une TypeError ; une autre erreur (lecture) remonte
		if (!(erreur instanceof TypeError)) throw erreur;
		return avec(await decoder(ENCODAGE_DE_REPLI, false), ENCODAGE_DE_REPLI, true);
	}
}

/** Les premiers octets du contenu (`ECHANTILLON_NATURE` au plus) : de quoi reconnaître son encodage et un binaire. */
export function debutDe(contenu: Contenu): Promise<Uint8Array> {
	return lirePlage(contenu, 0, Math.min(ECHANTILLON_NATURE, contenu.taille));
}
