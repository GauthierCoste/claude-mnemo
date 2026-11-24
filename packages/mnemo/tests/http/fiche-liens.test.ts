import { describe, expect, it } from 'vitest';
import { vueFiche } from '../../src/adaptateurs/http/memoire-vues.ts';
import { lireFicheEtLiens } from '../../src/application/liens-de-fiche.ts';
import { fauxPorts } from '../aides/faux-ports.ts';

const entete = (id: string, type = 'sujet', plus = '') => `---\nid: ${id}\ntype: ${type}\n${plus}updated: 2026-11-01\n---\n`;
const SANS_SESSIONS = { sessionsAyantServi: async () => ({ sessions: [], total: 0 }) };

/** Une mémoire où les liens se résolvent par chemin, par nom unique, par titre, par alias ; ou pas du tout (ambigu, hors mémoire). */
async function memoire() {
	const dep = fauxPorts();
	await dep.coffre.ecrire('projets/stocks.md', `${entete('01S', 'sujet', 'alias:\n  - Inventaire\n')}# Module stocks\n\nVoir [[Acme]], [[doublon]], [[../dehors]], [[projets/stocks]] et [[Facture]].\n\n## Relations\n- concerne [[clients/acme]]\n`);
	await dep.coffre.ecrire('clients/acme.md', `${entete('01A', 'entite')}# Acme\n\nClient de l'[[inventaire]] et du [[Module Stocks]].\n\n## Relations\n- utilise [[projets/stocks]]\n`);
	await dep.coffre.ecrire('a/doublon.md', `${entete('01D1')}# Doublon A\n\nVoir [[stocks]].\n`);
	await dep.coffre.ecrire('b/doublon.md', `${entete('01D2')}# Doublon B\n`);
	await dep.coffre.ecrire('factures/f1.md', `${entete('01F1')}# Facture\n`);
	await dep.coffre.ecrire('factures/f2.md', `${entete('01F2')}# Facture\n\nPour [[projets/stocks.md]].\n`);
	return dep;
}

describe('liens d’une fiche (caractérisation, avant et après le déplacement dans application/)', () => {
	it('sortants : chemin, nom unique, titre, alias ; ambigu ou hors mémoire → null ; lien vers soi absent ; entrants : par chemin, nom, titre, alias, sans la fiche elle-même', async () => {
		const dep = await memoire();
		const f = await vueFiche(dep, SANS_SESSIONS, 'projets/stocks.md', false);
		expect(f!.liens).toEqual({
			sortants: [
				{ ecrit: 'clients/acme', chemin: 'clients/acme.md', verbe: 'concerne' },
				{ ecrit: 'Acme', chemin: 'clients/acme.md', verbe: null },
				{ ecrit: 'doublon', chemin: null, verbe: null },
				{ ecrit: '../dehors', chemin: null, verbe: null },
				{ ecrit: 'Facture', chemin: null, verbe: null },
			],
			entrants: [
				{ chemin: 'a/doublon.md', titre: 'Doublon A', verbe: null },
				{ chemin: 'clients/acme.md', titre: 'Acme', verbe: 'utilise' },
				{ chemin: 'clients/acme.md', titre: 'Acme', verbe: null },
				{ chemin: 'clients/acme.md', titre: 'Acme', verbe: null },
				{ chemin: 'factures/f2.md', titre: 'Facture', verbe: null },
			],
		});
		expect((await lireFicheEtLiens(dep, 'projets/stocks.md'))!.liens).toEqual(f!.liens);
	});
});
