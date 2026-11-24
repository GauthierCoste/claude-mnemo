import { describe, expect, it } from 'vitest';
import { deplacer } from '../../src/application/deplacer.ts';
import { proposer } from '../../src/application/proposer.ts';
import type { Demande } from '../../src/application/proposer.ts';
import { fauxPorts } from '../aides/faux-ports.ts';

const src = { ref: 'dit en séance', type: 'utilisateur' as const };
const SANS_ID = '---\ntype: sujet\nupdated: 2026-01-01\n---\n# A\n\n## Faits\n- Montant | declare | a confirmer ^f-0001\n';

describe('toute fiche réécrite par Mnemo reçoit un identifiant', () => {
	const cas: [string, Demande][] = [
		['fait', { genre: 'fait', fiche: 'a.md', texte: 'Autre', nature: 'declare', source: src }],
		['relation', { genre: 'relation', fiche: 'a.md', verbe: 'concerne', cible: 'b' }],
		['confirmer', { genre: 'confirmer', fiche: 'a.md', ancre: 'f-0001' }],
		['rejeter', { genre: 'rejeter', fiche: 'a.md', ancre: 'f-0001' }],
		['supprimer', { genre: 'supprimer', fiche: 'a.md', ancre: 'f-0001' }],
	];
	for (const [nom, demande] of cas) {
		it(nom, async () => {
			const dep = fauxPorts();
			dep.fichiers.set('a.md', SANS_ID);
			expect((await proposer(dep, demande, { appliquerDirectement: true })).statut).toBe('ecrit');
			expect(dep.fichiers.get('a.md')).toMatch(/^---\nid: ID\d{4}\n/u);
		});
	}

	it('consigne répétée', async () => {
		const dep = fauxPorts();
		dep.fichiers.set('consignes/r.md', '---\ntype: consigne\nportee: globale\nniveau: rappelee\n---\n# Règle\n\nRègle\n');
		expect((await proposer(dep, { genre: 'consigne', texte: 'Règle', portee: { genre: 'globale' }, source: src })).statut).toBe('repetition');
		expect(dep.fichiers.get('consignes/r.md')).toMatch(/^---\nid: ID\d{4}\n/u);
	});

	it('déplacement : la fiche déplacée et les fiches dont un lien est réécrit', async () => {
		const dep = fauxPorts();
		dep.fichiers.set('a.md', SANS_ID.replace('# A', '# a'));
		dep.fichiers.set('b.md', 'Voir [[a]].\n');
		dep.fichiers.set('c.md', '---\nid: C\ntype: sujet\n---\n# C\n\nVoir [[a]].\n');
		expect((await deplacer(dep, 'a.md', 'x/a.md')).statut).toBe('ecrit');
		expect(dep.fichiers.get('x/a.md')).toMatch(/^---\nid: ID\d{4}\n/u);
		expect(dep.fichiers.get('b.md')).toMatch(/^---\nid: ID\d{4}\n/u);
		expect(dep.fichiers.get('b.md')).toContain('Voir [[x/a]].');
		expect(dep.fichiers.get('c.md')).toBe('---\nid: C\ntype: sujet\n---\n# C\n\nVoir [[x/a]].\n');
	});

	it('les faits écrits à la main sans ancre en reçoivent une, distincte, à la réécriture', async () => {
		const dep = fauxPorts();
		dep.fichiers.set('a.md', '---\ntype: sujet\n---\n# A\n\n## Faits\n- Un\n- Deux\n');
		expect((await proposer(dep, { genre: 'fait', fiche: 'a.md', texte: 'Trois', nature: 'declare', source: src })).statut).toBe('ecrit');
		const ancres = [...dep.fichiers.get('a.md')!.matchAll(/ \^(f-\d{4})$/gmu)].map((m) => m[1]);
		expect(ancres).toHaveLength(3);
		expect(new Set(ancres).size).toBe(3);
	});

	it('garde un identifiant existant', async () => {
		const dep = fauxPorts();
		dep.fichiers.set('a.md', SANS_ID.replace('---\ntype', '---\nid: GARDE\ntype'));
		await proposer(dep, { genre: 'relation', fiche: 'a.md', verbe: 'concerne', cible: 'b' });
		expect(dep.fichiers.get('a.md')).toMatch(/^---\nid: GARDE\n/u);
	});
});
