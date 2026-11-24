import { execFile, spawn } from 'node:child_process';
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { commandeModeles } from '../../src/adaptateurs/cli/modeles.ts';
import { piecesPourPlateforme } from '../../src/infra/modeles/catalogue.ts';
import { dossierPiece } from '../../src/infra/modeles/installer.ts';
import { rerankerLlama, sensLlama } from '../../src/infra/modeles/client-llama.ts';
import { journaliser } from '../../src/infra/modeles/journal.ts';
import { arreterServeurs, cheminsModeles, ecrireEtatServeurs, environnementGardien, lireEtatServeurs, lireLances, nettoyerLances, pidVivant } from '../../src/infra/modeles/serveurs.ts';
import type { EtatServeurs } from '../../src/infra/modeles/serveurs.ts';
import { dossierTemporaire } from '../aides/dossier-temporaire.ts';

const FAUX_LLAMA = join(import.meta.dirname, '../aides/faux-llama.mjs');
const MAIN = join(import.meta.dirname, '../../src/adaptateurs/cli/main.ts');
const PIECES = piecesPourPlateforme('darwin', 'arm64')!;
const SENS = PIECES.find((p) => p.nom === 'sens')!;
const RERANKER = PIECES.find((p) => p.nom === 'reranker')!;

type Reglages = { demarrageMs?: number; delaiMs?: number; dimension?: number; defaut?: string; notes?: number[] };
type Banc = { racine: string; modeles: string; env: NodeJS.ProcessEnv; gguf: { sens: string; reranker: string } };

const racinesOuvertes: string[] = [];
const processus: number[] = [];

afterEach(async () => {
	vi.restoreAllMocks();
	// jamais de processus laissé derrière : gardiens arrêtés, faux serveurs tués
	while (racinesOuvertes.length > 0) {
		const racine = racinesOuvertes.pop()!;
		// des serveurs encore en chargement ne sont pas vérifiables : ceux du registre de ce test sont tués
		if (typeof (await arreterServeurs(racine)) === 'object') for (const l of await lireLances(racine)) processus.push(l.pid);
	}
	while (processus.length > 0) {
		try {
			process.kill(processus.pop()!, 'SIGKILL');
		} catch {
			/* déjà mort */
		}
	}
});

/** Une pièce « installée » pour de faux : marqueur au bon SHA-256 et fichier utile (vide). */
async function installerFaux(modeles: string, nom: 'sens' | 'reranker'): Promise<string> {
	const piece = nom === 'sens' ? SENS : RERANKER;
	const dossier = dossierPiece(modeles, piece);
	await mkdir(dossier, { recursive: true });
	await writeFile(join(dossier, '.empreinte'), `${piece.sha256}\n`);
	await writeFile(join(dossier, piece.fichier), '');
	return join(dossier, piece.fichier);
}

async function banc(
	options: { reranker?: boolean; inactiviteMs?: number; sens?: Reglages; rerankerReglages?: Reglages; env?: Record<string, string> } = {},
): Promise<Banc> {
	const racine = await dossierTemporaire();
	const modeles = await dossierTemporaire();
	await mkdir(join(racine, '.mnemo'), { recursive: true });
	racinesOuvertes.push(racine);
	const sens = await installerFaux(modeles, 'sens');
	const reranker = options.reranker === false ? '' : await installerFaux(modeles, 'reranker');
	if (options.sens) await writeFile(`${sens}.faux.json`, JSON.stringify(options.sens));
	if (options.rerankerReglages) await writeFile(`${reranker}.faux.json`, JSON.stringify(options.rerankerReglages));
	const env: NodeJS.ProcessEnv = {
		...process.env,
		MNEMO_MODELES: modeles,
		MNEMO_LLAMA_SERVEUR: FAUX_LLAMA,
		MNEMO_MODELES_INACTIVITE_MS: String(options.inactiviteMs ?? 60_000),
		...options.env,
	};
	return { racine, modeles, env, gguf: { sens, reranker } };
}

async function lancements(b: Banc): Promise<{ pid: number; args: string[]; env: string[] }[]> {
	const dossiers = [join(b.gguf.sens, '..', 'lancements.log')];
	if (b.gguf.reranker !== '') dossiers.push(join(b.gguf.reranker, '..', 'lancements.log'));
	const lignes: { pid: number; args: string[]; env: string[] }[] = [];
	for (const f of dossiers) {
		if (!existsSync(f)) continue;
		for (const l of (await readFile(f, 'utf8')).split('\n').filter(Boolean)) lignes.push(JSON.parse(l));
	}
	return lignes;
}

const attendre = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function attendreQue(condition: () => Promise<boolean> | boolean, delaiMs = 10_000): Promise<void> {
	const fin = Date.now() + delaiMs;
	while (Date.now() < fin) {
		if (await condition()) return;
		await attendre(50);
	}
	throw new Error('condition jamais remplie');
}

/** Démarre les serveurs (gros budget) et rend l'état écrit par le gardien. */
async function demarrer(b: Banc): Promise<EtatServeurs> {
	const v = await sensLlama(b.racine, { env: b.env }).vecteurs(['amorce'], { budgetMs: 15_000, demarrer: true });
	expect(v).not.toBeNull();
	await attendreQue(async () => (await lireEtatServeurs(b.racine))?.gardien.etat === 'pret');
	return (await lireEtatServeurs(b.racine))!;
}

