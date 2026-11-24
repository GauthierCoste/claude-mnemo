import { describe, expect, it } from 'vitest';
import { deplacer, destinationDuDeplacement } from '../../src/application/deplacer.ts';
import { lireFiche } from '../../src/domaine/fiche.ts';
import { fauxPorts } from '../aides/faux-ports.ts';

const fiche = (type: string, titre: string, corps = '') => `---\nid: 01${titre.toUpperCase().replace(/[^A-Z]/gu, '')}\ntype: ${type}\nupdated: 2026-11-01\n---\n# ${titre}\n${corps}`;

function memoire() {
	const dep = fauxPorts();
	dep.fichiers.set('clients/acme/acme.md', fiche('organisation', 'Acme', '\nLe client Acme.\n'));
	dep.fichiers.set('clients/acme/contrat.md', fiche('sujet', 'Contrat', '\nVoir [[clients/acme/acme]].\n'));
	dep.fichiers.set('clients/acme/site/site.md', fiche('dossier', 'Site'));
	dep.fichiers.set('clients/acme/site/maquette.md', fiche('sujet', 'Maquette'));
	dep.fichiers.set('notes/n.md', fiche('sujet', 'N', '\nLiens : [[clients/acme/contrat]], [[maquette]], [[clients/acme/site/site|le site]].\n'));
	return dep;
}

describe('destination d’un déplacement', () => {
	it('fiche simple : <dossier>/<nom>.md ; fiche de dossier : <dossier>/<nom>/<nom>.md', () => {
		expect(destinationDuDeplacement('notes/n.md', 'archives')).toBe('archives/n.md');
		expect(destinationDuDeplacement('notes/n.md', '', 'note')).toBe('note.md');
		expect(destinationDuDeplacement('clients/acme/acme.md', 'organisations')).toBe('organisations/acme/acme.md');
		expect(destinationDuDeplacement('clients/acme/acme.md', 'organisations', 'Acme SA')).toBe('organisations/Acme SA/Acme SA.md');
	});
});

describe('deplacer un dossier', () => {
	it('emporte ses fiches et sous-dossiers, réécrit les liens, en un seul commit', async () => {
		const dep = memoire();
		const r = await deplacer(dep, 'clients/acme/acme.md', 'organisations/acme/acme.md');
		expect(r).toMatchObject({ statut: 'ecrit', fiche: 'organisations/acme/acme.md' });
		expect([...dep.fichiers.keys()].filter((c) => c.startsWith('clients/acme/'))).toEqual([]);
		for (const c of ['organisations/acme/acme.md', 'organisations/acme/contrat.md', 'organisations/acme/site/site.md', 'organisations/acme/site/maquette.md']) expect(dep.fichiers.has(c), c).toBe(true);
		expect(dep.fichiers.get('organisations/acme/contrat.md')).toContain('[[organisations/acme/acme]]');
		const n = dep.fichiers.get('notes/n.md')!;
		expect(n).toContain('[[organisations/acme/contrat]]');
		expect(n).toContain('[[organisations/acme/site/maquette]]');
		expect(n).toContain('[[organisations/acme/site/site|le site]]');
		expect(dep.commits).toHaveLength(1);
		expect(dep.commits[0]!.message).toBe('mnemo: déplace clients/acme → organisations/acme');
	});

	it('renommé : la fiche du dossier prend le nouveau nom et garde l’ancien en alias', async () => {
		const dep = memoire();
		expect((await deplacer(dep, 'clients/acme/acme.md', 'clients/acme-sa/acme-sa.md')).statut).toBe('ecrit');
		const renommee = lireFiche('clients/acme-sa/acme-sa.md', dep.fichiers.get('clients/acme-sa/acme-sa.md')!);
		expect(renommee.alias).toContain('acme');
		expect(dep.fichiers.get('clients/acme-sa/contrat.md')).toContain('[[clients/acme-sa/acme-sa]]');
	});

	it('refuse sans rien écrire : destination existante, dans le dossier déplacé, dossiers à chemin fixe', async () => {
		const dep = memoire();
		dep.fichiers.set('organisations/acme/acme.md', fiche('dossier', 'Autre'));
		dep.fichiers.set('profils/travail/travail.md', fiche('profil', 'Travail'));
		const avant = new Map(dep.fichiers);
		for (const [de, vers] of [
			['clients/acme/acme.md', 'organisations/acme/acme.md'],
			['clients/acme/acme.md', 'clients/acme/sous/sous.md'],
			['clients/acme/acme.md', 'profils/acme/acme.md'],
			['profils/travail/travail.md', 'autres/travail/travail.md'],
		] as const) {
			expect((await deplacer(dep, de, vers)).statut, `${de} → ${vers}`).toBe('refuse');
		}
		expect(dep.fichiers).toEqual(avant);
		expect(dep.commits).toHaveLength(0);
	});

	it('échec pendant l’écriture : les fichiers reviennent à leur état d’avant', async () => {
		const dep = memoire();
		const avant = new Map(dep.fichiers);
		dep.historique.commit = async () => {
			throw new Error('git en panne');
		};
		await expect(deplacer(dep, 'clients/acme/acme.md', 'organisations/acme/acme.md')).rejects.toThrow('git en panne');
		expect(dep.fichiers).toEqual(avant);
	});
});
