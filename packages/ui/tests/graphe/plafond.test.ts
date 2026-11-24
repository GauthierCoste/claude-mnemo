import { describe, expect, it } from 'vitest';
import { cibler, creerSimulation, placerAuDepart } from '../../src/graphe/disposition.ts';
import { preparerGraphe, type EntreeGraphe } from '../../src/graphe/donnees.ts';
import { brancheContenant, brancheDeDepart, depasseLePlafond, PLAFOND_FICHES, SEUIL_PIXELS_UN } from '../../src/graphe/plafond.ts';
import { couleursDeTest } from '../aides/couleurs-graphe.ts';

describe('grande mémoire', () => {
	it('plafonds : 2 500 fiches, échelle de pixels à 1 au-delà de 1 500 nœuds', () => {
		expect(PLAFOND_FICHES).toBe(2500);
		expect(SEUIL_PIXELS_UN).toBe(1500);
	});

	it('1 000 fiches → tout le coffre', () => {
		expect(brancheDeDepart([['clients', 600], ['projets', 400]], 1000)).toBe('');
		expect(brancheDeDepart([], 2500)).toBe('');
	});

	it('6 000 fiches dont une branche de 2 000 → cette branche (la plus grosse sous le plafond)', () => {
		const branches: [string, number][] = [
			['clients', 1000],
			['clients/durand', 900],
			['personnes', 2000],
			['projets', 3000],
			['projets/erp', 2400],
		];
		expect(brancheDeDepart(branches, 6000)).toBe('personnes');
	});

	it('une seule branche de 6 000 fiches → sa plus grosse sous-branche', () => {
		const branches: [string, number][] = [
			['projets', 6000],
			['projets/api', 1200],
			['projets/erp', 2400],
			['projets/erp/stocks', 900],
			['projets/site', 2000],
		];
		expect(brancheDeDepart(branches, 6000)).toBe('projets/erp');
	});

	it('une fiche d’une autre branche : la plus large de ses branches qui tient sous le plafond', () => {
		const branches: [string, number][] = [
			['projets', 6000],
			['projets/erp', 2400],
			['projets/erp/stocks', 900],
		];
		expect(brancheContenant(branches, 'projets/erp/stocks', 'personnes')).toBe('projets/erp');
		expect(brancheContenant([['personnes', 2000]], 'personnes', 'x')).toBe('personnes');
		expect(brancheContenant([['a', 9000], ['a/b', 8000]], 'a/b', 'x')).toBe('a/b');
	});

	it('une fiche à la racine du coffre : la branche affichée reste (jamais « Tout le coffre »)', () => {
		expect(brancheContenant([['projets', 6000], ['personnes', 2000]], '', 'personnes')).toBe('personnes');
	});

	it('jamais une branche de départ au-dessus du plafond : on descend d’un niveau tant qu’il le faut', () => {
		const branches: [string, number][] = [
			['projets', 6000],
			['projets/erp', 4000],
			['projets/erp/stocks', 2000],
			['projets/erp/achats', 1500],
		];
		expect(brancheDeDepart(branches, 6000)).toBe('projets/erp/stocks');
	});

	it('aucune branche sous le plafond : la plus grosse des branches sans sous-branche', () => {
		const branches: [string, number][] = [
			['a', 9000],
			['a/b', 5000],
			['a/c', 4000],
			['a/b/d', 3000],
		];
		expect(brancheDeDepart(branches, 9000)).toBe('a/c');
		expect(depasseLePlafond(branches, 'a/c')).toBe(true);
		expect(depasseLePlafond([['x', 2500]], 'x')).toBe(false);
	});

	it('2 500 nœuds : préparation, cibles et 30 tranches de disposition en moins de 2 s', () => {
		const fiches: NonNullable<EntreeGraphe['fiches']> = [];
		const liens: NonNullable<EntreeGraphe['liens']> = [];
		for (let i = 0; i < 2500; i++) {
			const branche = `b${i % 12}/s${i % 5}`;
			const chemin = `${branche}/Fiche ${i}.md`;
			fiches.push({ chemin, titre: `Fiche ${i}`, alias: [], etats: [], faitsActifs: i % 9, categories: {}, dates: [], branche, parent: null });
			if (i > 0) liens.push({ source: chemin, cible: `b${(i - 1) % 12}/s${(i - 1) % 5}/Fiche ${i - 1}.md`, cibleEcrite: `Fiche ${i - 1}`, relation: null });
			if (i % 7 === 0) liens.push({ source: chemin, cible: null, cibleEcrite: `Absente ${i % 40}`, relation: 'cite' });
		}
		// Temps de calcul du processus (pool `forks` : un processus par fichier de test), insensible aux autres suites
		// lancées en même temps ; le temps écoulé, lui, s'allonge avec la charge de la machine.
		const debut = process.cpuUsage();
		const graphe = preparerGraphe({ coffre: '_mnemo', fiches, liens }, couleursDeTest());
		placerAuDepart(graphe.noeuds);
		cibler(graphe.noeuds, 'constellations', { racines: [...new Set(graphe.noeuds.map((n) => n.racine))].sort() });
		const simulation = creerSimulation(graphe.noeuds, [...graphe.liens, ...graphe.parentes], 'constellations');
		for (let tranche = 0; tranche < 30; tranche++) simulation.avancer(12);
		const { user, system } = process.cpuUsage(debut);
		const duree = (user + system) / 1000;

		expect(graphe.noeuds.length).toBeGreaterThanOrEqual(2500);
		expect(graphe.noeuds.every((n) => Number.isFinite(n.x) && Number.isFinite(n.z))).toBe(true);
		expect(duree).toBeLessThan(2000);
	}, 30_000);
});
