import { describe, expect, it } from 'vitest';
import { extraireSource } from '../../src/application/extraire-source.ts';
import { presenterResultat, presenterSource } from '../../src/application/presenter.ts';
import { proposer } from '../../src/application/proposer.ts';
import { PASSAGES_SOURCE_RICHE } from '../../src/application/repartition.ts';
import { synchroniser } from '../../src/application/synchroniser.ts';
import { fauxPorts } from '../aides/faux-ports.ts';

/** Compte rendu de `n` sections d'environ 1 200 caractères (un passage chacune) qui cite Julia Marchand et le Zoo de Lune. */
function compteRendu(n: number): string {
	const sections = Array.from({ length: n }, (_, i) => `## Point ${i}\n\nJulia Marchand présente le point ${i} pour le zoo de Lune. ${`Remplissage ${i} pour atteindre la taille d'un passage. `.repeat(22)}`);
	return `# Réunion de chantier\n\n${sections.join('\n\n')}\n`;
}

const fiche = (type: string, titre: string, alias: string[] = []) =>
	`---\ntype: ${type}\n${alias.length > 0 ? `alias: [${alias.join(', ')}]\n` : ''}---\n# ${titre}\n\nSynthèse de ${titre}.\n`;

async function memoireDeDepart() {
	const dep = fauxPorts();
	dep.fichiers.set('personnes/Julia Marchand.md', fiche('personne', 'Julia Marchand'));
	dep.fichiers.set('organisations/Parc animalier.md', fiche('organisation', 'Parc animalier', ['Zoo de Lune']));
	dep.fichiers.set('projets/Volière.md', fiche('projet', 'Volière'));
	await synchroniser(dep);
	return dep;
}

const fait = (fiche: string, texte: string) =>
	({ genre: 'fait', fiche, texte, nature: 'declare', source: { ref: '[[sources/Réunion de chantier]]', type: 'compte_rendu' } }) as const;
const traitee = { genre: 'modification', fiche: 'sources/Réunion de chantier.md', traitee: true, source: { ref: 'session 1', type: 'session' } } as const;

describe('répartition d\'une source', () => {
	it('extraire_source nomme les fiches existantes que le document cite (titre ou alias), sans les sources', async () => {
		const dep = await memoireDeDepart();
		dep.documents.deposer('reunions/chantier.md', compteRendu(3));
		const r = await extraireSource(dep, { chemin: 'reunions/chantier.md', type: 'compte_rendu' });
		expect(r).toMatchObject({ statut: 'ecrit', mentionnees: ['personnes/Julia Marchand.md', 'organisations/Parc animalier.md'] });
		expect(presenterSource(r)).toContain('Fiches que le document nomme, où ranger aussi ses informations : personnes/Julia Marchand.md, organisations/Parc animalier.md.');
	});

	it('un document qui ne nomme aucune fiche n\'a pas de `mentionnees`', async () => {
		const dep = await memoireDeDepart();
		dep.documents.deposer('notes/vide.md', '# Note\n\nRien de connu ici.\n');
		expect(await extraireSource(dep, { chemin: 'notes/vide.md' })).not.toHaveProperty('mentionnees');
	});

	it('traitee : la réponse liste les fiches qui citent la source ; une source riche qui n\'en touche qu\'une est signalée', async () => {
		const dep = await memoireDeDepart();
		dep.documents.deposer('reunions/chantier.md', compteRendu(PASSAGES_SOURCE_RICHE));
		await extraireSource(dep, { chemin: 'reunions/chantier.md', type: 'compte_rendu' });
		expect((await proposer(dep, fait('projets/Volière.md', 'La volière ouvre au printemps'))).statut).toBe('ecrit');

		const seule = await proposer(dep, traitee);
		expect(seule).toMatchObject({ repartition: { citeePar: ['projets/Volière.md'], passages: PASSAGES_SOURCE_RICHE, riche: true } });
		expect(presenterResultat(seule)).toMatch(/Fiches qui citent cette source \(1\) : projets\/Volière\.md\. Une source de 8 passages qui ne touche qu'une fiche est suspecte/u);

		expect((await proposer(dep, fait('personnes/Julia Marchand.md', 'Julia Marchand valide les plans de la volière'))).statut).toBe('ecrit');
		const deux = await proposer(dep, traitee);
		expect(deux).toMatchObject({ repartition: { citeePar: expect.arrayContaining(['projets/Volière.md', 'personnes/Julia Marchand.md']) } });
		expect(presenterResultat(deux)).toContain('Fiches qui citent cette source (2)');
		expect(presenterResultat(deux)).not.toContain('suspecte');
	});

	it('traitee sur une petite source sans citation : le bilan le dit, sans la signaler', async () => {
		const dep = await memoireDeDepart();
		dep.documents.deposer('reunions/chantier.md', compteRendu(1));
		await extraireSource(dep, { chemin: 'reunions/chantier.md', type: 'compte_rendu' });
		const r = await proposer(dep, traitee);
		expect(r).toMatchObject({ repartition: { citeePar: [], riche: false } });
		expect(presenterResultat(r)).toContain('Aucune fiche ne cite cette source.');
		expect(presenterResultat(r)).not.toContain('suspecte');
	});

	it('traitee sur une fiche qui n\'est pas une source : pas de bilan', async () => {
		const dep = await memoireDeDepart();
		const r = await proposer(dep, { ...traitee, fiche: 'projets/Volière.md' });
		expect(r).not.toHaveProperty('repartition');
	});
});
