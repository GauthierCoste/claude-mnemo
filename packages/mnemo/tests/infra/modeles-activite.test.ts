import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, stat, utimes, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { avecActivite, dossierActivite, lireActivites, REPRISE_MS } from '../../src/infra/modeles/activite.ts';
import type { DescriptionActivite } from '../../src/infra/modeles/activite.ts';
import { piecesPourPlateforme } from '../../src/infra/modeles/catalogue.ts';
import { rerankerLlama, sensLlama } from '../../src/infra/modeles/client-llama.ts';
import { dossierServeurs } from '../../src/infra/modeles/dossier.ts';
import { dossierPiece } from '../../src/infra/modeles/installer.ts';
import { changerNiveau } from '../../src/infra/modeles/niveau.ts';
import { piecesInstallees } from '../../src/infra/modeles/pieces-installees.ts';
import { arreterServeurs, lireEtatServeurs, lireLances } from '../../src/infra/modeles/serveurs.ts';
import { dossierTemporaire } from '../aides/dossier-temporaire.ts';

const FAUX_LLAMA = join(import.meta.dirname, '../aides/faux-llama.mjs');
const PIECES = piecesPourPlateforme('darwin', 'arm64')!;
const attendre = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function attendreQue(condition: () => Promise<boolean> | boolean, delaiMs = 10_000): Promise<void> {
	const fin = Date.now() + delaiMs;
	while (Date.now() < fin) {
		if (await condition()) return;
		await attendre(20);
	}
	throw new Error('condition jamais remplie');
}

/** Fichiers d'activité présents, et leur contenu. */
async function fichiers(serveurs: string): Promise<{ nom: string; contenu: Record<string, unknown> }[]> {
	const ici = dossierActivite(serveurs);
	if (!existsSync(ici)) return [];
	const noms = (await readdir(ici)).filter((n) => n.endsWith('.json'));
	return Promise.all(noms.map(async (nom) => ({ nom, contenu: JSON.parse(await readFile(join(ici, nom), 'utf8')) as Record<string, unknown> })));
}

const RECHERCHE: DescriptionActivite = { operation: 'recherche', dossier: '/racine', session: 's1', avancement: null };

