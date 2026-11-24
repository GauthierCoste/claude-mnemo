import { describe, expect, it } from 'vitest';
import { contenuEnMemoire, contenuHache, empreinteContenu } from '../../src/application/contenu.ts';
import type { Contenu } from '../../src/application/ports.ts';

/** Octets pseudo-aléatoires reproductibles : deux plages différentes n'ont pas le même contenu. */
function octets(taille: number): Uint8Array {
	const sortie = new Uint8Array(taille);
	let x = 2463534242;
	for (let i = 0; i < taille; i++) {
		x ^= x << 13;
		x ^= x >>> 17;
		x ^= x << 5;
		sortie[i] = x & 0xff;
	}
	return sortie;
}

/** Un contenu qui compte les octets lus. */
function compte(contenu: Contenu): { contenu: Contenu; lus: () => number } {
	let lus = 0;
	return {
		contenu: {
			taille: contenu.taille,
			async lire(position, longueur) {
				const b = await contenu.lire(position, longueur);
				lus += b.byteLength;
				return b;
			},
		},
		lus: () => lus,
	};
}

const TAILLE = 3 * 1024 * 1024 + 17;
const PAS = 100_000;

describe('contenuHache', () => {
	const donnees = octets(TAILLE);
	const plages = Array.from({ length: Math.ceil(TAILLE / PAS) }, (_, i) => i * PAS);

	const cas: [string, (c: Contenu) => Promise<unknown>][] = [
		['aucune lecture', async () => {}],
		['lectures dans l’ordre, jusqu’au milieu', async (c) => { for (const p of plages.slice(0, plages.length / 2)) await c.lire(p, PAS); }],
		['lectures dans l’ordre, jusqu’au bout', async (c) => { for (const p of plages) await c.lire(p, PAS); }],
		['lectures à rebours', async (c) => { for (const p of [...plages].reverse()) await c.lire(p, PAS); }],
		['lectures sautées puis reprises', async (c) => { for (const p of [0, 3 * PAS, PAS, 2 * PAS, 10 * PAS, 4 * PAS]) await c.lire(p, PAS); }],
		['lectures qui se chevauchent', async (c) => { for (const p of [0, PAS / 2, PAS / 4, PAS, 3 * PAS / 2]) await c.lire(p, PAS); }],
		['lectures concurrentes', async (c) => Promise.all(plages.map((p) => c.lire(p, PAS)))],
		['lecture au-delà de la fin', async (c) => { await c.lire(TAILLE - 10, PAS); await c.lire(TAILLE + 5, PAS); }],
	];

	it.each(cas)('%s : même empreinte que empreinteContenu', async (_nom, parcourir) => {
		const attendue = await empreinteContenu(contenuEnMemoire(donnees));
		const lu = contenuHache(contenuEnMemoire(donnees));
		await parcourir(lu.contenu);
		expect(await lu.empreinte()).toBe(attendue);
	});

	it('après une lecture dans l’ordre, l’empreinte ne relit que ce qui n’a pas été parcouru', async () => {
		const source = compte(contenuEnMemoire(donnees));
		const lu = contenuHache(source.contenu);
		for (const p of plages.slice(0, 10)) await lu.contenu.lire(p, PAS);
		const avant = source.lus();
		await lu.empreinte();
		expect(source.lus() - avant).toBe(TAILLE - 10 * PAS);
	});
});
