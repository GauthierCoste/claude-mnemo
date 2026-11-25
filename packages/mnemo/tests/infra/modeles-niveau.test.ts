import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { modelesLocaux, rerankerLlama, sensLlama } from '../../src/infra/modeles/client-llama.ts';
import { piecesPourPlateforme } from '../../src/infra/modeles/catalogue.ts';
import { dossierServeurs } from '../../src/infra/modeles/dossier.ts';
import { dossierPiece } from '../../src/infra/modeles/installer.ts';
import { changerNiveau, FICHIER_NIVEAU, lireNiveau, niveauMachine } from '../../src/infra/modeles/niveau.ts';
import { arreterServeurs, cheminsModeles, lireEtatServeurs, lireLances, pidVivant } from '../../src/infra/modeles/serveurs.ts';
import type { EtatServeurs } from '../../src/infra/modeles/serveurs.ts';
import { dossierTemporaire } from '../aides/dossier-temporaire.ts';

const FAUX_LLAMA = join(import.meta.dirname, '../aides/faux-llama.mjs');
const PIECES = piecesPourPlateforme('darwin', 'arm64')!;
/** Surveillance du gardien toutes les 200 ms : un niveau changé est vu vite. */
const SURVEILLANCE_RAPIDE = { MNEMO_MODELES_SURVEILLANCE_MS: '200' };

type Banc = { racine: string; serveurs: string; env: NodeJS.ProcessEnv; gguf: { sens: string; reranker: string } };

const serveursOuverts: string[] = [];
afterEach(async () => {
	// jamais de processus laissé derrière : gardiens arrêtés, faux serveurs encore en chargement tués
	while (serveursOuverts.length > 0) {
		const serveurs = serveursOuverts.pop()!;
		if (typeof (await arreterServeurs(serveurs)) === 'object') {
			for (const l of await lireLances(serveurs)) {
				try {
					process.kill(l.pid, 'SIGKILL');
				} catch {
					/* déjà mort */
				}
			}
		}
	}
});

async function installerFaux(modeles: string, nom: 'sens' | 'reranker'): Promise<string> {
	const piece = PIECES.find((p) => p.nom === nom)!;
	const dossier = dossierPiece(modeles, piece);
	await mkdir(dossier, { recursive: true });
	await writeFile(join(dossier, '.empreinte'), `${piece.sha256}\n`);
	await writeFile(join(dossier, piece.fichier), '');
	return join(dossier, piece.fichier);
}

async function banc(options: { env?: Record<string, string> } = {}): Promise<Banc> {
	const racine = await dossierTemporaire();
	const modeles = await dossierTemporaire();
	await mkdir(join(racine, '.mnemo'), { recursive: true });
	const gguf = { sens: await installerFaux(modeles, 'sens'), reranker: await installerFaux(modeles, 'reranker') };
	const env: NodeJS.ProcessEnv = { ...process.env, MNEMO_MODELES: modeles, MNEMO_LLAMA_SERVEUR: FAUX_LLAMA, MNEMO_MODELES_INACTIVITE_MS: '60000', ...options.env };
	const serveurs = dossierServeurs(env, process.platform, homedir());
	serveursOuverts.push(serveurs);
	return { racine, serveurs, env, gguf };
}

