import { describe, expect, it } from 'vitest';
import { deplacer } from '../../src/application/deplacer.ts';
import { proposer } from '../../src/application/proposer.ts';
import { fauxPorts } from '../aides/faux-ports.ts';

describe('commit sans changement', () => {
	it('sousVerrou tolère un commit vide des modifications manuelles', async () => {
		const dep = fauxPorts();
		dep.modificationsManuelles.push('x.md');
		const commit = dep.historique.commit;
		let premier = true;
		dep.historique.commit = async (message, chemins) => {
			if (premier) {
				premier = false;
				return null;
			}
			return commit(message, chemins);
		};
		expect((await proposer(dep, { genre: 'fiche', chemin: 'a.md', type: 'sujet', titre: 'A' })).statut).toBe('ecrit');
	});

	it('une écriture de Mnemo sans changement est une erreur interne explicite', async () => {
		const dep = fauxPorts();
		dep.historique.commit = async () => null;
		await expect(proposer(dep, { genre: 'fiche', chemin: 'a.md', type: 'sujet', titre: 'A' })).rejects.toThrow(/Erreur interne.*a\.md/u);
		dep.fichiers.set('b.md', '# b\n');
		await expect(deplacer(dep, 'b.md', 'c.md')).rejects.toThrow(/Erreur interne/u);
	});
});
