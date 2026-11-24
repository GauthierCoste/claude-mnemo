import { mkdir, readdir, readFile, symlink, truncate, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { lirePlage } from '../../src/application/contenu.ts';
import { TAILLE_MAX_DOCUMENT } from '@mnemo/commun';
import { ErreurFichier } from '../../src/application/ports.ts';
import type { Fichiers } from '../../src/application/ports.ts';
import { deposerFichier, ErreurEspaceInsuffisant, ErreurTropVolumineux, fichiersDossier, nettoyerDepots, verifierDepot } from '../../src/infra/fichiers-dossier.ts';
import { empreinteOctets } from '../../src/domaine/empreinte.ts';
import { dossierTemporaire } from '../aides/dossier-temporaire.ts';

/** Ouvre, lit en entier, ferme ; null si absent. */
async function lire(f: Fichiers, chemin: string): Promise<Uint8Array | null> {
	const ouvert = await f.ouvrir(chemin);
	if (ouvert === null) return null;
	try {
		return await lirePlage(ouvert, 0, ouvert.taille);
	} finally {
		await ouvert.fermer();
	}
}

/** Un flux d'un seul morceau. */
async function* flux(texte: string): AsyncGenerator<Uint8Array> {
	yield new TextEncoder().encode(texte);
}

async function dossier() {
	const racine = await dossierTemporaire();
	await mkdir(join(racine, 'docs'), { recursive: true });
	await mkdir(join(racine, '_mnemo'), { recursive: true });
	await writeFile(join(racine, 'docs', 'cdc.md'), '# CDC\n');
	await writeFile(join(racine, '_mnemo', 'x.md'), 'x');
	return racine;
}

describe('fichiers du dossier (lecture seule)', () => {
	it('cheminReel : la casse du disque ; absent → null ; chemin refusé → ErreurFichier', async () => {
		const racine = await dossier();
		await mkdir(join(racine, 'Archives'));
		await writeFile(join(racine, 'Archives', 'Devis.PDF'), 'x');
		const f = fichiersDossier(racine);
		expect(await f.cheminReel('Archives/Devis.PDF')).toBe('Archives/Devis.PDF');
		expect(await f.cheminReel('docs/absent.md')).toBeNull();
		await expect(f.cheminReel('_mnemo/x.md')).rejects.toBeInstanceOf(ErreurFichier);
		// disque insensible à la casse (macOS, Windows) : la variante désigne le même fichier, rendu dans sa casse
		if ((await f.etat('archives/devis.pdf')) !== null) expect(await f.cheminReel('archives/devis.pdf')).toBe('Archives/Devis.PDF');
	});

	it('lit les octets et l\'état ; absent → null', async () => {
		const f = fichiersDossier(await dossier());
		expect(new TextDecoder().decode((await lire(f, 'docs/cdc.md'))!)).toBe('# CDC\n');
		expect(await f.etat('docs/cdc.md')).toMatchObject({ taille: 6 });
		expect(await lire(f, 'docs/absent.md')).toBeNull();
		expect(await f.etat('absent/x.md')).toBeNull();
		expect(await f.etat('docs/cdc.md/x')).toBeNull();
	});

	it('refuse hors racine, _mnemo/ (toute casse), .mnemo/, dossier, absolu', async () => {
		const f = fichiersDossier(await dossier());
		for (const chemin of ['../x.md', 'docs/../../x.md', '_mnemo/x.md', '_MNEMO/x.md', '.mnemo/index.sqlite', '/etc/passwd', 'C:/x.md', 'docs', '']) {
			await expect(f.etat(chemin), chemin).rejects.toBeInstanceOf(ErreurFichier);
			await expect(lire(f, chemin), chemin).rejects.toBeInstanceOf(ErreurFichier);
		}
	});

	it('refuse un lien symbolique, fichier ou dossier du chemin', async () => {
		const racine = await dossier();
		const dehors = await dossierTemporaire();
		await writeFile(join(dehors, 'secret.md'), 'secret');
		await symlink(join(dehors, 'secret.md'), join(racine, 'docs', 'lien.md'));
		await symlink(dehors, join(racine, 'ailleurs'));
		const f = fichiersDossier(racine);
		await expect(lire(f, 'docs/lien.md')).rejects.toThrow('lien symbolique');
		await expect(f.etat('ailleurs/secret.md')).rejects.toThrow('lien symbolique');
	});

	it('refuse d\'ouvrir plus de TAILLE_MAX_DOCUMENT (10 Go, fichier creux)', async () => {
		const racine = await dossier();
		await writeFile(join(racine, 'docs', 'gros.pdf'), '');
		await truncate(join(racine, 'docs', 'gros.pdf'), TAILLE_MAX_DOCUMENT + 1);
		const f = fichiersDossier(racine);
		expect((await f.etat('docs/gros.pdf'))!.taille).toBe(TAILLE_MAX_DOCUMENT + 1);
		await expect(lire(f, 'docs/gros.pdf')).rejects.toThrow('trop volumineux');
	});

	it('dossiers et fichiers cachés lus comme les autres (.notes/, Clients/.archives/, .claude/) ; ~/.claude global refusé', async () => {
		const racine = await dossier();
		await mkdir(join(racine, '.claude', 'rules'), { recursive: true });
		await mkdir(join(racine, 'P', '.claude'), { recursive: true });
		await mkdir(join(racine, '.notes'), { recursive: true });
		await mkdir(join(racine, 'Clients', '.archives'), { recursive: true });
		const caches = ['.claude/CLAUDE.md', '.claude/rules/x.md', 'P/.claude/claude.md', '.notes/cr.pdf', 'Clients/.archives/devis.md', '.env'];
		for (const f of caches) await writeFile(join(racine, ...f.split('/')), 'texte');
		const f = fichiersDossier(racine, { claudeGlobal: join(await dossierTemporaire(), '.claude') });
		for (const chemin of caches) expect(await f.etat(chemin), chemin).toMatchObject({ taille: 5 });
		expect(new TextDecoder().decode((await lire(f, '.notes/cr.pdf'))!)).toBe('texte');
		// racine = dossier personnel : son .claude/ est la configuration globale de Claude Code (déjà amorcée par `mnemo amorce`)
		const global = fichiersDossier(racine, { claudeGlobal: join(racine, '.claude') });
		await expect(lire(global, '.claude/CLAUDE.md')).rejects.toThrow('.claude');
		expect(await global.etat('P/.claude/claude.md')).toMatchObject({ taille: 5 });
		expect(await deposerFichier(racine, '.notes/y.md', flux('x'))).toHaveProperty('empreinte');
	});
});

describe('ouvrir : lecture par morceaux', () => {
	it('lit des plages ; un fichier modifié après l\'ouverture fait échouer la lecture suivante ; fermer est idempotent', async () => {
		const racine = await dossier();
		await writeFile(join(racine, 'docs', 'v.txt'), 'abcdefghij');
		const f = fichiersDossier(racine);
		const ouvert = (await f.ouvrir('docs/v.txt'))!;
		expect(ouvert.taille).toBe(10);
		expect(new TextDecoder().decode(await ouvert.lire(2, 3))).toBe('cde');
		expect(new TextDecoder().decode(await ouvert.lire(8, 100))).toBe('ij');
		expect((await ouvert.lire(10, 5)).byteLength).toBe(0);
		await writeFile(join(racine, 'docs', 'v.txt'), 'abcdefghijKLM');
		await expect(ouvert.lire(0, 4)).rejects.toThrow('a changé pendant sa lecture');
		await ouvert.fermer();
		await ouvert.fermer();
	});
});

describe('deposerFichier : en flux, via un temporaire', () => {
	async function* morceaux(n: number, taille: number, erreurApres?: number): AsyncGenerator<Uint8Array> {
		for (let i = 0; i < n; i++) {
			if (erreurApres !== undefined && i === erreurApres) throw new Error('connexion coupée');
			yield new Uint8Array(taille).fill(i);
		}
	}
	const reste = async (dossier: string) => (await readdir(dossier)).sort();

	it('écrit le flux morceau par morceau ; le fichier n\'apparaît sous son nom qu\'une fois complet', async () => {
		const racine = await dossier();
		expect(await deposerFichier(racine, 'docs/neuf/f.bin', morceaux(4, 1000))).toEqual({ empreinte: empreinteOctets(new Uint8Array(4000).map((_, i) => Math.floor(i / 1000))) });
		const lu = await readFile(join(racine, 'docs', 'neuf', 'f.bin'));
		expect(lu.byteLength).toBe(4000);
		expect([lu[0], lu[1000], lu[3999]]).toEqual([0, 1, 3]);
		expect(await reste(join(racine, 'docs', 'neuf'))).toEqual(['f.bin']);
	});

	it('limite dépassée → ErreurTropVolumineux dès le dépassement (le reste n\'est pas lu), aucun fichier restant', async () => {
		const racine = await dossier();
		let lus = 0;
		async function* compte(): AsyncGenerator<Uint8Array> {
			for (const m of [1, 2, 3, 4, 5]) {
				lus = m;
				yield new Uint8Array(1000);
			}
		}
		const e = await deposerFichier(racine, 'docs/g.bin', compte(), 2500).catch((x: unknown) => x);
		expect(e).toBeInstanceOf(ErreurTropVolumineux);
		expect(e).toBeInstanceOf(ErreurFichier);
		expect((e as Error).message).toBe('Document trop volumineux : « docs/g.bin » (plus de 2,4 Ko).');
		expect(lus).toBe(3);
		expect(await reste(join(racine, 'docs'))).toEqual(['cdc.md']);
	});

	it('flux en erreur (envoi interrompu) → l\'erreur remonte, aucun fichier restant', async () => {
		const racine = await dossier();
		await expect(deposerFichier(racine, 'docs/c.bin', morceaux(5, 1000, 2))).rejects.toThrow('connexion coupée');
		expect(await reste(join(racine, 'docs'))).toEqual(['cdc.md']);
	});

	it('fichier déjà là → existe, sans lire le flux ; apparu pendant l\'envoi → existe, jamais remplacé', async () => {
		const racine = await dossier();
		let lu = false;
		async function* espion(): AsyncGenerator<Uint8Array> {
			lu = true;
			yield new Uint8Array(1);
		}
		expect(await deposerFichier(racine, 'docs/cdc.md', espion())).toBe('existe');
		expect(lu).toBe(false);
		async function* concurrent(): AsyncGenerator<Uint8Array> {
			yield new TextEncoder().encode('mien');
			await writeFile(join(racine, 'docs', 'course.md'), 'autre');
		}
		expect(await deposerFichier(racine, 'docs/course.md', concurrent())).toBe('existe');
		expect(await readFile(join(racine, 'docs', 'course.md'), 'utf8')).toBe('autre');
		expect(await reste(join(racine, 'docs'))).toEqual(['cdc.md', 'course.md']);
	});

	it('mêmes refus de chemin : lien symbolique dans le chemin, mémoire, .mnemo/, hors racine ; un dossier caché est une destination', async () => {
		const racine = await dossier();
		const dehors = await dossierTemporaire();
		await symlink(dehors, join(racine, 'lien'));
		expect(await deposerFichier(racine, 'Clients/.archives/x.bin', morceaux(1, 1))).toHaveProperty('empreinte');
		for (const chemin of ['lien/x.bin', '_mnemo/x.bin', '.mnemo/x.bin', '../x.bin']) {
			await expect(deposerFichier(racine, chemin, morceaux(1, 1)), chemin).rejects.toBeInstanceOf(ErreurFichier);
		}
		expect(await readdir(dehors)).toEqual([]);
	});
});

describe('dépôt : temporaire à part, repli sans lien, disque, vérification préalable', () => {
	const erreurCode = (code: string): Error => Object.assign(new Error(code), { code });

	it('le temporaire s\'écrit dans .mnemo/depots/ (nom aléatoire, rien du nom déposé), jamais dans le dossier cible', async () => {
		const racine = await dossier();
		const nom = `${'東京'.repeat(40)}.bin`;
		let vu: string[] = [];
		async function* espion(): AsyncGenerator<Uint8Array> {
			yield new Uint8Array(10);
			vu = await readdir(join(racine, '.mnemo', 'depots'));
		}
		expect(await deposerFichier(racine, `docs/${nom}`, espion())).toEqual({ empreinte: expect.any(String) });
		expect(vu).toHaveLength(1);
		expect(vu[0]).toMatch(/^[0-9a-f]{24}\.depot$/u);
		expect((await readdir(join(racine, 'docs'))).sort()).toEqual(['cdc.md', nom].sort());
		expect(await readdir(join(racine, '.mnemo', 'depots'))).toEqual([]);
	});

	it('lien dur impossible (exFAT, SMB, autre volume) → nom final créé de façon exclusive puis copie ; jamais d\'écrasement', async () => {
		const racine = await dossier();
		const refus = async () => {
			throw erreurCode('EPERM');
		};
		expect(await deposerFichier(racine, 'docs/copie.bin', flux('contenu copié'), undefined, { lier: refus })).toEqual({ empreinte: empreinteOctets(new TextEncoder().encode('contenu copié')) });
		expect(await readFile(join(racine, 'docs', 'copie.bin'), 'utf8')).toBe('contenu copié');
		// apparu juste avant la copie : jamais remplacé
		const course = async (_de: string, vers: string) => {
			await writeFile(vers, 'autre');
			throw erreurCode('EXDEV');
		};
		expect(await deposerFichier(racine, 'docs/course.bin', flux('mien'), undefined, { lier: course })).toBe('existe');
		expect(await readFile(join(racine, 'docs', 'course.bin'), 'utf8')).toBe('autre');
		expect(await readdir(join(racine, '.mnemo', 'depots'))).toEqual([]);
		// une autre erreur du lien remonte, rien ne reste
		await expect(deposerFichier(racine, 'docs/x.bin', flux('x'), undefined, { lier: async () => Promise.reject(erreurCode('EIO')) })).rejects.toThrow('EIO');
		expect((await readdir(join(racine, 'docs'))).sort()).toEqual(['cdc.md', 'copie.bin', 'course.bin']);
	});

	it('disque plein pendant l\'écriture → ErreurEspaceInsuffisant (message clair), rien ne reste ; taille annoncée trop grande → refus avant d\'écrire', async () => {
		const racine = await dossier();
		async function* plein(): AsyncGenerator<Uint8Array> {
			yield new Uint8Array(10);
			throw erreurCode('ENOSPC');
		}
		const e = await deposerFichier(racine, 'docs/p.bin', plein()).catch((x: unknown) => x);
		expect(e).toBeInstanceOf(ErreurEspaceInsuffisant);
		expect((e as Error).message).toBe('Disque plein : « docs/p.bin » n\'a pas pu être écrit en entier (rien n\'est gardé).');
		let lu = false;
		async function* espion(): AsyncGenerator<Uint8Array> {
			lu = true;
			yield new Uint8Array(1);
		}
		await expect(deposerFichier(racine, 'docs/g.bin', espion(), 2 ** 53, { annonce: 2 ** 51 })).rejects.toBeInstanceOf(ErreurEspaceInsuffisant);
		expect(lu).toBe(false);
		expect(await readdir(join(racine, 'docs'))).toEqual(['cdc.md']);
		expect(await readdir(join(racine, '.mnemo', 'depots'))).toEqual([]);
	});

	it('verifierDepot : libre (rien n\'est créé), existe, refus de chemin, place insuffisante', async () => {
		const racine = await dossier();
		expect(await verifierDepot(racine, 'docs/neuf/a/b.bin', 10)).toBe('libre');
		expect(await readdir(join(racine, 'docs'))).toEqual(['cdc.md']);
		expect(await verifierDepot(racine, 'docs/cdc.md', null)).toBe('existe');
		await symlink(await dossierTemporaire(), join(racine, 'lien'));
		for (const chemin of ['lien/x.bin', '_mnemo/x.bin', '.Mnemo/x.bin', '../x.bin', 'docs/cdc.md/x']) {
			await expect(verifierDepot(racine, chemin, null), chemin).rejects.toBeInstanceOf(ErreurFichier);
		}
		expect(await verifierDepot(racine, '.notes/x.bin', null)).toBe('libre');
		// un dossier manquant est un nom nouveau : invisible → refusé, même plusieurs niveaux sous le premier manquant
		for (const chemin of ['neuf/\u202eabc/x.bin', '\u202eneuf/x.bin', 'docs/neuf/\u0007/x.bin']) {
			await expect(verifierDepot(racine, chemin, null), chemin).rejects.toBeInstanceOf(ErreurFichier);
			await expect(deposerFichier(racine, chemin, flux('x')), chemin).rejects.toBeInstanceOf(ErreurFichier);
		}
		expect(await readdir(racine)).not.toContain('neuf');
		await mkdir(join(racine, 'docs', '\u202eabc'));
		expect(await verifierDepot(racine, 'docs/\u202eabc/x.bin', null)).toBe('libre');
		await expect(verifierDepot(racine, 'docs/g.bin', 2 ** 51)).rejects.toBeInstanceOf(ErreurEspaceInsuffisant);
	});

	it('nettoyerDepots : vide .mnemo/depots/ (temporaires d\'un dépôt interrompu par un arrêt brutal)', async () => {
		const racine = await dossier();
		expect(await nettoyerDepots(racine)).toBe(0);
		await mkdir(join(racine, '.mnemo', 'depots'), { recursive: true });
		await writeFile(join(racine, '.mnemo', 'depots', 'a.depot'), 'x');
		await writeFile(join(racine, '.mnemo', 'depots', 'b.depot'), 'y');
		expect(await nettoyerDepots(racine)).toBe(2);
		expect(await readdir(join(racine, '.mnemo', 'depots'))).toEqual([]);
	});
});
