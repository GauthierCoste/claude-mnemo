import { describe, expect, it } from 'vitest';
import { fauxPorts } from './faux-ports.ts';

describe('faux coffre : se comporte comme le vrai', () => {
	it('exclut les chemins cachés de etats, toutesLesFiches et lister', async () => {
		const dep = fauxPorts();
		for (const chemin of ['a.md', 'd/b.md', '.obsidian/x.md', 'd/.cache/y.md', 'd/.z.md']) await dep.coffre.ecrire(chemin, '# x\n');
		expect((await dep.coffre.etats()).map((e) => e.chemin)).toEqual(['a.md', 'd/b.md']);
		expect(await dep.coffre.toutesLesFiches()).toEqual(['a.md', 'd/b.md']);
		expect(await dep.coffre.lister('')).toEqual({ fiches: ['a.md'], dossiers: ['d'] });
		expect(await dep.coffre.lister('d')).toEqual({ fiches: ['d/b.md'], dossiers: [] });
	});

	it('refuse un chemin qui sort de la mémoire', async () => {
		const dep = fauxPorts();
		await expect(dep.coffre.lire('../dehors.md')).rejects.toThrow('Chemin hors de la mémoire');
		await expect(dep.coffre.lire('a/../../dehors.md')).rejects.toThrow('Chemin hors de la mémoire');
		await expect(dep.coffre.ecrire('../dehors.md', 'x')).rejects.toThrow('Chemin hors de la mémoire');
	});
});
