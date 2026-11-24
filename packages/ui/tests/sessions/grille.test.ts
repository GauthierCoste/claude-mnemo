import { describe, expect, it } from 'vitest';
import { disposerGrille, glisserSeparateur, type EntreeGrille } from '../../src/sessions/grille.ts';

// Données de démonstration : 8 sessions, 4 dossiers.
const GROUPES = [
	{ cle: 'erp-saas', sessions: ['7f3a', 'b7d1', '41d7', '9e02'] },
	{ cle: 'api-facturation', sessions: ['a90b', 'e6c2'] },
	{ cle: 'agent-maison', sessions: ['c21e'] },
	{ cle: 'site-vitrine', sessions: ['0b5f'] },
];

const entree = (e: Partial<EntreeGrille> = {}): EntreeGrille => ({
	groupes: GROUPES,
	zoom: null,
	replies: new Set(['site-vitrine']),
	poidsLignes: {},
	poidsCellules: {},
	...e,
});

describe('disposerGrille', () => {
	it('sans zoom : poids par défaut, ligne repliée en mini', () => {
		const g = disposerGrille(entree());
		expect(g.zoomee).toBe(false);
		expect(g.lignes).toEqual([
			{ cle: 'erp-saas', mini: false, flexGrow: 1.5 },
			{ cle: 'api-facturation', mini: false, flexGrow: 1 },
			{ cle: 'agent-maison', mini: false, flexGrow: 1 },
			{ cle: 'site-vitrine', mini: true, flexGrow: 0 },
		]);
		expect(g.cellules).toHaveLength(8);
		for (const c of g.cellules) expect(c).toMatchObject({ rail: false, zoomee: false, flexGrow: 1, flexBasis: '0px' });
	});

	it('zoom sur 7f3a : les 3 autres cellules de erp-saas en rail, les autres lignes mini', () => {
		const g = disposerGrille(entree({ zoom: '7f3a' }));
		expect(g.zoomee).toBe(true);
		expect(g.lignes.map((l) => [l.cle, l.mini, l.flexGrow])).toEqual([
			['erp-saas', false, 1.5],
			['api-facturation', true, 0],
			['agent-maison', true, 0],
			['site-vitrine', true, 0],
		]);
		const par = Object.fromEntries(g.cellules.map((c) => [c.id, c]));
		expect(par['7f3a']).toEqual({ id: '7f3a', rail: false, zoomee: true, flexGrow: 1, flexBasis: '0px' });
		for (const id of ['b7d1', '41d7', '9e02']) expect(par[id]).toEqual({ id, rail: true, zoomee: false, flexGrow: 0, flexBasis: '44px' });
		for (const id of ['a90b', 'e6c2', 'c21e', '0b5f']) expect(par[id]).toMatchObject({ rail: false, zoomee: false });
	});

	it('poids mémorisés (pixels) repris ; zoom inconnu ignoré', () => {
		const g = disposerGrille(entree({ zoom: 'absente', poidsLignes: { 'erp-saas': 420 }, poidsCellules: { b7d1: 310 } }));
		expect(g.zoomee).toBe(false);
		expect(g.lignes[0]).toEqual({ cle: 'erp-saas', mini: false, flexGrow: 420 });
		expect(g.cellules.find((c) => c.id === 'b7d1')?.flexGrow).toBe(310);
	});
});

describe('disposerGrille : poids manquants après un glissement', () => {
	it('cellule sans poids dans un groupe pesé → moyenne des poids du groupe', () => {
		const g = disposerGrille(entree({ poidsCellules: { '7f3a': 400, b7d1: 300, a90b: 900 } }));
		const par = Object.fromEntries(g.cellules.map((c) => [c.id, c.flexGrow]));
		expect(par['41d7']).toBe(350);
		expect(par['9e02']).toBe(350);
		// Groupe api-facturation : seule a90b est pesée → e6c2 prend sa valeur ; agent-maison sans poids → 1.
		expect(par['e6c2']).toBe(900);
		expect(par['c21e']).toBe(1);
	});

	it('ligne sans poids quand d’autres en ont (nouvelle, ou repliée pendant le glissement) → moyenne des poids des lignes', () => {
		const pesees = { 'erp-saas': 420, 'api-facturation': 300 };
		const g = disposerGrille(entree({ poidsLignes: pesees, replies: new Set() }));
		expect(g.lignes.map((l) => l.flexGrow)).toEqual([420, 300, 360, 360]);
		const repliee = disposerGrille(entree({ poidsLignes: pesees }));
		expect(repliee.lignes[3]).toEqual({ cle: 'site-vitrine', mini: true, flexGrow: 0 });
	});
});

describe('glisserSeparateur', () => {
	it('déplace la frontière en gardant la somme', () => {
		expect(glisserSeparateur(400, 400, 50, 170)).toEqual([450, 350]);
		expect(glisserSeparateur(400, 400, -120, 170)).toEqual([280, 520]);
	});
	it('borné par le minimum de chaque côté', () => {
		expect(glisserSeparateur(400, 400, 1000, 170)).toEqual([630, 170]);
		expect(glisserSeparateur(300, 200, -1000, 90)).toEqual([90, 410]);
	});
	it('trop petit pour deux minimums : inchangé', () => {
		expect(glisserSeparateur(150, 150, 40, 170)).toEqual([150, 150]);
	});
});
