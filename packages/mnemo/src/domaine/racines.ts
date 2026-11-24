// Racines françaises des mots, pour la recherche plein texte : « déploiement » trouve « déployer ». Pur, sans module `node:`.
// Racinisateur Snowball français de `@orama/stemmers` (licence Apache-2.0, JavaScript pur, sans dépendance).
import { stemmer } from '@orama/stemmers/french';
import { sansAccents } from '@mnemo/commun';
import { MOTS_VIDES } from './requete.ts';

/** Un mot de moins de lettres n'est pas racinisé (« api », « vps », « mis ») : il reste au texte exact. */
const LETTRES_MIN = 4;
/**
 * Morceau de texte (entre deux blancs) qui ressemble à du code ou à une référence : `snake_case`, chemin, nom de fichier,
 * adresse, `camelCase`, mélange de lettres et de chiffres. Aucun de ses mots n'est racinisé.
 */
const RE_IDENTIFIANT = /[_/\\.@#$=:~]|\p{N}|\p{Ll}\p{Lu}/u;
/** Sigle (« HTTPS », « API ») : jamais racinisé. */
const RE_SIGLE = /^\p{Lu}{2,}$/u;
const RE_BORDS = /^[^\p{L}\p{N}_]+|[^\p{L}\p{N}_]+$/gu;

/** Racine d'un mot seul (lettres seulement), ou null s'il ne se racinise pas (court, mot vide, sigle, identifiant, nombre). */
export function racineDuMot(mot: string): string | null {
	if (RE_IDENTIFIANT.test(mot) || RE_SIGLE.test(mot) || !/^\p{L}+$/u.test(mot) || [...mot].length < LETTRES_MIN) return null;
	const minuscule = mot.normalize('NFC').toLowerCase();
	if (MOTS_VIDES.has(sansAccents(minuscule))) return null;
	return sansAccents(stemmer(minuscule));
}

/** Mots racinisables d'un texte, dans l'ordre, chacun avec sa racine (`cache` : racines déjà calculées dans cet appel). */
function* motsRacinises(texte: string): Generator<{ mot: string; racine: string }> {
	const cache = new Map<string, string | null>();
	for (const morceau of texte.split(/\s+/u)) {
		const net = morceau.replace(RE_BORDS, '');
		if (net === '' || RE_IDENTIFIANT.test(net)) continue;
		for (const mot of net.split(/[^\p{L}]+/u)) {
			if (mot === '') continue;
			let racine = cache.get(mot);
			if (racine === undefined) {
				racine = racineDuMot(mot);
				cache.set(mot, racine);
			}
			if (racine !== null) yield { mot, racine };
		}
	}
}

/** Racines d'un texte, séparées par des espaces, répétitions comprises (colonne `racines` de l'index). */
export function racinesDe(texte: string): string {
	const racines: string[] = [];
	for (const { racine } of motsRacinises(texte)) racines.push(racine);
	return racines.join(' ');
}

/** Racines des mots d'une recherche, par mot tel que `motsDe` le rend (minuscules, sans accents). */
export function racinesDeRequete(texte: string): Map<string, string> {
	const racines = new Map<string, string>();
	for (const { mot, racine } of motsRacinises(texte)) {
		const cle = sansAccents(mot).toLowerCase();
		if (!racines.has(cle)) racines.set(cle, racine);
	}
	return racines;
}
