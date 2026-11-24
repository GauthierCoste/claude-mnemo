import { describe, expect, it } from 'vitest';
import { lister } from '../../src/application/lister.ts';
import { dependancesReelles } from '../../src/infra/systeme.ts';
import { dossierTemporaire } from '../aides/dossier-temporaire.ts';
import { fauxPorts } from '../aides/faux-ports.ts';

describe('Coffre.lister', () => {
	it('le faux et le réel renvoient des chemins relatifs à _mnemo/', async () => {
		const reel = dependancesReelles(await dossierTemporaire());
		const faux = fauxPorts();
		for (const dep of [reel, faux]) {
			await dep.coffre.ecrire('x/un.md', '# Un\n');
			await dep.coffre.ecrire('x/sous/deux.md', '# Deux\n');
			expect(await dep.coffre.lister('x')).toEqual({ fiches: ['x/un.md'], dossiers: ['x/sous'] });
		}
	});

	it('lister (application) avec les ports réels', async () => {
		const dep = dependancesReelles(await dossierTemporaire());
		await dep.coffre.ecrire('SCHEMA.md', '---\nseuil_rappel: 0.4\n---\n');
		await dep.coffre.ecrire('p/p.md', '---\ntype: dossier\n---\n# P\n\nRésumé.\n');
		await dep.coffre.ecrire('p/b.md', '# Bêta\n');
		await dep.coffre.ecrire('p/a.md', '# Alpha\n');
		await dep.coffre.ecrire('p/s/s.md', '# S\n');
		expect(await lister(dep, 'p')).toEqual({
			dossier: 'p',
			ficheDossier: expect.objectContaining({ titre: 'P', synthese: 'Résumé.' }),
			fiches: [{ chemin: 'p/a.md', titre: 'Alpha', type: 'sujet' }, { chemin: 'p/b.md', titre: 'Bêta', type: 'sujet' }],
			sousDossiers: ['s'],
		});
		expect((await lister(dep, '')).fiches).toEqual([]);
	});
});
