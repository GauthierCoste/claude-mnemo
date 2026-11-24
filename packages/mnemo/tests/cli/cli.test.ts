import { execFile } from 'node:child_process';
import { access, mkdir, rm, writeFile } from 'node:fs/promises';
import { delimiter, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { messagesInit } from '../../src/adaptateurs/cli/init.ts';
import { racineDeSession, trouverRacine } from '../../src/adaptateurs/cli/racine.ts';
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

/** git avec une identité : les tests ne dépendent pas de la configuration de la machine (aucune sur une machine de CI). */
function git(cwd: string, ...args: string[]): Promise<string> {
	return new Promise((resoudre, rejeter) => {
		execFile('git', ['-c', 'user.name=Test', '-c', 'user.email=test@localhost', '-c', 'commit.gpgsign=false', ...args], { cwd }, (e, out) => (e ? rejeter(e) : resoudre(out)));
	});
}

describe('commande mnemo', () => {
	it("init --sans-mcp n'appelle pas claude", async () => {
		const d = await dossierTemporaire();
		const bin = join(d, 'bin');
		await mkdir(bin);
		const marque = join(d, 'appele');
		await writeFile(join(bin, 'claude'), `#!/bin/sh\ntouch "${marque}"\n`, { mode: 0o755 });
		const r = await new Promise<{ out: string }>((resoudre) => {
			execFile(process.execPath, [MAIN, 'init', '--sans-mcp'], { cwd: d, env: { ...process.env, MNEMO_SANS_MCP: '', PATH: `${bin}${delimiter}${process.env.PATH}` } }, (_e, out) => resoudre({ out }));
		});
		expect(r.out).toContain('Mémoire créée');
		expect(r.out).not.toContain('MCP');
		await expect(access(marque)).rejects.toThrow();
	});

	it('init crée l\'arbre et un commit ; un second init ne change rien', async () => {
		const d = await dossierTemporaire();
		const premier = await mnemo(d, 'init');
		expect(premier.code).toBe(0);
		const memoire = join(d, '_mnemo');
		expect((await git(memoire, 'log', '--format=%s')).trim()).toBe('mnemo: initialisation');
		expect(await git(memoire, 'status', '--porcelain')).toBe('');
		expect((await git(memoire, 'ls-files')).split('\n')).toEqual(expect.arrayContaining(['.gitattributes', '.gitignore', 'SCHEMA.md', 'profils/travail/travail.md']));
		expect(await git(memoire, 'check-ignore', '.mnemo-abc.tmp')).toBe('.mnemo-abc.tmp\n');
		const second = await mnemo(d, 'init');
		expect(second.code).toBe(0);
		expect(second.out).toContain('existe déjà');
		expect((await git(memoire, 'rev-list', '--count', 'HEAD')).trim()).toBe('1');
	});

	it('init sur une mémoire sans profil travail : le dépose dans son propre commit', async () => {
		const d = await dossierTemporaire();
		await mnemo(d, 'init');
		const memoire = join(d, '_mnemo');
		await rm(join(memoire, 'profils', 'travail', 'travail.md'));
		await git(memoire, 'commit', '-qam', 'retrait du profil');
		const r = await mnemo(d, 'init');
		expect(r.out).toContain('profil travail ajouté');
		expect((await git(memoire, 'log', '-1', '--format=%s')).trim()).toBe('mnemo: profil travail');
		await access(join(memoire, 'profils', 'travail', 'travail.md'));
	});

	it('messages de init : un par issue, jamais contradictoires', () => {
		const existante = { statut: 'existante', profil: null } as const;
		const deux = messagesInit('/m', existante, 'declare');
		expect(deux.join('\n')).not.toContain('rien n\'a changé');
		expect(deux[0]).toContain('existe déjà');
		expect(deux[1]).toBe('Serveur MCP déclaré pour toutes les sessions Claude Code.');
		expect(messagesInit('/m', { statut: 'existante', profil: 'abc' }, null)).toEqual([expect.stringContaining('profil travail ajouté (commit abc)')]);
		expect(messagesInit('/m', { statut: 'cree', commit: 'abc' }, 'deja')[1]).toBe('Serveur MCP déjà déclaré.');
		expect(messagesInit('/m', existante, { perime: true, manuel: 'claude mcp add X' })[1]).toBe(
			'Serveur MCP déclaré avec un autre chemin : lancez `claude mcp remove mnemo --scope user` puis : claude mcp add X',
		);
		expect(messagesInit('/m', existante, { perime: true, manuel: 'claude mcp add X', portee: 'Local config', scope: 'local' })[1]).toBe(
			'Serveur MCP déclaré avec un autre chemin (portée : Local config) : lancez `claude mcp remove mnemo --scope local` puis : claude mcp add X',
		);
		expect(messagesInit('/m', existante, { manuel: 'M', introuvable: true, raison: '' })[1]).toBe('Claude Code introuvable : lancez vous-même : M');
	});

	it('liste affiche la fiche du dossier, lit affiche la fiche brute', async () => {
		const d = await dossierTemporaire();
		await mnemo(d, 'init');
		const liste = await mnemo(d, 'liste', 'profils/travail');
		expect(liste.code).toBe(0);
		expect(liste.out).toContain('Profil');
		const racine = await mnemo(d, 'liste');
		expect(racine.out).toContain('  profils/');
		const lit = await mnemo(d, 'lit', 'profils/travail/travail.md');
		expect(lit.out).toMatch(/^---\n/u);
		expect(lit.out).toContain('type: profil');
	});

	it('liste un dossier vide ou inconnu : message explicite', async () => {
		const d = await dossierTemporaire();
		await mnemo(d, 'init');
		const r = await mnemo(d, 'liste', 'nulle/part');
		expect(r.code).toBe(0);
		expect(r.out).toBe('Dossier vide ou inconnu : nulle/part\n');
	});

	it('lit un chemin inconnu : code 1 et message', async () => {
		const d = await dossierTemporaire();
		await mnemo(d, 'init');
		const r = await mnemo(d, 'lit', 'projets/absent.md');
		expect(r.code).toBe(1);
		expect(r.err).toContain('n\'existe pas');
	});

	it('lit sans mémoire : code 1 ; commande inconnue : code 2', async () => {
		const d = await dossierTemporaire();
		const r = await mnemo(d, 'lit', 'a.md');
		expect(r.code).toBe(1);
		expect(r.err).toContain('Aucune mémoire Mnemo trouvée');
		const inconnue = await mnemo(d, 'zzz');
		expect(inconnue.code).toBe(2);
		expect(inconnue.err).toContain('Usage');
		expect((await mnemo(d, '--aide')).out).toContain('Usage');
	});

	it('trouverRacine remonte depuis un sous-dossier profond', async () => {
		const d = await dossierTemporaire();
		await mnemo(d, 'init');
		const profond = join(d, 'a', 'b', 'c');
		await mkdir(profond, { recursive: true });
		expect(trouverRacine(profond)).toBe(d);
		expect(trouverRacine(join(d, '_mnemo', 'projets'))).toBe(d);
	});

	it('racineDeSession : la position part du dossier qui a trouvé la racine', async () => {
		const d = await dossierTemporaire();
		await mnemo(d, 'init');
		const dedans = join(d, 'projet');
		await mkdir(dedans, { recursive: true });
		const dehors = await dossierTemporaire();
		// CLAUDE_PROJECT_DIR hors de toute mémoire, dossier courant dedans : le projet est le dossier courant.
		expect(racineDeSession(dehors, dedans)).toEqual({ racine: d, projet: dedans });
		// CLAUDE_PROJECT_DIR dans la mémoire : il l'emporte.
		expect(racineDeSession(dedans, dehors)).toEqual({ racine: d, projet: dedans });
		// Sans CLAUDE_PROJECT_DIR : le dossier courant.
		expect(racineDeSession(undefined, dedans)).toEqual({ racine: d, projet: dedans });
		expect(racineDeSession('', dedans)).toEqual({ racine: d, projet: dedans });
		// Aucune mémoire : pas de racine.
		expect(racineDeSession(dehors, dehors)).toEqual({ racine: null, projet: dehors });
	});
});
