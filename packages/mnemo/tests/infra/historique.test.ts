import { execFileSync } from 'node:child_process';
import { chmod, mkdir, rename, writeFile } from 'node:fs/promises';
import { delimiter, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { coffreFichiers } from '../../src/infra/coffre-fichiers.ts';
import { historiqueGit } from '../../src/infra/historique-git.ts';
import { dossierTemporaire } from '../aides/dossier-temporaire.ts';

const git = (racine: string, ...args: string[]) => execFileSync('git', args, { cwd: racine, encoding: 'utf8' });

/** Un `git` placé en tête du PATH, qui refuse `--initial-branch` comme git < 2.28 et passe le reste au vrai git. */
async function gitAncien(): Promise<string> {
	const dossier = await dossierTemporaire();
	const vrai = join(execFileSync('git', ['--exec-path'], { encoding: 'utf8' }).trim(), 'git');
	const script = `#!${process.execPath}
const args = process.argv.slice(2);
if (args.some((a) => a.startsWith('--initial-branch'))) {
	process.stderr.write("error: unknown option \`initial-branch=main'\\n");
	process.exit(129);
}
const r = process.getBuiltinModule('node:child_process').spawnSync(${JSON.stringify(vrai)}, args, { stdio: 'inherit' });
process.exit(r.status ?? 1);
`;
	await writeFile(join(dossier, 'git'), script);
	await chmod(join(dossier, 'git'), 0o755);
	return dossier;
}

describe('historiqueGit', () => {
	it.skipIf(process.platform === 'win32')('git sans --initial-branch (avant 2.28) : le dépôt est créé, sur la branche main', async () => {
		const racine = await dossierTemporaire();
		const ancien = await gitAncien();
		const path = process.env.PATH;
		process.env.PATH = `${ancien}${delimiter}${path ?? ''}`;
		try {
			await historiqueGit(racine).initialiser();
		} finally {
			process.env.PATH = path;
		}
		expect(git(racine, 'symbolic-ref', 'HEAD').trim()).toBe('refs/heads/main');
	});

	it('commite sans signature ni hook, même si le dépôt les exige', async () => {
		const racine = await dossierTemporaire();
		const historique = historiqueGit(racine);
		await historique.initialiser();
		git(racine, 'config', 'commit.gpgsign', 'true');
		git(racine, 'config', 'gpg.program', 'false');
		await mkdir(join(racine, '.git', 'hooks'), { recursive: true });
		await writeFile(join(racine, '.git', 'hooks', 'pre-commit'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
		await writeFile(join(racine, 'a.md'), 'a');
		expect(await historique.commit('premier', 'tout')).toMatch(/^[0-9a-f]{7,}$/u);
		expect(git(racine, 'log', '--format=%s')).toBe('premier\n');
	});

	it('initialise (idempotent), liste les modifications et commite', async () => {
		const racine = await dossierTemporaire();
		const coffre = coffreFichiers(racine);
		const historique = historiqueGit(racine);
		await historique.initialiser();
		await historique.initialiser();
		expect(await historique.modificationsEnCours()).toEqual([]);

		await coffre.ecrire('dossier/é fiche.md', 'un');
		await coffre.ecrire('autre.md', 'deux');
		expect(await historique.modificationsEnCours()).toEqual(['autre.md', 'dossier/é fiche.md']);

		const hash = await historique.commit('premier', 'tout');
		expect(hash).toMatch(/^[0-9a-f]{7,}$/);
		expect(await historique.modificationsEnCours()).toEqual([]);

		await coffre.ecrire('autre.md', 'trois');
		await coffre.ecrire('dossier/é fiche.md', 'quatre');
		await historique.commit('second', ['autre.md']);
		expect(await historique.modificationsEnCours()).toEqual(['dossier/é fiche.md']);

		await coffre.supprimer('dossier/é fiche.md');
		await historique.commit('suppression', 'tout');
		expect(await historique.modificationsEnCours()).toEqual([]);
	});

	it('gère les renommages et refuse un commit vide', async () => {
		const racine = await dossierTemporaire();
		const coffre = coffreFichiers(racine);
		const historique = historiqueGit(racine);
		await historique.initialiser();
		await coffre.ecrire('a.md', 'contenu assez long pour être détecté comme renommage');
		await historique.commit('init', 'tout');
		await mkdir(join(racine, 'n'));
		await rename(join(racine, 'a.md'), join(racine, 'n', 'b.md'));
		expect((await historique.modificationsEnCours()).sort()).toEqual(['a.md', 'n/b.md']);
		await historique.commit('mv', 'tout');
		expect(await historique.commit('vide', 'tout')).toBeNull();
		expect(await historique.commit('vide', [])).toBeNull();
		expect(await historique.commit('vide', ['n/b.md'])).toBeNull();
	});

	describe('trailer de session et journal', () => {
		const SESSION = '11111111-2222-4333-8444-555555555555';
		const jour = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
		// Le jour est figé avant tout commit : un test qui franchit minuit reste cohérent.
		const CE_JOUR = jour(new Date());

		it('écrit le trailer Mnemo-Session et le journal le relit, avec les fichiers', async () => {
			const racine = await dossierTemporaire();
			const historique = historiqueGit(racine);
			await historique.initialiser();
			await mkdir(join(racine, 'sous dossier'), { recursive: true });
			await writeFile(join(racine, 'sous dossier', 'é a.md'), 'a');
			await writeFile(join(racine, 'b.md'), 'b');
			await historique.commit('mnemo: fait a', 'tout', SESSION);
			await writeFile(join(racine, 'c.md'), 'c');
			await historique.commit('mnemo: fait c', 'tout');
			expect(git(racine, 'log', '-1', '--format=%B', 'HEAD~1')).toContain(`\n\nMnemo-Session: ${SESSION}`);
			const lignes = await historique.journal(CE_JOUR, 500);
			expect(lignes).toHaveLength(2);
			expect(lignes[0]).toMatchObject({ message: 'mnemo: fait c', fichiers: ['c.md'], session: null });
			expect(lignes[1]).toMatchObject({ message: 'mnemo: fait a', session: SESSION });
			expect(lignes[1]!.fichiers.sort()).toEqual(['b.md', 'sous dossier/é a.md']);
			expect(lignes[1]!.hash).toMatch(/^[0-9a-f]{7,}$/u);
			expect(Math.abs(lignes[1]!.dateMs - Date.now())).toBeLessThan(60_000);
		});

		it('exclut les commits d\'hier et respecte la limite', async () => {
			const racine = await dossierTemporaire();
			const historique = historiqueGit(racine);
			await historique.initialiser();
			const hier = new Date(Date.now() - 36 * 3600_000);
			await writeFile(join(racine, 'a.md'), 'a');
			git(racine, 'add', '-A');
			execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@l', 'commit', '-m', 'ancien'], { cwd: racine, env: { ...process.env, GIT_AUTHOR_DATE: hier.toISOString(), GIT_COMMITTER_DATE: hier.toISOString() } });
			await writeFile(join(racine, 'b.md'), 'b');
			await historique.commit('un', 'tout');
			await writeFile(join(racine, 'c.md'), 'c');
			await historique.commit('deux', 'tout');
			expect((await historique.journal(CE_JOUR, 500)).map((l) => l.message)).toEqual(['deux', 'un']);
			expect((await historique.journal(jour(hier), 500)).map((l) => l.message)).toEqual(['deux', 'un', 'ancien']);
			expect((await historique.journal(CE_JOUR, 1)).map((l) => l.message)).toEqual(['deux']);
		});

		it('n\'écrit pas de trailer pour une session qui n\'est pas un uuid (injection)', async () => {
			const racine = await dossierTemporaire();
			const historique = historiqueGit(racine);
			await historique.initialiser();
			await writeFile(join(racine, 'a.md'), 'a');
			await historique.commit('mnemo: fait a', 'tout', `${SESSION}\nAutre: x`);
			expect(git(racine, 'log', '-1', '--format=%B').trim()).toBe('mnemo: fait a');
			expect((await historique.journal(CE_JOUR, 500))[0]!.session).toBeNull();
		});

		/** Dépôt à partir d'un flux `git fast-import` : commits `{ ms, message }` dans l'ordre d'écriture (le premier est le plus ancien dans la chaîne). */
		async function depotImporte(commits: { ms: number; message: string }[]): Promise<string> {
			const racine = await dossierTemporaire();
			await historiqueGit(racine).initialiser();
			let flux = '';
			for (const [i, c] of commits.entries()) {
				flux += `commit refs/heads/main\ncommitter T <t@l> ${Math.floor(c.ms / 1000)} +0000\ndata ${Buffer.byteLength(c.message)}\n${c.message}\nM 100644 inline f${i}.md\ndata 1\nx\n`;
			}
			execFileSync('git', ['fast-import', '--quiet'], { cwd: racine, input: flux });
			return racine;
		}
		const midi = (j: number) => new Date(2026, 5, j, 12).getTime();

		it('jusqua borne le journal : plus de 500 commits après le jour, le jour reste complet', async () => {
			const commits = [{ ms: midi(15), message: 'a' }, { ms: midi(15) + 1000, message: 'b' }, { ms: midi(15) + 2000, message: 'c' }];
			for (let i = 0; i < 520; i++) commits.push({ ms: midi(17) + i * 1000, message: `futur ${i}` });
			const racine = await depotImporte(commits);
			const historique = historiqueGit(racine);
			expect((await historique.journal('2026-06-15', 500)).filter((l) => l.dateMs < midi(16))).toHaveLength(0); // sans borne, le jour est noyé
			expect((await historique.journal('2026-06-15', 500, '2026-06-16')).map((l) => l.message)).toEqual(['c', 'b', 'a']);
			await expect(historique.journal('2026-06-15', 500, 'nimporte quoi')).rejects.toThrow(/Date invalide/u);
		});

		it('un sujet qui contient les séparateurs ne fait pas disparaître le commit', async () => {
			const racine = await depotImporte([
				{ ms: midi(15), message: 'avant' },
				{ ms: midi(15) + 1000, message: 'sujet\x1e0123abc\x1f123\x1fpiégé\x1f fin' },
				{ ms: midi(15) + 2000, message: 'après\x1f\x1e' },
			]);
			const lignes = await historiqueGit(racine).journal('2026-06-15', 500);
			expect(lignes).toHaveLength(3);
			expect(lignes.map((l) => l.fichiers)).toEqual([['f2.md'], ['f1.md'], ['f0.md']]);
			expect(lignes.map((l) => l.session)).toEqual([null, null, null]);
			expect(lignes[2]!.message).toBe('avant');
			expect(lignes[1]!.message.startsWith('sujet')).toBe(true);
			expect(lignes[1]!.message).not.toMatch(/[\x1e\x1f]/u);
		});

		it('un dépôt sans commit rend un journal vide ; une date mal formée est refusée', async () => {
			const racine = await dossierTemporaire();
			const historique = historiqueGit(racine);
			await historique.initialiser();
			expect(await historique.journal(CE_JOUR, 500)).toEqual([]);
			await expect(historique.journal('--all', 5)).rejects.toThrow(/Date invalide/u);
		});
	});
});
