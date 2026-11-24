import { describe, expect, it } from 'vitest';
import { episodesDuProjet, trouverEpisode } from '../../src/application/episode.ts';
import { SANS_EXTRACTION, synchroniser } from '../../src/application/synchroniser.ts';
import { fauxPorts } from '../aides/faux-ports.ts';

const episode = (session: string, projet: string) => `---\nid: 01EP\ntype: episode\nsession: ${session}\nprojet: ${projet}\nupdated: 2026-11-20\n---\n# Atelier\n\nFait.\n`;

describe('épisodes rangés hors du dossier par défaut', () => {
	it('un épisode déplacé est retrouvé par sa session, une fois indexé', async () => {
		const dep = fauxPorts();
		await dep.coffre.ecrire('journal/2026/atelier.md', episode('s1', 'alpha'));
		await synchroniser(dep, SANS_EXTRACTION);
		expect((await trouverEpisode(dep, 's1', 'alpha'))?.chemin).toBe('journal/2026/atelier.md');
		expect((await trouverEpisode(dep, 's1', 'un-autre-projet'))?.chemin).toBe('journal/2026/atelier.md');
	});

	it('un épisode pas encore indexé est retrouvé dans le dossier par défaut du projet', async () => {
		const dep = fauxPorts();
		await dep.coffre.ecrire('episodes/alpha/2026-11-20-atelier.md', episode('s2', 'alpha'));
		expect((await trouverEpisode(dep, 's2', 'alpha'))?.chemin).toBe('episodes/alpha/2026-11-20-atelier.md');
	});

	it('les épisodes du projet réunissent ceux de l’index, où qu’ils soient, et ceux du dossier par défaut', async () => {
		const dep = fauxPorts();
		await dep.coffre.ecrire('journal/atelier.md', episode('s1', 'Alpha'));
		await dep.coffre.ecrire('journal/autre.md', episode('s9', 'beta'));
		await synchroniser(dep, SANS_EXTRACTION);
		await dep.coffre.ecrire('episodes/alpha/2026-11-21-suite.md', episode('s2', 'alpha'));
		expect([...(await episodesDuProjet(dep, 'alpha')).keys()].sort()).toEqual(['s1', 's2']);
	});
});
