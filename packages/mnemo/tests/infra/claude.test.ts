import { access, chmod, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ecrirePlugin, retirerPlugin, trouverClaude } from '../../src/infra/claude.ts';
import { dossierTemporaire } from '../aides/dossier-temporaire.ts';

const ID = '0f1e2d3c-4b5a-4968-8776-655443322110';

async function executable(dossier: string, nom: string): Promise<string> {
	await mkdir(dossier, { recursive: true });
	const chemin = join(dossier, nom);
	await writeFile(chemin, '#!/bin/sh\nexit 0\n');
	await chmod(chemin, 0o755);
	return chemin;
}

/** Un shim npm `claude.cmd` (forme de cmd-shim) et le script qu'il lance ; rend le chemin du script. */
async function shimNpm(dossier: string, texte?: string): Promise<string> {
	const script = join(dossier, 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js');
	await mkdir(join(dossier, 'node_modules', '@anthropic-ai', 'claude-code'), { recursive: true });
	await writeFile(script, '');
	const shim =
		texte ??
		[
			'@ECHO off',
			'GOTO start',
			':find_dp0',
			'SET dp0=%~dp0',
			'EXIT /b',
			':start',
			'SETLOCAL',
			'CALL :find_dp0',
			'',
			'IF EXIST "%dp0%\\node.exe" (',
			'  SET "_prog=%dp0%\\node.exe"',
			') ELSE (',
			'  SET "_prog=node"',
			'  SET PATHEXT=%PATHEXT:;.JS;=;%',
			')',
			'',
			'endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\@anthropic-ai\\claude-code\\cli.js" %*',
			'',
		].join('\r\n');
	await writeFile(join(dossier, 'claude.cmd'), shim);
	return script;
}

describe('trouverClaude', () => {
	it('MNEMO_CLAUDE en .mjs ou .js : lancé par le Node courant', async () => {
		const d = await dossierTemporaire();
		const faux = join(d, 'faux-claude.mjs');
		await writeFile(faux, '');
		expect(trouverClaude({ MNEMO_CLAUDE: faux, PATH: '' }, 'darwin')).toEqual({ commande: process.execPath, avant: [faux] });
		const js = join(d, 'faux.js');
		await writeFile(js, '');
		expect(trouverClaude({ MNEMO_CLAUDE: js }, 'linux')).toEqual({ commande: process.execPath, avant: [js] });
	});

	it('MNEMO_CLAUDE vers un exécutable : lancé directement', async () => {
		const d = await dossierTemporaire();
		const bin = await executable(d, 'mon-claude');
		expect(trouverClaude({ MNEMO_CLAUDE: bin }, 'darwin')).toEqual({ commande: bin, avant: [] });
	});

	it('MNEMO_CLAUDE vers un fichier absent : null, sans jamais retomber sur le claude du PATH', async () => {
		const d = await dossierTemporaire();
		await executable(join(d, 'bin'), 'claude');
		expect(trouverClaude({ MNEMO_CLAUDE: join(d, 'absent.mjs'), PATH: join(d, 'bin') }, 'darwin')).toBeNull();
	});

	it('sinon cherche claude dans le PATH, dans l\'ordre, en sautant les fichiers non exécutables', async () => {
		const d = await dossierTemporaire();
		await mkdir(join(d, 'vide'));
		await mkdir(join(d, 'non-exec'));
		await writeFile(join(d, 'non-exec', 'claude'), 'texte');
		await chmod(join(d, 'non-exec', 'claude'), 0o644);
		await mkdir(join(d, 'dossier', 'claude'), { recursive: true });
		const bon = await executable(join(d, 'bin'), 'claude');
		const PATH = [join(d, 'absent'), join(d, 'vide'), join(d, 'non-exec'), join(d, 'dossier'), join(d, 'bin')].join(':');
		expect(trouverClaude({ PATH }, 'darwin')).toEqual({ commande: bon, avant: [] });
	});

	it('Windows : PATH séparé par « ; », extensions de PATHEXT, clé Path', async () => {
		const d = await dossierTemporaire();
		const bon = await executable(join(d, 'b'), 'claude.EXE');
		await mkdir(join(d, 'a'));
		expect(trouverClaude({ Path: `${join(d, 'a')};${join(d, 'b')}`, PATHEXT: '.COM;.EXE;.CMD' }, 'win32')).toEqual({ commande: bon, avant: [] });
	});

	it('Windows : claude.exe préféré à un claude.cmd placé plus tôt dans le PATH', async () => {
		const d = await dossierTemporaire();
		await shimNpm(join(d, 'a'));
		const exe = await executable(join(d, 'b'), 'claude.exe');
		expect(trouverClaude({ PATH: `${join(d, 'a')};${join(d, 'b')}`, PATHEXT: '.com;.exe;.bat;.cmd' }, 'win32')).toEqual({ commande: exe, avant: [] });
	});

	it('Windows : claude.cmd (shim npm) → son script Node, lancé par le Node courant, sans shell', async () => {
		const d = await dossierTemporaire();
		const script = await shimNpm(join(d, 'npm'));
		expect(trouverClaude({ PATH: join(d, 'npm'), PATHEXT: '.COM;.EXE;.BAT;.CMD' }, 'win32')).toEqual({ commande: process.execPath, avant: [script] });
		// MNEMO_CLAUDE vers le shim : même résolution
		expect(trouverClaude({ MNEMO_CLAUDE: join(d, 'npm', 'claude.cmd') }, 'win32')).toEqual({ commande: process.execPath, avant: [script] });
	});

	it('Windows : claude.cmd illisible mais cli.js du paquet à côté → ce script', async () => {
		const d = await dossierTemporaire();
		const script = await shimNpm(join(d, 'npm'), '@ECHO off\r\nrem rien d\'utile ici\r\n');
		expect(trouverClaude({ PATH: join(d, 'npm'), PATHEXT: '.EXE;.CMD' }, 'win32')).toEqual({ commande: process.execPath, avant: [script] });
	});

	it('Windows : claude.cmd vers un exécutable natif → cet exécutable', async () => {
		const d = await dossierTemporaire();
		await mkdir(join(d, 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'bin'), { recursive: true });
		const exe = join(d, 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe');
		await writeFile(exe, '');
		await writeFile(join(d, 'npm', 'claude.cmd'), '@ECHO off\r\n"%dp0%\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe"   %*\r\n');
		expect(trouverClaude({ PATH: join(d, 'npm'), PATHEXT: '.EXE;.CMD' }, 'win32')).toEqual({ commande: exe, avant: [] });
	});

	it('Windows : claude.cmd sans cible trouvable (ou .bat) → null : mode dégradé, jamais de shell', async () => {
		const d = await dossierTemporaire();
		await mkdir(join(d, 'npm'));
		await writeFile(join(d, 'npm', 'claude.cmd'), '@ECHO off\r\n"%dp0%\\absent\\cli.js" %*\r\n');
		await writeFile(join(d, 'npm', 'claude.bat'), '@ECHO off\r\n');
		expect(trouverClaude({ PATH: join(d, 'npm'), PATHEXT: '.EXE;.BAT;.CMD' }, 'win32')).toBeNull();
	});

	it('claude absent (ou PATH vide) : null', async () => {
		const d = await dossierTemporaire();
		expect(trouverClaude({ PATH: d }, 'darwin')).toBeNull();
		expect(trouverClaude({}, 'linux')).toBeNull();
	});
});

describe('ecrirePlugin', () => {
	it('écrit les fichiers sous .mnemo/plugins/<session>/ et rend le dossier', async () => {
		const racine = await dossierTemporaire();
		const dossier = await ecrirePlugin(racine, ID, [
			{ chemin: '.claude-plugin/plugin.json', texte: '{}\n' },
			{ chemin: 'skills/revue/SKILL.md', texte: 'Relis.\n' },
		]);
		expect(dossier).toBe(join(racine, '.mnemo', 'plugins', ID));
		expect(await readFile(join(dossier, 'skills', 'revue', 'SKILL.md'), 'utf8')).toBe('Relis.\n');
		// .mnemo/ ignoré par git, comme pour l'index
		expect(await readFile(join(racine, '.mnemo', '.gitignore'), 'utf8')).toBe('*\n');
	});

	it('un nouvel assemblage remplace l\'ancien (un skill retiré disparaît)', async () => {
		const racine = await dossierTemporaire();
		await ecrirePlugin(racine, ID, [{ chemin: 'skills/vieux/SKILL.md', texte: 'x' }, { chemin: 'consigne.md', texte: 'a' }]);
		const dossier = await ecrirePlugin(racine, ID, [{ chemin: 'consigne.md', texte: 'b' }]);
		expect(await readdir(dossier)).toEqual(['consigne.md']);
		expect(await readFile(join(dossier, 'consigne.md'), 'utf8')).toBe('b');
	});

	it('refuse une session qui n\'est pas un uuid et un chemin qui sort du plugin', async () => {
		const racine = await dossierTemporaire();
		await expect(ecrirePlugin(racine, '../../x', [])).rejects.toThrow(/session/);
		for (const chemin of ['../dehors.md', '/abs.md', 'a/../../b.md', 'a\\b.md', '', 'a//b.md']) {
			await expect(ecrirePlugin(racine, ID, [{ chemin, texte: '' }])).rejects.toThrow(/plugin/);
		}
	});
});

describe('retirerPlugin', () => {
	it('supprime .mnemo/plugins/<session>/ (absent : sans erreur) et seulement lui ; refuse une session hors uuid', async () => {
		const racine = await dossierTemporaire();
		const dossier = await ecrirePlugin(racine, ID, [{ chemin: 'consigne.md', texte: 'a' }]);
		const autre = await ecrirePlugin(racine, '22222222-2222-4333-8444-555555555555', [{ chemin: 'consigne.md', texte: 'b' }]);
		await retirerPlugin(racine, ID);
		await expect(access(dossier)).rejects.toThrow();
		expect(await readdir(autre)).toEqual(['consigne.md']);
		await retirerPlugin(racine, ID);
		await expect(retirerPlugin(racine, '..')).rejects.toThrow(/session/);
		expect(await readdir(join(racine, '.mnemo', 'plugins'))).toEqual(['22222222-2222-4333-8444-555555555555']);
	});
});
