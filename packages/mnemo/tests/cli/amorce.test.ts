import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { dossierTemporaire } from '../aides/dossier-temporaire.ts';
import { ENV_TEST } from '../aides/env-test.ts';

const MAIN = join(import.meta.dirname, '../../src/adaptateurs/cli/main.ts');

function mnemo(cwd: string, ...args: string[]): Promise<{ code: number; out: string; err: string }> {
	return new Promise((resoudre) => {
		execFile(process.execPath, [MAIN, ...args], { cwd, env: ENV_TEST }, (erreur, out, err) => {
			resoudre({ code: erreur ? (erreur.code as number) : 0, out, err });
		});
	});
}

describe('commande mnemo amorce', () => {
	it('importe la mémoire de Claude Code et les CLAUDE.md des projets, et affiche le bilan', async () => {
		const d = await dossierTemporaire();
		await mnemo(d, 'init', '--sans-mcp');
		const claude = join(d, 'faux-claude');
		await mkdir(join(claude, 'projects', '-x-y', 'memory'), { recursive: true });
		await writeFile(join(claude, 'projects', '-x-y', 'memory', 'note.md'), 'Une note.\n');
		await writeFile(join(claude, 'CLAUDE.md'), 'Global.\n');
		await mkdir(join(d, 'Projets', 'P', '.claude'), { recursive: true });
		await writeFile(join(d, 'Projets', 'P', 'CLAUDE.md'), '# P\n\nLe projet P.\n');
		await writeFile(join(d, 'Projets', 'P', '.claude', 'settings.local.json'), '{}');
		const r = await mnemo(d, 'amorce', '--dossier-claude', claude);
		expect(r.code).toBe(0);
		expect(r.out).toBe(
			'Amorçage : 2 fiches ajoutées, 0 fiche mise à jour, 0 fiche inchangée, 2 fichiers ignorés.\n' +
				'Instructions des projets (CLAUDE.md, .claude/) : 1 ajoutée, 0 mise à jour, 0 inchangée.\n' +
				"3 fiches à traiter : confiées à l'archiviste à son lancement (ou par le bouton de la vue Mémoire).\n" +
				// la configuration de Claude, ici dans le dossier et marquée par son CLAUDE.md, n'est pas un projet parcouru
				"Ignoré : faux-claude (configuration de Claude Code (lue par l'amorçage de la mémoire))\n" +
				'Ignoré : Projets/P/.claude/settings.local.json (pas un fichier .md)\n',
		);
		const encore = await mnemo(d, 'amorce', '--dossier-claude', claude);
		expect(encore.out).toBe(
			'Amorçage : 0 fiche ajoutée, 0 fiche mise à jour, 2 fiches inchangées, 2 fichiers ignorés.\n' +
				'Instructions des projets (CLAUDE.md, .claude/) : 0 ajoutée, 0 mise à jour, 1 inchangée.\n' +
				"3 fiches à traiter : confiées à l'archiviste à son lancement (ou par le bouton de la vue Mémoire).\n" +
				"Ignoré : faux-claude (configuration de Claude Code (lue par l'amorçage de la mémoire))\n" +
				'Ignoré : Projets/P/.claude/settings.local.json (pas un fichier .md)\n',
		);
		const lit = await mnemo(d, 'lit', 'sources/claude-code/global/CLAUDE.md');
		expect(lit.out).toContain('Global.');
	});

	it('mnemo lit : un secret d\'une fiche source (écrit en clair avant le masquage) ne s\'affiche pas', async () => {
		const d = await dossierTemporaire();
		await mnemo(d, 'init', '--sans-mcp');
		await mkdir(join(d, '_mnemo', 'sources'), { recursive: true });
		await writeFile(join(d, '_mnemo', 'sources', 'vieille.md'), '---\nid: 01V\ntype: source\nupdated: 2026-11-01\n---\n# Vieille\n\n## Contenu\n\nghp_abcdefghijklmnopqrstuvwxyz0123456789\n');
		const lit = await mnemo(d, 'lit', 'sources/vieille.md');
		expect(lit.code).toBe(0);
		expect(lit.out).not.toContain('ghp_');
		expect(lit.out).toContain('[secret masqué]');
	});

	it('sans mémoire Mnemo ou avec une option inconnue : erreur', async () => {
		const d = await dossierTemporaire();
		expect((await mnemo(d, 'amorce', '--dossier-claude', d)).code).toBe(1);
		await mnemo(d, 'init', '--sans-mcp');
		expect((await mnemo(d, 'amorce', '--bidule')).code).toBe(2);
	});
});