async function portLibre(): Promise<number> {
	return new Promise((resoudre) => {
		const s = createServer();
		s.listen(0, '127.0.0.1', () => {
			const port = (s.address() as { port: number }).port;
			s.close(() => resoudre(port));
		});
	});
}

async function pidMort(): Promise<number> {
	const enfant = spawn(process.execPath, ['-e', '0']);
	await new Promise((r) => enfant.once('exit', r));
	return enfant.pid!;
}

describe('modèles partagés : démarrage et clients', () => {
	it('sans serveur et sans démarrer : null aussitôt, rien de lancé', async () => {
		const b = await banc();
		const debut = Date.now();
		expect(await sensLlama(b.racine, { env: b.env }).vecteurs(['a'], { budgetMs: 400, demarrer: false })).toBeNull();
		expect(await rerankerLlama(b.racine, { env: b.env }).noter('q', ['a'], { budgetMs: 400, demarrer: false })).toBeNull();
		expect(Date.now() - debut).toBeLessThan(400);
		await attendre(300);
		expect(await lancements(b)).toHaveLength(0);
		expect(existsSync(cheminsModeles(b.racine).etat)).toBe(false);
	});

	it('démarre un gardien : vecteurs 1024, notes par index, modeles.json 0600, arguments et environnement des serveurs', async () => {
		const b = await banc();
		const sens = sensLlama(b.racine, { env: b.env });
		const vecteurs = await sens.vecteurs(['chat', 'chien', 'oiseau'], { budgetMs: 15_000, demarrer: true });
		expect(vecteurs).toHaveLength(3);
		expect(vecteurs!.every((v) => v instanceof Float32Array && v.length === 1024)).toBe(true);
		// dans l'ordre des textes malgré une réponse dans le désordre
		const seul = await sens.vecteurs(['oiseau'], { budgetMs: 2000, demarrer: false });
		expect([...seul![0]!]).toEqual([...vecteurs![2]!]);

		const notes = await rerankerLlama(b.racine, { env: b.env }).noter('abc', ['xyz', 'abc', 'ab'], { budgetMs: 15_000, demarrer: true });
		expect(notes).toEqual([0, 0.3, 0.2]);

		await attendreQue(async () => (await lireEtatServeurs(b.racine))?.gardien.etat === 'pret');
		const etat = (await lireEtatServeurs(b.racine))!;
		expect(pidVivant(etat.gardien.pid)).toBe(true);
		expect(etat.sens!.modele).toBe('bge-m3-q8_0.gguf');
		expect(etat.reranker!.modele).toBe('bge-reranker-v2-m3-Q8_0.gguf');
		expect(etat.sens!.cle).toMatch(/^[0-9a-f]{64}$/u);
		expect(etat.sens!.cle).not.toBe(etat.reranker!.cle);
		expect(pidVivant(etat.sens!.pid) && pidVivant(etat.reranker!.pid)).toBe(true);
		if (process.platform !== 'win32') expect((await stat(cheminsModeles(b.racine).etat)).mode & 0o777).toBe(0o600);
		expect(existsSync(cheminsModeles(b.racine).actif)).toBe(true);

		const lances = await lancements(b);
		expect(lances).toHaveLength(2);
		const argsSens = lances.find((l) => l.args.includes('--embedding'))!.args.join(' ');
		const argsReranker = lances.find((l) => l.args.includes('--reranking'))!.args.join(' ');
		expect(argsSens).toContain('--embedding --pooling cls -c 16384 -b 2048 -ub 2048 -np 8');
		expect(argsReranker).toContain('--reranking -c 8192 -b 2048 -ub 2048 -np 4');
		for (const args of [argsSens, argsReranker]) {
			expect(args).toContain('--host 127.0.0.1');
			expect(args).toContain('--log-disable');
			expect(args).toMatch(/-m \S+\.gguf/u);
			// clé par fichier 0600, jamais sur la ligne de commande ; fichier retiré une fois le serveur prêt
			expect(args).toMatch(/--api-key-file \S+\.cle/u);
			expect(args).not.toMatch(/[0-9a-f]{64}/u);
		}
		expect((await readdir(join(b.racine, '.mnemo'))).filter((f) => f.endsWith('.cle'))).toEqual([]);
		if (process.platform === 'win32') {
			// libuv ajoute toujours à l'environnement d'un enfant ces variables du système, si le parent les a : rien d'autre
			const systeme = ['HOMEDRIVE', 'HOMEPATH', 'LOGONSERVER', 'PATH', 'SYSTEMDRIVE', 'SYSTEMROOT', 'TEMP', 'USERDOMAIN', 'USERNAME', 'USERPROFILE', 'WINDIR'];
			for (const l of lances) {
				const noms = l.env.map((n) => n.toUpperCase());
				expect(noms).toEqual(expect.arrayContaining(['PATH', 'SYSTEMROOT']));
				expect(noms.filter((n) => !systeme.includes(n))).toEqual([]);
			}
		} else {
			const attendu = process.platform === 'linux' ? ['LD_LIBRARY_PATH', 'PATH'] : ['PATH'];
			for (const l of lances) expect(l.env.filter((n) => !['__CF_USER_TEXT_ENCODING'].includes(n))).toEqual(attendu);
		}
	}, 30_000);

	it('deux démarrages simultanés : un seul gardien', async () => {
		const b = await banc();
		const [a, c] = await Promise.all([
			sensLlama(b.racine, { env: b.env }).vecteurs(['a'], { budgetMs: 15_000, demarrer: true }),
			sensLlama(b.racine, { env: b.env }).vecteurs(['b'], { budgetMs: 15_000, demarrer: true }),
		]);
		expect(a).not.toBeNull();
		expect(c).not.toBeNull();
		await attendre(500);
		expect(await lancements(b)).toHaveLength(2);
	}, 30_000);

	it('deux gardiens lancés ensemble (sans démarreur) : un seul reste', async () => {
		const b = await banc();
		const lancer = () => spawn(process.execPath, [MAIN, 'modeles', 'garde', b.racine], { cwd: b.racine, env: b.env, stdio: 'ignore' });
		const g1 = lancer();
		const g2 = lancer();
		processus.push(g1.pid!, g2.pid!);
		await attendreQue(async () => (await lireEtatServeurs(b.racine))?.gardien.etat === 'pret');
		await attendreQue(() => !pidVivant(g1.pid!) || !pidVivant(g2.pid!));
		expect(await lancements(b)).toHaveLength(2);
	}, 30_000);

	it('modeles.json au pid mort : remplacé', async () => {
		const b = await banc();
		const mort = await pidMort();
		await ecrireEtatServeurs(b.racine, {
			gardien: { pid: mort, depuis: new Date().toISOString(), etat: 'pret' },
			sens: { port: await portLibre(), cle: 'a'.repeat(64), modele: 'bge-m3-q8_0.gguf', pid: mort, depuis: new Date().toISOString() },
		});
		expect(await sensLlama(b.racine, { env: b.env }).vecteurs(['a'], { budgetMs: 300, demarrer: false })).toBeNull();
		const etat = await demarrer(b);
		expect(etat.gardien.pid).not.toBe(mort);
	}, 30_000);

	it('serveur vivant mais clé refusée : inutilisable, remplacé au démarrage', async () => {
		const b = await banc();
		const port = await portLibre();
		const intrus = spawn(process.execPath, [FAUX_LLAMA, '-m', b.gguf.sens, '--host', '127.0.0.1', '--port', String(port), '--api-key', 'b'.repeat(64), '--embedding'], { stdio: 'ignore' });
		processus.push(intrus.pid!);
		await attendre(300);
		await ecrireEtatServeurs(b.racine, {
			gardien: { pid: intrus.pid!, depuis: new Date().toISOString(), etat: 'pret' },
			sens: { port, cle: 'a'.repeat(64), modele: 'bge-m3-q8_0.gguf', pid: intrus.pid!, depuis: new Date().toISOString() },
		});
		expect(await sensLlama(b.racine, { env: b.env }).vecteurs(['a'], { budgetMs: 500, demarrer: false })).toBeNull();
		const etat = await demarrer(b);
		expect(etat.gardien.pid).not.toBe(intrus.pid);
		expect(etat.sens!.port).not.toBe(port);
	}, 30_000);

	it('serveur lent : null dans le budget ; si-en-marche utilise le serveur déjà là', async () => {
		const b = await banc({ sens: { delaiMs: 1500 } });
		// premier appel court : le démarrage continue en arrière-plan
		const debut = Date.now();
		expect(await sensLlama(b.racine, { env: b.env }).vecteurs(['a'], { budgetMs: 200, demarrer: true })).toBeNull();
		expect(Date.now() - debut).toBeLessThan(600);
		await attendreQue(async () => (await lireEtatServeurs(b.racine))?.gardien.etat === 'pret');
		const t = Date.now();
		expect(await sensLlama(b.racine, { env: b.env }).vecteurs(['a'], { budgetMs: 400, demarrer: false })).toBeNull();
		expect(Date.now() - t).toBeLessThan(800);
		expect(await sensLlama(b.racine, { env: b.env }).vecteurs(['a'], { budgetMs: 5000, demarrer: false })).toHaveLength(1);
	}, 30_000);

	it('réponses fautives : dimension, nombre, JSON cassé, erreur HTTP → null (et une ligne de journal)', async () => {
		for (const sens of [{ dimension: 512 }, { defaut: 'compte' }, { defaut: 'json' }, { defaut: '500' }]) {
			const b = await banc({ sens, rerankerReglages: sens.dimension ? {} : sens });
			expect(await sensLlama(b.racine, { env: b.env }).vecteurs(['a', 'b'], { budgetMs: 15_000, demarrer: true })).toBeNull();
			if (!sens.dimension) {
				expect(await rerankerLlama(b.racine, { env: b.env }).noter('q', ['a', 'b'], { budgetMs: 15_000, demarrer: true })).toBeNull();
			}
			expect(await readFile(cheminsModeles(b.racine).journal, 'utf8')).toMatch(/sens/u);
		}
	}, 60_000);

	it('forme réelle de /v1/rerank (llama-server b11671) : logits négatifs, triés du meilleur au moins bon, avec usage → notes par index', async () => {
		// relevé sur le vrai serveur : {"model":"…gguf","object":"list","usage":{…},"results":[{"index":1,"relevance_score":-0.83…},…]}
		const b = await banc({ rerankerReglages: { notes: [-10.810524940490723, -0.8323414325714111, -9.603277206420898] } });
		const notes = await rerankerLlama(b.racine, { env: b.env }).noter('quel est le taux journalier', ['Le chat dort.', 'Le TJM convenu est de 650 euros par jour.', 'Réunion lundi.'], { budgetMs: 15_000, demarrer: true });
		expect(notes).toEqual([-10.810524940490723, -0.8323414325714111, -9.603277206420898]);
	});

	it('lots de 64 textes', async () => {
		const b = await banc();
		const textes = Array.from({ length: 150 }, (_, i) => `texte ${i}`);
		const v = await sensLlama(b.racine, { env: b.env }).vecteurs(textes, { budgetMs: 15_000, demarrer: true });
		expect(v).toHaveLength(150);
		const seul = await sensLlama(b.racine, { env: b.env }).vecteurs(['texte 149'], { budgetMs: 2000, demarrer: false });
		expect([...seul![0]!]).toEqual([...v![149]!]);
	}, 30_000);

	it('textes vides : liste vide sans serveur', async () => {
		const b = await banc();
		expect(await sensLlama(b.racine, { env: b.env }).vecteurs([], { budgetMs: 100, demarrer: true })).toEqual([]);
		expect(await rerankerLlama(b.racine, { env: b.env }).noter('q', [], { budgetMs: 100, demarrer: true })).toEqual([]);
		expect(await lancements(b)).toHaveLength(0);
	});

	it('reranker non installé : le sens seul est lancé, noter rend null sans relancer de gardien', async () => {
		const b = await banc({ reranker: false });
		const etat = await demarrer(b);
		expect(etat.reranker).toBeUndefined();
		expect(await rerankerLlama(b.racine, { env: b.env }).noter('q', ['a'], { budgetMs: 2000, demarrer: true })).toBeNull();
		await attendre(300);
		expect(await lancements(b)).toHaveLength(1);
		expect((await lireEtatServeurs(b.racine))!.gardien.pid).toBe(etat.gardien.pid);
	}, 30_000);

	it('modele() : bge-m3@<sha12> si la pièce est installée, sinon null', async () => {
		const b = await banc();
		expect(sensLlama(b.racine, { env: b.env }).modele()).toBe(`bge-m3@${SENS.sha256.slice(0, 12)}`);
		const vide = await dossierTemporaire();
		const env = { ...b.env, MNEMO_MODELES: vide };
		expect(sensLlama(b.racine, { env }).modele()).toBeNull();
		expect(await sensLlama(b.racine, { env }).vecteurs(['a'], { budgetMs: 300, demarrer: true })).toBeNull();
		expect(await lancements(b)).toHaveLength(0);
	});

	it('premier lancement d’un serveur en échec (port pris) : réessayé une fois', async () => {
		const b = await banc({ sens: { defaut: 'premier-echoue' } });
		await demarrer(b);
		expect((await lancements(b)).filter((l) => l.args.includes('--embedding'))).toHaveLength(2);
	}, 30_000);
});

