import { describe, expect, it } from 'vitest';
import { dossierAccepte, dossiersDesNiveaux, ErreurDossier, niveauDossiers } from '../../src/application/dossiers.ts';
import type { ContexteDossiers } from '../../src/application/dossiers.ts';
import type { ContenuDossier, DossiersRacine } from '../../src/application/ports.ts';
import type { Session } from '../../src/domaine/session.ts';

/** Arbre en mémoire : chemin → contenu ; un chemin absent est introuvable, `illisibles` lève une erreur de lecture. */
function racine(arbre: Record<string, ContenuDossier>, illisibles: string[] = []): DossiersRacine & { lus: string[] } {
	const lus: string[] = [];
	return {
		lus,
		async lire(chemin) {
			lus.push(chemin);
			if (illisibles.includes(chemin)) throw new Error('lecture refusée');
			const c = arbre[chemin];
			if (c === undefined) throw new Error('introuvable');
			return c;
		},
	};
}

const vide: ContenuDossier = { dossiers: [], entrees: [] };
const MARQUEURS = ['.git', 'package.json'];
const sansSession: Pick<Session, 'dossier' | 'etat'>[] = [];
const sousDossiers = async (ctx: ContexteDossiers, chemin: string) => (await niveauDossiers(ctx, chemin)).sousDossiers;

