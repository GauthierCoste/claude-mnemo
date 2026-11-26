import { mkdir, readdir, readFile, rename, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { coffreFichiers } from '../../src/infra/coffre-fichiers.ts';
import { dossierTemporaire } from '../aides/dossier-temporaire.ts';

describe('coffreFichiers', () => {
	it('écrit et lit un chemin à sous-dossiers', async () => {
		const racine = await dossierTemporaire();
		const coffre = coffreFichiers(racine);
		await coffre.ecrire('a/b/fiche.md', 'bonjour');
		expect(await coffre.lire('a/b/fiche.md')).toBe('bonjour');
		expect(await coffre.lire('absent.md')).toBeNull();
	});

	it('écrit en LF un texte CRLF', async () => {
		const racine = await dossierTemporaire();
		const coffre = coffreFichiers(racine);
		await coffre.ecrire('f.md', 'a\r\nb\rc\n');
		expect(await readFile(join(racine, 'f.md'), 'utf8')).toBe('a\nb\nc\n');
	});

	it('liste fiches et dossiers en ignorant .git', async () => {
		const racine = await dossierTemporaire();
		const coffre = coffreFichiers(racine);
		await coffre.ecrire('x/un.md', '1');
		await coffre.ecrire('x/deux.md', '2');
		await coffre.ecrire('x/sous/trois.md', '3');
		await coffre.ecrire('x/note.txt', 'pas une fiche');
		await mkdir(join(racine, '.git'));
		await writeFile(join(racine, '.git', 'HEAD.md'), 'x');
		expect(await coffre.lister('x')).toEqual({ fiches: ['x/deux.md', 'x/un.md'], dossiers: ['x/sous'] });
		expect((await coffre.lister('')).dossiers).toEqual(['x']);
		expect(await coffre.lister('inexistant')).toEqual({ fiches: [], dossiers: [] });
	});

	it('lister ne suit jamais un lien symbolique (dossier listé ou traversé, fiche, sous-dossier)', async () => {
		const racine = await dossierTemporaire();
		const dehors = await dossierTemporaire();
		await writeFile(join(dehors, 'secret.md'), 'x');
		const coffre = coffreFichiers(racine);
		await coffre.ecrire('x/vraie.md', '1');
		await symlink(dehors, join(racine, 'lien'));
		await symlink(dehors, join(racine, 'x', 'sous-lien'));
		await symlink(join(dehors, 'secret.md'), join(racine, 'x', 'lien.md'));
		expect(await coffre.lister('x')).toEqual({ fiches: ['x/vraie.md'], dossiers: [] });
		expect(await coffre.lister('lien')).toEqual({ fiches: [], dossiers: [] });
		expect(await coffre.lister('x/sous-lien')).toEqual({ fiches: [], dossiers: [] });
	});

	it('toutesLesFiches renvoie des chemins en / triés', async () => {
		const racine = await dossierTemporaire();
		const coffre = coffreFichiers(racine);
		await coffre.ecrire('b/z.md', '1');
		await coffre.ecrire('a.md', '2');
		await coffre.ecrire('b/c/d.md', '3');
		await mkdir(join(racine, '.git'));
		await writeFile(join(racine, '.git', 'x.md'), 'x');
		expect(await coffre.toutesLesFiches()).toEqual(['a.md', 'b/c/d.md', 'b/z.md']);
	});

	it('réessaie un renommage refusé un instant (Windows : EPERM, EBUSY, EACCES)', async () => {
		const racine = await dossierTemporaire();
		let echecs = 0;
		const coffre = coffreFichiers(racine, {
			renommer: async (de, vers) => {
				if (echecs < 2) {
					echecs++;
					throw Object.assign(new Error('occupé'), { code: 'EPERM' });
				}
				await rename(de, vers);
			},
			delais: [1, 1, 1, 1],
		});
		await coffre.ecrire('a.md', 'x');
		expect(echecs).toBe(2);
		expect(await coffre.lire('a.md')).toBe('x');
	});

	it('abandonne après les essais et ne laisse pas de fichier temporaire', async () => {
		const racine = await dossierTemporaire();
		const coffre = coffreFichiers(racine, {
			renommer: async () => {
				throw Object.assign(new Error('occupé'), { code: 'EBUSY' });
			},
			delais: [1, 1],
		});
		await expect(coffre.ecrire('a.md', 'x')).rejects.toThrow('occupé');
		expect(await readdir(racine)).toEqual([]);
	});

	it('supprime, et refuse les évasions', async () => {
		const racine = await dossierTemporaire();
		const coffre = coffreFichiers(racine);
		await coffre.ecrire('b.md', '2');
		await coffre.supprimer('b.md');
		await coffre.supprimer('b.md');
		expect(await coffre.lire('b.md')).toBeNull();
		await expect(coffre.lire('../dehors.md')).rejects.toThrow(/hors de la mémoire/);
		await expect(coffre.ecrire('../dehors.md', 'x')).rejects.toThrow(/hors de la mémoire/);
	});

	it('deplacerDossier : tout le dossier suit (fichiers .md ou non, sous-dossiers) ; refuse une cible existante, la racine, un lien', async () => {
		const racine = await dossierTemporaire();
		const coffre = coffreFichiers(racine);
		await coffre.ecrire('skills/devis/SKILL.md', 'a');
		await mkdir(join(racine, 'skills', 'devis', 'scripts'), { recursive: true });
		await writeFile(join(racine, 'skills', 'devis', 'scripts', 'calc.py'), 'print(1)\r\n');
		await coffre.deplacerDossier('skills/devis', 'skills/neuf/devis-maison');
		expect(await readdir(join(racine, 'skills'))).toEqual(['neuf']);
		expect(await readFile(join(racine, 'skills', 'neuf', 'devis-maison', 'scripts', 'calc.py'), 'utf8')).toBe('print(1)\r\n');
		await coffre.ecrire('skills/autre/SKILL.md', 'b');
		await expect(coffre.deplacerDossier('skills/autre', 'skills/neuf/devis-maison')).rejects.toThrow('existe déjà');
		await expect(coffre.deplacerDossier('skills/absent', 'skills/x')).rejects.toThrow();
		await expect(coffre.deplacerDossier('', 'x')).rejects.toThrow('racine');
		await mkdir(join(racine, 'dehors'));
		await symlink(join(racine, 'dehors'), join(racine, 'skills', 'lien'));
		await expect(coffre.deplacerDossier('skills/lien', 'skills/y')).rejects.toThrow('lien symbolique');
		await expect(coffre.deplacerDossier('skills/autre', '../evade')).rejects.toThrow();
	});

	it('retirerDossier : tout le dossier part, un lien dedans est retiré sans être suivi ; refuse la racine et un lien ; absent sans erreur', async () => {
		const racine = await dossierTemporaire();
		const coffre = coffreFichiers(racine);
		await coffre.ecrire('skills/devis/SKILL.md', 'a');
		await mkdir(join(racine, 'skills', 'devis', 'assets'));
		await writeFile(join(racine, 'skills', 'devis', 'assets', 'logo.png'), 'x');
		await mkdir(join(racine, 'dehors'));
		await writeFile(join(racine, 'dehors', 'garde.md'), 'g');
		await symlink(join(racine, 'dehors'), join(racine, 'skills', 'devis', 'lien'));
		await coffre.retirerDossier('skills/devis');
		expect(await readdir(join(racine, 'skills'))).toEqual([]);
		expect(await readFile(join(racine, 'dehors', 'garde.md'), 'utf8')).toBe('g');
		await coffre.retirerDossier('skills/absent');
		await expect(coffre.retirerDossier('')).rejects.toThrow('racine');
		await symlink(join(racine, 'dehors'), join(racine, 'lien'));
		await expect(coffre.retirerDossier('lien')).rejects.toThrow('lien symbolique');
		expect(await readFile(join(racine, 'dehors', 'garde.md'), 'utf8')).toBe('g');
	});

	it('retirerDossierVide : retire un dossier vide, garde un dossier non vide, la racine et un lien ; sans erreur si absent', async () => {
		const racine = await dossierTemporaire();
		const coffre = coffreFichiers(join(racine, '_mnemo'));
		await mkdir(join(racine, '_mnemo', 'vide', 'sous'), { recursive: true });
		await coffre.ecrire('plein/f.md', 'x');
		await mkdir(join(racine, 'cible'));
		await symlink(join(racine, 'cible'), join(racine, '_mnemo', 'lien'));
		await coffre.retirerDossierVide('vide/sous');
		await coffre.retirerDossierVide('vide');
		await coffre.retirerDossierVide('plein');
		await coffre.retirerDossierVide('absent');
		await coffre.retirerDossierVide('lien');
		await coffre.retirerDossierVide('');
		expect((await readdir(join(racine, '_mnemo'))).sort()).toEqual(['lien', 'plein']);
		expect(await readdir(join(racine, 'cible'))).toEqual([]);
	});

	it('retirerDossierVide : rend ce qu\'il a fait ; .DS_Store et sous-dossiers vides ne comptent pas', async () => {
		const racine = await dossierTemporaire();
		const coffre = coffreFichiers(join(racine, '_mnemo'));
		await mkdir(join(racine, '_mnemo', 'clients', 'vieux', 'sous'), { recursive: true });
		await writeFile(join(racine, '_mnemo', 'clients', '.DS_Store'), 'x');
		await writeFile(join(racine, '_mnemo', 'clients', 'vieux', '.DS_Store'), 'x');
		await coffre.ecrire('plein/f.md', 'x');
		await mkdir(join(racine, '_mnemo', 'autre'));
		await writeFile(join(racine, '_mnemo', 'autre', 'notes.txt'), 'x');
		await mkdir(join(racine, '_mnemo', 'cache'));
		await writeFile(join(racine, '_mnemo', 'cache', '.env'), 'x');
		await writeFile(join(racine, '_mnemo', 'fichier.md'), 'x');
		await mkdir(join(racine, 'cible'));
		await symlink(join(racine, 'cible'), join(racine, '_mnemo', 'lien'));
		await mkdir(join(racine, '_mnemo', 'avec-lien'));
		await symlink(join(racine, 'cible'), join(racine, '_mnemo', 'avec-lien', 'l'));
		expect(await coffre.retirerDossierVide('clients')).toBe('retire');
		expect(await coffre.retirerDossierVide('plein')).toBe('non_vide');
		expect(await coffre.retirerDossierVide('autre')).toBe('non_vide');
		expect(await coffre.retirerDossierVide('cache')).toBe('non_vide');
		expect(await coffre.retirerDossierVide('avec-lien')).toBe('non_vide');
		expect(await coffre.retirerDossierVide('lien')).toBe('lien');
		expect(await coffre.retirerDossierVide('lien/x')).toBe('lien');
		expect(await coffre.retirerDossierVide('')).toBe('racine');
		expect(await coffre.retirerDossierVide('absent')).toBe('absent');
		expect(await coffre.retirerDossierVide('fichier.md')).toBe('pas_un_dossier');
		expect((await readdir(join(racine, '_mnemo'))).sort()).toEqual(['autre', 'avec-lien', 'cache', 'fichier.md', 'lien', 'plein']);
		expect(await readdir(join(racine, 'cible'))).toEqual([]);
	});
});

