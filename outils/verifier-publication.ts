/**
 * Garde anti-fuite avant une publication publique du dépôt :
 * `pnpm verifier-publication [dossier] [--commit <rév>] [--json] [--strict]`.
 *
 * Sans dossier, vérifie le contenu commité du dépôt courant (`HEAD`, ou `--commit <rév>`), pas la copie de travail ; avec un
 * dossier (un export, par exemple), tous ses fichiers sauf `.git/` et `node_modules/` (voir publication/sources.ts). Règles :
 * - liste blanche (`publication/liste-blanche.txt`, motifs glob, `!` pour exclure, la dernière ligne qui s'applique gagne) :
 *   tout fichier hors liste est signalé, et seuls les fichiers de la liste sont lus ;
 * - termes interdits : fichier local jamais versionné (`MNEMO_TERMES_INTERDITS`, sinon `~/.config/mnemo/termes-interdits.txt`),
 *   un terme par ligne, comparé au contenu et aux chemins sans casse, accents, séparateurs ni formes de compatibilité (voir
 *   publication/termes.ts) ; un terme n'est jamais affiché : on donne son numéro de ligne dans le fichier des termes, et tout
 *   chemin, extrait ou message affiché qui en contient un est masqué (le dossier personnel devient `~`) ;
 * - secrets (clés AWS et Google, jetons GitHub, GitLab, Slack, npm, Stripe, `sk-…`, JWT, clés privées, `Bearer` longs, URL
 *   avec identifiants, chaînes à forte entropie affectées à un nom de secret), chemins personnels (dossiers d'utilisateur
 *   macOS, Linux et Windows, leur forme encodée par Claude Code, le dossier Workspace de l'auteur sous ses formes usuelles),
 *   adresses e-mail hors domaines d'exemple, fichiers de plus de 1 Mo, binaires inattendus, liens symboliques qui sortent de
 *   la racine ;
 * - les binaires (images, PDF, tout fichier avec un octet nul) sont fouillés aussi : chaînes lisibles et métadonnées (voir
 *   publication/binaires.ts).
 * Les faux positifs se déclarent dans `publication/exceptions.txt`, chacun sous un commentaire qui le justifie.
 * Un terme interdit ne s'admet que dans l'identité publique de l'auteur (`publication/identite-publique.txt` : un glob de
 * fichier et le texte exact admis, par exemple le nom de la licence) ; un faux positif de terme se retire de la liste locale.
 *
 * Limites : un terme ou un secret encodé (base64, URL, `\uXXXX`, hexadécimal hors PDF) ou coupé sur deux lignes n'est pas
 * reconnu ; seuls les secrets de forme connue ou affectés à un nom de secret le sont.
 *
 * Code de sortie : 0 sans constat, 1 sinon (ou configuration invalide, ou `--strict` sans fichier de termes). Aucun accès réseau.
 */
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';
import { parseArgs } from 'node:util';
import { segmentsBinaires } from './publication/binaires.ts';
import { depuisDossier, depuisGit, lienHorsRacine } from './publication/sources.ts';
import type { Entree, Source } from './publication/sources.ts';
import { lireTermes, masquer, occurrences } from './publication/termes.ts';
import type { Terme } from './publication/termes.ts';

export type Regle =
	| 'hors-liste-blanche'
	| 'terme-interdit'
	| 'secret'
	| 'chemin-personnel'
	| 'email'
	| 'fichier-lourd'
	| 'binaire'
	| 'lien-symbolique';

/**
 * Un constat tel qu'affiché : `fichier` et `extrait` sont déjà masqués (aucun terme interdit). `ligne` pour un fichier texte,
 * `lieu` pour un binaire (octet, bloc PNG, flux PDF) ou la cible d'un lien.
 */
export type Constat = { regle: Regle; fichier: string; ligne?: number; lieu?: string; detail: string; extrait?: string };

export type Rapport = { ok: boolean; mode: 'git' | 'dossier'; racine: string; fichiers: number; constats: Constat[]; avertissements: string[] };

