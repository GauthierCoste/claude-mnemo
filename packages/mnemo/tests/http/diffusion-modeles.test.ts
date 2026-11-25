import { afterEach, describe, expect, it } from 'vitest';
import type { MessageServeur } from '@mnemo/contrat';
import { diffuserModeles } from '../../src/adaptateurs/http/diffusion-modeles.ts';
import type { DiffusionModeles } from '../../src/adaptateurs/http/diffusion-modeles.ts';
import type { EtatModeles, Modeles } from '../../src/application/ports.ts';
import { etatModelesFaux, jusqua } from '../aides/service-faux.ts';

const diffusions: DiffusionModeles[] = [];
afterEach(() => {
	while (diffusions.length > 0) diffusions.pop()!.fermer();
});

/** Faux modèles dont la lecture échoue tant que `panne` est vrai ; lectures comptées. */
type FauxModeles = { vue: EtatModeles; panne: boolean; lectures: number; modeles: Modeles };
function fauxModeles(): FauxModeles {
	const f: FauxModeles = {
		vue: etatModelesFaux(),
		panne: false,
		lectures: 0,
		modeles: {
			etat: async (): Promise<EtatModeles> => {
				f.lectures++;
				if (f.panne) throw new Error('disque illisible');
				return structuredClone(f.vue);
			},
			demarrer: async () => {},
			arreter: async () => 'rien' as const,
			changerNiveau: async () => null,
			surveiller: () => () => {},
		},
	};
	return f;
}

describe('diffuserModeles', () => {
	it('première lecture : référence sans diffusion ; ensuite, seulement ce qui change ; une rafale : une lecture', async () => {
		const f = fauxModeles();
		const recus: MessageServeur[] = [];
		const d = diffuserModeles({ modeles: f.modeles, diffuser: (m) => recus.push(m), journal: () => {}, sondageMs: 60_000, regroupementMs: 20 });
		diffusions.push(d);
		expect(await jusqua(() => f.lectures === 1, 1000)).toBe(true);
		d.relire();
		await new Promise((r) => setTimeout(r, 100));
		expect(recus).toEqual([]);
		const avant = f.lectures;
		f.vue = { ...f.vue, gardien: 'demarrage' };
		for (let i = 0; i < 5; i++) d.relire();
		expect(await jusqua(() => recus.length === 1, 1000)).toBe(true);
		expect(f.lectures).toBe(avant + 1);
		expect(recus[0]).toEqual({ type: 'modeles', modeles: f.vue });
	});

	it('première lecture en échec (journalisée une fois) : la première qui réussit est diffusée', async () => {
		const f = fauxModeles();
		f.panne = true;
		const recus: MessageServeur[] = [];
		const journal: string[] = [];
		const d = diffuserModeles({ modeles: f.modeles, diffuser: (m) => recus.push(m), journal: (m) => journal.push(m), sondageMs: 30, regroupementMs: 5 });
		diffusions.push(d);
		expect(await jusqua(() => f.lectures >= 3, 1000)).toBe(true);
		expect(journal).toHaveLength(1);
		expect(journal[0]).toContain('disque illisible');
		f.panne = false;
		expect(await jusqua(() => recus.length === 1, 1000)).toBe(true);
		expect(recus[0]).toEqual({ type: 'modeles', modeles: f.vue });
	});
});
