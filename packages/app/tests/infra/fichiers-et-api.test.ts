// Configuration (`config.json` sous un HOME temporaire, jamais le vrai), `service.json`, et les deux routes de l'API contre un
// serveur HTTP local (jeton, aucun `Origin`, suite de la demande d'arrêt).
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { ROUTES } from '@mnemo/contrat';
import { afterEach, describe, expect, it } from 'vitest';
import { demanderArret, requeteLocale, santeService, suiteDeLaDemande } from '../../src/infra/api-service.ts';
import { cheminConfiguration, lireConfiguration } from '../../src/infra/configuration-fichier.ts';
import { environnementOuvrir } from '../../src/infra/demarrage.ts';
import { dossierApp } from '../../src/infra/dossiers.ts';
import { cheminsInstallation } from '../../src/infra/installation-fichiers.ts';
import { cheminServiceJson, lireServiceJson, processusVivant } from '../../src/infra/service-local.ts';

const JETON = 'c'.repeat(64);
const dossiers: string[] = [];
const nettoyages: (() => void)[] = [];
afterEach(() => {
	for (const f of nettoyages.splice(0)) f();
	for (const d of dossiers.splice(0)) rmSync(d, { recursive: true, force: true });
});
const temporaire = () => {
	const d = realpathSync(mkdtempSync(join(tmpdir(), 'mnemo-app-infra-')));
	dossiers.push(d);
	return d;
};

describe('dossiers selon la plateforme', () => {
	it('dossier de l’app : Library/Application Support sous macOS, %APPDATA%\\Mnemo sous Windows (APPDATA de travail possible)', () => {
		expect(dossierApp('/maison/exemple', 'darwin', {})).toBe('/maison/exemple/Library/Application Support/Mnemo');
		expect(dossierApp('D:\\Profils\\exemple', 'win32', { APPDATA: 'D:\\essai\\Roaming' })).toBe('D:\\essai\\Roaming\\Mnemo');
		expect(dossierApp('D:\\Profils\\exemple', 'win32', {})).toBe('D:\\Profils\\exemple\\AppData\\Roaming\\Mnemo');
	});

	it('configuration de l’app Claude : même règle que le service', () => {
		expect(cheminsInstallation('/maison/exemple', 'darwin', {}).appClaude).toBe('/maison/exemple/Library/Application Support/Claude/claude_desktop_config.json');
		expect(cheminsInstallation('D:\\Profils\\exemple', 'win32', { APPDATA: 'D:\\Profils\\exemple\\AppData\\Roaming' }).appClaude).toBe('D:\\Profils\\exemple\\AppData\\Roaming\\Claude\\claude_desktop_config.json');
	});
});

describe('configuration', () => {
	it('chemin sous Library/Application Support/Mnemo du HOME donné ; absente, non JSON, invalide : erreurs qui nomment le fichier', async () => {
		const home = temporaire();
		const chemin = cheminConfiguration(home);
		expect(chemin).toBe(join(home, 'Library', 'Application Support', 'Mnemo', 'config.json'));
		const absente = await lireConfiguration(home);
		expect(absente).toEqual({ ok: false, erreurs: [`Configuration absente : ${chemin} (l’assistant ou « pnpm installer-dev » l’écrit).`] });
		mkdirSync(dirname(chemin), { recursive: true });
		writeFileSync(chemin, '{ pas du JSON');
		expect(await lireConfiguration(home)).toEqual({ ok: false, erreurs: [`Configuration invalide : ${chemin} n’est pas du JSON.`] });
		writeFileSync(chemin, JSON.stringify({ racine: 'relatif', node: '/n', main: '/m', path: '/bin' }));
		const invalide = await lireConfiguration(home);
		expect(invalide.ok).toBe(false);
		if (!invalide.ok) expect(invalide.erreurs).toEqual([`${chemin} : « racine » doit être un chemin absolu : relatif`]);
	});

	it('valide : lue telle quelle, port compris', async () => {
		const home = temporaire();
		const chemin = cheminConfiguration(home);
		mkdirSync(dirname(chemin), { recursive: true });
		const configuration = { racine: '/r', node: '/n', main: '/m', path: '/usr/bin:/bin', port: 0 };
		writeFileSync(chemin, JSON.stringify(configuration), { mode: 0o600 });
		expect(await lireConfiguration(home)).toEqual({ ok: true, configuration });
	});

	it('environnement de `ouvrir` : PATH de la configuration, sans navigateur, MNEMO_PORT seulement s’il est fixé', () => {
		const base = { HOME: '/h', PATH: '/autre', MNEMO_PORT: '7' };
		expect(environnementOuvrir({ racine: '/r', node: '/n', main: '/m', path: '/bin' }, base)).toEqual({ HOME: '/h', PATH: '/bin', MNEMO_PORT: '7', MNEMO_SANS_NAVIGATEUR: '1' });
		expect(environnementOuvrir({ racine: '/r', node: '/n', main: '/m', path: '/bin', port: 4321 }, base)).toMatchObject({ MNEMO_PORT: '4321' });
		// Windows : la clé `Path` du système est remplacée, jamais doublée d'une clé `PATH`
		expect(environnementOuvrir({ racine: 'C:\\r', node: 'C:\\n', main: 'C:\\m', path: 'C:\\Git\\cmd' }, { Path: 'C:\\Windows', USERPROFILE: 'C:\\h' }, 'win32')).toEqual({ Path: 'C:\\Git\\cmd', USERPROFILE: 'C:\\h', MNEMO_SANS_NAVIGATEUR: '1' });
	});
});

