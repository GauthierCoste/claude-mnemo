export type Nature = 'declare' | 'observe' | 'infere';

/**
 * Source ajoutée à une information après coup : une ligne `  + src: … | corroboré AAAA-MM-JJ` sous l'information (et sous
 * sa citation), suivie de sa propre citation facultative. `source` : la mention, comme `src:` ; `le` : date de l'ajout.
 */
export type Corroboration = { source: string; citation?: string; le: string };

export type Fait = {
	texte: string;
	categorie?: string;
	nature?: Nature;
	source?: string;
	appris?: string;
	valideDebut?: string;
	valideFin?: string;
	finIncluse: boolean;
	confiance?: number;
	aConfirmer: boolean;
	/** Ancre du fait que celui-ci contredit (contradiction à confirmer) ; gardée après la décision, pour l'historique. */
	contredit?: string;
	barre: boolean;
	invalideLe?: string;
	invalidePar?: string;
	ancre?: string;
	citation?: string;
	/** Sources ajoutées après la première, dans l'ordre de la fiche ; absent : aucune. */
	corroborations?: Corroboration[];
};

export const LONGUEUR_MAX_FAIT = 500;
export const LONGUEUR_MAX_CITATION = 500;

const SEPARATEUR = ' | ';
const DATE = '\\d{4}-\\d{2}-\\d{2}';
const ANCRE = 'f-\\d{4,9}';
const BLANCS = /[\s   ]+/gu;
const NATURES: readonly string[] = ['declare', 'observe', 'infere'];

const RE_ANCRE_FINALE = new RegExp(` \\^(${ANCRE})$`, 'u');
// Mentions qui se terminent par un renvoi `^f-NNNN` : en fin de ligne, ce renvoi n'est pas l'ancre du fait.
const RE_RENVOI_SANS_ANCRE = new RegExp(`(?:(?:^| )invalidé ${DATE} par|^contredit)$`, 'u');
const CATEGORIE = '[\\p{Ll}\\p{N}_-]{1,40}';
const RE_CATEGORIE = new RegExp(`^\\[(${CATEGORIE})\\] (.*)$`, 'u');
const RE_NOM_CATEGORIE = new RegExp(`^${CATEGORIE}$`, 'u');
const RE_VALIDE = new RegExp(`^valide \\[(${DATE})?,(${DATE})?([)\\]])$`, 'u');
const RE_SOURCE = /^src: (.+)$/u;
const RE_APPRIS = new RegExp(`^appris (${DATE})$`, 'u');
const RE_CONFIANCE = /^confiance (\d{1,3}) %$/u;
const RE_INVALIDE = new RegExp(`^invalidé (${DATE})(?: par \\^(${ANCRE}))?$`, 'u');
const RE_CONTREDIT = new RegExp(`^contredit \\^(${ANCRE})$`, 'u');
const RE_CITATION = /^ {2}> « (.+) »$/u;
const RE_CORROBORATION = new RegExp(`^ {2}\\+ src: (.+) \\| corroboré (${DATE})$`, 'u');

/** Vrai pour une date AAAA-MM-JJ qui existe au calendrier. */
export function estDate(valeur: string): boolean {
	const t = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(valeur);
	if (t === null) return false;
	const [annee, mois, jour] = [Number(t[1]), Number(t[2]), Number(t[3])];
	const date = new Date(Date.UTC(annee, mois - 1, jour));
	return date.getUTCFullYear() === annee && date.getUTCMonth() === mois - 1 && date.getUTCDate() === jour;
}

/** Catégorie de fait valide : minuscules, chiffres, « _ » ou « - », 40 caractères au plus. */
export function estCategorie(valeur: unknown): valeur is string {
	return typeof valeur === 'string' && RE_NOM_CATEGORIE.test(valeur);
}

/**
 * Null pour une ligne mal formée : l'appelant la garde telle quelle dans la fiche. `suivantes` : les lignes qui suivent,
 * où se lisent la citation (`  > « … »`) puis les corroborations (`  + src: … | corroboré AAAA-MM-JJ`, chacune suivie de
 * sa citation facultative) ; la lecture s'arrête à la première ligne qui n'en est pas une (`lignesDuFait` dit combien
 * de lignes le fait occupe).
 */
