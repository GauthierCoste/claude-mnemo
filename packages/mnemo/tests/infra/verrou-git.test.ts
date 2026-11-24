import { existsSync } from 'node:fs';
import { utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { historiqueGit } from '../../src/infra/historique-git.ts';
import { commandeDesProcessus, estProcessusGit, gitEnCoursSurLaMachine, nomsDesProcessus, retirerVerrouGitPerime } from '../../src/infra/verrou-git.ts';
import { dossierTemporaire } from '../aides/dossier-temporaire.ts';

/** Dépôt de mémoire initialisé, avec un `.git/index.lock` laissé par un git tué, vieux de `ageS` secondes. */
async function depotAvecVerrou(ageS: number): Promise<{ racine: string; verrou: string }> {
	const racine = await dossierTemporaire();
	await historiqueGit(racine).initialiser();
	const verrou = join(racine, '.git', 'index.lock');
	await writeFile(verrou, '');
	const instant = (Date.now() - ageS * 1000) / 1000;
	await utimes(verrou, instant, instant);
	return { racine, verrou };
}

describe('index.lock périmé de la mémoire', () => {
	it('plus de 60 s, aucun git en cours : retiré avant le commit (une ligne de journal), le commit réussit', async () => {
		const { racine, verrou } = await depotAvecVerrou(120);
		const journal: string[] = [];
		const historique = historiqueGit(racine, { journal: (m) => journal.push(m), gitEnCours: async () => false });
		await writeFile(join(racine, 'a.md'), 'a');
		expect(await historique.commit('premier', 'tout')).toMatch(/^[0-9a-f]{7,}$/u);
		expect(existsSync(verrou)).toBe(false);
		expect(journal).toHaveLength(1);
		expect(journal[0]).toMatch(/index\.lock/u);
	});

	it('récent (moins de 60 s) : gardé (un git peut travailler), le commit échoue comme avant', async () => {
		const { racine, verrou } = await depotAvecVerrou(10);
		const historique = historiqueGit(racine, { journal: () => {}, gitEnCours: async () => false });
		await writeFile(join(racine, 'a.md'), 'a');
		await expect(historique.commit('premier', 'tout')).rejects.toThrow(/index\.lock|File exists/u);
		expect(existsSync(verrou)).toBe(true);
	});

	it('un git en cours (ou inconnu) : gardé, même vieux', async () => {
		for (const enCours of [true, null]) {
			const { racine, verrou } = await depotAvecVerrou(600);
			expect(await retirerVerrouGitPerime(racine, { journal: () => {}, gitEnCours: async () => enCours })).toBe(false);
			expect(existsSync(verrou)).toBe(true);
		}
	});

	it('aucun verrou : rien à faire, git jamais interrogé', async () => {
		const racine = await dossierTemporaire();
		await historiqueGit(racine).initialiser();
		let interroge = false;
		expect(
			await retirerVerrouGitPerime(racine, {
				journal: () => {},
				gitEnCours: async () => {
					interroge = true;
					return false;
				},
			}),
		).toBe(false);
		expect(interroge).toBe(false);
	});

	it('estProcessusGit : git et ses sous-commandes (git-*), jamais un autre nom', () => {
		for (const c of ['git', '/usr/bin/git', '/Library/Developer/CommandLineTools/usr/libexec/git-core/git-remote-https', 'git-upload-pack', 'C:\\Program Files\\Git\\bin\\git.exe']) {
			expect(estProcessusGit(c), c).toBe(true);
		}
		for (const c of ['gitk-like', 'node', '/usr/bin/digit', 'legit', '']) expect(estProcessusGit(c), c).toBe(false);
	});

	it('Windows comme POSIX : une liste des processus (tasklist, ps), lue par la même règle', () => {
		expect(commandeDesProcessus('darwin')).toEqual({ commande: 'ps', args: ['-A', '-o', 'comm='] });
		expect(commandeDesProcessus('win32')).toEqual({ commande: 'tasklist', args: ['/FO', 'CSV', '/NH'] });
		const tasklist = '"System Idle Process","0","Services","0","8 K"\r\n"git.exe","4242","Console","1","9 120 K"\r\n"node.exe","77","Console","1","50 000 K"\r\n';
		expect(nomsDesProcessus(tasklist, 'win32')).toEqual(['System Idle Process', 'git.exe', 'node.exe']);
		expect(nomsDesProcessus(tasklist, 'win32').some(estProcessusGit)).toBe(true);
		expect(nomsDesProcessus('"node.exe","77","Console","1","50 000 K"\r\n', 'win32').some(estProcessusGit)).toBe(false);
		expect(nomsDesProcessus('/usr/bin/git\nnode\n', 'darwin')).toEqual(['/usr/bin/git', 'node']);
	});

	it('sur cette machine, la liste des processus répond (oui ou non, pas inconnu)', async () => {
		expect(typeof (await gitEnCoursSurLaMachine())).toBe('boolean');
	});

	it('verrou gardé : l’erreur de git nomme le fichier à retirer', async () => {
		const { racine } = await depotAvecVerrou(10);
		const historique = historiqueGit(racine, { journal: () => {}, gitEnCours: async () => false });
		await writeFile(join(racine, 'a.md'), 'a');
		await expect(historique.commit('premier', 'tout')).rejects.toThrow(/\.git[\\/]index\.lock/u);
	});
});