describe('service.json', () => {
	it('lu s’il est complet et valide ; sinon null', () => {
		const racine = temporaire();
		expect(lireServiceJson(racine)).toBeNull();
		mkdirSync(dirname(cheminServiceJson(racine)), { recursive: true });
		const s = { pid: 12, port: 4000, jeton: JETON, demarre: 5 };
		writeFileSync(cheminServiceJson(racine), JSON.stringify(s));
		chmodSync(cheminServiceJson(racine), 0o600);
		expect(lireServiceJson(racine)).toEqual(s);
		for (const faux of [{ ...s, jeton: 'court' }, { ...s, port: 0 }, { ...s, pid: 1.5 }, { pid: 12, port: 4000, jeton: JETON }]) {
			writeFileSync(cheminServiceJson(racine), JSON.stringify(faux));
			expect(lireServiceJson(racine)).toBeNull();
		}
	});

	it('processus vivant : celui-ci oui, un pid inexistant non', () => {
		expect(processusVivant(process.pid)).toBe(true);
		expect(processusVivant(2 ** 30)).toBe(false);
	});
});

describe('API du service', () => {
	async function serveur(repondre: (methode: string, chemin: string) => number | null): Promise<{ port: number; requetes: { methode: string; chemin: string; entetes: IncomingHttpHeaders; corps: string }[] }> {
		const requetes: { methode: string; chemin: string; entetes: IncomingHttpHeaders; corps: string }[] = [];
		const http = createServer((req, res) => {
			let corps = '';
			req.on('data', (m: Buffer) => (corps += m.toString('utf8')));
			req.on('end', () => {
				requetes.push({ methode: req.method!, chemin: req.url!, entetes: req.headers, corps });
				const statut = repondre(req.method!, req.url!);
				if (statut === null) return; // ne répond jamais
				res.writeHead(statut, { 'Content-Type': 'application/json' }).end('{}');
			});
		});
		await new Promise<void>((r) => http.listen(0, '127.0.0.1', () => r()));
		nettoyages.push(() => {
			http.closeAllConnections();
			http.close();
		});
		return { port: (http.address() as AddressInfo).port, requetes };
	}

	it('santé : jeton en Bearer, aucun Origin ; 200 ok, 401 refusé, autre ou rien : absent', async () => {
		let statut = 200;
		const { port, requetes } = await serveur(() => statut);
		expect(await santeService({ port, jeton: JETON })).toBe('ok');
		expect(requetes[0]).toMatchObject({ methode: 'GET', chemin: ROUTES.sante });
		expect(requetes[0]!.entetes.authorization).toBe(`Bearer ${JETON}`);
		expect(requetes[0]!.entetes.origin).toBeUndefined();
		expect(requetes[0]!.entetes.host).toBe(`127.0.0.1:${port}`);
		statut = 401;
		expect(await santeService({ port, jeton: JETON })).toBe('refuse');
		statut = 500;
		expect(await santeService({ port, jeton: JETON })).toBe('absent');
		expect(await requeteLocale(port, 'GET', ROUTES.sante, JETON, 1000)).toEqual({ statut: 500 });
	});

	it('arrêt : POST {} ; 202 accepté, 404 ou connexion refusée : signal, sans réponse : attendre, autre : refus', async () => {
		const { port, requetes } = await serveur((_m, chemin) => (chemin === ROUTES.arret ? 202 : null));
		expect(await demanderArret({ port, jeton: JETON })).toBe('accepte');
		expect(requetes[0]).toMatchObject({ methode: 'POST', chemin: ROUTES.arret, corps: '{}' });
		expect(requetes[0]!.entetes.origin).toBeUndefined();
		expect(await requeteLocale(port, 'GET', '/muet', JETON, 50)).toEqual({ echec: 'delai' });
		expect(suiteDeLaDemande({ statut: 404 })).toBe('signal');
		expect(suiteDeLaDemande({ echec: 'refusee' })).toBe('signal');
		expect(suiteDeLaDemande({ echec: 'delai' })).toBe('attendre');
		expect(suiteDeLaDemande({ statut: 500 })).toEqual({ refus: 'Le service a refusé l’arrêt (statut 500).' });
	});
});