export function lireFait(ligne: string, ...suivantes: readonly (string | undefined)[]): Fait | null {
	if (!ligne.startsWith('- ')) {
		return null;
	}
	let reste = ligne.slice(2);
	if (reste.startsWith('| ')) {
		return null;
	}
	let ancre: string | undefined;
	const trouveeAncre = RE_ANCRE_FINALE.exec(reste);
	if (trouveeAncre !== null) {
		const sansAncre = reste.slice(0, -trouveeAncre[0].length);
		// Le renvoi d'une invalidation (`par ^f-NNNN`) ou d'une contradiction en fin de ligne n'est pas l'ancre du fait.
		if (!RE_RENVOI_SANS_ANCRE.test(sansAncre.split(SEPARATEUR).pop() ?? '')) {
			ancre = trouveeAncre[1];
			reste = sansAncre;
		}
	}
	const segments = reste.split(SEPARATEUR);
	let enonce = segments.shift() ?? '';
	let categorie: string | undefined;
	const trouveeCategorie = RE_CATEGORIE.exec(enonce);
	if (trouveeCategorie !== null) {
		categorie = trouveeCategorie[1];
		enonce = trouveeCategorie[2]!;
	}
	const barre = enonce.length > 4 && enonce.startsWith('~~') && enonce.endsWith('~~');
	if (barre) {
		enonce = enonce.slice(2, -2);
	}
	if (enonce.trim() === '' || enonce.includes('~~')) {
		return null;
	}

	const fait: Fait = { texte: enonce, finIncluse: false, aConfirmer: false, barre };
	if (categorie !== undefined) fait.categorie = categorie;
	const vues = new Set<string>();
	for (const segment of segments) {
		const genre = lireMention(segment, fait);
		if (genre === null || vues.has(genre)) {
			return null;
		}
		vues.add(genre);
	}
	if (ancre !== undefined) fait.ancre = ancre;
	let i = 0;
	const citation = lireCitation(suivantes[i]);
	if (citation !== null) {
		fait.citation = citation;
		i++;
	}
	const corroborations: Corroboration[] = [];
	for (let t = lireCorroboration(suivantes[i]); t !== null; t = lireCorroboration(suivantes[i])) {
		i++;
		const corroboration: Corroboration = { source: t.source, le: t.le };
		const citee = lireCitation(suivantes[i]);
		if (citee !== null) {
			corroboration.citation = citee;
			i++;
		}
		corroborations.push(corroboration);
	}
	if (corroborations.length > 0) fait.corroborations = corroborations;

	return fait;
}

function lireCitation(ligne: string | undefined): string | null {
	return ligne === undefined ? null : RE_CITATION.exec(ligne)?.[1] ?? null;
}

// Une mention de source ne contient pas le séparateur : elle ne pourrait pas se relire sur la ligne de l'information.
function lireCorroboration(ligne: string | undefined): { source: string; le: string } | null {
	const t = ligne === undefined ? null : RE_CORROBORATION.exec(ligne);
	if (t === null || t[1]!.includes(SEPARATEUR)) return null;
	return { source: t[1]!, le: t[2]! };
}

/** Nombre de lignes qu'occupe le fait dans la fiche : la sienne, sa citation, ses corroborations et leurs citations. */
export function lignesDuFait(fait: Fait): number {
	let n = fait.citation === undefined ? 1 : 2;
	for (const c of fait.corroborations ?? []) n += c.citation === undefined ? 1 : 2;
	return n;
}

// Applique la mention au fait et renvoie son genre, ou null si elle est inconnue ou invalide.
function lireMention(segment: string, fait: Fait): string | null {
	if (NATURES.includes(segment)) {
		fait.nature = segment as Nature;
		return 'nature';
	}
	if (segment === 'a confirmer') {
		fait.aConfirmer = true;
		return 'a confirmer';
	}
	let t = RE_VALIDE.exec(segment);
	if (t !== null) {
		if (t[1] === undefined && t[2] === undefined) return null;
		if (t[1] !== undefined) fait.valideDebut = t[1];
		if (t[2] !== undefined) fait.valideFin = t[2];
		fait.finIncluse = t[3] === ']';
		return 'valide';
	}
	t = RE_SOURCE.exec(segment);
	if (t !== null) {
		fait.source = t[1]!;
		return 'src';
	}
	t = RE_APPRIS.exec(segment);
	if (t !== null) {
		fait.appris = t[1]!;
		return 'appris';
	}
	t = RE_CONFIANCE.exec(segment);
	if (t !== null && Number(t[1]) <= 100) {
		fait.confiance = Number(t[1]);
		return 'confiance';
	}
	t = RE_CONTREDIT.exec(segment);
	if (t !== null) {
		fait.contredit = t[1]!;
		return 'contredit';
	}
	t = RE_INVALIDE.exec(segment);
	if (t !== null) {
		fait.invalideLe = t[1]!;
		if (t[2] !== undefined) fait.invalidePar = t[2];
		return 'invalide';
	}
	return null;
}

