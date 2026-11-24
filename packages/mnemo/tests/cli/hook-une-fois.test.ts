import { describe, expect, it } from 'vitest';
import { uneFois } from '../../src/adaptateurs/cli/hook.ts';
import type { EtatSessions } from '../../src/application/ports.ts';

describe('mnemo hook sans service : uneFois', () => {
	it('après une première erreur de l’état, noter un dossier non rattaché et modifier une session ne l’interrogent plus', async () => {
		const appels: string[] = [];
		const occupe = async (): Promise<never> => {
			throw new Error('base occupée');
		};
		const etat = {
			lire: async (id: string) => {
				appels.push(`lire ${id}`);
				return occupe();
			},
			noterRattachement: async (dossier: string) => {
				appels.push(`noter ${dossier}`);
			},
			modifier: async (id: string) => {
				appels.push(`modifier ${id}`);
				return null;
			},
		} as unknown as EtatSessions;
		const garde = uneFois(etat);
		await expect(garde.lire('s1')).rejects.toThrow('base occupée');
		await garde.noterRattachement('h1', false, 1);
		expect(await garde.modifier('s1', { position: 'g1' })).toBeNull();
		expect(appels).toEqual(['lire s1']);
	});
});