/** Lancements de faux serveurs (une ligne par lancement, dans le dossier de chaque modèle). */
async function lancements(b: Banc): Promise<{ args: string[] }[]> {
	const lignes: { args: string[] }[] = [];
	for (const g of [b.gguf.sens, b.gguf.reranker]) {
		const f = join(g, '..', 'lancements.log');
		if (existsSync(f)) for (const l of (await readFile(f, 'utf8')).split('\n').filter(Boolean)) lignes.push(JSON.parse(l));
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

/** Démarre les modèles permis par le sens (gros budget) et rend l'état écrit par le gardien prêt. */
async function demarrer(b: Banc): Promise<EtatServeurs> {
	expect(await sensLlama(b.racine, { env: b.env }).vecteurs(['amorce'], { budgetMs: 15_000, demarrer: true })).not.toBeNull();
	await attendreQue(async () => (await lireEtatServeurs(b.serveurs))?.gardien.etat === 'pret');
	return (await lireEtatServeurs(b.serveurs))!;
}

describe('niveau des modèles de la machine', () => {
	it('absent ou illisible : complets ; changerNiveau l’écrit d’un coup, droits 0600', async () => {
		const b = await banc();
		expect(await lireNiveau(b.serveurs)).toBe('complets');
		expect(await niveauMachine(b.env)).toBe('complets');
		// un modèle retiré, rien en marche : l'arrêt est tenté et ne trouve rien
		expect(await changerNiveau(b.env, 'sens')).toEqual({ ancien: 'complets', niveau: 'sens', arret: 'rien' });
		expect(await niveauMachine(b.env)).toBe('sens');
		const fichier = join(b.serveurs, FICHIER_NIVEAU);
		expect(JSON.parse(await readFile(fichier, 'utf8'))).toEqual({ niveau: 'sens' });
		if (process.platform !== 'win32') expect((await stat(fichier)).mode & 0o777).toBe(0o600);
		for (const brut of ['{', '{"niveau":"aucun"}', 'null', '[]']) {
			await writeFile(fichier, brut);
			expect(await lireNiveau(b.serveurs)).toBe('complets');
		}
	});

	it('niveau « sens » : le gardien ne lance que le sens ; le reranker rend null sans rien lancer ni appeler', async () => {
		const b = await banc();
		await changerNiveau(b.env, 'sens');
		const etat = await demarrer(b);
		expect(etat.sens).toBeDefined();
		expect(etat.reranker).toBeUndefined();
		const lances = await lancements(b);
		expect(lances).toHaveLength(1);
		expect(lances[0]!.args).toContain('--embedding');
		expect(await rerankerLlama(b.racine, { env: b.env }).noter('q', ['a'], { budgetMs: 2000, demarrer: true })).toBeNull();
		await attendre(300);
		expect(await lancements(b)).toHaveLength(1);
		expect((await lireEtatServeurs(b.serveurs))!.gardien.pid).toBe(etat.gardien.pid);
	}, 30_000);

	it('niveau « coupes » : sens et reranker rendent null tout de suite, aucun gardien, demarrer() ne lance rien', async () => {
		const b = await banc();
		await changerNiveau(b.env, 'coupes');
		const debut = Date.now();
		expect(await sensLlama(b.racine, { env: b.env }).vecteurs(['a'], { budgetMs: 5000, demarrer: true })).toBeNull();
		expect(await rerankerLlama(b.racine, { env: b.env }).noter('q', ['a'], { budgetMs: 5000, demarrer: true })).toBeNull();
		await modelesLocaux(b.racine, { env: b.env }).demarrer();
		expect(Date.now() - debut).toBeLessThan(1000);
		await attendre(300);
		expect(await lancements(b)).toHaveLength(0);
		expect(existsSync(cheminsModeles(b.serveurs).etat)).toBe(false);
	});

	it('demarrer() au niveau « sens » : lance le sens seul', async () => {
		const b = await banc();
		await changerNiveau(b.env, 'sens');
		await modelesLocaux(b.racine, { env: b.env }).demarrer();
		await attendreQue(async () => (await lireEtatServeurs(b.serveurs))?.gardien.etat === 'pret');
		const etat = (await lireEtatServeurs(b.serveurs))!;
		expect(etat.sens).toBeDefined();
		expect(etat.reranker).toBeUndefined();
	}, 30_000);

	it('retirer un modèle arrête le gardien en marche ; le relancer ensuite ne lance que les modèles permis', async () => {
		const b = await banc();
		const etat = await demarrer(b);
		expect(etat.reranker).toBeDefined();
		const changement = await changerNiveau(b.env, 'sens');
		expect(changement).toMatchObject({ ancien: 'complets', niveau: 'sens', arret: 'arrete' });
		for (const pid of [etat.gardien.pid, etat.sens!.pid, etat.reranker!.pid]) expect(pidVivant(pid)).toBe(false);
		expect(existsSync(cheminsModeles(b.serveurs).etat)).toBe(false);
		const relance = await demarrer(b);
		expect(relance.gardien.pid).not.toBe(etat.gardien.pid);
		expect(relance.reranker).toBeUndefined();
	}, 30_000);

	it('ajouter un modèle ne lance rien au changement ; la surveillance arrête le gardien, le prochain usage lance tous les modèles permis', async () => {
		const b = await banc({ env: SURVEILLANCE_RAPIDE });
		// coupés, rien en marche : passer à « sens » ne lance rien
		await changerNiveau(b.env, 'coupes');
		expect(await changerNiveau(b.env, 'sens')).toEqual({ ancien: 'coupes', niveau: 'sens', arret: null });
		await attendre(300);
		expect(await lancements(b)).toHaveLength(0);
		// sens en marche : passer à « complets » ne lance rien et n'arrête rien sur le moment
		const etat = await demarrer(b);
		expect(await changerNiveau(b.env, 'complets')).toEqual({ ancien: 'sens', niveau: 'complets', arret: null });
		expect(pidVivant(etat.gardien.pid)).toBe(true);
		// à la surveillance suivante, le gardien s'arrête (le reranker, permis et installé, n'est pas servi), sans relance
		await attendreQue(() => !pidVivant(etat.gardien.pid) && !pidVivant(etat.sens!.pid));
		expect(await readFile(cheminsModeles(b.serveurs).journal, 'utf8')).toContain('arrêt (niveau changé)');
		expect(await lancements(b)).toHaveLength(1);
		// le prochain usage relance le gardien avec le sens et le reranker
		expect(await rerankerLlama(b.racine, { env: b.env }).noter('q', ['a'], { budgetMs: 15_000, demarrer: true })).not.toBeNull();
		const relance = (await lireEtatServeurs(b.serveurs))!;
		expect(relance.sens).toBeDefined();
		expect(relance.reranker).toBeDefined();
	}, 30_000);

	it('niveau élargi, gardien prêt sans le reranker : demarrer() l’arrête proprement et le relance avec tous les modèles permis', async () => {
		const b = await banc();
		await changerNiveau(b.env, 'sens');
		const etat = await demarrer(b);
		expect(etat.reranker).toBeUndefined();
		await changerNiveau(b.env, 'complets');
		// sans geste explicite (un hook, une recherche), le gardien prêt est laissé à sa surveillance
		expect(await rerankerLlama(b.racine, { env: b.env }).noter('q', ['a'], { budgetMs: 1000, demarrer: false })).toBeNull();
		expect((await lireEtatServeurs(b.serveurs))!.gardien.pid).toBe(etat.gardien.pid);
		await modelesLocaux(b.racine, { env: b.env }).demarrer();
		await attendreQue(async () => {
			const e = await lireEtatServeurs(b.serveurs);
			return e?.gardien.etat === 'pret' && e.sens !== undefined && e.reranker !== undefined;
		});
		const relance = (await lireEtatServeurs(b.serveurs))!;
		expect(relance.gardien.pid).not.toBe(etat.gardien.pid);
		// l'ancien gardien et son serveur sont arrêtés
		for (const pid of [etat.gardien.pid, etat.sens!.pid]) expect(pidVivant(pid)).toBe(false);
		expect(await readFile(cheminsModeles(b.serveurs).journal, 'utf8')).toContain('gardien prêt sans le reranker : remplacé');
		expect(await lancements(b)).toHaveLength(3);
	}, 30_000);

	it('niveau écrit pendant que le gardien est prêt (sans changerNiveau) : un modèle servi exclu l’arrête à la surveillance suivante', async () => {
		const b = await banc({ env: SURVEILLANCE_RAPIDE });
		const etat = await demarrer(b);
		expect(etat.reranker).toBeDefined();
		// comme un niveau écrit entre la lecture du gardien et sa publication : aucun arrêt demandé
		await writeFile(join(b.serveurs, FICHIER_NIVEAU), JSON.stringify({ niveau: 'sens' }));
		await attendreQue(() => !pidVivant(etat.gardien.pid) && !pidVivant(etat.reranker!.pid) && !pidVivant(etat.sens!.pid));
		expect(await readFile(cheminsModeles(b.serveurs).journal, 'utf8')).toContain('arrêt (niveau changé)');
		expect(existsSync(cheminsModeles(b.serveurs).etat)).toBe(false);
	}, 30_000);

	it('niveau inchangé : la surveillance laisse le gardien en marche', async () => {
		const b = await banc({ env: SURVEILLANCE_RAPIDE });
		await changerNiveau(b.env, 'sens');
		const etat = await demarrer(b);
		await attendre(1000);
		expect(pidVivant(etat.gardien.pid)).toBe(true);
		expect(await readFile(cheminsModeles(b.serveurs).journal, 'utf8')).not.toContain('niveau changé');
	}, 30_000);
});

describe('mnemo index au niveau « coupes »', () => {
	const MAIN = join(import.meta.dirname, '../../src/adaptateurs/cli/main.ts');
	const mnemo = (cwd: string, env: NodeJS.ProcessEnv, ...args: string[]) =>
		new Promise<{ code: number; out: string }>((resoudre) => {
			execFile(process.execPath, [MAIN, ...args], { cwd, env }, (erreur, out) => resoudre({ code: erreur ? (erreur.code as number) : 0, out }));
		});

	it('dit que le sens est coupé par le niveau, sans rien lancer', { timeout: 60_000 }, async () => {
		const b = await banc();
		await changerNiveau(b.env, 'coupes');
		expect((await mnemo(b.racine, b.env, 'init', '--sans-mcp')).code).toBe(0);
		await mkdir(join(b.racine, '_mnemo', 'projets'), { recursive: true });
		await writeFile(join(b.racine, '_mnemo', 'projets', 'alpha.md'), '# Alpha\n\nUn projet de tapirs.\n');
		const r = await mnemo(b.racine, b.env, 'index');
		expect(r.code).toBe(0);
		expect(r.out).toMatch(/\n0 vecteurs calculés \(bge-m3@[0-9a-f]{12}\)\n[1-9]\d* vecteurs restants : sens coupé par le niveau des modèles, recherche par les mots pour ceux-là\n$/u);
		expect(await lancements(b)).toHaveLength(0);
	});
});