/** Une ligne, suivie de la ligne de citation s'il y en a une, puis de chaque corroboration et de sa citation. */
export function ecrireFait(fait: Fait): string[] {
	const mentions: string[] = [];
	if (fait.nature !== undefined) mentions.push(fait.nature);
	if (fait.source !== undefined) mentions.push(`src: ${fait.source}`);
	if (fait.appris !== undefined) mentions.push(`appris ${fait.appris}`);
	if (fait.valideDebut !== undefined || fait.valideFin !== undefined) {
		mentions.push(`valide [${fait.valideDebut ?? ''},${fait.valideFin ?? ''}${fait.finIncluse ? ']' : ')'}`);
	}
	if (fait.confiance !== undefined) mentions.push(`confiance ${fait.confiance} %`);
	if (fait.aConfirmer) mentions.push('a confirmer');
	if (fait.contredit !== undefined) mentions.push(`contredit ^${fait.contredit}`);
	if (fait.invalideLe !== undefined) {
		mentions.push(`invalidé ${fait.invalideLe}${fait.invalidePar === undefined ? '' : ` par ^${fait.invalidePar}`}`);
	}
	const categorie = fait.categorie === undefined ? '' : `[${fait.categorie}] `;
	const ligne = `- ${categorie}${fait.barre ? `~~${fait.texte}~~` : fait.texte}${mentions.map((m) => SEPARATEUR + m).join('')}${fait.ancre === undefined ? '' : ` ^${fait.ancre}`}`;

	const lignes = [ligne];
	if (fait.citation !== undefined) lignes.push(ligneDeCitation(fait.citation));
	for (const c of fait.corroborations ?? []) {
		lignes.push(`  + src: ${c.source}${SEPARATEUR}corroboré ${c.le}`);
		if (c.citation !== undefined) lignes.push(ligneDeCitation(c.citation));
	}
	return lignes;
}

const ligneDeCitation = (citation: string): string => `  > « ${citation} »`;

/**
 * Même énoncé : catégorie, texte et validité ; ni les mentions, ni la rature, ni la cible d'un lien `[[…]]`
 * (Obsidian la réécrit au renommage d'une fiche), ni les espaces.
 */
export function memeEnonce(a: Fait, b: Fait): boolean {
	return a.categorie === b.categorie
		&& texteCompare(a.texte) === texteCompare(b.texte)
		&& a.valideDebut === b.valideDebut
		&& a.valideFin === b.valideFin
		&& a.finIncluse === b.finIncluse;
}

function texteCompare(texte: string): string {
	return texte.replace(/\[\[[^\]]*\]\]/gu, '[[]]').replace(BLANCS, ' ').trim();
}

const CHAMPS_FAIT: readonly (keyof Fait)[] = [
	'texte', 'categorie', 'nature', 'source', 'appris', 'valideDebut', 'valideFin', 'finIncluse',
	'confiance', 'aConfirmer', 'contredit', 'barre', 'invalideLe', 'invalidePar', 'ancre', 'citation',
];

/**
 * Égalité champ à champ (une clé absente et une clé `undefined` sont égales ; aucune corroboration, absente ou liste vide,
 * c'est pareil).
 */
export function faitsEgaux(a: Fait | null, b: Fait | null): boolean {
	if (a === null || b === null) return a === b;
	return CHAMPS_FAIT.every((champ) => a[champ] === b[champ]) && corroborationsEgales(a.corroborations ?? [], b.corroborations ?? []);
}

function corroborationsEgales(a: readonly Corroboration[], b: readonly Corroboration[]): boolean {
	return a.length === b.length && a.every((c, i) => c.source === b[i]!.source && c.le === b[i]!.le && c.citation === b[i]!.citation);
}