describe('gardien : arrêt', () => {
	it('après inactivité : serveurs arrêtés, modeles.json retiré', async () => {
		const b = await banc({ inactiviteMs: 1500 });
		const etat = await demarrer(b);
		await attendreQue(() => !pidVivant(etat.gardien.pid), 15_000);
		expect(pidVivant(etat.sens!.pid)).toBe(false);
		expect(pidVivant(etat.reranker!.pid)).toBe(false);
		expect(existsSync(cheminsModeles(b.racine).etat)).toBe(false);
	}, 30_000);

	it('l’activité repousse l’arrêt', async () => {
		const b = await banc({ inactiviteMs: 1500 });
		const etat = await demarrer(b);
		const sens = sensLlama(b.racine, { env: b.env });
		for (let i = 0; i < 6; i++) {
			await attendre(500);
			expect(await sens.vecteurs(['a'], { budgetMs: 2000, demarrer: false })).not.toBeNull();
		}
		expect(pidVivant(etat.gardien.pid)).toBe(true);
	}, 30_000);

	it('un serveur meurt après « prêt » : tout s’arrête, trace « echec » d’une minute (pas de relance en boucle)', async () => {
		const b = await banc();
		const etat = await demarrer(b);
		process.kill(etat.sens!.pid, 'SIGKILL');
		await attendreQue(() => !pidVivant(etat.gardien.pid));
		expect(pidVivant(etat.reranker!.pid)).toBe(false);
		expect((await lireEtatServeurs(b.racine))?.gardien.etat).toBe('echec');
		const avant = (await lancements(b)).length;
		expect(await sensLlama(b.racine, { env: b.env }).vecteurs(['a'], { budgetMs: 1500, demarrer: true })).toBeNull();
		await attendre(300);
		expect((await lancements(b)).length).toBe(avant);
		expect((await lireEtatServeurs(b.racine))?.gardien.pid).toBe(etat.gardien.pid);
	}, 30_000);

	it('un modèle qui ne charge pas : l’autre est publié et sert ; le premier rend null sans relance', async () => {
		const b = await banc({ rerankerReglages: { defaut: 'echoue' } });
		const etat = await demarrer(b);
		expect(etat.gardien.etat).toBe('pret');
		expect(etat.sens).toBeDefined();
		expect(etat.reranker).toBeUndefined();
		const avant = (await lancements(b)).length;
		expect(await rerankerLlama(b.racine, { env: b.env }).noter('q', ['a'], { budgetMs: 1500, demarrer: true })).toBeNull();
		expect((await lancements(b)).length).toBe(avant);
		expect((await lireEtatServeurs(b.racine))?.gardien.pid).toBe(etat.gardien.pid);
		expect(await sensLlama(b.racine, { env: b.env }).vecteurs(['a'], { budgetMs: 2000, demarrer: false })).not.toBeNull();
	}, 30_000);

	it('dossier Mnemo supprimé : le gardien arrête ses serveurs et ne recrée rien', async () => {
		const b = await banc({ env: { MNEMO_MODELES_SURVEILLANCE_MS: '200' } });
		const etat = await demarrer(b);
		await rm(b.racine, { recursive: true, force: true });
		await attendre(1000);
		await attendreQue(() => !pidVivant(etat.gardien.pid) && !pidVivant(etat.sens!.pid) && !pidVivant(etat.reranker!.pid), 10_000);
		await attendre(300);
		expect(existsSync(b.racine)).toBe(false);
	}, 30_000);

	it('dossier Mnemo supprimé pendant le chargement : gardien et serveurs arrêtés, rien de recréé', async () => {
		const LENT = { demarrageMs: 2500 };
		const b = await banc({ sens: LENT, rerankerReglages: LENT, env: { MNEMO_MODELES_SURVEILLANCE_MS: '200' } });
		expect(await sensLlama(b.racine, { env: b.env }).vecteurs(['a'], { budgetMs: 300, demarrer: true })).toBeNull();
		await attendreQue(async () => {
			const e = await lireEtatServeurs(b.racine);
			return e?.gardien.etat === 'demarrage' && e.sens !== undefined && e.reranker !== undefined;
		});
		const etat = (await lireEtatServeurs(b.racine))!;
		const pids = [etat.gardien.pid, etat.sens!.pid, etat.reranker!.pid];
		processus.push(...pids);
		await rm(b.racine, { recursive: true, force: true });
		await attendreQue(() => pids.every((pid) => !pidVivant(pid)), 8000);
		expect(existsSync(b.racine)).toBe(false);
	}, 30_000);

	it('modeles.json disparu (dossier gardé) : arrêt journalisé « état disparu »', async () => {
		const b = await banc({ env: { MNEMO_MODELES_SURVEILLANCE_MS: '200' } });
		const etat = await demarrer(b);
		await rm(cheminsModeles(b.racine).etat);
		await attendreQue(() => !pidVivant(etat.gardien.pid) && !pidVivant(etat.sens!.pid));
		expect(await readFile(cheminsModeles(b.racine).journal, 'utf8')).toContain('arrêt (état disparu)');
	}, 30_000);

	it('mnemo modeles arreter : gardien et serveurs arrêtés ; etat liste les serveurs en marche', async () => {
		const b = await banc();
		const etat = await demarrer(b);
		const lignes: string[] = [];
		vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => {
			lignes.push(a.join(' '));
		});
		await commandeModeles(['etat'], { dossier: b.modeles, racine: b.racine });
		expect(lignes.join('\n')).toMatch(new RegExp(`serveur sens : port ${etat.sens!.port}, bge-m3-q8_0\\.gguf, depuis `, 'u'));
		expect(lignes.join('\n')).toMatch(/serveur reranker : port \d+, bge-reranker-v2-m3-Q8_0\.gguf/u);

		lignes.length = 0;
		await commandeModeles(['arreter'], { racine: b.racine });
		expect(lignes.join('\n')).toContain('Serveurs arrêtés');
		for (const pid of [etat.gardien.pid, etat.sens!.pid, etat.reranker!.pid]) expect(pidVivant(pid)).toBe(false);
		expect(existsSync(cheminsModeles(b.racine).etat)).toBe(false);

		lignes.length = 0;
		await commandeModeles(['arreter'], { racine: b.racine });
		expect(lignes.join('\n')).toContain('Aucun serveur');
		lignes.length = 0;
		await commandeModeles(['etat'], { dossier: b.modeles, racine: b.racine });
		expect(lignes.join('\n')).toContain('aucun serveur en marche');
	}, 30_000);

	it('arreter tue les serveurs même si le gardien ne les a pas arrêtés (gardien tué net)', async () => {
		const b = await banc();
		const etat = await demarrer(b);
		process.kill(etat.gardien.pid, 'SIGKILL');
		await attendreQue(() => !pidVivant(etat.gardien.pid));
		expect(pidVivant(etat.sens!.pid)).toBe(true);
		vi.spyOn(console, 'log').mockImplementation(() => {});
		await commandeModeles(['arreter'], { racine: b.racine });
		await attendreQue(() => !pidVivant(etat.sens!.pid) && !pidVivant(etat.reranker!.pid));
	}, 30_000);
});

