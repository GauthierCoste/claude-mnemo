import { describe, expect, it } from 'vitest';
import { resoudreLien } from '../../src/memoire/resoudre-lien.ts';

const FICHES = [
	{ chemin: 'sources/cdc-stocks-v2.md', titre: 'Cahier des charges stocks', alias: ['CDC stocks'] },
	{ chemin: 'projets/erp-saas/Module stocks.md', titre: 'Module stocks', alias: ['stocks'] },
	{ chemin: 'personnes/Marc.md', titre: 'Marc', alias: [] },
	{ chemin: 'clients/Marc.md', titre: 'Marc Durand', alias: [] },
];

describe('lien `[[…]]` résolu sur les fiches', () => {
	it('chemin avec ou sans .md, ancre et alias d’affichage ignorés', () => {
		expect(resoudreLien('sources/cdc-stocks-v2', FICHES)).toBe('sources/cdc-stocks-v2.md');
		expect(resoudreLien('sources/cdc-stocks-v2.md#^f-0001|le cahier', FICHES)).toBe('sources/cdc-stocks-v2.md');
	});

	it('titre, alias, nom de fichier, à la casse près', () => {
		expect(resoudreLien('module stocks', FICHES)).toBe('projets/erp-saas/Module stocks.md');
		expect(resoudreLien('CDC stocks', FICHES)).toBe('sources/cdc-stocks-v2.md');
		expect(resoudreLien('cdc-stocks-v2', FICHES)).toBe('sources/cdc-stocks-v2.md');
	});

	it('ambigu ou inconnu : null', () => {
		expect(resoudreLien('Marc', FICHES)).toBeNull();
		expect(resoudreLien('Inconnue', FICHES)).toBeNull();
		expect(resoudreLien('', FICHES)).toBeNull();
	});
});
