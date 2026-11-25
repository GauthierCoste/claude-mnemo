import { describe, expect, it } from 'vitest';
import { uneFois } from '../../src/adaptateurs/cli/hook.ts';
import { dependancesDeSession } from '../../src/application/modeles-de-session.ts';
import type { EtatSessions } from '../../src/application/ports.ts';
import { fauxPorts } from '../aides/faux-ports.ts';
import { fauxSens } from '../aides/faux-sens.ts';

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

	it('le niveau de la session lu par son propre uneFois (comme `traiterIci`) : son échec suit la machine et ne met pas en panne l’état du hook', async () => {
		const appels: string[] = [];
		let echouer = true;
		const etat = {
			lire: async (id: string) => {
				appels.push(`lire ${id}`);
				if (echouer) throw new Error('base occupée');
				return null;
			},
			modifier: async (id: string) => {
				appels.push(`modifier ${id}`);
				return null;
			},
		} as unknown as EtatSessions;
		const sens = fauxSens();
		const etatDuHook = uneFois(etat);
		const dep = dependancesDeSession({ ...fauxPorts(), sens }, uneFois(etat), 's1');
		// lecture du niveau en échec : le sens de la machine est appelé
		expect(await dep.sens.vecteurs(['a'], { budgetMs: 100, demarrer: false })).not.toBeNull();
		expect(sens.appels).toHaveLength(1);
		echouer = false;
		// l'état du hook n'est pas en panne : modifier et lire l'interrogent encore
		await etatDuHook.modifier('s1', { position: 'g1' });
		await etatDuHook.lire('s1');
		expect(appels).toEqual(['lire s1', 'modifier s1', 'lire s1']);
	});
});
