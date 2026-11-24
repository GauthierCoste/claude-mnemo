// Chemins portables (macOS + Windows), relatifs au dossier `_mnemo/`, séparés par `/`.
// Aucun module `node:` ici : opérations sur chaînes uniquement.

import { nomDeFichierNouveauValide } from '@mnemo/commun';
import { DOSSIERS_DE_MNEMO } from './dossier-memoire.ts';
import { tronquerTexte } from './texte.ts';

const LONGUEUR_MAX = 120;
const RESERVES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
// Caractères interdits sous Windows, plus les caractères de contrôle.
// eslint-disable-next-line no-control-regex
const INTERDITS = /[<>:"/\\|?*\u0000-\u001f]/;
// Pour un nom tiré d'un titre : en plus, la syntaxe des liens Obsidian (`#` section, `^` bloc, `[ ]` lien, `|` alias).
// eslint-disable-next-line no-control-regex
const SUITE_INTERDITS = /\s*[<>:"/\\|?*#^[\]\u0000-\u001f]+\s*/g;
const SYNTAXE_LIEN = /[#^[\]|]/;
const EXTREMITES = /^[\s.-]+|[\s.-]+$/g;

function estReserve(segment: string): boolean {
	const base = segment.split('.')[0] ?? '';
	return RESERVES.test(base.trimEnd());
}

function suffixerReserve(nom: string): string {
	const point = nom.indexOf('.');
	const base = point === -1 ? nom : nom.slice(0, point);
	const reste = point === -1 ? '' : nom.slice(point);
	const mot = base.trimEnd();
	// « CON .x » est réservé comme « CON.x » : le suffixe se place juste après le mot réservé.
	return RESERVES.test(mot) ? `${mot}_${base.slice(mot.length)}${reste}` : nom;
}

function nettoyer(texte: string): string {
	return texte.replace(SUITE_INTERDITS, ' - ').replace(/\s+/g, ' ').replace(EXTREMITES, '');
}

const longueur = (texte: string) => Array.from(texte).length;


/** Nom de fichier portable (sans extension) tiré d'un titre : 120 points de code au plus, jamais vide. */
export function nomDeFichier(titre: string): string {
	let nom = nettoyer(titre.normalize('NFC'));
	if (longueur(nom) > LONGUEUR_MAX) nom = tronquerTexte(nom, LONGUEUR_MAX).replace(EXTREMITES, '');
	if (nom === '') return 'sans-titre';
	nom = suffixerReserve(nom);
	if (longueur(nom) > LONGUEUR_MAX) {
		// Le suffixe `_` peut dépasser la limite : on rogne la base.
		nom = suffixerReserve(tronquerTexte(nom, LONGUEUR_MAX - 1).replace(EXTREMITES, '') || 'sans-titre');
	}
	return nom;
}

/** Vrai si le chemin contient un caractère de la syntaxe des liens (`# ^ [ ] |`) : la fiche ne serait pas liable. */
export function contientSyntaxeDeLien(chemin: string): boolean {
	return SYNTAXE_LIEN.test(chemin);
}

/** Vrai si un segment du chemin commence par « . » (dossier ou fichier caché : .git, .obsidian…). */
export function estCache(chemin: string): boolean {
	return chemin.split('/').some((segment) => segment.startsWith('.'));
}

/** Extension d'un fichier Markdown (fiche, note, instruction). */
export const EXTENSION_MARKDOWN = '.md';
/** Vrai pour un nom de fichier en `.md`, sans tenir compte de la casse (`Note.MD`). */
export const estMarkdown = (nom: string): boolean => nom.toLowerCase().endsWith(EXTENSION_MARKDOWN);

/** Dossier de la configuration de Claude Code dans un projet : ses `.md` sont des instructions. */
export const DOSSIER_CLAUDE = '.claude';
/** Fichiers d'instructions de Claude Code, où qu'ils soient dans un projet (en minuscules : toute casse acceptée). */
const NOMS_INSTRUCTIONS: readonly string[] = ['claude.md', 'claude.local.md'];
/** Vrai pour le nom d'un fichier d'instructions de Claude Code (`CLAUDE.md`, `CLAUDE.local.md`), en toute casse. */
const estNomInstruction = (nom: string): boolean => NOMS_INSTRUCTIONS.includes(nom.toLowerCase());

/**
 * Vrai pour un fichier d'instructions de Claude Code, que l'amorçage référence : un `CLAUDE.md` ou un `CLAUDE.local.md`
 * (toute casse) dans un dossier non caché ou sous `.claude/`, ou un fichier `.md` dont les seuls dossiers cachés sont des
 * `.claude/` (`.claude/rules/x.md`, `.claude/commands/…`). Jamais un fichier lui-même caché, jamais sous `.git/`. Le reste de `.claude/` (`settings.json`,
 * identifiants…) n'est pas un `.md` : non reconnu. `dossier` : le dossier listé par l'amorçage qui contient le fichier ;
 * seuls les segments sous lui sont jugés (un dossier listé compte, caché ou non).
 */
export function estInstructionClaude(chemin: string, dossier = ''): boolean {
	if (dansGit(chemin) || (dossier !== '' && !chemin.startsWith(`${dossier}/`))) return false;
	const segments = (dossier === '' ? chemin : chemin.slice(dossier.length + 1)).split('/');
	const nom = segments.pop() ?? '';
	if (nom.startsWith('.')) return false;
	// Seul dossier caché traversé sous le dossier listé : `.claude/` (jamais `.ssh/`, `.config/`…), pour un CLAUDE.md comme pour un autre .md.
	const caches = segments.filter((s) => s.startsWith('.'));
	if (!caches.every((s) => s.toLowerCase() === DOSSIER_CLAUDE)) return false;
	if (estNomInstruction(nom)) return true;
	return estMarkdown(nom) && caches.length > 0;
}

/** Dossier d'un dépôt git. */
export const DOSSIER_GIT = '.git';

/** Chemin dans un dépôt git (`.git/`, toute casse : systèmes de fichiers insensibles) : jamais lu ni listé. */
export function dansGit(chemin: string): boolean {
	return chemin.split('/').some((segment) => segment.toLowerCase() === DOSSIER_GIT);
}

export function cheminValide(chemin: string): string | null {
	const normalise = chemin.replace(/\\/g, '/');
	if (normalise === '' || normalise.startsWith('/')) return null;
	for (const segment of normalise.split('/')) {
		if (segment === '' || segment === '.' || segment === '..') return null;
		if (INTERDITS.test(segment)) return null;
		if (segment.endsWith('.') || segment.endsWith(' ')) return null;
		if (estReserve(segment)) return null;
	}
	return normalise;
}

/** Chemin d'un dossier ou d'un fichier EXISTANT sous la racine (« » = la racine), en « / » : tout nom est accepté, un dossier de Mnemo refusé. */
export function cheminDeLaRacine(brut: string): { ok: true; chemin: string } | { ok: false; motif: string } {
	const net = brut.replace(/\\/gu, '/');
	if (net.startsWith('/') || /^[A-Za-z]:/u.test(net)) return { ok: false, motif: 'chemin absolu, relatif à la racine attendu' };
	const chemin = net.replace(/\/+$/u, '');
	if (chemin === '') return { ok: true, chemin };
	const segments = chemin.split('/');
	for (const segment of segments) {
		if (segment === '') return { ok: false, motif: 'segment vide' };
		if (segment === '.' || segment === '..') return { ok: false, motif: 'segment « . » ou « .. »' };
		// aucun nom de fichier ne contient l'octet nul : le refuser n'écarte rien de ce qui existe
		if (segment.includes('\u0000')) return { ok: false, motif: 'caractère nul' };
	}
	const premier = cleDeCasse(segments[0]!);
	if (DOSSIERS_DE_MNEMO.some((d) => cleDeCasse(d) === premier)) return { ok: false, motif: `dossier de Mnemo lui-même (${DOSSIERS_DE_MNEMO.map((d) => `${d}/`).join(', ')})` };
	return { ok: true, chemin };
}

/** Chemin d'un dépôt : son dossier par `cheminDeLaRacine` (un dossier manquant est contrôlé à sa création), son nom par `nomDeFichierNouveauValide`. */
export function cheminDeDepot(vers: string): { ok: true; chemin: string } | { ok: false; motif: string } {
	const net = vers.replace(/\\/gu, '/');
	const i = net.lastIndexOf('/');
	const partieDossier = i < 0 ? '' : net.slice(0, i);
	// le « / » final que tolère un dossier serait ici un segment vide au milieu du chemin
	if (partieDossier.endsWith('/')) return { ok: false, motif: 'segment vide' };
	const dossier = cheminDeLaRacine(partieDossier);
	if (!dossier.ok) return dossier;
	if (i === 0) return { ok: false, motif: 'chemin absolu, relatif à la racine attendu' };
	const nom = nomDeFichierNouveauValide(net.slice(i + 1));
	if (!nom.ok) return nom;
	return { ok: true, chemin: dossier.chemin === '' ? nom.nom : `${dossier.chemin}/${nom.nom}` };
}

/** Nom d'une fiche tiré de son chemin (dernier segment, sans `.md`) : titre par défaut d'une fiche sans titre ou illisible. */
export function nomDeLaFiche(chemin: string): string {
	return chemin.slice(chemin.lastIndexOf('/') + 1).replace(/\.md$/u, '');
}

/** Dossier d'une fiche de dossier (`d/d.md` → `d`), sinon le chemin de la fiche. */
export function positionDeFiche(chemin: string): string {
	const segments = chemin.split('/');
	const fichier = segments.pop() ?? '';
	return segments.length > 0 && fichier === `${segments[segments.length - 1]}.md` ? segments.join('/') : chemin;
}

export function ficheDeDossier(dossier: string): string {
	const nom = dossier.slice(dossier.lastIndexOf('/') + 1);
	return `${dossier}/${nom}.md`;
}

export function dossiersAscendants(chemin: string): string[] {
	const segments = chemin.split('/');
	const fichier = segments.pop() ?? '';
	const dernier = segments[segments.length - 1];
	// La fiche d'un dossier est le fichier du même nom : son dossier propre n'est pas un ascendant.
	if (dernier !== undefined && fichier === `${dernier}.md`) segments.pop();
	const resultat: string[] = [];
	for (let i = 1; i <= segments.length; i++) resultat.push(segments.slice(0, i).join('/'));
	return resultat;
}

export function cleDeCasse(chemin: string): string {
	return chemin.normalize('NFC').toLowerCase().normalize('NFC');
}

/** Nom du dernier segment d'un chemin (« / » ou « \\ »), sans son extension. */
export function nomDuFichier(chemin: string): string {
	const nom = chemin.split(/[\\/]/u).pop() ?? chemin;
	const point = nom.lastIndexOf('.');
	return point > 0 ? nom.slice(0, point) : nom;
}
