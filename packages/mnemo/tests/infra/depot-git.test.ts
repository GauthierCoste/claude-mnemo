import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { depotGit } from '../../src/infra/depot-git.ts';
import { dossierTemporaire } from '../aides/dossier-temporaire.ts';
import { git } from '../aides/git.ts';

/** Un dépôt `projet/` sous une racine temporaire : un premier commit (`suivi.txt`, `.gitignore`). */
async function depotDeTest(): Promise<{ racine: string; projet: string }> {
	const racine = await dossierTemporaire();
	const projet = join(racine, 'projet');
	await mkdir(projet);
	git(projet, 'init', '--initial-branch=main');
	await writeFile(join(projet, 'suivi.txt'), 'un\n');
	await writeFile(join(projet, '.gitignore'), 'ignore.log\n');
	git(projet, 'add', '-A');
	git(projet, 'commit', '-m', 'premier');
	return { racine, projet };
}

describe('depotGit', () => {
	it('etat : branche et commit de tête ; fichiersModifies : suivis modifiés depuis le début (commits compris), non suivis, sans les ignorés', async () => {
		const { racine, projet } = await depotDeTest();
		const depot = depotGit(racine);
		const debut = await depot.etat('projet');
		expect(debut).toEqual({ branche: 'main', commit: git(projet, 'rev-parse', 'HEAD') });

		await writeFile(join(projet, 'suivi.txt'), 'deux\n');
		await writeFile(join(projet, 'commite.txt'), 'c\n');
		git(projet, 'add', 'commite.txt');
		git(projet, 'commit', '-m', 'suite');
		await mkdir(join(projet, 'sous'));
		await writeFile(join(projet, 'sous', 'nouveau.txt'), 'n\n');
		await writeFile(join(projet, 'ignore.log'), 'i\n');

		expect((await depot.fichiersModifies('projet', debut!.commit, 1000)).fichiers.sort()).toEqual(['commite.txt', 'sous/nouveau.txt', 'suivi.txt']);
		// sans commit de départ : depuis la tête
		expect((await depot.fichiersModifies('projet', null, 1000)).fichiers.sort()).toEqual(['sous/nouveau.txt', 'suivi.txt']);
		// depuis un sous-dossier, ou par un chemin absolu : chemins relatifs à la racine du dépôt
		expect((await depot.fichiersModifies('projet/sous', debut!.commit, 1000)).fichiers.sort()).toEqual(['commite.txt', 'sous/nouveau.txt', 'suivi.txt']);
		expect(await depot.etat(join(projet, 'sous'))).toEqual({ branche: 'main', commit: git(projet, 'rev-parse', 'HEAD') });
	});

	it('statuts : M, A (ajouté ou non suivi), D ; relatifs au dossier, limités à lui ; fichiers bornés, total vrai ; pas un dépôt : null', async () => {
		const { racine, projet } = await depotDeTest();
		await mkdir(join(projet, 'sous'));
		await writeFile(join(projet, 'sous', 'garde.txt'), 'g\n');
		await writeFile(join(projet, 'sous', 'part.txt'), 'p\n');
		git(projet, 'add', '-A');
		git(projet, 'commit', '-m', 'sous');
		const depot = depotGit(racine);
		expect(await depot.statuts('projet', 20)).toEqual({ fichiers: [], total: 0 });

		await writeFile(join(projet, 'suivi.txt'), 'deux\n');
		await writeFile(join(projet, 'nouveau.txt'), 'n\n');
		await writeFile(join(projet, 'indexe.txt'), 'i\n');
		git(projet, 'add', 'indexe.txt');
		await writeFile(join(projet, 'sous', 'garde.txt'), 'g2\n');
		git(projet, 'rm', '-q', 'sous/part.txt');
		await writeFile(join(projet, 'ignore.log'), 'i\n');
		await writeFile(join(projet, 'nom avec espace.txt'), 'e\n');

		const tri = (l: { fichiers: { chemin: string; statut: string }[] } | null) => [...(l?.fichiers ?? [])].sort((a, b) => a.chemin.localeCompare(b.chemin));
		expect(tri(await depot.statuts('projet', 20))).toEqual([
			{ chemin: 'indexe.txt', statut: 'A' },
			{ chemin: 'nom avec espace.txt', statut: 'A' },
			{ chemin: 'nouveau.txt', statut: 'A' },
			{ chemin: 'sous/garde.txt', statut: 'M' },
			{ chemin: 'sous/part.txt', statut: 'D' },
			{ chemin: 'suivi.txt', statut: 'M' },
		]);
		// un sous-dossier du dépôt : ses fichiers seulement, relatifs à lui
		expect(tri(await depot.statuts('projet/sous', 20))).toEqual([
			{ chemin: 'garde.txt', statut: 'M' },
			{ chemin: 'part.txt', statut: 'D' },
		]);
		const bornes = await depot.statuts('projet', 2);
		expect(bornes?.fichiers).toHaveLength(2);
		expect(bornes?.total).toBe(6);
		expect((await depot.statuts('projet/sous', 1))?.total).toBe(2);

		await mkdir(join(racine, 'libre'));
		expect(await depot.statuts('libre', 20)).toBeNull();
		expect(await depot.statuts('absent', 20)).toBeNull();
	});

	it('pas un dépôt, ou dossier absent : etat null, aucun fichier', async () => {
		const racine = await dossierTemporaire();
		await mkdir(join(racine, 'libre'));
		const depot = depotGit(racine);
		expect(await depot.etat('libre')).toBeNull();
		expect(await depot.fichiersModifies('libre', null, 1000)).toEqual({ fichiers: [], total: 0 });
		expect(await depot.etat('absent')).toBeNull();
	});

	it('dépôt sans commit : commit null, fichiers indexés et non suivis ; tête détachée : branche null', async () => {
		const racine = await dossierTemporaire();
		const vide = join(racine, 'vide');
		await mkdir(vide);
		git(vide, 'init', '--initial-branch=main');
		await writeFile(join(vide, 'indexe.txt'), 'i\n');
		git(vide, 'add', 'indexe.txt');
		await writeFile(join(vide, 'libre.txt'), 'l\n');
		const depot = depotGit(racine);
		expect(await depot.etat('vide')).toEqual({ branche: 'main', commit: null });
		expect((await depot.fichiersModifies('vide', null, 1000)).fichiers.sort()).toEqual(['indexe.txt', 'libre.txt']);

		const { projet } = await depotDeTest();
		git(projet, 'checkout', '--detach');
		expect(await depotGit(join(projet, '..')).etat('projet')).toEqual({ branche: null, commit: git(projet, 'rev-parse', 'HEAD') });
	});

	it('commit de départ invalide ou inconnu : rejeté (jamais passé à git comme option)', async () => {
		const { racine } = await depotDeTest();
		const depot = depotGit(racine);
		await expect(depot.fichiersModifies('projet', '--output=/tmp/x', 1000)).rejects.toThrow(/invalide/u);
		await expect(depot.fichiersModifies('projet', 'abcdef0123', 1000)).rejects.toThrow();
	});

	it('fichiersModifies : `limite` fichiers au plus, `total` est le vrai nombre', async () => {
		const { racine, projet } = await depotDeTest();
		for (let i = 0; i < 230; i++) await writeFile(join(projet, `f${i}.txt`), 'x');
		const r = await depotGit(racine).fichiersModifies('projet', null, 50);
		expect(r.fichiers).toHaveLength(50);
		expect(r.total).toBe(230);
	});

	it('délai dépassé : git tué, appel rejeté', async () => {
		const { racine } = await depotDeTest();
		await expect(depotGit(racine, { delaiMs: 1 }).etat('projet')).rejects.toThrow(/délai/u);
	});
});
