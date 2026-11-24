import { describe, expect, it } from 'vitest';
import { diagnostiquer } from '../../src/application/diagnostiquer.ts';
import { empreinte } from '../../src/domaine/empreinte.ts';
import { fauxPorts } from '../aides/faux-ports.ts';

const fiche = (type: string, titre: string, corps = '', extra = '') => `---\nid: 01X\ntype: ${type}\n${extra}updated: 2026-11-01\n---\n# ${titre}\n${corps}`;

function memoire() {
	const dep = fauxPorts();
	dep.fichiers.set('SCHEMA.md', '---\nseuil_rappel: 0.5\n---\n# Schéma\n');
	dep.fichiers.set('clients/clients.md', fiche('dossier', 'Clients', '\nLes clients.\n'));
	dep.fichiers.set('clients/acme.md', fiche('organisation', 'Acme', [
		'',
		'Client depuis 2024, voir [[clients/zeta]].',
		'',
		'## Informations',
		'- Le client est Acme | declare | src: [[sources/a]] | confiance 45 % ^f-0001',
		'- Le client est bien Acme | declare | src: utilisateur | confiance 100 % ^f-0002',
		'- Budget à préciser | declare | src: utilisateur | a confirmer ^f-0003',
		'',
	].join('\n')));
	dep.fichiers.set('clients/beta/notes.md', fiche('sujet', 'Notes', '\nDes notes sans lien.\n'));
	dep.fichiers.set('sources/sources.md', fiche('dossier', 'Sources', '\nLes documents.\n'));
	dep.fichiers.set('sources/a.md', fiche('source', 'A', '', 'chemin: docs/a.pdf\nempreinte: e1\n'));
	dep.fichiers.set('sources/b.md', fiche('source', 'B', '', 'chemin: docs/b.pdf\nempreinte: e1\n'));
	return dep;
}

describe('diagnostiquer', () => {
	it('lit la mémoire sans rien écrire : comptes en tête, rubriques avec chemins et ancres, seuil de SCHEMA.md, dossiers parcourus', async () => {
		const dep = memoire();
		const avant = new Map(dep.fichiers);
		const texte = await diagnostiquer(dep);
		expect(dep.commits).toEqual([]);
		expect(dep.fichiers).toEqual(avant);
		expect(texte.split('\n')[0]).toBe('Diagnostic de la mémoire : 7 fiches, 3 informations.');
		expect(texte).toContain('- liens_casses : 1');
		expect(texte).toContain('- clients/acme.md → [[clients/zeta]]');
		// seuil de rappel lu dans SCHEMA.md (50 %) : 45 % est en dessous
		expect(texte).toContain('## Informations de confiance faible (sous 50 %) (1)');
		expect(texte).toContain('- clients/acme.md#^f-0001 (confiance 45 %)');
		expect(texte).toContain('- clients/acme.md#^f-0003 « Budget à préciser »');
		expect(texte).toContain('- clients/acme.md : ^f-0001 ≈ ^f-0002');
		// dossier sans fiche : trouvé en parcourant la mémoire
		expect(texte).toContain('- clients/beta/ : sans fiche (clients/beta/beta.md)');
		expect(texte).toContain('- clients/beta/notes.md');
		expect(texte).toContain('- sources/a.md, sources/b.md : même document');
		expect(texte).toContain('- sources_non_citees : 1');
		expect(texte).toMatch(/^- sources\/b\.md$/mu);
	});

	it('rubriques filtrées, limite par rubrique (les comptes restent entiers)', async () => {
		const dep = memoire();
		dep.fichiers.set('clients/c.md', fiche('organisation', 'C', '\nVoir [[x1]], [[x2]], [[x3]].\n'));
		const texte = await diagnostiquer(dep, { rubriques: ['liens_casses'], limite: 2 });
		expect(texte.split('\n')).toEqual([
			'Diagnostic de la mémoire : 8 fiches, 3 informations.',
			'- liens_casses : 4',
			'',
			'## Liens cassés (4)',
			'- clients/acme.md → [[clients/zeta]]',
			'- clients/c.md → [[x1]]',
			'… 2 de plus',
		]);
	});

	it('mémoire vide : rien à signaler', async () => {
		expect(await diagnostiquer(fauxPorts())).toContain('Rien à signaler.');
	});

	it('lots proposés en attente, lus dans l\'état local', async () => {
		const dep = memoire();
		await dep.lots.enregistrer({ id: 'L1', genre: 'supprimer', fiche: 'clients/acme.md', lignes: [{ ancre: 'f-0001' }], motif: 'Doublon', empreinte: empreinte(dep.fichiers.get('clients/acme.md')!), proposeMs: 1, session: null });
		const texte = await diagnostiquer(dep, { rubriques: ['lots_en_attente'] });
		expect(texte).toContain('- lots_en_attente : 1');
		expect(texte).toContain('## Lots proposés en attente de l\'utilisateur (1)');
		expect(texte).toContain('- clients/acme.md : lot L1 (supprimer, 1 ligne(s)) « Doublon »');
	});
});
