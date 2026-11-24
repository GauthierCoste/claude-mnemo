import type { DossierVue } from '@mnemo/contrat';
import { describe, expect, it } from 'vitest';
import { basculer, lignesArbre, PLIAGE_INITIAL, toutDeplier, toutReplier } from '../../src/dossiers/arbre.ts';
import type { Niveau, Pliage } from '../../src/dossiers/arbre.ts';

const vue = (chemin: string, o: Partial<DossierVue> = {}): DossierVue => ({ chemin, nom: chemin.slice(chemin.lastIndexOf('/') + 1), git: false, marque: false, sessions: 0, erreur: null, ...o });

/** Niveaux chargés : chemin → ses sous-dossiers (le dossier lui-même décrit par `vue`), ou le motif d'un échec. */
function niveaux(charges: Record<string, DossierVue[] | string>, racine: Partial<DossierVue> = {}): Map<string, Niveau> {
	return new Map(
		Object.entries(charges).map(([chemin, n]): [string, Niveau] => [chemin, typeof n === 'string' ? { erreur: n } : { dossier: chemin === '' ? vue('', racine) : vue(chemin), sousDossiers: n }]),
	);
}

/** Lignes en texte : « profondeur nom marque-du-pliage » (▸ replié, ▾ déplié, · sans sous-dossier). */
const texte = (r: ReturnType<typeof lignesArbre>) => r.lignes.map((l) => `${l.profondeur} ${l.nom} ${l.deplie === null ? '·' : l.deplie ? '▾' : '▸'}`);

const base = (n: Map<string, Niveau>, pliage: Pliage = PLIAGE_INITIAL, ouverts: readonly string[] = []) => lignesArbre({ niveaux: n, nomRacine: 'Developer', pliage, ouverts });

describe('lignesArbre', () => {
	it('au départ : la racine et ses dossiers sont dépliés, les 2 premiers niveaux affichés ; le 3e attend un dépliage', () => {
		expect(base(new Map())).toEqual({ lignes: [{ chemin: '', nom: 'Developer', profondeur: 0, dossier: null, deplie: true, erreurNiveau: null }], niveauxVisibles: [''] });
		const n = niveaux({ '': [vue('Documents'), vue('.notes')], Documents: [vue('Documents/Paula')], '.notes': [] });
		const r = base(n);
		expect(texte(r)).toEqual(['0 Developer ▾', '1 Documents ▾', '2 Paula ▸', '1 .notes ·']);
		expect(r.niveauxVisibles).toEqual(['', 'Documents', '.notes']);
	});

	it('la racine est décrite comme tout dossier : sa ligne porte la vue du service (git, marque)', () => {
		const r = base(niveaux({ '': [] }, { git: true, marque: true }));
		expect(r.lignes[0]!.dossier).toMatchObject({ chemin: '', git: true, marque: true });
	});

	it('un dossier illisible : sans chevron ni niveau demandé', () => {
		const r = base(niveaux({ '': [vue('A'), vue('B', { erreur: 'lecture refusée' })], A: [] }));
		expect(texte(r)).toEqual(['0 Developer ▾', '1 A ·', '1 B ·']);
		expect(r.niveauxVisibles).toEqual(['', 'A']);
	});

	it('déplier un dossier du 2e niveau affiche et demande le 3e', () => {
		const n = niveaux({ '': [vue('Documents')], Documents: [vue('Documents/Paula')] });
		const r = base(n, basculer(PLIAGE_INITIAL, 'Documents/Paula', false));
		expect(r.niveauxVisibles).toEqual(['', 'Documents', 'Documents/Paula']);
	});

	it('le chemin d\'un dossier ouvert (session au niveau 5, dossier choisi) se déplie et ses niveaux sont demandés ; replier l\'emporte', () => {
		const ouverts = ['a/b/c/d/e'];
		const n = niveaux({ '': [vue('a')], a: [vue('a/b')], 'a/b': [vue('a/b/c')], 'a/b/c': [vue('a/b/c/d')], 'a/b/c/d': [vue('a/b/c/d/e', { sessions: 1 })] });
		expect(texte(base(n, PLIAGE_INITIAL, ouverts))).toEqual(['0 Developer ▾', '1 a ▾', '2 b ▾', '3 c ▾', '4 d ▾', '5 e ▸']);
		expect(base(niveaux({ '': [vue('a')], a: [vue('a/b')] }), PLIAGE_INITIAL, ouverts).niveauxVisibles).toEqual(['', 'a', 'a/b']);
		expect(texte(base(n, basculer(PLIAGE_INITIAL, 'a', true), ouverts))).toEqual(['0 Developer ▾', '1 a ▸']);
	});

	it('niveau en erreur : l\'erreur est portée par la ligne, qui garde son chevron pour réessayer', () => {
		const r = base(niveaux({ '': [vue('A')], A: 'Dossier « A » illisible : introuvable.' }));
		expect(r.lignes[1]).toMatchObject({ chemin: 'A', deplie: true, erreurNiveau: 'Dossier « A » illisible : introuvable.' });
	});
});

describe('pliage', () => {
	it('tout replier : chaque dossier chargé sauf la racine ; tout déplier : chaque niveau chargé', () => {
		const n = niveaux({ '': [vue('A'), vue('B')], A: [vue('A/x')], 'A/x': [], B: [] });
		expect(texte(base(n, toutReplier(n), ['A/x']))).toEqual(['0 Developer ▾', '1 A ▸', '1 B ·']);
		expect(texte(base(n, toutDeplier(n)))).toEqual(['0 Developer ▾', '1 A ▾', '2 x ·', '1 B ·']);
	});
});
