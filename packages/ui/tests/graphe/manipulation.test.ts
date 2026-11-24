// Nœuds épinglés, réchauffage, densité des étiquettes.
import { describe, expect, it } from 'vitest';
import { cibler, creerSimulation, placerAuDepart } from '../../src/graphe/disposition.ts';
import { cranDeDensite, DENSITE_PAR_DEFAUT, DENSITES_ETIQUETTES, type LienNoeud, type Noeud } from '../../src/graphe/donnees.ts';

function petitGraphe() {
	const noeuds = ['a', 'b', 'c', 'd'].map((cle, id) => ({ id, cle }) as unknown as Noeud);
	const liens = [
		[0, 1],
		[1, 2],
		[2, 3],
		[3, 0],
	].map(([source, cible]) => ({ source: noeuds[source!]!, cible: noeuds[cible!]! }) as LienNoeud);
	placerAuDepart(noeuds);
	cibler(noeuds, 'forces');
	return { noeuds, liens };
}

describe('manipulation du graphe', () => {
	it('un nœud épinglé garde sa place pendant que la disposition déplace les autres', () => {
		const { noeuds, liens } = petitGraphe();
		Object.assign(noeuds[0]!, { x: 400, y: -300, z: 120, epingle: true });
		const autre = { x: noeuds[1]!.x, y: noeuds[1]!.y, z: noeuds[1]!.z };
		creerSimulation(noeuds, liens, 'forces').terminer();

		expect([noeuds[0]!.x, noeuds[0]!.y, noeuds[0]!.z]).toEqual([400, -300, 120]);
		expect([noeuds[1]!.x, noeuds[1]!.y, noeuds[1]!.z]).not.toEqual([autre.x, autre.y, autre.z]);
	});

	it('une disposition finie repart quand on la réchauffe, et ses voisins suivent le nœud déplacé', () => {
		const { noeuds, liens } = petitGraphe();
		const simulation = creerSimulation(noeuds, liens, 'forces');
		simulation.terminer();
		expect(simulation.avancer(5)).toBe(false);
		const avant = simulation.pasFaits();
		const voisin = noeuds[1]!;
		const distanceAvant = Math.hypot(voisin.x - 500, voisin.y, voisin.z);
		Object.assign(noeuds[0]!, { x: 500, y: 0, z: 0, epingle: true });

		simulation.rechauffer(0.3);
		simulation.terminer();

		expect(simulation.pasFaits() > avant).toBe(true);
		expect(Math.hypot(voisin.x - 500, voisin.y, voisin.z) < distanceAvant).toBe(true);
	});

	it('le cran de densité lu est borné, avec « Normale » par défaut et « Toutes » sans masquage', () => {
		expect(DENSITES_ETIQUETTES[DENSITE_PAR_DEFAUT]!.nom).toBe('Normale');
		expect(DENSITES_ETIQUETTES[DENSITE_PAR_DEFAUT]!.maximum).toBe(26);
		expect(cranDeDensite(null)).toBe(DENSITE_PAR_DEFAUT);
		expect(cranDeDensite('')).toBe(DENSITE_PAR_DEFAUT);
		expect(cranDeDensite('9')).toBe(DENSITE_PAR_DEFAUT);
		expect(cranDeDensite('1.5')).toBe(DENSITE_PAR_DEFAUT);
		expect(cranDeDensite('0')).toBe(0);
		expect(cranDeDensite('4')).toBe(4);
		const toutes = DENSITES_ETIQUETTES.at(-1)!;
		expect(toutes.maximum).toBe(Infinity);
		expect(toutes.chevauchements).toBe(true);
	});
});
