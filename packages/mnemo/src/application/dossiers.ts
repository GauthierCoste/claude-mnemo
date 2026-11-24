/** L'arbre des dossiers de la racine : le contenu d'un dossier (`.git`, un marqueur) ajoute une information à sa ligne. */
import { cheminDeLaRacine, cleDeCasse, dansGit, DOSSIER_GIT } from '../domaine/chemin.ts';
import type { Session } from '../domaine/session.ts';
import { messageDErreur } from '../domaine/texte.ts';
import type { ContenuDossier, DossiersRacine } from './ports.ts';

/** Un sous-dossier : `erreur`, le motif si son contenu n'a pas pu être lu (`git` et `marque` sont alors faux). */
export type SousDossier = { chemin: string; nom: string; git: boolean; marque: boolean; sessions: number; erreur: string | null };

/** `refuse` : le chemin n'est pas accepté ; `illisible` : le dossier demandé est absent ou ne se lit pas. */
export const GENRES_ERREUR_DOSSIER = ['refuse', 'illisible'] as const;
export type GenreErreurDossier = (typeof GENRES_ERREUR_DOSSIER)[number];

export class ErreurDossier extends Error {
	readonly genre: GenreErreurDossier;
	constructor(genre: GenreErreurDossier, message: string) {
		super(message);
		this.name = 'ErreurDossier';
		this.genre = genre;
	}
}

export type ContexteDossiers = { racine: DossiersRacine; marqueurs: readonly string[]; sessions: readonly Pick<Session, 'dossier' | 'etat'>[] };

/** Le chemin de dossier reçu, normalisé par `cheminDeLaRacine`, ou le message de son refus. */
export function validerDossier(brut: string): { ok: true; chemin: string } | { ok: false; message: string } {
	const r = cheminDeLaRacine(brut);
	return r.ok ? r : { ok: false, message: `Dossier refusé : « ${brut} » (${r.motif}).` };
}

/** Comme `validerDossier`, un refus levé en `ErreurDossier` « refuse ». */
export function dossierAccepte(brut: string): string {
	const r = validerDossier(brut);
	if (!r.ok) throw new ErreurDossier('refuse', r.message);
	return r.chemin;
}

const enfant = (parent: string, nom: string): string => (parent === '' ? nom : `${parent}/${nom}`);

/** Un dossier et ses sous-dossiers directs, décrits de la même façon. */
export type NiveauDossiers = { dossier: SousDossier; sousDossiers: SousDossier[] };

/** `chemin` décrit à partir de son contenu, ou de l'échec de sa lecture. */
function decrire(ctx: ContexteDossiers, chemin: string, nom: string, contenu: ContenuDossier | { erreur: string }): SousDossier {
	const sessions = ctx.sessions.filter((s) => s.etat !== 'terminee' && s.dossier === chemin).length;
	if ('erreur' in contenu) return { chemin, nom, git: false, marque: false, sessions, erreur: contenu.erreur };
	const marques = new Set(ctx.marqueurs.map(cleDeCasse));
	const entrees = contenu.entrees.map(cleDeCasse);
	return { chemin, nom, git: entrees.includes(DOSSIER_GIT), marque: entrees.some((e) => marques.has(e)), sessions, erreur: null };
}

const lireOuErreur = (ctx: ContexteDossiers, chemin: string): Promise<ContenuDossier | { erreur: string }> =>
	ctx.racine.lire(chemin).catch((erreur: unknown) => ({ erreur: messageDErreur(erreur) }));

/** `brut` et ses sous-dossiers directs, triés par nom ; ceux que `cheminDeLaRacine` refuse (ceux de Mnemo) n'y sont pas. */
export async function niveauDossiers(ctx: ContexteDossiers, brut: string): Promise<NiveauDossiers> {
	const chemin = dossierAccepte(brut);
	const contenu = await lireOuErreur(ctx, chemin);
	if ('erreur' in contenu) throw new ErreurDossier('illisible', `Dossier « ${chemin} » illisible : ${contenu.erreur}.`);
	const nom = chemin.slice(chemin.lastIndexOf('/') + 1);
	const acceptes = contenu.dossiers.filter((n) => cheminDeLaRacine(enfant(chemin, n)).ok).sort((a, b) => a.localeCompare(b, 'fr'));
	const sousDossiers = await Promise.all(acceptes.map(async (n) => decrire(ctx, enfant(chemin, n), n, await lireOuErreur(ctx, enfant(chemin, n)))));
	return { dossier: decrire(ctx, chemin, nom, contenu), sousDossiers };
}

/** Les dossiers des `niveaux` premiers niveaux sous la racine (premier niveau = 1), triés par chemin, lus par `niveauDossiers` ; jamais un dépôt `.git` ni rien sous lui. */
export async function dossiersDesNiveaux(ctx: ContexteDossiers, niveaux: number): Promise<SousDossier[]> {
	const trouves: SousDossier[] = [];
	let parents = [''];
	for (let niveau = 1; niveau <= niveaux && parents.length > 0; niveau++) {
		const niveauCourant = (await Promise.all(parents.map(async (p) => (await niveauDossiers(ctx, p)).sousDossiers))).flat().filter((d) => !dansGit(d.chemin));
		trouves.push(...niveauCourant);
		parents = niveauCourant.filter((d) => d.erreur === null).map((d) => d.chemin);
	}
	return trouves.sort((a, b) => a.chemin.localeCompare(b.chemin, 'fr'));
}

/** Niveaux de dossiers dont l'amorçage lit les instructions de Claude Code (`CLAUDE.md`, `.claude/*.md`). */
export const NIVEAUX_AMORCE = 3;

/** Les dossiers des `NIVEAUX_AMORCE` premiers niveaux, pour l'amorçage (ni marqueur ni session n'y servent). */
export function dossiersAAmorcer(racine: DossiersRacine): Promise<SousDossier[]> {
	return dossiersDesNiveaux({ racine, marqueurs: [], sessions: [] }, NIVEAUX_AMORCE);
}
