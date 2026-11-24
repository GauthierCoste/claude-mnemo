/**
 * Termes interdits : comparaison par « squelette ». Texte et terme sont dépliés (NFKD : ligatures, pleine chasse, exposants),
 * privés de leurs accents, mis en minuscules, `œ`/`æ`/`ß`… remplacés (oe, ae, ss…), puis réduits à leurs lettres et chiffres :
 * séparateurs, espaces (insécables comprises), tirets, soulignés et ponctuation ne comptent pas. « Ombelle Rail » trouve donc
 * `ombellerail`, `ombelle-rail`, `Ombelle  Rail` ; « Verdurette » trouve `verdu_rette`, `VERDU RETTE`, `Ｖｅｒｄｕｒｅｔｔｅ`.
 *
 * Un terme dont le squelette a moins de `LONGUEUR_MOT_ENTIER` caractères est comparé en mot entier (ni lettre ni chiffre
 * juste avant ni juste après l'occurrence), sinon « rt » se trouverait dans `port`.
 *
 * Limite connue : un terme encodé (base64, URL, échappements `\uXXXX`, hexadécimal) n'est pas reconnu.
 */
import { readFileSync } from 'node:fs';

export const LONGUEUR_MOT_ENTIER = 4;

export type Terme = { numero: number; squelette: string };

/** Lettres que NFKD ne décompose pas. */
const SUBSTITUTIONS: Record<string, string> = { œ: 'oe', æ: 'ae', ß: 'ss', ø: 'o', đ: 'd', ð: 'd', ł: 'l', ŀ: 'l', ı: 'i', þ: 'th', ħ: 'h', ŧ: 't' };

/** Squelette d'un caractère (chaîne vide pour un séparateur ou un accent combinant). */
function squeletteCaractere(c: string): string {
	const code = c.charCodeAt(0);
	if (code < 128) {
		if ((code >= 48 && code <= 57) || (code >= 97 && code <= 122)) return c;
		if (code >= 65 && code <= 90) return String.fromCharCode(code + 32);
		return '';
	}
	let r = '';
	for (const x of c.normalize('NFKD').toLowerCase().normalize('NFKD')) {
		if (/\p{M}/u.test(x)) continue;
		const s = SUBSTITUTIONS[x] ?? x;
		if (/^[\p{L}\p{N}]+$/u.test(s)) r += s;
	}
	return r;
}

export function squelette(texte: string): string {
	let r = '';
	for (const c of texte) r += squeletteCaractere(c);
	return r;
}

/** Squelette du texte, avec pour chaque caractère produit les indices de début et de fin (exclue) du caractère d'origine. */
function squeletteAvecCarte(texte: string): { s: string; debuts: number[]; fins: number[] } {
	let s = '';
	const debuts: number[] = [];
	const fins: number[] = [];
	for (let i = 0; i < texte.length; ) {
		const c = String.fromCodePoint(texte.codePointAt(i)!);
		const sc = squeletteCaractere(c);
		for (let k = 0; k < sc.length; k++) {
			debuts.push(i);
			fins.push(i + c.length);
		}
		s += sc;
		i += c.length;
	}
	return { s, debuts, fins };
}

export function lireTermes(chemin: string): Terme[] {
	return readFileSync(chemin, 'utf8')
		.split(/\r?\n/)
		.map((t, i) => ({ texte: t.trim(), numero: i + 1 }))
		.filter((l) => l.texte !== '' && !l.texte.startsWith('#'))
		.map(({ texte, numero }) => ({ numero, squelette: squelette(texte) }))
		.filter((t) => t.squelette !== '');
}

export type Occurrence = { terme: Terme; debut: number; fin: number };

/** Lettre ou chiffre (le caractère qui commence à `i`), pour la comparaison en mot entier. */
function alphanumerique(texte: string, i: number): boolean {
	if (i < 0 || i >= texte.length) return false;
	const cp = texte.codePointAt(i)!;
	// Un demi-caractère de paire de substitution, lu à l'envers : on recule au début de la paire.
	const c = cp >= 0xdc00 && cp <= 0xdfff && i > 0 ? String.fromCodePoint(texte.codePointAt(i - 1)!) : String.fromCodePoint(cp);
	return squeletteCaractere(c) !== '';
}

/** Occurrences des termes dans `texte`, en plages du texte d'origine (accents combinants qui suivent compris). */
export function occurrences(texte: string, termes: Terme[]): Occurrence[] {
	if (termes.length === 0) return [];
	const { s, debuts, fins } = squeletteAvecCarte(texte);
	const trouvees: Occurrence[] = [];
	for (const terme of termes) {
		for (let p = s.indexOf(terme.squelette); p >= 0; p = s.indexOf(terme.squelette, p + 1)) {
			const debut = debuts[p]!;
			let fin = fins[p + terme.squelette.length - 1]!;
			while (fin < texte.length && /\p{M}/u.test(texte[fin]!)) fin++;
			if (terme.squelette.length < LONGUEUR_MOT_ENTIER && (alphanumerique(texte, debut - 1) || alphanumerique(texte, fin))) continue;
			trouvees.push({ terme, debut, fin });
		}
	}
	return trouvees;
}

/** Remplace chaque terme interdit par `[terme n°k]`. */
export function masquer(texte: string, termes: Terme[]): string {
	const plages = occurrences(texte, termes).sort((a, b) => a.debut - b.debut || b.fin - a.fin);
	let r = '';
	let curseur = 0;
	for (const p of plages) {
		if (p.debut < curseur) continue;
		r += `${texte.slice(curseur, p.debut)}[terme n°${p.terme.numero}]`;
		curseur = p.fin;
	}
	return r + texte.slice(curseur);
}
