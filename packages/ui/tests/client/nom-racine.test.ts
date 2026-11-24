import { describe, expect, it } from 'vitest';
import { nomDeRacine } from '../../src/client/hooks.ts';

describe('nomDeRacine', () => {
	it('dernier segment du chemin affiché, séparé par « / » ou par « \\ » (Windows)', () => {
		expect(nomDeRacine('~/Developer')).toBe('Developer');
		expect(nomDeRacine('~\\Documents\\Mnemo')).toBe('Mnemo');
		expect(nomDeRacine('C:\\Users\\ana\\Projets\\')).toBe('Projets');
		expect(nomDeRacine('/srv/memoire/')).toBe('memoire');
	});
});
