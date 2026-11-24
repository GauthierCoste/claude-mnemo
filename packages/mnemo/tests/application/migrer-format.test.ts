import { describe, expect, it } from 'vitest';
import { migrerFormat } from '../../src/application/migrer-format.ts';
import { fauxPorts } from '../aides/faux-ports.ts';

const ancienne = (nom: string) => `---\nid: 01${nom.toUpperCase()}\ntype: sujet\nupdated: 2026-11-01\ntype_origine: projet\n---\n# ${nom}\n\nSynthèse : Résumé de ${nom}.\n`;
const neuve = (nom: string) => `---\nid: 01${nom.toUpperCase()}\ntype: sujet\nupdated: 2026-11-01\n---\n# ${nom}\n\nRésumé de ${nom}.\n`;

describe('migrerFormat', () => {
	it('migre les fiches à l\'ancien format en un seul commit, les autres intactes', async () => {
		const dep = fauxPorts();
		dep.fichiers.set('notes/a.md', ancienne('A'));
		dep.fichiers.set('notes/b.md', ancienne('B'));
		const propre = '---\nid: 01C\ntype: sujet\nupdated: 2026-11-01\n---\n# C\n\nDéjà bien.\n';
		dep.fichiers.set('notes/c.md', propre);
		const r = await migrerFormat(dep);
		expect(r.fiches).toEqual(['notes/a.md', 'notes/b.md']);
		expect(dep.fichiers.get('notes/a.md')).toBe(neuve('A'));
		expect(dep.fichiers.get('notes/b.md')).toBe(neuve('B'));
		expect(dep.fichiers.get('notes/c.md')).toBe(propre);
		expect(dep.commits).toHaveLength(1);
		expect(dep.commits[0]!.message).toBe('mnemo: migre format ancien (2 fiches)');
		expect(dep.commits[0]!.chemins).toEqual(['notes/a.md', 'notes/b.md']);
	});

	it('idempotent : deuxième passage sans écriture ni commit', async () => {
		const dep = fauxPorts();
		dep.fichiers.set('notes/a.md', ancienne('A'));
		await migrerFormat(dep);
		const apres = new Map(dep.fichiers);
		const r = await migrerFormat(dep);
		expect(r).toEqual({ fiches: [], commit: null });
		expect(dep.fichiers).toEqual(apres);
		expect(dep.commits).toHaveLength(1);
	});

	it('mémoire déjà au format courant : aucun commit', async () => {
		const dep = fauxPorts();
		dep.fichiers.set('notes/c.md', neuve('C'));
		expect((await migrerFormat(dep)).commit).toBeNull();
		expect(dep.commits).toHaveLength(0);
	});

	it('index rafraîchi : la synthèse indexée est sans préfixe', async () => {
		const dep = fauxPorts();
		dep.fichiers.set('notes/a.md', ancienne('A'));
		await migrerFormat(dep);
		const indexees = await dep.index.fiches();
		expect(indexees.map((f) => f.chemin)).toContain('notes/a.md');
	});
});
