import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { commandeModeles } from '../../src/adaptateurs/cli/modeles.ts';
import { ErreurCli } from '../../src/adaptateurs/cli/erreurs.ts';
import { piecesPourPlateforme } from '../../src/infra/modeles/catalogue.ts';
import type { Piece } from '../../src/infra/modeles/catalogue.ts';
import { dossierTemporaire } from '../aides/dossier-temporaire.ts';
import { ENV_TEST } from '../aides/env-test.ts';

const MAIN = join(import.meta.dirname, '../../src/adaptateurs/cli/main.ts');

function mnemo(env: Record<string, string>, ...args: string[]): Promise<{ code: number; out: string; err: string }> {
	return new Promise((resoudre) => {
		// hors de toute mémoire (le dépôt peut être rangé sous la vraie mémoire de l'utilisateur)
		execFile(process.execPath, [MAIN, ...args], { cwd: tmpdir(), env: { ...ENV_TEST, ...env } }, (erreur, out, err) => {
			resoudre({ code: erreur ? (erreur.code as number) : 0, out, err });
		});
	});
}

const sha = (b: string) => createHash('sha256').update(b).digest('hex');

function pieces(): Piece[] {
	return [
		{ nom: 'sens', libelle: 'sens de test', adresse: 'https://exemple.invalid/a/sens.gguf', sha256: sha('sens'), archive: null, fichier: 'sens.gguf' },
		{ nom: 'reranker', libelle: 'reranker de test', adresse: 'https://exemple.invalid/b/reranker.gguf', sha256: sha('reranker'), archive: null, fichier: 'reranker.gguf' },
	];
}

/** Faux téléchargement : écrit le contenu attendu (le nom du fichier sans extension). */
const telecharger = async (url: string, vers: string) => {
	await writeFile(vers, url.endsWith('sens.gguf') ? 'sens' : 'reranker');
};

function capturer() {
	const lignes: string[] = [];
	vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => {
		lignes.push(a.join(' '));
	});
	return lignes;
}

afterEach(() => {
	vi.restoreAllMocks();
});

// `racine: null` partout : sinon la racine est cherchée depuis le dossier courant, et un dépôt rangé sous une vraie mémoire
// (par exemple ~/Documents/_mnemo) arrêterait les serveurs de modèles de l'utilisateur.
describe('mnemo modeles (en processus)', () => {
	it('etat puis installer, puis installer encore : déjà installé', async () => {
		const dossier = await dossierTemporaire();
		const lignes = capturer();
		await commandeModeles(['etat'], { dossier, racine: null, pieces: pieces() });
		expect(lignes.join('\n')).toContain(`Dossier des modèles : ${dossier}`);
		expect(lignes.filter((l) => l.includes(': absent'))).toHaveLength(2);

		lignes.length = 0;
		await commandeModeles(['installer'], { dossier, racine: null, pieces: pieces(), telecharger });
		expect(lignes).toEqual(['sens de test : téléchargé', 'reranker de test : téléchargé']);

		lignes.length = 0;
		await commandeModeles(['installer'], { dossier, racine: null, pieces: pieces(), telecharger });
		expect(lignes).toEqual(['sens de test : déjà installé', 'reranker de test : déjà installé']);

		lignes.length = 0;
		await commandeModeles(['etat'], { dossier, racine: null, pieces: pieces() });
		expect(lignes.filter((l) => l.includes(': installé — '))).toHaveLength(2);
		expect(lignes.join('\n')).toContain(join(dossier, 'sens', sha('sens').slice(0, 12), 'sens.gguf'));
	});

	it('--depuis : prend ce qui est là, écarte une empreinte fausse, télécharge le reste', async () => {
		const dossier = await dossierTemporaire();
		const source = await dossierTemporaire();
		await mkdir(join(source, 'bge'));
		await writeFile(join(source, 'bge', 'sens.gguf'), 'sens');
		await writeFile(join(source, 'reranker.gguf'), 'abîmé');
		const lignes = capturer();
		await commandeModeles(['installer', '--depuis', source], { dossier, racine: null, pieces: pieces(), telecharger });
		expect(lignes).toEqual([
			`sens de test : installé depuis ${join(source, 'bge', 'sens.gguf')}`,
			`reranker de test : ${join(source, 'reranker.gguf')} écarté (empreinte différente)`,
			'reranker de test : téléchargé',
		]);
	});

	it('un échec n\'arrête pas les autres pièces ; code 1 à la fin', async () => {
		const dossier = await dossierTemporaire();
		const lignes = capturer();
		const erreurs: string[] = [];
		vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => {
			erreurs.push(a.join(' '));
		});
		const mauvais = async (url: string, vers: string) => {
			if (url.endsWith('sens.gguf')) throw new Error('réseau coupé');
			await telecharger(url, vers);
		};
		const echec = commandeModeles(['installer'], { dossier, racine: null, pieces: pieces(), telecharger: mauvais });
		await expect(echec).rejects.toBeInstanceOf(ErreurCli);
		await expect(echec).rejects.toMatchObject({ code: 1 });
		expect(erreurs.join('\n')).toContain('sens de test : échec — réseau coupé');
		expect(lignes).toEqual(['reranker de test : téléchargé']);
	});

	it('plateforme non prise en charge : message ; etat code 0, installer code 1', async () => {
		const dossier = await dossierTemporaire();
		const lignes = capturer();
		await commandeModeles(['etat'], { dossier, racine: null, plateforme: 'freebsd', arch: 'riscv64' });
		expect(lignes.join('\n')).toContain('plateforme non prise en charge : freebsd-riscv64 ; la recherche se fait par les mots');
		await expect(commandeModeles(['installer'], { dossier, racine: null, plateforme: 'freebsd', arch: 'riscv64' })).rejects.toThrow(
			'plateforme non prise en charge : freebsd-riscv64 ; la recherche se fait par les mots',
		);
	});

	it('usage : code 2', async () => {
		for (const args of [[], ['bidule'], ['installer', '--depuis'], ['installer', '--bidule'], ['etat', 'en-trop']]) {
			await expect(commandeModeles(args, { racine: null, pieces: pieces() })).rejects.toMatchObject({ code: 2 });
		}
	});
});

describe('mnemo modeles (processus)', () => {
	it('etat : dossier de MNEMO_MODELES, pièces de cette plateforme absentes', async () => {
		const dossier = await dossierTemporaire();
		const r = await mnemo({ MNEMO_MODELES: dossier }, 'modeles', 'etat');
		expect(r.code).toBe(0);
		expect(r.out).toContain(`Dossier des modèles : ${dossier}`);
		const attendues = piecesPourPlateforme(process.platform, process.arch);
		if (attendues === null) expect(r.out).toContain('plateforme non prise en charge');
		else for (const p of attendues) expect(r.out).toContain(`${p.libelle} : absent`);
	});

	it('usage : code 2 ; listé dans l\'aide', async () => {
		const r = await mnemo({}, 'modeles');
		expect(r.code).toBe(2);
		expect(r.err).toContain('Usage : mnemo modeles');
		expect((await mnemo({}, '--aide')).out).toContain('modeles');
	});
});