describe('niveauDossiers', () => {
	it('le dossier demandé est décrit comme ses sous-dossiers, la racine comprise (git, marque, sessions)', async () => {
		const r = racine({ '': { dossiers: ['a'], entrees: ['.git', 'package.json', 'a'] }, a: vide, 'a/b': vide });
		const sessions: Pick<Session, 'dossier' | 'etat'>[] = [{ dossier: '', etat: 'attend' }];
		expect((await niveauDossiers({ racine: r, marqueurs: MARQUEURS, sessions }, '')).dossier).toEqual({ chemin: '', nom: '', git: true, marque: true, sessions: 1, erreur: null });
		expect((await niveauDossiers({ racine: r, marqueurs: MARQUEURS, sessions }, 'a')).dossier).toEqual({ chemin: 'a', nom: 'a', git: false, marque: false, sessions: 0, erreur: null });
	});

	it('rend chaque sous-dossier direct, caché compris, trié par nom ; git et marque seulement quand le contenu le dit', async () => {
		const r = racine({
			'': { dossiers: ['zeta', '.notes', 'Documents', 'node_modules'], entrees: ['zeta', '.notes', 'Documents', 'node_modules', 'a.txt'] },
			zeta: { dossiers: ['.git'], entrees: ['.git', 'README.md'] },
			'.notes': vide,
			Documents: { dossiers: [], entrees: ['Package.JSON'] },
			node_modules: vide,
		});
		expect(await sousDossiers({ racine: r, marqueurs: MARQUEURS, sessions: sansSession }, '')).toEqual([
			{ chemin: '.notes', nom: '.notes', git: false, marque: false, sessions: 0, erreur: null },
			{ chemin: 'Documents', nom: 'Documents', git: false, marque: true, sessions: 0, erreur: null },
			{ chemin: 'node_modules', nom: 'node_modules', git: false, marque: false, sessions: 0, erreur: null },
			{ chemin: 'zeta', nom: 'zeta', git: true, marque: true, sessions: 0, erreur: null },
		]);
	});

	it('`.git` fichier (worktree) : git vrai ; marque suit le réglage, même sans `.git` dans les marqueurs', async () => {
		const r = racine({ '': { dossiers: ['w'], entrees: ['w'] }, w: { dossiers: [], entrees: ['.git'] } });
		expect(await sousDossiers({ racine: r, marqueurs: ['go.mod'], sessions: sansSession }, '')).toEqual([{ chemin: 'w', nom: 'w', git: true, marque: false, sessions: 0, erreur: null }]);
	});

	it('à n\'importe quelle profondeur : chemins relatifs à la racine ; sessions non terminées lancées exactement là', async () => {
		const r = racine({ 'Documents/Paula': { dossiers: ['.archives'], entrees: ['.archives'] }, 'Documents/Paula/.archives': vide });
		const sessions: Pick<Session, 'dossier' | 'etat'>[] = [
			{ dossier: 'Documents/Paula/.archives', etat: 'attend' },
			{ dossier: 'Documents/Paula/.archives', etat: 'travaille' },
			{ dossier: 'Documents/Paula/.archives', etat: 'terminee' },
			{ dossier: 'Documents/Paula', etat: 'attend' },
		];
		expect(await sousDossiers({ racine: r, marqueurs: MARQUEURS, sessions }, 'Documents\\Paula/')).toEqual([
			{ chemin: 'Documents/Paula/.archives', nom: '.archives', git: false, marque: false, sessions: 2, erreur: null },
		]);
	});

	it('un sous-dossier illisible rend son erreur, ses voisins s\'affichent', async () => {
		const r = racine({ '': { dossiers: ['a', 'b', 'c'], entrees: ['a', 'b', 'c'] }, a: vide, c: vide }, ['b']);
		const liste = await sousDossiers({ racine: r, marqueurs: MARQUEURS, sessions: sansSession }, '');
		expect(liste.map((d) => [d.chemin, d.erreur])).toEqual([
			['a', null],
			['b', 'lecture refusée'],
			['c', null],
		]);
	});

	it('_mnemo/ et .mnemo/ de la racine ne sont pas listés (toute casse) ; ailleurs, ce sont des dossiers ordinaires', async () => {
		const r = racine({
			'': { dossiers: ['_Mnemo', '.mnemo', 'mnemo', 'P'], entrees: ['_Mnemo', '.mnemo', 'mnemo', 'P'] },
			mnemo: vide,
			P: { dossiers: ['_mnemo'], entrees: ['_mnemo'] },
			'P/_mnemo': vide,
		});
		const ctx = { racine: r, marqueurs: MARQUEURS, sessions: sansSession };
		expect((await sousDossiers(ctx, '')).map((d) => d.chemin)).toEqual(['mnemo', 'P']);
		expect((await sousDossiers(ctx, 'P')).map((d) => d.chemin)).toEqual(['P/_mnemo']);
		expect(r.lus).not.toContain('_Mnemo');
	});

	it('refus typés : chemin refusé (« .. », _mnemo/) et dossier demandé illisible ou absent', async () => {
		const ctx = { racine: racine({}), marqueurs: MARQUEURS, sessions: sansSession };
		for (const brut of ['../x', '_mnemo', '.mnemo/depots', '/etc']) {
			const e = await sousDossiers(ctx, brut).catch((x: unknown) => x);
			expect(e, brut).toBeInstanceOf(ErreurDossier);
			expect((e as ErreurDossier).genre, brut).toBe('refuse');
			expect((e as Error).message, brut).toContain(brut);
		}
		const absent = await sousDossiers(ctx, 'absent').catch((x: unknown) => x);
		expect(absent).toBeInstanceOf(ErreurDossier);
		expect((absent as ErreurDossier).genre).toBe('illisible');
		expect((absent as Error).message).toMatch(/absent.*introuvable/u);
	});

	it('dossierAccepte : le chemin normalisé, ou une ErreurDossier « refuse » lisible', () => {
		expect(dossierAccepte('.notes\\x/')).toBe('.notes/x');
		expect(() => dossierAccepte('_mnemo/fiches')).toThrow(ErreurDossier);
	});
});

describe('dossiersDesNiveaux', () => {
	it('les dossiers des n premiers niveaux, par sousDossiers ; un dossier en erreur n\'est pas descendu', async () => {
		const r = racine(
			{
				'': { dossiers: ['A', 'B'], entrees: ['A', 'B'] },
				A: { dossiers: ['x'], entrees: ['x'] },
				'A/x': { dossiers: ['y'], entrees: ['y'] },
				'A/x/y': { dossiers: ['z'], entrees: ['z'] },
				'A/x/y/z': vide,
			},
			['B'],
		);
		const liste = await dossiersDesNiveaux({ racine: r, marqueurs: MARQUEURS, sessions: sansSession }, 3);
		expect(liste.map((d) => d.chemin)).toEqual(['A', 'A/x', 'A/x/y', 'B']);
		expect(r.lus).not.toContain('A/x/y/z');
	});
});
