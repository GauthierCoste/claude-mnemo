import { existsSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { MessageServeur } from '@mnemo/contrat';
import { diffuserModeles } from '../../src/adaptateurs/http/diffusion-modeles.ts';
import { modelesLocaux } from '../../src/infra/modeles/client-llama.ts';
import { piecesPourPlateforme } from '../../src/infra/modeles/catalogue.ts';
import { dossierServeurs } from '../../src/infra/modeles/dossier.ts';
import { phaseDuGardien } from '../../src/infra/modeles/etat-modeles.ts';
import { dossierPiece } from '../../src/infra/modeles/installer.ts';
import { changerNiveau } from '../../src/infra/modeles/niveau.ts';
import { arreterServeurs, lireLances } from '../../src/infra/modeles/serveurs.ts';
import type { EtatServeurs } from '../../src/infra/modeles/serveurs.ts';
import { dossierTemporaire } from '../aides/dossier-temporaire.ts';

const FAUX_LLAMA = join(import.meta.dirname, '../aides/faux-llama.mjs');
/** Pièces de la plateforme qui exécute ; à défaut (plateforme sans pièces figées), celles de macOS arm64, imposées au client. */
const ICI = piecesPourPlateforme(process.platform, process.arch);
const PIECES = ICI ?? piecesPourPlateforme('darwin', 'arm64')!;
const PLATEFORME = ICI === null ? { plateforme: 'darwin' as const, arch: 'arm64' } : {};
const sha = (nom: 'sens' | 'reranker') => PIECES.find((p) => p.nom === nom)!.sha256;

const serveursOuverts: string[] = [];
const arrets: (() => void)[] = [];
afterEach(async () => {
	while (arrets.length > 0) arrets.pop()!();
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

async function installerFaux(modeles: string, nom: 'sens' | 'reranker'): Promise<void> {
	const piece = PIECES.find((p) => p.nom === nom)!;
	const dossier = dossierPiece(modeles, piece);
	await mkdir(dossier, { recursive: true });
	await writeFile(join(dossier, '.empreinte'), `${piece.sha256}\n`);
	await writeFile(join(dossier, piece.fichier), 'gguf');
}

/** Modèles installés (fichiers factices), moteur remplacé par le faux llama-server ; tout dans des dossiers temporaires. */
async function banc() {
	const racine = await dossierTemporaire();
	const modeles = await dossierTemporaire();
	await installerFaux(modeles, 'sens');
	await installerFaux(modeles, 'reranker');
	const env: NodeJS.ProcessEnv = {
		...process.env,
		MNEMO_MODELES: modeles,
		MNEMO_LLAMA_SERVEUR: FAUX_LLAMA,
		MNEMO_MODELES_INACTIVITE_MS: '60000',
		MNEMO_MODELES_SURVEILLANCE_MS: '200',
	};
	const serveurs = dossierServeurs(env, process.platform, homedir());
	serveursOuverts.push(serveurs);
	return { racine, serveurs, env, modeles: modelesLocaux(racine, { env, ...PLATEFORME }) };
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

/** Un fichier d'activité d'un appel de ce processus (vivant), comme `avecActivite` l'écrit. */
async function ecrireActivite(serveurs: string, n: number, avancement: { faits: number; total: number | null } | null): Promise<string> {
	await mkdir(join(serveurs, 'activite'), { recursive: true });
	const fichier = join(serveurs, 'activite', `${process.pid}-${n}.json`);
	const valeur = { operation: avancement === null ? 'recherche' : 'vectorisation', dossier: '/projets/alpha', session: null, depuisMs: 1000 + n, jusqueMs: Date.now() + 60_000, avancement };
	await writeFile(fichier, JSON.stringify(valeur));
	return fichier;
}

describe('modelesLocaux : état', () => {
	it('rien d’installé : « absent » partout, et demarrer ne lance rien', async () => {
		const racine = await dossierTemporaire();
		const vide = await dossierTemporaire();
		const env = { MNEMO_MODELES: join(vide, 'cache') };
		const modeles = modelesLocaux(racine, { env });
		expect(await modeles.etat()).toEqual({
			installes: false,
			niveau: 'complets',
			gardien: 'arrete',
			sens: 'absent',
			reranker: 'absent',
			pieces: { sens: null, reranker: null, moteur: null },
			activites: [],
		});
		await modeles.demarrer();
		// aucun gardien n'a été lancé : pas même le dossier des serveurs
		expect(existsSync(dossierServeurs(env, process.platform, homedir()))).toBe(false);
	});

	it('installés et arrêtés : pièces décrites ; le niveau exclut les modèles qu’il retire', async () => {
		const b = await banc();
		const etat = await b.modeles.etat();
		expect(etat).toMatchObject({ installes: true, niveau: 'complets', gardien: 'arrete', sens: 'arrete', reranker: 'arrete', activites: [] });
		expect(etat.pieces.sens).toEqual({ modele: 'bge-m3', editeur: 'BAAI', quantification: 'Q8_0', octets: 4, empreinte: sha('sens').slice(0, 8) });
		expect(etat.pieces.reranker).toMatchObject({ modele: 'bge-reranker-v2-m3', octets: 4, empreinte: sha('reranker').slice(0, 8) });
		await b.modeles.changerNiveau('sens');
		expect(await b.modeles.etat()).toMatchObject({ niveau: 'sens', sens: 'arrete', reranker: 'exclu' });
		await b.modeles.changerNiveau('coupes');
		expect(await b.modeles.etat()).toMatchObject({ niveau: 'coupes', sens: 'exclu', reranker: 'exclu' });
	});

	it('demarrer : prêts, vérifiés ; arreter : arrêtés, niveau inchangé', async () => {
		const b = await banc();
		await b.modeles.demarrer();
		await attendreQue(async () => {
			const e = await b.modeles.etat();
			return e.gardien === 'pret' && e.sens === 'pret' && e.reranker === 'pret';
		});
		await b.modeles.arreter();
		expect(await b.modeles.etat()).toMatchObject({ niveau: 'complets', gardien: 'arrete', sens: 'arrete', reranker: 'arrete' });
	}, 30_000);

	it('activités : les appels en cours, du plus ancien au plus récent, sans leur échéance', async () => {
		const b = await banc();
		await ecrireActivite(b.serveurs, 2, null);
		await ecrireActivite(b.serveurs, 1, { faits: 64, total: null });
		expect((await b.modeles.etat()).activites).toEqual([
			{ operation: 'vectorisation', session: null, dossier: '/projets/alpha', depuisMs: 1001, avancement: { faits: 64, total: null } },
			{ operation: 'recherche', session: null, dossier: '/projets/alpha', depuisMs: 1002, avancement: null },
		]);
	});
});

describe('phaseDuGardien', () => {
	const etat = (phase: EtatServeurs['gardien']['etat'], pid: number, ilYaMs: number, maintenant: number): EtatServeurs => ({
		gardien: { pid, depuis: new Date(maintenant - ilYaMs).toISOString(), etat: phase },
	});
	const MORT = 2 ** 22 + 12_345;
	it('aucun état ou gardien mort : arrêté ; échec récent (ou mort en plein démarrage récent) : échec ; démarrage bloqué : échec', () => {
		const t = Date.now();
		expect(phaseDuGardien(null, t)).toBe('arrete');
		expect(phaseDuGardien(etat('pret', process.pid, 1000, t), t)).toBe('pret');
		expect(phaseDuGardien(etat('pret', MORT, 1000, t), t)).toBe('arrete');
		expect(phaseDuGardien(etat('demarrage', process.pid, 1000, t), t)).toBe('demarrage');
		expect(phaseDuGardien(etat('demarrage', process.pid, 4 * 60_000, t), t)).toBe('echec');
		expect(phaseDuGardien(etat('demarrage', MORT, 1000, t), t)).toBe('echec');
		expect(phaseDuGardien(etat('demarrage', MORT, 2 * 60_000, t), t)).toBe('arrete');
		expect(phaseDuGardien(etat('echec', MORT, 1000, t), t)).toBe('echec');
		expect(phaseDuGardien(etat('echec', MORT, 2 * 60_000, t), t)).toBe('arrete');
	});
});

describe('modelesLocaux : surveillance et diffusion', () => {
	it('surveiller : crée les dossiers ; un niveau changé, un fichier d’activité écrit ou retiré, appellent le rappel', async () => {
		const b = await banc();
		let rappels = 0;
		arrets.push(b.modeles.surveiller(() => rappels++));
		await attendreQue(() => existsSync(join(b.serveurs, 'activite')), 2000);
		await attendre(100);
		rappels = 0;
		await changerNiveau(b.env, 'sens');
		await attendreQue(() => rappels > 0, 2000);
		rappels = 0;
		const fichier = await ecrireActivite(b.serveurs, 1, null);
		await attendreQue(() => rappels > 0, 2000);
		rappels = 0;
		await rm(fichier);
		await attendreQue(() => rappels > 0, 2000);
	});

	it('diffusion : un fichier d’activité ou un niveau changé pousse un message ; rien si rien ne change', async () => {
		const b = await banc();
		const recus: Extract<MessageServeur, { type: 'modeles' }>[] = [];
		// sondage lent : seule la surveillance des fichiers peut faire partir les messages à temps
		const diffusion = diffuserModeles({ modeles: b.modeles, diffuser: (m) => m.type === 'modeles' && recus.push(m), journal: () => {}, sondageMs: 60_000 });
		arrets.push(() => diffusion.fermer());
		await attendreQue(() => existsSync(join(b.serveurs, 'activite')), 2000);
		await attendre(200);
		diffusion.relire();
		await attendre(200);
		expect(recus).toEqual([]);
		const fichier = await ecrireActivite(b.serveurs, 7, { faits: 10, total: 100 });
		await attendreQue(() => recus.length === 1, 3000);
		expect(recus[0]!.modeles.activites).toMatchObject([{ operation: 'vectorisation', avancement: { faits: 10, total: 100 } }]);
		await rm(fichier);
		await attendreQue(() => recus.length === 2, 3000);
		expect(recus[1]!.modeles.activites).toEqual([]);
		await changerNiveau(b.env, 'coupes');
		await attendreQue(() => recus.length === 3, 3000);
		expect(recus[2]!.modeles).toMatchObject({ niveau: 'coupes', sens: 'exclu', reranker: 'exclu' });
		await attendre(300);
		expect(recus).toHaveLength(3);
	});
});