describe('fichiers d’activité', () => {
	it('écrit autour de l’action (0600, dossier 0700, sans texte), retiré à la fin, même en échec', async () => {
		const serveurs = await dossierTemporaire();
		let pendant: Awaited<ReturnType<typeof fichiers>> = [];
		let droits: number[] = [];
		const resultat = await avecActivite(serveurs, RECHERCHE, async () => {
			await attendreQue(async () => (await fichiers(serveurs)).length === 1);
			pendant = await fichiers(serveurs);
			droits = [(await stat(dossierActivite(serveurs))).mode & 0o777, (await stat(join(dossierActivite(serveurs), pendant[0]!.nom))).mode & 0o777];
			return 42;
		});
		expect(resultat).toBe(42);
		expect(pendant).toHaveLength(1);
		expect(pendant[0]!.nom).toMatch(new RegExp(`^${process.pid}-\\d+\\.json$`, 'u'));
		const { depuisMs, ...reste } = pendant[0]!.contenu;
		expect(reste).toEqual({ operation: 'recherche', dossier: '/racine', session: 's1', avancement: null });
		expect(typeof depuisMs).toBe('number');
		if (process.platform !== 'win32') expect(droits).toEqual([0o700, 0o600]);
		expect(await fichiers(serveurs)).toEqual([]);
		// en échec : l'erreur passe, le fichier est retiré
		await expect(
			avecActivite(serveurs, RECHERCHE, async () => {
				await attendreQue(async () => (await fichiers(serveurs)).length === 1);
				throw new Error('panne');
			}),
		).rejects.toThrow('panne');
		expect(await fichiers(serveurs)).toEqual([]);
		expect((await readdir(dossierActivite(serveurs))).filter((n) => n.includes('.tmp-'))).toEqual([]);
	});

	it('vectorisation : un seul fichier pour la passe, avancement réécrit au plus une fois par seconde, retiré après la reprise', async () => {
		const serveurs = await dossierTemporaire();
		const lot = (faits: number) =>
			avecActivite(serveurs, { operation: 'vectorisation', dossier: '/racine', session: null, avancement: { faits, total: 640 } }, async () => {
				await attendre(20);
			});
		for (let faits = 0; faits < 320; faits += 64) await lot(faits);
		const premiers = await fichiers(serveurs);
		expect(premiers).toHaveLength(1);
		// lots rapides : seul le premier avancement est écrit
		expect(premiers[0]!.contenu['avancement']).toEqual({ faits: 0, total: 640 });
		await attendre(REPRISE_MS - 300);
		await lot(320);
		await attendre(400);
		await lot(384);
		const apres = await fichiers(serveurs);
		// même fichier (la passe n'a pas cessé), avancement d'au plus un lot de retard, une seconde après la première écriture
		expect(apres.map((f) => f.nom)).toEqual([premiers[0]!.nom]);
		expect(apres[0]!.contenu['avancement']).toEqual({ faits: 384, total: 640 });
		expect(apres[0]!.contenu['depuisMs']).toBe(premiers[0]!.contenu['depuisMs']);
		await attendreQue(async () => (await fichiers(serveurs)).length === 0, REPRISE_MS + 1000);
	});

	it('lecture : triées par début ; pid mort ignoré et retiré ; illisible ou trop vieux (pid vivant) ignoré sans être retiré', async () => {
		const serveurs = await dossierTemporaire();
		const ici = dossierActivite(serveurs);
		await mkdir(ici, { recursive: true });
		const activite = (depuisMs: number, operation = 'recherche') => JSON.stringify({ operation, dossier: '/r', session: null, depuisMs, avancement: null });
		await writeFile(join(ici, `${process.pid}-901.json`), activite(2000, 'injection'));
		await writeFile(join(ici, `${process.pid}-902.json`), activite(1000));
		await writeFile(join(ici, `${process.pid}-903.json`), '{');
		await writeFile(join(ici, `${process.pid}-904.json`), activite(500, 'autre'));
		await writeFile(join(ici, `${process.pid}-905.json`), activite(100));
		const vieux = new Date(Date.now() - 11 * 60_000);
		await utimes(join(ici, `${process.pid}-905.json`), vieux, vieux);
		// pid mort : un processus fini
		const mort = 2 ** 22 + 12_345;
		await writeFile(join(ici, `${mort}-1.json`), activite(10));
		await writeFile(join(ici, `${mort}-2.json.tmp-abc`), activite(10));
		expect(await lireActivites(serveurs)).toEqual([
			{ operation: 'recherche', dossier: '/r', session: null, depuisMs: 1000, avancement: null },
			{ operation: 'injection', dossier: '/r', session: null, depuisMs: 2000, avancement: null },
		]);
		expect((await readdir(ici)).sort()).toEqual([`${process.pid}-901.json`, `${process.pid}-902.json`, `${process.pid}-903.json`, `${process.pid}-904.json`, `${process.pid}-905.json`]);
		expect(await lireActivites(await dossierTemporaire())).toEqual([]);
	});
});