export type Sorties = { ecrire(texte: string): void; erreur(texte: string): void };

/** Taille au-delà de laquelle un fichier est signalé. */
export const TAILLE_MAX = 1024 * 1024;

/** Binaires attendus (images, polices) : pas signalés comme binaires, mais fouillés. */
const EXTENSIONS_BINAIRES = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.woff', '.woff2', '.pdf']);

/** Règles qu'une exception peut lever (la liste blanche et les termes se règlent dans leurs propres fichiers). */
const REGLES_EXCEPTABLES = new Set<Regle>(['secret', 'chemin-personnel', 'email', 'fichier-lourd', 'binaire', 'lien-symbolique']);

const TITRES: Record<Regle, string> = {
	'hors-liste-blanche': 'Hors de la liste blanche',
	'terme-interdit': 'Termes interdits',
	secret: 'Secrets',
	'chemin-personnel': 'Chemins personnels',
	email: 'Adresses e-mail',
	'fichier-lourd': 'Fichiers de plus de 1 Mo',
	binaire: 'Binaires inattendus',
	'lien-symbolique': 'Liens symboliques hors de la racine',
};

type Motif = { sous: string; detail: string; regex: RegExp };

/** Secrets reconnus à leur forme. L'en-tête PEM est assemblé pour que ce fichier ne se signale pas lui-même. */
const SECRETS: Motif[] = [
	{ sous: 'aws', detail: 'clé AWS', regex: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
	{ sous: 'google', detail: 'clé Google', regex: /\bAIza[0-9A-Za-z_-]{35}\b/g },
	{ sous: 'github', detail: 'jeton GitHub', regex: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{22,})/g },
	{ sous: 'gitlab', detail: 'jeton GitLab', regex: /\bglpat-[A-Za-z0-9_-]{20,}/g },
	{ sous: 'npm', detail: 'jeton npm', regex: /\bnpm_[A-Za-z0-9]{36}\b/g },
	{ sous: 'stripe', detail: 'clé Stripe', regex: /\b[rs]k_live_[0-9A-Za-z]{20,}/g },
	{ sous: 'cle-privee', detail: 'clé privée', regex: new RegExp('-----BEGIN (?:[A-Z0-9]+ )*' + 'PRIVATE KEY-----', 'g') },
	{ sous: 'slack', detail: 'jeton Slack', regex: /\bxox[abprs]-[A-Za-z0-9-]{10,}/g },
	{ sous: 'cle-api', detail: 'clé d’API (sk-…)', regex: /\bsk-(?:ant-)?[A-Za-z0-9_-]{32,}/g },
	{ sous: 'jwt', detail: 'jeton JWT', regex: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g },
	{ sous: 'bearer', detail: 'jeton Bearer', regex: /\bBearer\s+[A-Za-z0-9._~+/=-]{20,}/g },
	{ sous: 'url-identifiants', detail: 'URL avec identifiants', regex: /\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@'"`]+:[^\s/@'"`]+@[^\s/'"`]+/gi },
];

/** Valeur affectée à un nom de secret (`token = "…"`, `apiKey: '…'`) : signalée si son entropie est forte. */
const AFFECTATION_SECRETE =
	/\b[\w-]*(?:secret|token|password|passwd|pwd|api[_-]?key|apikey|access[_-]?key|private[_-]?key|jeton|mot[_-]?de[_-]?passe|motdepasse)[\w-]*["']?\s*[:=]\s*["'`]([A-Za-z0-9+/=_.-]{20,})["'`]/gi;
const ENTROPIE_MIN = 3.5;

const CHEMINS: Motif[] = [
	{ sous: 'users', detail: 'chemin personnel', regex: /\/Users\/(?!Shared\b)[A-Za-z0-9._-]+/g },
	{ sous: 'home', detail: 'chemin personnel', regex: /\/home\/[a-z_][a-z0-9._-]*/g },
	{ sous: 'windows', detail: 'chemin personnel', regex: /\b[A-Za-z]:\\{1,2}Users\\{1,2}(?!Public\b)[A-Za-z0-9._-]+/g },
	{ sous: 'claude', detail: 'chemin personnel', regex: /-Users-(?!Shared-)[A-Za-z0-9._]+-/g },
	{ sous: 'workspace', detail: 'chemin personnel', regex: /(?:~|\$HOME|\$\{HOME\}|%USERPROFILE%)[/\\]Workspace\b/g },
	{ sous: 'workspace', detail: 'chemin personnel', regex: /\bWorkspace[/\\-]Projets\b/gi },
];

const EMAIL = /\b[A-Za-z0-9._%+-]+@((?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,})\b/g;
const DOMAINES_EXEMPLE = ['example.com', 'example.org', 'example.net', 'exemple.fr', 'exemple.com', 'exemple.org'];
const TLD_EXEMPLE = ['.example', '.test', '.invalid', '.localhost'];

function domaineExemple(domaine: string): boolean {
	const d = domaine.toLowerCase();
	return DOMAINES_EXEMPLE.some((x) => d === x || d.endsWith(`.${x}`)) || TLD_EXEMPLE.some((t) => d.endsWith(t));
}

/** Entropie de Shannon, en bits par caractère. */
export function entropie(texte: string): number {
	const comptes = new Map<string, number>();
	for (const c of texte) comptes.set(c, (comptes.get(c) ?? 0) + 1);
	let h = 0;
	const n = [...texte].length;
	for (const k of comptes.values()) h -= (k / n) * Math.log2(k / n);
	return h;
}

// --- Globs ---

/** Motif glob → expression régulière sur un chemin relatif en `/` : `**` traverse les dossiers, `*` et `?` non. */
export function globVersRegex(glob: string): RegExp {
	let r = '';
	for (let i = 0; i < glob.length; i++) {
		const c = glob[i]!;
		if (c === '*' && glob[i + 1] === '*') {
			const debut = i === 0 || glob[i - 1] === '/';
			if (debut && glob[i + 2] === '/') {
				r += '(?:.*/)?';
				i += 2;
			} else {
				r += '.*';
				i += 1;
			}
		} else if (c === '*') r += '[^/]*';
		else if (c === '?') r += '[^/]';
		else r += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
	}
	return new RegExp(`^${r}$`);
}

export type LigneListe = { positif: boolean; regex: RegExp };

export function lireListeBlanche(chemin: string): LigneListe[] {
	return readFileSync(chemin, 'utf8')
		.split(/\r?\n/)
		.map((t) => t.trim())
		.filter((t) => t !== '' && !t.startsWith('#'))
		.map((t) => (t.startsWith('!') ? { positif: false, regex: globVersRegex(t.slice(1).trim()) } : { positif: true, regex: globVersRegex(t) }));
}

export function publiable(fichier: string, liste: LigneListe[]): boolean {
	let ok = false;
	for (const l of liste) if (l.regex.test(fichier)) ok = l.positif;
	return ok;
}

// --- Exceptions ---

type Exception = { regle: Regle; sous: string | null; fichier: RegExp; motif: RegExp | null };

/**
 * Lignes utiles d'un fichier de déclarations : chacune doit suivre un commentaire (`#`) de son bloc (lignes non vides
 * consécutives) qui dit pourquoi ce n'est pas une fuite. `ou` situe la ligne sans en citer le contenu.
 */
function lignesCommentees(chemin: string, lire: (ligne: string, ou: string) => void): void {
	let commentee = false;
	readFileSync(chemin, 'utf8')
		.split(/\r?\n/)
		.forEach((brute, i) => {
			const ligne = brute.trim();
			if (ligne === '') {
				commentee = false;
				return;
			}
			if (ligne.startsWith('#')) {
				commentee = true;
				return;
			}
			const ou = `${basename(chemin)}:${i + 1}`;
			if (!commentee) throw new Error(`${ou} : déclaration sans commentaire ; dites au-dessus, en commentaire (#), pourquoi ce n'est pas une fuite.`);
			lire(ligne, ou);
		});
}

/** Une exception par ligne : `regle[:sous-règle] <glob de fichier> [expression régulière sur le texte trouvé]`. */
function lireExceptions(chemin: string): Exception[] {
	const exceptions: Exception[] = [];
	lignesCommentees(chemin, (ligne, ou) => {
		const m = /^(\S+)\s+(\S+)(?:\s+(.+))?$/.exec(ligne);
		if (!m) throw new Error(`${ou} : exception illisible (attendu : regle[:sous-règle] <glob> [expression régulière]).`);
		const [regle, sous] = m[1]!.split(':') as [string, string | undefined];
		if (!REGLES_EXCEPTABLES.has(regle as Regle)) {
			throw new Error(`${ou} : règle « ${regle} » inconnue ou sans exception possible (${[...REGLES_EXCEPTABLES].join(', ')}).`);
		}
		exceptions.push({ regle: regle as Regle, sous: sous ?? null, fichier: globVersRegex(m[2]!), motif: m[3] === undefined ? null : new RegExp(m[3]) });
	});
	return exceptions;
}

/** Texte exact de l'identité publique de l'auteur (nom, compte) admis dans les fichiers d'un glob. */
type Identite = { fichier: RegExp; texte: string };

/** Une déclaration par ligne : `<glob de fichier> <texte exact>`. */
function lireIdentite(chemin: string): Identite[] {
	const identite: Identite[] = [];
	lignesCommentees(chemin, (ligne, ou) => {
		const m = /^(\S+)\s+(.+)$/.exec(ligne);
		if (!m) throw new Error(`${ou} : déclaration illisible (attendu : <glob> <texte exact>).`);
		identite.push({ fichier: globVersRegex(m[1]!), texte: m[2]! });
	});
	return identite;
}

/** Plages de `texte` couvertes par un texte d'identité publique admis. */
function plagesAdmises(texte: string, admis: string[]): [number, number][] {
	const plages: [number, number][] = [];
	for (const a of admis) for (let p = texte.indexOf(a); p >= 0; p = texte.indexOf(a, p + 1)) plages.push([p, p + a.length]);
	return plages;
}

// --- Analyse ---

/** Constat avant masquage ; `brut` est le texte trouvé, que testent les exceptions. */
type Brut = Omit<Constat, 'extrait'> & { sous: string | null; colonne: number; extrait?: string; brut: string };

/** Où se trouve un texte analysé : une ligne d'un fichier texte, ou un lieu d'un binaire. */
type Position = { ligne: number } | { lieu: string };

/** Début d'un secret, assez pour le retrouver, trop court pour s'en servir. */
function abrege(secret: string): string {
	return `${secret.slice(0, Math.min(6, Math.floor(secret.length / 3)))}…`;
}

function chevauche(plages: [number, number][], debut: number, fin: number): boolean {
	return plages.some(([a, b]) => debut < b && fin > a);
}

function analyserTexte(fichier: string, ou: Position, texte: string, termes: Terme[], admis: string[], constats: Brut[]): void {
	const ajouter = (c: Omit<Brut, 'fichier'>) => constats.push({ ...c, fichier, ...ou });
	const vus = new Set<number>();
	const identite = plagesAdmises(texte, admis);
	for (const o of occurrences(texte, termes)) {
		if (vus.has(o.terme.numero) || identite.some(([a, b]) => o.debut >= a && o.fin <= b)) continue;
		vus.add(o.terme.numero);
		ajouter({ regle: 'terme-interdit', sous: null, colonne: o.debut, detail: `terme n°${o.terme.numero}`, brut: '' });
	}
	const secrets: [number, number][] = [];
	for (const m of SECRETS) {
		for (const r of texte.matchAll(m.regex)) {
			if (chevauche(secrets, r.index, r.index + r[0].length)) continue;
			secrets.push([r.index, r.index + r[0].length]);
			ajouter({ regle: 'secret', sous: m.sous, colonne: r.index, detail: m.detail, extrait: abrege(r[0]), brut: r[0] });
		}
	}
	for (const r of texte.matchAll(AFFECTATION_SECRETE)) {
		const valeur = r[1]!;
		const debut = r.index + r[0].lastIndexOf(valeur);
		if (chevauche(secrets, debut, debut + valeur.length) || entropie(valeur) < ENTROPIE_MIN) continue;
		ajouter({ regle: 'secret', sous: 'entropie', colonne: debut, detail: 'chaîne à forte entropie', extrait: abrege(valeur), brut: r[0] });
	}
	for (const m of CHEMINS) {
		for (const r of texte.matchAll(m.regex)) {
			ajouter({ regle: 'chemin-personnel', sous: m.sous, colonne: r.index, detail: m.detail, extrait: r[0], brut: r[0] });
		}
	}
	for (const r of texte.matchAll(EMAIL)) {
		if (domaineExemple(r[1]!) || chevauche(secrets, r.index, r.index + r[0].length)) continue;
		ajouter({ regle: 'email', sous: null, colonne: r.index, detail: 'adresse e-mail', extrait: r[0], brut: r[0] });
	}
}

function analyserEntree(e: Entree, termes: Terme[], admis: string[], constats: Brut[]): void {
	const fichier = e.chemin;
	const vus = new Set<number>();
	for (const o of occurrences(fichier, termes)) {
		if (vus.has(o.terme.numero)) continue;
		vus.add(o.terme.numero);
		constats.push({ regle: 'terme-interdit', sous: null, fichier, colonne: 0, detail: `terme n°${o.terme.numero}`, brut: '' });
	}
	if (e.lien !== null) {
		if (lienHorsRacine(fichier, e.lien)) {
			constats.push({ regle: 'lien-symbolique', sous: null, fichier, colonne: 0, detail: 'cible hors de la racine', extrait: e.lien, brut: e.lien });
		}
		analyserTexte(fichier, { lieu: 'cible du lien' }, e.lien, termes, admis, constats);
		return;
	}
	if (e.taille > TAILLE_MAX) constats.push({ regle: 'fichier-lourd', sous: null, fichier, colonne: 0, detail: `${(e.taille / 1024 / 1024).toFixed(1)} Mo`, brut: '' });
	const contenu = e.lire();
	const extension = /\.[^./]+$/.exec(fichier)?.[0].toLowerCase() ?? '';
	const attendu = EXTENSIONS_BINAIRES.has(extension);
	if (attendu || contenu.subarray(0, 8000).includes(0)) {
		if (!attendu) constats.push({ regle: 'binaire', sous: null, fichier, colonne: 0, detail: 'binaire inattendu', brut: '' });
		// Un même texte peut ressortir de plusieurs segments (bloc PNG non compressé et chaîne brute) : un constat suffit.
		const avant = constats.length;
		for (const s of segmentsBinaires(contenu)) analyserTexte(fichier, { lieu: s.lieu }, s.texte, termes, admis, constats);
		const vusBinaire = new Set<string>();
		const nouveaux = constats.splice(avant).filter((c) => {
			const cle = `${c.regle}|${c.sous}|${c.detail}|${c.brut}`;
			if (vusBinaire.has(cle)) return false;
			vusBinaire.add(cle);
			return true;
		});
		constats.push(...nouveaux);
		return;
	}
	contenu
		.toString('utf8')
		.split('\n')
		.forEach((ligne, i) => analyserTexte(fichier, { ligne: i + 1 }, ligne, termes, admis, constats));
}

function excepte(c: Brut, exceptions: Exception[]): boolean {
	return exceptions.some(
		(e) => e.regle === c.regle && (e.sous === null || e.sous === c.sous) && e.fichier.test(c.fichier) && (e.motif === null || e.motif.test(c.brut)),
	);
}

export type Options = {
	source: Source;
	mode: 'git' | 'dossier';
	listeBlanche: string;
	exceptions: string;
	/** Identité publique de l'auteur : seuls textes où un terme interdit est admis. */
	identite: string;
	termes: Terme[];
	strict: boolean;
	/** Rend un chemin affichable : dossier personnel en `~`, termes masqués. */
	afficher: (texte: string) => string;
};

export function verifierPublication(o: Options): Rapport {
	const liste = lireListeBlanche(o.listeBlanche);
	const exceptions = lireExceptions(o.exceptions);
	const identite = lireIdentite(o.identite);
	const bruts: Brut[] = [];
	const entrees = [...o.source.entrees].sort((a, b) => (a.chemin < b.chemin ? -1 : a.chemin > b.chemin ? 1 : 0));
	for (const e of entrees) {
		if (publiable(e.chemin, liste)) analyserEntree(e, o.termes, identite.filter((i) => i.fichier.test(e.chemin)).map((i) => i.texte), bruts);
		else bruts.push({ regle: 'hors-liste-blanche', sous: null, fichier: e.chemin, colonne: 0, detail: 'hors de la liste blanche', brut: '' });
	}
	const constats = bruts
		.filter((c) => !excepte(c, exceptions))
		.sort((a, b) => (a.fichier < b.fichier ? -1 : a.fichier > b.fichier ? 1 : (a.ligne ?? 0) - (b.ligne ?? 0) || a.colonne - b.colonne))
		.map((c): Constat => {
			const k: Constat = { regle: c.regle, fichier: masquer(c.fichier, o.termes), detail: c.detail };
			if (c.ligne !== undefined) k.ligne = c.ligne;
			if (c.lieu !== undefined) k.lieu = c.lieu;
			if (c.extrait !== undefined) k.extrait = masquer(c.extrait, o.termes);
			return k;
		});
	return {
		ok: constats.length === 0 && !(o.strict && o.termes.length === 0),
		mode: o.mode,
		racine: o.afficher(o.source.racine),
		fichiers: entrees.length,
		constats,
		avertissements: o.source.avertissements.map(o.afficher),
	};
}

// --- Présentation ---

export function presenter(r: Rapport): string {
	const lignes = [`Vérification de publication : ${r.fichiers} fichier${r.fichiers > 1 ? 's' : ''} (${r.mode === 'git' ? 'commités dans' : 'du dossier'} ${r.racine})`];
	for (const regle of Object.keys(TITRES) as Regle[]) {
		const constats = r.constats.filter((c) => c.regle === regle);
		if (constats.length === 0) continue;
		lignes.push('', `${TITRES[regle]} (${constats.length})`);
		for (const c of constats) {
			const ou = c.ligne !== undefined ? `${c.fichier}:${c.ligne}` : c.lieu !== undefined ? `${c.fichier} [${c.lieu}]` : c.fichier;
			const quoi = regle === 'hors-liste-blanche' ? '' : `  ${c.detail}${c.extrait === undefined ? '' : ` (${c.extrait})`}`;
			lignes.push(`  ${ou}${quoi}`);
		}
	}
	const n = r.constats.length;
	lignes.push('', n === 0 ? 'Publication : aucun constat.' : `Publication refusée : ${n} constat${n > 1 ? 's' : ''}.`);
	return `${lignes.join('\n')}\n`;
}

const AIDE = `Usage : pnpm verifier-publication [dossier] [--commit <rév>] [--json] [--strict] [--liste-blanche <f>] [--exceptions <f>]
  [--identite <f>]
  sans dossier : contenu commité du dépôt courant (HEAD, ou --commit <rév>) ; avec un dossier : tous ses fichiers
  (sauf .git/ et node_modules/).
  --strict : échoue aussi sans fichier de termes interdits (MNEMO_TERMES_INTERDITS, sinon ~/.config/mnemo/termes-interdits.txt).
`;

export const PUBLICATION = join(import.meta.dirname, '..', 'publication');

/** Dossier personnel remplacé par `~`, puis termes masqués. */
function afficheur(home: string, termes: Terme[]): (texte: string) => string {
	const prefixes = [home, home.split(sep).join('/')].filter((p) => p.length > 1);
	return (texte) => {
		let t = texte;
		for (const p of prefixes) t = t.split(p).join('~');
		return masquer(t, termes);
	};
}

/** Point d'entrée : rend le code de sortie. `env` et `cwd` sont des paramètres pour les tests. */
export async function principal(argv: string[], env: Record<string, string | undefined>, io: Sorties, cwd = process.cwd()): Promise<number> {
	const home = env['HOME'] || homedir();
	let afficher = afficheur(home, []);
	try {
		const { values, positionals } = parseArgs({
			args: argv[0] === '--' ? argv.slice(1) : argv,
			allowPositionals: true,
			options: {
				json: { type: 'boolean', default: false },
				strict: { type: 'boolean', default: false },
				commit: { type: 'string' },
				'liste-blanche': { type: 'string', default: join(PUBLICATION, 'liste-blanche.txt') },
				exceptions: { type: 'string', default: join(PUBLICATION, 'exceptions.txt') },
				identite: { type: 'string', default: join(PUBLICATION, 'identite-publique.txt') },
				aide: { type: 'boolean', short: 'h', default: false },
			},
		});
		if (values.aide) {
			io.ecrire(AIDE);
			return 0;
		}
		if (positionals.length > 1) throw new Error(`un seul dossier attendu.\n${AIDE}`);
		const dossier = positionals[0];
		if (dossier !== undefined && values.commit !== undefined) throw new Error('--commit ne vaut qu’en mode git (sans dossier).');

		const cheminTermes = env['MNEMO_TERMES_INTERDITS'] || join(home, '.config', 'mnemo', 'termes-interdits.txt');
		const avertissements: string[] = [];
		let termes: Terme[] = [];
		if (!existsSync(cheminTermes)) {
			avertissements.push('fichier des termes interdits absent (CHEMIN) : termes interdits non vérifiés. Créez-le (un terme par ligne, jamais versionné) ou posez MNEMO_TERMES_INTERDITS.');
		} else {
			termes = lireTermes(cheminTermes);
			if (termes.length === 0) avertissements.push('fichier des termes interdits vide (CHEMIN) : termes interdits non vérifiés.');
		}
		afficher = afficheur(home, termes);
		const termesAffiches = afficher(cheminTermes);

		const source = dossier === undefined ? depuisGit(cwd, values.commit ?? 'HEAD') : depuisDossier(resolve(cwd, dossier));
		const rapport = verifierPublication({
			source,
			mode: dossier === undefined ? 'git' : 'dossier',
			listeBlanche: resolve(cwd, values['liste-blanche']),
			exceptions: resolve(cwd, values.exceptions),
			identite: resolve(cwd, values.identite),
			termes,
			strict: values.strict,
			afficher,
		});
		const suffixe = values.strict ? ' (--strict : échec)' : '';
		rapport.avertissements.unshift(...avertissements.map((a) => `${a.replace('CHEMIN', termesAffiches)}${suffixe}`));
		for (const a of rapport.avertissements) io.erreur(`Avertissement : ${a}\n`);
		io.ecrire(values.json ? `${JSON.stringify(rapport, null, 2)}\n` : presenter(rapport));
		return rapport.ok ? 0 : 1;
	} catch (e) {
		const brut = e instanceof Error ? ((e as { stderr?: Buffer }).stderr?.toString() || e.message) : String(e);
		io.erreur(`verifier-publication : ${afficher(brut.trim())}\n`);
		return 1;
	}
}

if (import.meta.main) {
	process.exitCode = await principal(process.argv.slice(2), process.env, {
		ecrire: (t) => process.stdout.write(t),
		erreur: (t) => process.stderr.write(t),
	});
}