const INTRUS = `
import { createServer } from 'node:http';
import { appendFileSync } from 'node:fs';
const [port, journal, corps] = process.argv.slice(1);
createServer((req, res) => {
	appendFileSync(journal, req.method + ' ' + req.url + '\\n');
	res.writeHead(200, { 'content-type': corps === 'html' ? 'text/html' : 'application/json' });
	res.end(corps === 'html' ? '<html>app</html>' : corps === 'id' ? '{"data":[{"id":"/x/bge-m3-q8_0.gguf"}]}' : '{}');
}).listen(Number(port), '127.0.0.1');
`;

/** Un processus vivant sans rapport avec Mnemo. */
function processusEtranger(): number {
	const p = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
	processus.push(p.pid!);
	return p.pid!;
}

describe('identité stricte, arrêt sûr, orphelins', () => {
	for (const corps of ['{}', 'html', 'id']) {
		it(`un imposteur qui répond 200 à tout (${corps}) ne reçoit aucun texte et est remplacé, sans être tué`, async () => {
			const b = await banc();
			const port = await portLibre();
			const journal = join(b.racine, 'intrus.log');
			const intrus = spawn(process.execPath, ['--input-type=module', '-e', INTRUS, port.toString(), journal, corps], { stdio: 'ignore' });
			processus.push(intrus.pid!);
			await attendre(300);
			await ecrireEtatServeurs(b.racine, {
				gardien: { pid: intrus.pid!, depuis: new Date().toISOString(), etat: 'pret' },
				sens: { port, cle: 'a'.repeat(64), modele: 'bge-m3-q8_0.gguf', pid: intrus.pid!, depuis: new Date().toISOString() },
			});
			expect(await sensLlama(b.racine, { env: b.env }).vecteurs(['secret'], { budgetMs: 500, demarrer: false })).toBeNull();
			const etat = await demarrer(b);
			expect(etat.sens!.port).not.toBe(port);
			const recu = existsSync(journal) ? await readFile(journal, 'utf8') : '';
			expect(recu).toMatch(/GET \/v1\/models/u);
			expect(recu).not.toMatch(/POST/u);
			expect(pidVivant(intrus.pid!)).toBe(true);
		}, 30_000);
	}

	it('arreter : un état périmé qui nomme un processus étranger vivant le laisse en vie', async () => {
		const b = await banc();
		const etranger = processusEtranger();
		await ecrireEtatServeurs(b.racine, {
			gardien: { pid: etranger, depuis: new Date().toISOString(), etat: 'pret' },
			sens: { port: await portLibre(), cle: 'a'.repeat(64), modele: 'bge-m3-q8_0.gguf', pid: etranger, depuis: new Date().toISOString() },
		});
		const lignes: string[] = [];
		vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => {
			lignes.push(a.join(' '));
		});
		await commandeModeles(['etat'], { dossier: b.modeles, racine: b.racine });
		expect(lignes.join('\n')).toContain('aucun serveur en marche');
		await commandeModeles(['arreter'], { racine: b.racine });
		expect(lignes.join('\n')).toContain('état périmé retiré');
		await attendre(500);
		expect(pidVivant(etranger)).toBe(true);
		expect(existsSync(cheminsModeles(b.racine).etat)).toBe(false);
	});

	it('gardien tué net : le démarrage suivant arrête ses anciens serveurs', async () => {
		const b = await banc();
		const etat = await demarrer(b);
		process.kill(etat.gardien.pid, 'SIGKILL');
		await attendreQue(() => !pidVivant(etat.gardien.pid));
		const nouveau = await demarrer(b);
		expect(nouveau.gardien.pid).not.toBe(etat.gardien.pid);
		await attendreQue(() => !pidVivant(etat.sens!.pid) && !pidVivant(etat.reranker!.pid), 6000);
	}, 30_000);

	it('serveurs publiés dès leur lancement : un gardien tué pendant le chargement ne laisse pas de serveur introuvable', async () => {
		const b = await banc({ sens: { demarrageMs: 1500 }, rerankerReglages: { demarrageMs: 1500 } });
		expect(await sensLlama(b.racine, { env: b.env }).vecteurs(['a'], { budgetMs: 200, demarrer: true })).toBeNull();
		await attendreQue(async () => {
			const e = await lireEtatServeurs(b.racine);
			return e?.gardien.etat === 'demarrage' && e.sens !== undefined && e.reranker !== undefined;
		});
		const enChargement = (await lireEtatServeurs(b.racine))!;
		process.kill(enChargement.gardien.pid, 'SIGKILL');
		await attendre(2000);
		await demarrer(b);
		await attendreQue(() => !pidVivant(enChargement.sens!.pid) && !pidVivant(enChargement.reranker!.pid), 6000);
	}, 30_000);

	it('installer une pièce neuve arrête les serveurs du dossier (ils repartent avec elle)', async () => {
		const b = await banc();
		const etat = await demarrer(b);
		const lignes: string[] = [];
		vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => {
			lignes.push(a.join(' '));
		});
		const piece = { nom: 'reranker' as const, libelle: 'pièce neuve', adresse: 'https://exemple.invalid/x.gguf', sha256: '0'.repeat(64), archive: null, fichier: 'x.gguf' };
		await commandeModeles(['installer'], {
			dossier: await dossierTemporaire(),
			racine: b.racine,
			pieces: [piece],
			telecharger: async (_url, vers) => {
				await writeFile(vers, '');
				return '0'.repeat(64);
			},
		});
		expect(lignes.join('\n')).toContain('Serveurs de ce dossier arrêtés');
		expect(pidVivant(etat.gardien.pid)).toBe(false);
	}, 30_000);

	it('environnement du gardien réduit', () => {
		expect(
			environnementGardien({ PATH: '/b', HOME: '/h', SECRET_TOKEN: 'x', MNEMO_MODELES: '/m', TMPDIR: '/t', Path: '/w', SystemRoot: 'C:', AWS_KEY: 'k' }),
		).toEqual({ PATH: '/b', HOME: '/h', MNEMO_MODELES: '/m', TMPDIR: '/t', Path: '/w', SystemRoot: 'C:' });
	});
});

