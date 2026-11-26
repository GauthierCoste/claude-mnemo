import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { dupliquerProfil, supprimerProfil } from '../../src/application/gerer-profils.ts';
import { coffreFichiers } from '../../src/infra/coffre-fichiers.ts';
import { historiqueGit } from '../../src/infra/historique-git.ts';
import { dossierTemporaire } from '../aides/dossier-temporaire.ts';
import { fauxPorts } from '../aides/faux-ports.ts';
import { git } from '../aides/git.ts';

/** Une vraie mémoire (fichiers et git, dossier temporaire) avec `redaction` et une skill qui porte un script. */
async function surDisque() {
	const racine = await dossierTemporaire();
	const historique = historiqueGit(racine);
	await historique.initialiser();
	const dep = { ...fauxPorts(), coffre: coffreFichiers(racine), historique };
	await dep.coffre.ecrire('profils/redaction/redaction.md', '---\ntype: profil\n---\n# Profil redaction\n\nRédige.\n');
	await dep.coffre.ecrire('profils/redaction/skills/signature/SKILL.md', '---\nname: signature\ndescription: Signer.\n---\n');
	await mkdir(join(racine, 'profils', 'redaction', 'skills', 'signature', 'scripts'), { recursive: true });
	await writeFile(join(racine, 'profils', 'redaction', 'skills', 'signature', 'scripts', 'calc.py'), 'print(1)\r\n');
	await historique.commit('profil', 'tout');
	return { racine, dep };
}

describe('profils, sur disque', () => {
	it('dupliquer : le dossier de skills copié octet pour octet (scripts/calc.py), dans le commit ; un lien symbolique n\'est pas copié', async () => {
		const { racine, dep } = await surDisque();
		await mkdir(join(racine, 'dehors'));
		await symlink(join(racine, 'dehors'), join(racine, 'profils', 'redaction', 'skills', 'signature', 'lien'));
		expect((await dupliquerProfil(dep, 'redaction', 'courriers')).ok).toBe(true);
		expect(await readFile(join(racine, 'profils', 'courriers', 'skills', 'signature', 'scripts', 'calc.py'), 'utf8')).toBe('print(1)\r\n');
		expect(existsSync(join(racine, 'profils', 'courriers', 'skills', 'signature', 'lien'))).toBe(false);
		expect(git(racine, 'show', '--name-only', '--format=', 'HEAD').split('\n').sort()).toEqual([
			'profils/courriers/courriers.md',
			'profils/courriers/skills/signature/SKILL.md',
			'profils/courriers/skills/signature/scripts/calc.py',
		]);
	});

	it('supprimer : le dossier entier part (scripts compris), dans le commit ; rien ne reste de côté', async () => {
		const { racine, dep } = await surDisque();
		expect(await supprimerProfil(dep, 'redaction')).toEqual({ ok: true, commit: expect.any(String) });
		expect(existsSync(join(racine, 'profils', 'redaction'))).toBe(false);
		expect(await readdir(join(racine, 'profils'))).toEqual([]);
		expect(git(racine, 'show', '--name-status', '--format=', 'HEAD').split('\n').sort()).toEqual([
			'D\tprofils/redaction/redaction.md',
			'D\tprofils/redaction/skills/signature/SKILL.md',
			'D\tprofils/redaction/skills/signature/scripts/calc.py',
		]);
		expect(git(racine, 'status', '--porcelain')).toBe('');
	});

	it('un commit qui échoue : la copie est retirée, le profil supprimé revient tel quel', async () => {
		const { racine, dep } = await surDisque();
		const echoue = { ...dep, historique: { ...dep.historique, commit: async () => Promise.reject(new Error('git indisponible')) } };
		await expect(dupliquerProfil(echoue, 'redaction', 'courriers')).rejects.toThrow('git indisponible');
		expect(existsSync(join(racine, 'profils', 'courriers'))).toBe(false);
		await expect(supprimerProfil(echoue, 'redaction')).rejects.toThrow('git indisponible');
		expect(await readFile(join(racine, 'profils', 'redaction', 'skills', 'signature', 'scripts', 'calc.py'), 'utf8')).toBe('print(1)\r\n');
		expect(await readdir(join(racine, 'profils'))).toEqual(['redaction']);
		expect(git(racine, 'status', '--porcelain')).toBe('');
	});
});
