import { describe, expect, it } from 'vitest';
import { deplacer } from '../../src/application/deplacer.ts';
import { positionDuProjet } from '../../src/application/position.ts';
import { proposer } from '../../src/application/proposer.ts';
import { elementsDeFiche } from '../../src/domaine/elements.ts';
import { fauxPorts } from '../aides/faux-ports.ts';

const fiche = (type: string) => `---\nid: 01ABC\ntype: ${type}\ndossier_projet: h1\nupdated: 2026-11-01\n---\n# T\n\nSynthèse.\n`;
const session = { type: 'session', ref: 'session s1' } as const;

describe('dossier_projet n\'est honoré que sur les fiches de lieu', () => {
	it('elementsDeFiche ignore dossier_projet sur une fiche source ou episode ; tout type libre est un lieu', () => {
		for (const type of ['source', 'episode']) {
			expect(elementsDeFiche('a.md', fiche(type)).elements[0]!.dossierProjet, type).toBeNull();
		}
		for (const type of ['dossier', 'entite', 'sujet', 'personne', 'glossaire']) {
			expect(elementsDeFiche('a.md', fiche(type)).elements[0]!.dossierProjet, type).toBe('h1');
		}
	});

	it('une fiche source qui déclare dossier_projet ne fixe pas la position', async () => {
		const dep = fauxPorts();
		await dep.coffre.ecrire('g1/piege.md', fiche('source'));
		expect((await positionDuProjet(dep, 'h1')).chemin).toBe('');
		await dep.coffre.ecrire('g2/d1/d1.md', fiche('dossier'));
		expect((await positionDuProjet(dep, 'h1')).chemin).toBe('g2/d1');
	});
});

describe('dossier_projet et portee se posent par proposer (le travail de l\'archiviste)', () => {
	it('genre fiche : accepté sur une fiche de lieu, refusé sur une source ou un épisode, ou mal écrit', async () => {
		const dep = fauxPorts();
		expect(await proposer(dep, { genre: 'fiche', chemin: 'g1/d1/d1.md', type: 'dossier', titre: 'D1', donnees: { dossier_projet: 'h1', portee: 'projet:D1' } })).toMatchObject({ statut: 'ecrit' });
		expect((await positionDuProjet(dep, 'h1/e1')).chemin).toBe('g1/d1');
		expect(await proposer(dep, { genre: 'fiche', chemin: 'g1/s.md', type: 'source', titre: 'S', donnees: { dossier_projet: 'h2' } })).toMatchObject({
			statut: 'refuse',
			motif: expect.stringContaining('fiche de lieu'),
		});
		expect(await proposer(dep, { genre: 'fiche', chemin: 'g1/p.md', type: 'personne', titre: 'P', donnees: { dossier_projet: 'h3' } })).toMatchObject({ statut: 'ecrit' });
		expect((await positionDuProjet(dep, 'h3')).chemin).toBe('g1/p.md');
		expect(await proposer(dep, { genre: 'fiche', chemin: 'g1/e.md', type: 'entite', titre: 'E', donnees: { dossier_projet: '../h2' } })).toMatchObject({ statut: 'refuse' });
		expect(await proposer(dep, { genre: 'fiche', chemin: 'g1/f.md', type: 'entite', titre: 'F', donnees: { portee: 'acme' } })).toMatchObject({ statut: 'refuse', motif: expect.stringContaining('« portee »') });
	});

	it('genre modification : une session pose puis retire le lien ; la position suit', async () => {
		const dep = fauxPorts();
		await dep.coffre.ecrire('g1/d1/d1.md', '---\nid: 01D1\ntype: dossier\nupdated: 2026-11-01\n---\n# D1\n\nUn lieu.\n');
		expect((await positionDuProjet(dep, 'h1')).rattachement).toEqual({ dossier: 'h1', rattache: false });
		expect(await proposer(dep, { genre: 'modification', fiche: 'g1/d1/d1.md', dossier_projet: 'h1\\', portee: 'client:C1', source: session })).toMatchObject({
			statut: 'ecrit',
			aConfirmer: false,
			changements: ['dossier_projet : (aucun) → h1', 'portee : (aucun) → client:C1'],
		});
		expect(await positionDuProjet(dep, 'h1')).toEqual({ chemin: 'g1/d1', rattachement: { dossier: 'h1', rattache: true } });
		expect(await proposer(dep, { genre: 'modification', fiche: 'g1/d1/d1.md', dossier_projet: '', source: session })).toMatchObject({ statut: 'ecrit' });
		expect((await positionDuProjet(dep, 'h1')).chemin).toBe('');
	});

	it('genre modification : refusé sur une fiche qui n\'est pas un lieu (source, épisode)', async () => {
		const dep = fauxPorts();
		await dep.coffre.ecrire('g1/s.md', '---\nid: 01S\ntype: episode\nupdated: 2026-11-01\n---\n# S\n\nUn épisode.\n');
		expect(await proposer(dep, { genre: 'modification', fiche: 'g1/s.md', dossier_projet: 'h1', source: session })).toMatchObject({ statut: 'refuse', motif: expect.stringContaining('fiche de lieu') });
	});

	it('archiviste.typesAConfirmer ne vise que les informations : le lien proposé par une session est posé directement', async () => {
		const dep = fauxPorts();
		const reglages = dep.reglages();
		dep.reglages = () => ({ ...reglages, archiviste: { typesAConfirmer: ['dossier', 'entite'] } });
		await dep.coffre.ecrire('g1/d1/d1.md', '---\nid: 01D1\ntype: dossier\nupdated: 2026-11-01\n---\n# D1\n\nUn lieu.\n');
		expect(await proposer(dep, { genre: 'modification', fiche: 'g1/d1/d1.md', dossier_projet: 'h1', synthese: 'Le lieu D1.', source: session })).toMatchObject({ statut: 'ecrit', aConfirmer: false });
		expect((await positionDuProjet(dep, 'h1')).chemin).toBe('g1/d1');
		expect(await proposer(dep, { genre: 'fiche', chemin: 'g1/e2.md', type: 'entite', titre: 'E2', donnees: { dossier_projet: 'h2' } })).toMatchObject({ statut: 'ecrit', aConfirmer: false });
		expect((await positionDuProjet(dep, 'h2')).chemin).toBe('g1/e2.md');
	});

	it('deplacer range une fiche qui déclare dossier_projet ou portee ; la position suit la fiche', async () => {
		const dep = fauxPorts();
		await dep.coffre.ecrire('g1/f1.md', '---\nid: 01F1\ntype: entite\ndossier_projet: h1\nportee: client:C1\nupdated: 2026-11-01\n---\n# F1\n');
		expect((await deplacer(dep, 'g1/f1.md', 'g2/f1.md')).statut).toBe('ecrit');
		expect((await positionDuProjet(dep, 'h1')).chemin).toBe('g2/f1.md');
	});
});
