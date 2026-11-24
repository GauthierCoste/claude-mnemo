import { describe, expect, it } from 'vitest';
import { ROUTES } from '@mnemo/contrat';
import type { SessionVue } from '@mnemo/contrat';
import { appeler, jusqua, serviceFaux } from '../aides/service-faux.ts';

describe('pids() du service : seulement les sessions que le pilote fait tourner', () => {
	it('pid resté dans l’état après l’échec de l’écriture de pid: null : pids() ne le rend plus (aucun signal vers lui à la sortie)', async () => {
		let refuserPidNul = false;
		const c = await serviceFaux({}, {
			pil: (pil) => {
				const modifier = pil.etat.modifier.bind(pil.etat);
				pil.etat.modifier = async (id, champs) => {
					if (refuserPidNul && champs.pid === null) throw new Error('etat.sqlite verrouillé');
					return modifier(id, champs);
				};
			},
		});
		const { port, jeton } = c.service;
		const r = await appeler(port, 'POST', ROUTES.sessions, { jeton, corps: { profil: 'travail', dossier: 'alpha' } });
		expect(r.statut).toBe(201);
		const id = (r.corps as { session: SessionVue }).session.id;
		const terminal = c.terminaux.lances[0]!;
		expect(await jusqua(() => c.service.pids().includes(terminal.pid), 2000)).toBe(true);

		refuserPidNul = true;
		terminal.finir(0);
		const sansTerminal = async () => {
			const liste = (await appeler(port, 'GET', ROUTES.sessions, { jeton })).corps as { sessions: SessionVue[] };
			return liste.sessions.some((s) => s.id === id && s.terminal === false);
		};
		expect(await jusqua(sansTerminal, 3000)).toBe(true);
		expect((await c.etat.lire(id))?.pid).toBe(terminal.pid);
		expect(c.service.pids()).toEqual([]);
	});
});