/** Gardien tué net pendant le chargement de ses deux serveurs ; rend l'état qui les nomme. */
async function tuerPendantLeChargement(b: Banc): Promise<EtatServeurs> {
	expect(await sensLlama(b.racine, { env: b.env }).vecteurs(['a'], { budgetMs: 200, demarrer: true })).toBeNull();
	await attendreQue(async () => {
		const e = await lireEtatServeurs(b.racine);
		return e?.gardien.etat === 'demarrage' && e.sens !== undefined && e.reranker !== undefined;
	});
	const etat = (await lireEtatServeurs(b.racine))!;
	expect((await lireLances(b.racine)).map((l) => l.pid).sort()).toEqual([etat.sens!.pid, etat.reranker!.pid].sort());
	process.kill(etat.gardien.pid, 'SIGKILL');
	await attendreQue(() => !pidVivant(etat.gardien.pid));
	return etat;
}

// Sous Windows, libuv place les enfants non détachés dans un « job » fermé avec le parent : tuer le gardien tue ses
// serveurs, il n'y a jamais d'orphelin encore en chargement.
const WINDOWS = process.platform === 'win32';

describe('registre des serveurs lancés', () => {
	const ENV_COURT = { MNEMO_MODELES_CHARGEMENT_MS: '4000', MNEMO_MODELES_SURVEILLANCE_MS: '200' };
	const LENT = { demarrageMs: 1500 };

	it('gardien tué en plein chargement puis démarrage aussitôt : les anciens serveurs sont arrêtés dès qu’ils répondent', async () => {
		const b = await banc({ sens: LENT, rerankerReglages: LENT, env: ENV_COURT });
		const ancien = await tuerPendantLeChargement(b);
		const nouveau = await demarrer(b);
		expect(nouveau.gardien.pid).not.toBe(ancien.gardien.pid);
		await attendreQue(() => !pidVivant(ancien.sens!.pid) && !pidVivant(ancien.reranker!.pid), 4000 + 6000);
		await attendreQue(async () => (await lireLances(b.racine)).every((l) => l.gardien === nouveau.gardien.pid));
		expect(pidVivant(nouveau.sens!.pid) && pidVivant(nouveau.reranker!.pid)).toBe(true);
	}, 30_000);

	it.skipIf(WINDOWS)('gardien tué en plein chargement puis arreter : gardés tant qu’ils chargent, arrêtés au arreter suivant', async () => {
		const b = await banc({ sens: LENT, rerankerReglages: LENT, env: ENV_COURT });
		const ancien = await tuerPendantLeChargement(b);
		expect(await arreterServeurs(b.racine, b.env)).toEqual({ enChargement: 2 });
		expect(existsSync(cheminsModeles(b.racine).etat)).toBe(false);
		expect(await lireLances(b.racine)).toHaveLength(2);
		await attendre(2000);
		expect(await arreterServeurs(b.racine, b.env)).toBe('arrete');
		await attendreQue(() => !pidVivant(ancien.sens!.pid) && !pidVivant(ancien.reranker!.pid), 5000);
		expect(await lireLances(b.racine)).toEqual([]);
	}, 30_000);

	it.skipIf(WINDOWS)('mnemo modeles arreter pendant un chargement (gardien mort) : « encore en chargement », pas « état périmé »', async () => {
		const b = await banc({ sens: LENT, rerankerReglages: LENT, env: ENV_COURT });
		const ancien = await tuerPendantLeChargement(b);
		// ses faux serveurs, orphelins par construction : tués par le test lui-même
		processus.push(ancien.sens!.pid, ancien.reranker!.pid);
		const lignes: string[] = [];
		vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => {
			lignes.push(a.join(' '));
		});
		await commandeModeles(['arreter'], { racine: b.racine });
		expect(lignes.join('\n')).toContain('2 serveur(s) encore en chargement : relancez `mnemo modeles arreter` dans un instant');
		expect(lignes.join('\n')).not.toContain('périmé');
	}, 30_000);

	it('un pid réutilisé dans le registre n’est jamais signalé : gardé jeune, retiré vieux', async () => {
		const b = await banc({ env: ENV_COURT });
		const vieux = processusEtranger();
		const jeune = processusEtranger();
		const lance = (pid: number, lanceMs: number) => ({ pid, port: 1, cle: 'c'.repeat(64), piece: 'bge-m3-q8_0.gguf', lanceMs, gardien: 999_999 });
		await writeFile(cheminsModeles(b.racine).lances, JSON.stringify({ lances: [lance(vieux, Date.now() - 600_000), lance(jeune, Date.now())] }));
		expect(await nettoyerLances(b.racine, { garder: null, env: b.env })).toEqual({ arretes: 0, enChargement: 1 });
		expect((await lireLances(b.racine)).map((l) => l.pid)).toEqual([jeune]);
		await arreterServeurs(b.racine, b.env);
		await demarrer(b);
		await attendre(500);
		expect(pidVivant(vieux) && pidVivant(jeune)).toBe(true);
	}, 30_000);

	it('fichiers de clé abandonnés retirés après le chargement maximal', async () => {
		const b = await banc({ env: ENV_COURT });
		const reste = join(b.racine, '.mnemo', 'modeles-sens-abc.cle');
		const recent = join(b.racine, '.mnemo', 'modeles-sens-def.cle');
		await writeFile(reste, 'x');
		await writeFile(recent, 'x');
		const { utimes } = await import('node:fs/promises');
		await utimes(reste, new Date(Date.now() - 60_000), new Date(Date.now() - 60_000));
		await nettoyerLances(b.racine, { garder: null, env: b.env });
		expect(existsSync(reste)).toBe(false);
		expect(existsSync(recent)).toBe(true);
	});

	it('publication des serveurs en parallèle : aucune entrée perdue (20 fois)', async () => {
		for (let i = 0; i < 20; i++) {
			const b = await banc({ sens: { demarrageMs: 300 }, rerankerReglages: { demarrageMs: 300 } });
			await sensLlama(b.racine, { env: b.env }).vecteurs(['a'], { budgetMs: 50, demarrer: true });
			// « lancé » est journalisé après la publication de l'entrée
			await attendreQue(async () => {
				const j = existsSync(cheminsModeles(b.racine).journal) ? await readFile(cheminsModeles(b.racine).journal, 'utf8') : '';
				return j.includes('sens lancé') && j.includes('reranker lancé');
			});
			const etat = (await lireEtatServeurs(b.racine))!;
			expect(etat.sens, `essai ${i}`).toBeDefined();
			expect(etat.reranker, `essai ${i}`).toBeDefined();
			await arreterServeurs(b.racine);
		}
	}, 60_000);
});

