import { mkdir, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { lireElement } from '../../src/application/lire.ts';
import { lister } from '../../src/application/lister.ts';
import type { Dependances } from '../../src/application/ports.ts';
import { coffreFichiers } from '../../src/infra/coffre-fichiers.ts';
import { dossierTemporaire } from '../aides/dossier-temporaire.ts';

/** Mémoire réelle : une fiche, un `.git/` et un lien vers un fichier hors de la mémoire. */
async function memoire(): Promise<Dependances> {
	const racine = await dossierTemporaire();
	const memoire = join(racine, '_mnemo');
	await mkdir(join(memoire, '.git', 'refs', 'heads'), { recursive: true });
	await writeFile(join(memoire, '.git', 'config'), '[core]\n\tsecret = oui\n');
	await writeFile(join(memoire, '.git', 'notes.md'), '# Caché\n');
	await mkdir(join(memoire, 'projets'));
	await writeFile(join(memoire, 'projets', 'a.md'), '---\nid: A\ntype: sujet\nupdated: 2026-11-01\n---\n# A\n');
	await writeFile(join(racine, 'dehors.md'), '# Hors de la mémoire\n');
	await symlink(join(racine, 'dehors.md'), join(memoire, 'projets', 'lien.md'));
	await symlink('../.git/config', join(memoire, 'projets', 'git.md'));
	await symlink('../.git', join(memoire, 'projets', 'depot'));
	await symlink('../.GIT/notes.md', join(memoire, 'projets', 'casse.md'));
	return { coffre: coffreFichiers(memoire) } as Dependances;
}

describe('lecture : jamais hors de la mémoire ni dans .git/', () => {
	it('lireElement : .git/… (toute casse) et un lien vers l’extérieur → null ; une fiche ordinaire se lit', async () => {
		const dep = await memoire();
		expect(await lireElement(dep, 'projets/a.md')).not.toBeNull();
		for (const id of ['.git/config', '.GIT/config', '.Git/notes.md', 'projets/../.git/config']) expect(await lireElement(dep, id), id).toBeNull();
		expect(await lireElement(dep, 'projets/lien.md')).toBeNull();
		expect(await dep.coffre.lire('projets/lien.md')).toBeNull();
		for (const id of ['projets/git.md', 'projets/depot/config', 'projets/depot/notes.md', 'projets/casse.md']) {
			expect(await lireElement(dep, id), id).toBeNull();
			expect(await dep.coffre.lire(id), id).toBeNull();
		}
	});

	it('lister .git (toute casse) : vide', async () => {
		const dep = await memoire();
		for (const dossier of ['.git', '.GIT', '.git/refs']) {
			const l = await lister(dep, dossier);
			expect(l.fiches, dossier).toEqual([]);
			expect(l.sousDossiers, dossier).toEqual([]);
		}
	});
});
