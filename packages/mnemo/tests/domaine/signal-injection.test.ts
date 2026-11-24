import { describe, expect, it } from 'vitest';
import { PLAFOND_POIDS_INJECTION, poidsInjection, SEUIL_POIDS_INJECTION, signalInjection } from '../../src/domaine/signal-injection.ts';
import type { Arete } from '../../src/domaine/perimetre.ts';

const DEFAUT = { poids: 0.25, demiVie: 3 };

describe('poidsInjection', () => {
	it('25 points au message de l’injection, divisés par deux tous les 3 messages porteurs', () => {
		expect(poidsInjection(DEFAUT, 0)).toBe(0.25);
		// 0,25 × 0,5^(1/3) ≈ 0,198 ; 0,25 × 0,5^(2/3) ≈ 0,157
		expect(poidsInjection(DEFAUT, 1)).toBeCloseTo(0.1984, 4);
		expect(poidsInjection(DEFAUT, 2)).toBeCloseTo(0.1575, 4);
		expect(poidsInjection(DEFAUT, 3)).toBe(0.125);
		expect(poidsInjection(DEFAUT, 6)).toBe(0.0625);
	});

	it('ignoré sous 0,02 : encore là à 10 messages, plus à 11', () => {
		expect(SEUIL_POIDS_INJECTION).toBe(0.02);
		expect(poidsInjection(DEFAUT, 10)).toBeCloseTo(0.0248, 4);
		expect(poidsInjection(DEFAUT, 11)).toBe(0);
	});

	it('suit les réglages : poids nul, demi-vie plus longue', () => {
		expect(poidsInjection({ poids: 0, demiVie: 3 }, 0)).toBe(0);
		expect(poidsInjection({ poids: 0.5, demiVie: 10 }, 10)).toBe(0.25);
	});
});

describe('signalInjection', () => {
	// a — b (a écrit le lien), c — a (c écrit le lien), b — d, e — f
	const aretes: Arete[] = [
		{ de: 'a.md', vers: 'b.md' },
		{ de: 'c.md', vers: 'a.md' },
		{ de: 'b.md', vers: 'd.md' },
		{ de: 'e.md', vers: 'f.md' },
	];

	it('les voisines à un saut, dans les deux sens, reçoivent le poids ; pas les fiches à deux sauts ni l’injectée', () => {
		const s = signalInjection([{ chemin: 'a.md', messages: 0 }], aretes, DEFAUT);
		expect(s.nom).toBe('liee');
		expect(s.apport('b.md')).toEqual({ signal: 'liee', poids: 0.25, depuis: 'a.md' });
		expect(s.apport('c.md')).toEqual({ signal: 'liee', poids: 0.25, depuis: 'a.md' });
		expect(s.apport('d.md')).toBeNull();
		expect(s.apport('a.md')).toBeNull();
		expect(s.apport('f.md')).toBeNull();
		expect(s.designees).toEqual(new Set(['b.md', 'c.md']));
	});

	it('plusieurs injectées sur la même voisine : poids additionnés, plafonnés à 0,40 ; « depuis » : celle qui pèse le plus', () => {
		expect(PLAFOND_POIDS_INJECTION).toBe(0.4);
		// b est voisine de a et de d
		const deux = signalInjection([{ chemin: 'a.md', messages: 3 }, { chemin: 'd.md', messages: 0 }], aretes, DEFAUT);
		expect(deux.apport('b.md')).toEqual({ signal: 'liee', poids: 0.375, depuis: 'd.md' });
		const fraiches = signalInjection([{ chemin: 'a.md', messages: 0 }, { chemin: 'd.md', messages: 0 }], aretes, DEFAUT);
		expect(fraiches.apport('b.md')?.poids).toBe(0.4);
	});

	it('réinjectée : son âge le plus jeune compte', () => {
		const s = signalInjection([{ chemin: 'a.md', messages: 9 }, { chemin: 'a.md', messages: 0 }], aretes, DEFAUT);
		expect(s.apport('b.md')?.poids).toBe(0.25);
	});

	it('injection trop ancienne : aucun poids, aucune désignée', () => {
		const s = signalInjection([{ chemin: 'a.md', messages: 11 }], aretes, DEFAUT);
		expect(s.apport('b.md')).toBeNull();
		expect(s.designees.size).toBe(0);
	});

	it('aucune injection : le signal n’apporte rien', () => {
		const s = signalInjection([], aretes, DEFAUT);
		expect(s.apport('b.md')).toBeNull();
		expect(s.designees.size).toBe(0);
	});
});
