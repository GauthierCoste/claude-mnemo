import { describe, expect, it } from 'vitest';
import { fichesATraiter } from '../../src/application/amorcer.ts';
import { BORNES_DOCUMENTS, documentsDeLaMemoire } from '../../src/application/documents.ts';
import { proposer } from '../../src/application/proposer.ts';
import { listerATraiter } from '../../src/application/lister.ts';
import { referencerDepot } from '../../src/application/referencer-depot.ts';
import { synchroniser } from '../../src/application/synchroniser.ts';
import { lireFiche } from '../../src/domaine/fiche.ts';
import { descripteurDeSource } from '../../src/domaine/source.ts';
import { fauxPorts } from '../aides/faux-ports.ts';

const source = (chemin: string, empreinte: string) =>
	`---\nid: 01SRC\ntype: source\nchemin: ${chemin}\nempreinte: ${empreinte}\ntype_source: spec_validee\na_traiter: true\nupdated: 2026-11-01\n---\n# Cahier des charges\n`;

describe('une fiche source se reconnaît à son type, où qu\'elle soit rangée', () => {
	it('source déplacée hors de sources/ : toujours dans « à traiter » et « documents récents »', async () => {
		const dep = fauxPorts();
		await dep.coffre.ecrire('projets/Lumen/Cahier des charges.md', source('Projets/Lumen/cahier.md', 'e1'));
		await dep.coffre.ecrire('projets/Lumen/Lumen.md', '---\nid: 01LUM\ntype: dossier\nupdated: 2026-11-01\n---\n# Lumen\n');
		expect(await fichesATraiter(dep)).toEqual(['projets/Lumen/Cahier des charges.md']);
		const { recents, aTraiter } = await documentsDeLaMemoire(dep, BORNES_DOCUMENTS);
		expect(recents.map((d) => d.chemin)).toEqual(['projets/Lumen/Cahier des charges.md']);
		expect(aTraiter).toEqual([{ chemin: 'projets/Lumen/Cahier des charges.md', titre: 'Cahier des charges', document: 'Projets/Lumen/cahier.md', date: '2026-11-01', aTraiter: true }]);
	});

	it('nouveau dépôt du même fichier : la fiche déplacée est retrouvée par son chemin de document, sans doublon', async () => {
		const dep = fauxPorts();
		await dep.coffre.ecrire('projets/Lumen/Cahier des charges.md', source('Projets/Lumen/cahier.md', 'e1'));
		expect((await referencerDepot(dep, { chemin: 'Projets/Lumen/cahier.md', empreinte: 'e2' })).fiche).toBe('projets/Lumen/Cahier des charges.md');
		expect([...dep.fichiers.keys()].filter((c) => c.startsWith('sources/'))).toEqual([]);
	});
});

describe('une source citée se reconnaît à son type, pas à son dossier', () => {
	const fiche = '---\nid: 01LUM\ntype: dossier\nupdated: 2026-11-01\n---\n# Lumen\n';
	const sujet = '---\nid: 01SUJ\ntype: sujet\nupdated: 2026-11-01\n---\n# Note\n';

	it('un fait qui cite une source rangée hors de sources/ est accepté, prend son type de document et suit son fichier', async () => {
		const dep = fauxPorts();
		await dep.coffre.ecrire('projets/Lumen/Lumen.md', fiche);
		await dep.coffre.ecrire('projets/Lumen/Cahier des charges.md', source('Projets/Lumen/cahier.md', 'e1'));
		const r = await proposer(dep, { genre: 'fait', fiche: 'projets/Lumen/Lumen.md', texte: 'Le budget est de 10 k€', nature: 'declare', source: { ref: '[[projets/Lumen/Cahier des charges]]', type: 'spec_validee' } });
		expect(r.statut).toBe('ecrit');
		await synchroniser(dep);
		const faits = await dep.index.elements({ chemins: ['projets/Lumen/Lumen.md'], genres: ['fait'] });
		// son document est absent : le fait prend le statut dérivé de la source citée
		expect(faits.map((f) => [f.typeSource, f.statut])).toEqual([['spec_validee', 'source_disparue']]);
	});

	it('un lien vers une fiche qui n\'est pas une source : refusé comme source', async () => {
		const dep = fauxPorts();
		await dep.coffre.ecrire('projets/Lumen/Lumen.md', fiche);
		await dep.coffre.ecrire('notes/n.md', sujet);
		const r = await proposer(dep, { genre: 'fait', fiche: 'projets/Lumen/Lumen.md', texte: 'Un fait', nature: 'declare', source: { ref: '[[notes/n]]', type: 'email' } });
		expect(r).toMatchObject({ statut: 'refuse', motif: 'notes/n.md n\'est pas une fiche source : une source se cite par sa fiche de type « source ».' });
	});

	it('source_parente vers une fiche source rangée hors de sources/ : le fil garde sa parente', () => {
		const lue = lireFiche('projets/Lumen/fil.md', '---\nid: 01FIL\ntype: source\nsource_parente: "[[projets/Lumen/Cahier des charges]]"\nupdated: 2026-11-01\n---\n# Fil\n');
		expect(descripteurDeSource(lue)?.parente).toBe('projets/Lumen/Cahier des charges.md');
	});

	it('une source qui change de place sans changer de contenu : ses citants sont réindexés avec son type', async () => {
		const dep = fauxPorts();
		await dep.coffre.ecrire('notes/n.md', `${sujet}\n## Faits\n- Un fait | declare | src: [[projets/Lumen/Cahier]] | appris 2026-11-20 ^f-0001\n`);
		await synchroniser(dep);
		expect((await dep.index.elements({ chemins: ['notes/n.md'], genres: ['fait'] }))[0]!.typeSource).toBe('inconnue');
		await dep.coffre.ecrire('projets/Lumen/Cahier.md', source('Projets/Lumen/cahier.md', 'e1'));
		await synchroniser(dep);
		expect((await dep.index.elements({ chemins: ['notes/n.md'], genres: ['fait'] }))[0]!.typeSource).toBe('spec_validee');
	});
});

describe('lister les fiches à traiter, où qu’elles soient', () => {
	it('lister avec aTraiter rend toutes les sources à traiter de la mémoire, rangées n’importe où', async () => {
		const dep = fauxPorts();
		await dep.coffre.ecrire('sources/a.md', '---\nid: 01A\ntype: source\na_traiter: true\nupdated: 2026-11-01\n---\n# Alpha\n');
		await dep.coffre.ecrire('clients/acme/docs/b.md', '---\nid: 01B\ntype: source\na_traiter: true\nupdated: 2026-11-01\n---\n# Bêta\n');
		await dep.coffre.ecrire('clients/acme/docs/c.md', '---\nid: 01C\ntype: source\nupdated: 2026-11-01\n---\n# Gamma\n');
		const listing = await listerATraiter(dep);
		expect(listing.fiches.map((f) => f.chemin)).toEqual(['sources/a.md', 'clients/acme/docs/b.md']);
		expect(listing.fiches.every((f) => f.aTraiter === true)).toBe(true);
	});
});