describe('journal des modèles', () => {
	it('vidé quand il dépasse sa borne', async () => {
		const racine = await dossierTemporaire();
		const { journal } = cheminsModeles(racine);
		// sans `.mnemo/`, rien n'est écrit (le dossier n'est jamais recréé)
		await journaliser(racine, 'perdue');
		expect(existsSync(join(racine, '.mnemo'))).toBe(false);
		await mkdir(join(racine, '.mnemo'));
		await journaliser(racine, 'premiere');
		await journaliser(racine, 'x'.repeat(200), 100);
		await journaliser(racine, 'troisieme', 100);
		const texte = await readFile(journal, 'utf8');
		expect(texte).not.toContain('premiere');
		expect(texte).toContain('troisieme');
	});
});

describe('mnemo index : vecteurs de sens (faux serveur)', () => {
	const mnemo = (cwd: string, env: NodeJS.ProcessEnv, ...args: string[]) =>
		new Promise<{ code: number; out: string; err: string }>((resoudre) => {
			execFile(process.execPath, [MAIN, ...args], { cwd, env }, (erreur, out, err) => resoudre({ code: erreur ? (erreur.code as number) : 0, out, err }));
		});

	it('calcule les vecteurs manquants (modèle lancé au besoin), puis plus rien', { timeout: 60_000 }, async () => {
		const b = await banc({ reranker: false });
		expect((await mnemo(b.racine, b.env, 'init', '--sans-mcp')).code).toBe(0);
		await mkdir(join(b.racine, '_mnemo', 'projets'), { recursive: true });
		await writeFile(join(b.racine, '_mnemo', 'projets', 'alpha.md'), '# Alpha\n\nUn projet de tapirs.\n');
		const r = await mnemo(b.racine, b.env, 'index');
		expect(r.code).toBe(0);
		const modele = `bge-m3@${SENS.sha256.slice(0, 12)}`;
		expect(r.out).toMatch(new RegExp(`\\n[1-9]\\d* vecteurs calculés \\(${modele}\\)\\n$`, 'u'));
		const encore = await mnemo(b.racine, b.env, 'index');
		expect(encore.out).toMatch(new RegExp(`\\n0 vecteurs calculés \\(${modele}\\)\\n$`, 'u'));
	});
});
