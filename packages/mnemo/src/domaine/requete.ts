import { plier } from '@mnemo/commun';
import { racinesDeRequete } from './racines.ts';

/** Mots d'un texte : minuscules, sans accents, découpés sur les non-lettres/chiffres, ≥ 2 caractères, sans doublon, ordre conservé. */
export function motsDe(texte: string): string[] {
	const mots = plier(texte)
		.split(/[^\p{L}\p{N}]+/u)
		.filter((mot) => [...mot].length >= 2);

	return [...new Set(mots)];
}

/** Mots d'un texte hors mots vides : ce qui porte le sens d'un message. Vide pour « c'est tout », « ok merci ». */
export function motsUtiles(texte: string): string[] {
	return motsDe(texte).filter((mot) => !MOTS_VIDES.has(mot));
}

const RE_MOT_SUR = /^[\p{L}\p{N}]+$/u;

/** Mots vides français (articles, pronoms, auxiliaires, mots interrogatifs, politesses) : ils ne portent pas le sens d'une question. */
export const MOTS_VIDES: ReadonlySet<string> = new Set([
	'le', 'la', 'les', 'un', 'une', 'des', 'du', 'de', 'au', 'aux', 'et', 'ou', 'mais', 'donc', 'car', 'ni', 'or',
	'que', 'qui', 'quoi', 'dont', 'ce', 'cet', 'cette', 'ces', 'son', 'sa', 'ses', 'leur', 'leurs', 'mon', 'ma', 'mes',
	'pour', 'dans', 'avec', 'sans', 'sur', 'sous', 'par', 'chez', 'vers', 'est', 'sont', 'etre', 'etait', 'sera', 'ont',
	'avoir', 'avait', 'pas', 'plus', 'tout', 'tous', 'comme', 'nous', 'vous', 'ils', 'elles', 'elle', 'ete', 'aussi', 'cela',
	'en', 'il', 'on', 'je', 'tu', 'se', 'ne', 'si', 'qu', 'me', 'te', 'ai', 'as', 'lui', 'moi', 'toi', 'nos', 'vos', 'notre', 'votre',
	'ton', 'ta', 'tes', 'suis', 'es', 'sommes', 'etes',
	'quel', 'quelle', 'quels', 'quelles', 'combien', 'comment', 'pourquoi', 'quand',
	// politesses et accusés de réception : « ok merci » ne demande aucun fait
	'ok', 'merci', 'oui', 'bonjour', 'salut', 'voila', 'parfait', 'super', 'bien', 'svp',
]);


/** Pluriel : un mot de 5 caractères ou plus (hors chiffres seuls) fini par « s » ou « x » perd cette lettre, pour que le préfixe trouve le singulier. */
function sansPluriel(mot: string): string {
	return [...mot].length >= 5 && /[sx]$/u.test(mot) && !/^\p{N}+$/u.test(mot) ? mot.slice(0, -1) : mot;
}

function terme(brut: string[]): string {
	const mots = brut.map(sansPluriel);
	for (const mot of mots) {
		if (!RE_MOT_SUR.test(mot)) throw new Error(`Mot inattendu dans une requête plein texte : « ${mot} ».`);
	}

	// Un mot de deux caractères est cherché tel quel : en préfixe, « de » trouverait « dépôt », « délai », « dossier »…
	const prefixe = [...mots[mots.length - 1]!].length > 2 ? '*' : '';
	return `"${mots.join(' ')}"${prefixe}`;
}

/** Colonne de l'index qui porte les racines françaises du texte et du contexte (voir `racinesDe`). */
export const COLONNE_RACINES = 'racines';

/**
 * Expression FTS5 construite uniquement à partir des mots de `motsDe` : aucune syntaxe de l'utilisateur ne passe.
 * Les mots vides sont retirés (tous gardés s'il ne reste rien) ; un mot de trois caractères ou plus est un préfixe.
 * `alias` : mot (normalisé) → formes équivalentes, chacune devenant une phrase préfixe. Un mot qui a une racine française
 * différente de son terme exact (« déploiement » → « deploi ») est aussi cherché par elle dans la colonne des racines,
 * exacte (sans préfixe) : « déployer » est trouvé, et l'index classe l'exact devant (poids plus faible des racines).
 */
export function expressionFts(texte: string, alias?: Map<string, string[]>): { toutes: string; une: string } | null {
	const racines = racinesDeRequete(texte);
	const tous = motsDe(texte);
	if (tous.length === 0) return null;
	const utiles = tous.filter((mot) => !MOTS_VIDES.has(mot));
	const mots = utiles.length > 0 ? utiles : tous;
	const normalises = new Map<string, string[]>();
	for (const [cle, formes] of alias ?? []) normalises.set(motsDe(cle).join(' '), formes);
	const termes = mots.map((mot) => {
		const variantes = [terme([mot])];
		for (const forme of normalises.get(mot) ?? []) {
			const motsDeLaForme = motsDe(forme);
			if (motsDeLaForme.length === 0) continue;
			const t = terme(motsDeLaForme);
			if (!variantes.includes(t)) variantes.push(t);
		}
		const racine = racines.get(mot);
		if (racine !== undefined && racine !== sansPluriel(mot) && RE_MOT_SUR.test(racine)) variantes.push(`${COLONNE_RACINES} : "${racine}"`);

		return variantes.length === 1 ? variantes[0]! : `(${variantes.join(' OR ')})`;
	});

	return { toutes: termes.join(' AND '), une: termes.join(' OR ') };
}

/** Similarité à partir de laquelle deux textes sont « proches » (quasi-doublons) avant écriture. */
export const SEUIL_PROCHE = 0.6;

function motsDeProximite(texte: string): Set<string> {
	return new Set(motsDe(texte).filter((mot) => [...mot].length >= 3 && !MOTS_VIDES.has(mot)));
}

/** Similarité de Jaccard sur les mots de 3 lettres ou plus, hors mots vides. */
export function similarite(a: string, b: string): number {
	const ma = motsDeProximite(a);
	const mb = motsDeProximite(b);
	let commun = 0;
	for (const mot of ma) if (mb.has(mot)) commun++;
	const union = ma.size + mb.size - commun;

	return union === 0 ? 0 : commun / union;
}
