import { describe, expect, it } from 'vitest';
import { deplacer } from '../../src/application/deplacer.ts';
import { entretenir } from '../../src/application/entretenir.ts';
import { fauxPorts } from '../aides/faux-ports.ts';

const fiche = (type: string, titre: string, corps = '') => `---\nid: 01${titre.toUpperCase().replace(/[^A-Z]/gu, '')}\ntype: ${type}\nupdated: 2026-11-01\n---\n# ${titre}\n${corps}`;

function memoire() {
	const dep = fauxPorts();
	dep.fichiers.set('stacks/MCP.md', fiche('sujet', 'MCP', '\nLe protocole.\n'));
	dep.fichiers.set('personnes/clients/Samuel Tanaro.md', fiche('personne', 'Samuel Tanaro', '\nUn client.\n'));
	dep.fichiers.set(
		'projets/p.md',
		fiche('sujet', 'P', '\nCorps.\n\n## Relations\n- utilise [[stacks/MCP.md]]\n- géré par [[personnes/clients/Samuel Tanaro.md|Tano]]\n- ancre [[stacks/MCP.md#Section]]\n- sans extension [[stacks/MCP]]\n'),
	);
	return dep;
}

describe('liens écrits avec le chemin complet et l’extension', () => {
	it('deplacer : [[stacks/MCP.md]] et [[…Tanaro.md|Tano]] réécrits, alias et ancre gardés', async () => {
		const dep = memoire();
		expect((await deplacer(dep, 'stacks/MCP.md', 'outils/MCP.md')).statut).toBe('ecrit');
		expect((await deplacer(dep, 'personnes/clients/Samuel Tanaro.md', 'personnes/Samuel Tanaro.md')).statut).toBe('ecrit');
		const texte = dep.fichiers.get('projets/p.md')!;
		expect(texte).toContain('- utilise [[outils/MCP]]');
		expect(texte).toContain('- géré par [[personnes/Samuel Tanaro|Tano]]');
		expect(texte).toContain('- ancre [[outils/MCP#Section]]');
		expect(texte).toContain('- sans extension [[outils/MCP]]');
		expect(texte).not.toContain('stacks/MCP');
	});

	it('supprimer avec redirection : les liens avec .md sont réécrits', async () => {
		const dep = memoire();
		dep.fichiers.set('outils/MCP.md', fiche('sujet', 'Outil MCP', '\nLe nouveau.\n'));
		const r = await entretenir(dep, { action: 'supprimer', id: 'stacks/MCP.md', redirection: 'outils/MCP.md' });
		expect(r.statut).toBe('ecrit');
		const texte = dep.fichiers.get('projets/p.md')!;
		expect(texte).toContain('[[outils/MCP]]');
		expect(texte).not.toContain('stacks/MCP');
	});

	it('supprimer sans redirection : les liens avec .md comptent comme des citations', async () => {
		const dep = memoire();
		const r = await entretenir(dep, { action: 'supprimer', id: 'stacks/MCP.md' });
		expect(r).toMatchObject({ statut: 'refuse', citeePar: ['projets/p.md'] });
	});

	it('fusionner : les liens avec .md vers la fiche absorbée visent la receveuse', async () => {
		const dep = memoire();
		dep.fichiers.set('outils/MCP.md', fiche('sujet', 'Outil MCP', '\nLe nouveau.\n'));
		const r = await entretenir(dep, { action: 'fusionner', id: 'stacks/MCP.md', dans: 'outils/MCP.md' });
		expect(r.statut).toBe('ecrit');
		const texte = dep.fichiers.get('projets/p.md')!;
		expect(texte).toContain('[[outils/MCP');
		expect(texte).not.toContain('stacks/MCP');
	});

	it('corriger_lien : [[stacks/MCP.md]] désigné avec ou sans .md', async () => {
		const dep = memoire();
		const r = await entretenir(dep, { action: 'corriger_lien', id: 'projets/p.md', ancien: 'stacks/MCP', nouveau: 'stacks/MCP.md' });
		expect(r.statut).toBe('ecrit');
		const sans = memoire();
		const r2 = await entretenir(sans, { action: 'corriger_lien', id: 'projets/p.md', ancien: '[[stacks/MCP.md]]', nouveau: null });
		expect(r2.statut).toBe('ecrit');
		expect(sans.fichiers.get('projets/p.md')).toContain('- utilise stacks/MCP.md');
	});
});
