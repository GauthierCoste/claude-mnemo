import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { pluginsClaude } from '../../src/infra/plugins-claude.ts';
import { dossierTemporaire } from '../aides/dossier-temporaire.ts';

async function ecrire(chemin: string, contenu: string): Promise<void> {
	await mkdir(join(chemin, '..'), { recursive: true });
	await writeFile(chemin, contenu);
}

async function declarer(claude: string, id: string, installPath: string, version = '7.0.2'): Promise<void> {
	await ecrire(join(claude, 'plugins', 'installed_plugins.json'), JSON.stringify({ version: 2, plugins: { [id]: [{ scope: 'user', installPath, version }] } }));
}

describe('pluginsClaude', () => {
	it('lit un plugin installé, ses skills et ses hooks', async () => {
		const claude = await dossierTemporaire();
		const chemin = join(claude, 'cache', 'sp');
		await ecrire(join(chemin, 'skills', 'a', 'SKILL.md'), '---\nname: alpha\ndescription: Première skill\n---\nCorps\n');
		await ecrire(join(chemin, 'skills', 'b', 'SKILL.md'), '---\nname: beta\ndescription: Seconde skill\n---\n');
		await ecrire(join(chemin, 'hooks', 'hooks.json'), '{}');
		await declarer(claude, 'superpowers@superpowers-marketplace', chemin);
		const { plugins, avertissements } = await pluginsClaude(claude).installes();
		expect(avertissements).toEqual([]);
		expect(plugins).toHaveLength(1);
		expect(plugins[0]).toMatchObject({ id: 'superpowers@superpowers-marketplace', nom: 'superpowers', version: '7.0.2', portee: 'user', hooks: true });
		expect(plugins[0]!.skills).toEqual([
			{ nom: 'alpha', description: 'Première skill' },
			{ nom: 'beta', description: 'Seconde skill' },
		]);
	});

	it('rend une liste vide, sans avertissement, quand installed_plugins.json est absent', async () => {
		const claude = await dossierTemporaire();
		expect(await pluginsClaude(claude).installes()).toEqual({ plugins: [], avertissements: [] });
	});

	it('avertit sans lever quand le JSON est illisible', async () => {
		const claude = await dossierTemporaire();
		await ecrire(join(claude, 'plugins', 'installed_plugins.json'), '{ pas du json');
		const r = await pluginsClaude(claude).installes();
		expect(r.plugins).toEqual([]);
		expect(r.avertissements).toHaveLength(1);
		expect(r.avertissements[0]).toContain('installed_plugins.json');
	});

	it('rend le plugin sans skills, avec un avertissement qui le nomme, quand installPath a disparu', async () => {
		const claude = await dossierTemporaire();
		await declarer(claude, 'fantome@place', join(claude, 'disparu'), '1.0.0');
		const r = await pluginsClaude(claude).installes();
		expect(r.plugins).toEqual([{ id: 'fantome@place', nom: 'fantome', version: '1.0.0', portee: 'user', skills: [], hooks: false }]);
		expect(r.avertissements).toHaveLength(1);
		expect(r.avertissements[0]).toContain('fantome@place');
	});

	it('nomme par son dossier une skill sans frontmatter', async () => {
		const claude = await dossierTemporaire();
		const chemin = join(claude, 'cache', 'p');
		await ecrire(join(chemin, 'skills', 'nue', 'SKILL.md'), 'Juste du texte\n');
		await declarer(claude, 'p@m', chemin);
		const { plugins } = await pluginsClaude(claude).installes();
		expect(plugins[0]!.skills).toEqual([{ nom: 'nue', description: '' }]);
	});

	it('liste les skills personnelles : dossiers contenant un SKILL.md', async () => {
		const claude = await dossierTemporaire();
		await ecrire(join(claude, 'skills', 'ma-skill', 'SKILL.md'), 'x');
		await mkdir(join(claude, 'skills', 'vide'), { recursive: true });
		expect(await pluginsClaude(claude).skillsPersonnelles()).toEqual(['ma-skill']);
		expect(await pluginsClaude(join(claude, 'absent')).skillsPersonnelles()).toEqual([]);
	});
});