type Banc = { racine: string; serveurs: string; env: NodeJS.ProcessEnv };
const serveursOuverts: string[] = [];
afterEach(async () => {
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

/** Dossier de modèles factice : sens et reranker « installés » (fichiers vides et réglages du faux serveur), moteur absent. */
async function installerFaux(modeles: string, reglages: Record<string, unknown> = {}): Promise<void> {
	for (const piece of PIECES.filter((p) => p.nom !== 'moteur')) {
		const dossier = dossierPiece(modeles, piece);
		await mkdir(dossier, { recursive: true });
		await writeFile(join(dossier, '.empreinte'), `${piece.sha256}\n`);
		await writeFile(join(dossier, piece.fichier), piece.nom === 'sens' ? 'x'.repeat(1234) : '');
		await writeFile(join(dossier, `${piece.fichier}.faux.json`), JSON.stringify(reglages));
	}
}

async function banc(reglages: Record<string, unknown> = {}): Promise<Banc> {
	const racine = await dossierTemporaire();
	const modeles = await dossierTemporaire();
	await mkdir(join(racine, '.mnemo'), { recursive: true });
	await installerFaux(modeles, reglages);
	const env: NodeJS.ProcessEnv = { ...process.env, MNEMO_MODELES: modeles, MNEMO_LLAMA_SERVEUR: FAUX_LLAMA, MNEMO_MODELES_INACTIVITE_MS: '60000' };
	const serveurs = dossierServeurs(env, process.platform, homedir());
	serveursOuverts.push(serveurs);
	return { racine, serveurs, env };
}

describe('activité des appels aux modèles', () => {
	it('un appel au serveur : fichier pendant l’appel (opération déduite, racine, sans session), retiré après ; en échec aussi', async () => {
		const b = await banc({ delaiMs: 400 });
		// premier appel : démarre le gardien ; l'opération (deux textes, sans activité) est une vectorisation
		const appel = sensLlama(b.racine, { env: b.env }).vecteurs(['a', 'b'], { budgetMs: 15_000, demarrer: true });
		await attendreQue(async () => (await fichiers(b.serveurs)).length === 1, 15_000);
		const [pendant] = await fichiers(b.serveurs);
		expect(pendant!.contenu).toMatchObject({ operation: 'vectorisation', dossier: b.racine, session: null, avancement: null });
		expect(JSON.stringify(pendant!.contenu)).not.toMatch(/"a"|"b"/u);
		expect(await appel).toHaveLength(2);
		expect(await fichiers(b.serveurs)).toEqual([]);
		// activité nommée par l'appelant : reprise telle quelle
		const reranker = rerankerLlama(b.racine, { env: b.env }).noter('question secrète', ['texte'], { budgetMs: 5000, demarrer: true, activite: { operation: 'injection', session: 's9' } });
		await attendreQue(async () => (await fichiers(b.serveurs)).length === 1);
		const [noter] = await fichiers(b.serveurs);
		expect(noter!.contenu).toMatchObject({ operation: 'injection', session: 's9' });
		expect(JSON.stringify(noter!.contenu)).not.toContain('secrète');
		expect(await reranker).toHaveLength(1);
		expect(await fichiers(b.serveurs)).toEqual([]);
	}, 30_000);

	it('appel en échec (HTTP 500) : null, et le fichier est retiré', async () => {
		const b = await banc({ defaut: '500', delaiMs: 200 });
		const appel = sensLlama(b.racine, { env: b.env }).vecteurs(['a'], { budgetMs: 15_000, demarrer: true });
		await attendreQue(async () => (await fichiers(b.serveurs)).length === 1, 15_000);
		expect((await fichiers(b.serveurs))[0]!.contenu['operation']).toBe('recherche');
		expect(await appel).toBeNull();
		expect(await fichiers(b.serveurs)).toEqual([]);
	}, 30_000);

	it('modèle exclu par le niveau, ou serveur pas prêt sans démarrer : rien d’écrit', async () => {
		const b = await banc({ demarrageMs: 1000 });
		await changerNiveau(b.env, 'sens');
		expect(await rerankerLlama(b.racine, { env: b.env }).noter('q', ['a'], { budgetMs: 2000, demarrer: true })).toBeNull();
		expect(existsSync(dossierActivite(b.serveurs))).toBe(false);
		// hook : le gardien est lancé sans être attendu, l'appel rend null sans toucher de serveur
		expect(await sensLlama(b.racine, { env: b.env }).vecteurs(['a'], { budgetMs: 2000, demarrer: false })).toBeNull();
		expect(existsSync(dossierActivite(b.serveurs))).toBe(false);
		await attendreQue(async () => (await lireEtatServeurs(b.serveurs))?.gardien.etat === 'pret', 15_000);
	}, 30_000);
});

describe('pièces installées', () => {
	it('modèles du catalogue avec taille du fichier et empreinte courte ; moteur absent : null', async () => {
		const modeles = await dossierTemporaire();
		expect(await piecesInstallees(modeles, 'darwin', 'arm64')).toEqual({ sens: null, reranker: null, moteur: null });
		await installerFaux(modeles);
		expect(await piecesInstallees(modeles, 'darwin', 'arm64')).toEqual({
			sens: { modele: 'bge-m3', editeur: 'BAAI', quantification: 'Q8_0', octets: 1234, empreinte: 'aa473d51' },
			reranker: { modele: 'bge-reranker-v2-m3', editeur: 'BAAI', quantification: 'Q8_0', octets: 0, empreinte: 'a43c7c9b' },
			moteur: null,
		});
		// moteur installé : version et plateforme lisible
		const moteur = PIECES.find((p) => p.nom === 'moteur')!;
		const ici = dossierPiece(modeles, moteur);
		await mkdir(ici, { recursive: true });
		await writeFile(join(ici, '.empreinte'), `${moteur.sha256}\n`);
		await writeFile(join(ici, moteur.fichier), '');
		expect((await piecesInstallees(modeles, 'darwin', 'arm64')).moteur).toEqual({ version: 'b11671', plateforme: 'macOS arm64' });
		// plateforme sans pièce figée
		expect(await piecesInstallees(modeles, 'freebsd', 'x64')).toEqual({ sens: null, reranker: null, moteur: null });
	});
});
