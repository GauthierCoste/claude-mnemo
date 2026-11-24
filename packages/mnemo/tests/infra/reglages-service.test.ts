/** Réglages lus hors de l'application : arrêt des modèles pour inactivité, navigateur de « mnemo ouvrir » et du lanceur. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { commandeFenetre, navigateurInstalle } from '../../src/infra/navigateurs.ts';
import { REGLAGES_PAR_DEFAUT } from '../../src/domaine/reglages.ts';
import { inactiviteDuGardien } from '../../src/infra/modeles/gardien.ts';
import { ecrireReglagesDuDossier } from '../../src/infra/reglages-fichier.ts';
import { dossierTemporaire } from '../aides/dossier-temporaire.ts';

describe('modeles.inactiviteMinutes', () => {
	it('15 min par défaut ; le réglage le change ; MNEMO_MODELES_INACTIVITE_MS (tests) l’emporte', async () => {
		const racine = await dossierTemporaire();
		expect(inactiviteDuGardien(racine, {})).toBe(15 * 60_000);
		ecrireReglagesDuDossier(racine, { ...REGLAGES_PAR_DEFAUT, modeles: { inactiviteMinutes: 30 } });
		expect(inactiviteDuGardien(racine, {})).toBe(30 * 60_000);
		expect(inactiviteDuGardien(racine, { MNEMO_MODELES_INACTIVITE_MS: '500' })).toBe(500);
	});

	it('réglage invalide : le défaut, et l’avertissement va au journal', async () => {
		const racine = await dossierTemporaire();
		mkdirSync(join(racine, '.mnemo'));
		writeFileSync(join(racine, '.mnemo', 'reglages.json'), JSON.stringify({ modeles: { inactiviteMinutes: 0 } }));
		const avis: string[] = [];
		expect(inactiviteDuGardien(racine, {}, (m) => avis.push(m))).toBe(15 * 60_000);
		expect(avis).toEqual([expect.stringContaining('modeles.inactiviteMinutes')]);
	});
});

describe('service.navigateur', () => {
	const A = 'http://127.0.0.1:4747/';
	const installes = (...noms: string[]) => (chemin: string) => noms.some((n) => chemin === `/Applications/${n}.app`);
	const mac = (existe: (c: string) => boolean) => ({ plateforme: 'darwin' as const, home: '/h', env: {}, existe });

	it('auto : Chrome, sinon Edge, sinon le navigateur par défaut (comportement d’avant les réglages)', () => {
		expect(commandeFenetre('auto', A, mac(installes('Google Chrome', 'Microsoft Edge')))).toEqual({ commande: '/usr/bin/open', args: ['-na', 'Google Chrome', '--args', `--app=${A}`] });
		expect(commandeFenetre('auto', A, mac(installes('Microsoft Edge')))?.args[1]).toBe('Microsoft Edge');
		expect(commandeFenetre('auto', A, mac(installes('Brave Browser')))).toBeNull();
	});

	it('un navigateur choisi : le sien (Brave en fenêtre d’application, Arc en onglet), absent → par défaut', () => {
		const tous = installes('Google Chrome', 'Microsoft Edge', 'Brave Browser', 'Arc');
		expect(commandeFenetre('edge', A, mac(tous))?.args).toEqual(['-na', 'Microsoft Edge', '--args', `--app=${A}`]);
		expect(commandeFenetre('brave', A, mac(tous))?.args).toEqual(['-na', 'Brave Browser', '--args', `--app=${A}`]);
		expect(commandeFenetre('arc', A, mac(tous))?.args).toEqual(['-a', 'Arc', A]);
		expect(commandeFenetre('brave', A, mac(installes('Google Chrome')))).toBeNull();
		expect(commandeFenetre('defaut', A, mac(tous))).toBeNull();
		// installé dans ~/Applications
		expect(commandeFenetre('chrome', A, mac((c) => c === '/h/Applications/Google Chrome.app'))?.args[1]).toBe('Google Chrome');
	});

	it('Windows : cherché sous Program Files et %LOCALAPPDATA%, lancé directement en fenêtre d’application', () => {
		const env = { ProgramFiles: 'C:\\Program Files', 'ProgramFiles(x86)': 'C:\\Program Files (x86)', LOCALAPPDATA: 'C:\\Users\\ana\\AppData\\Local' };
		const win = (...presents: string[]) => ({ plateforme: 'win32' as const, home: 'C:\\Users\\ana', env, existe: (c: string) => presents.includes(c) });
		const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
		const chromeLocal = 'C:\\Users\\ana\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe';
		expect(commandeFenetre('auto', A, win(edge))).toEqual({ commande: edge, args: [`--app=${A}`] });
		expect(commandeFenetre('auto', A, win(edge, chromeLocal))).toEqual({ commande: chromeLocal, args: [`--app=${A}`] });
		expect(commandeFenetre('brave', A, win('C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe'))?.args).toEqual([`--app=${A}`]);
		expect(commandeFenetre('chrome', A, win(edge))).toBeNull();
		// variable absente : ce dossier n'est pas regardé (aucun chemin relatif)
		expect(commandeFenetre('edge', A, { ...win('Microsoft\\Edge\\Application\\msedge.exe'), env: {} })).toBeNull();
	});

	it('Linux : chemins connus, lancé directement ; Arc absent hors macOS → navigateur par défaut', () => {
		const linux = (...presents: string[]) => ({ plateforme: 'linux' as const, home: '/home/ana', env: {}, existe: (c: string) => presents.includes(c) });
		expect(commandeFenetre('auto', A, linux('/usr/bin/microsoft-edge'))).toEqual({ commande: '/usr/bin/microsoft-edge', args: [`--app=${A}`] });
		expect(commandeFenetre('chrome', A, linux('/usr/bin/google-chrome-stable'))?.commande).toBe('/usr/bin/google-chrome-stable');
		expect(commandeFenetre('arc', A, linux('/usr/bin/google-chrome'))).toBeNull();
		expect(commandeFenetre('defaut', A, linux('/usr/bin/google-chrome'))).toBeNull();
	});

	it('navigateurInstalle : le nom du navigateur qui ouvrira la fenêtre (message du lanceur), null pour le navigateur par défaut', () => {
		expect(navigateurInstalle('auto', mac(installes('Microsoft Edge')))?.nom).toBe('Microsoft Edge');
		expect(navigateurInstalle('brave', mac(installes('Brave Browser')))?.nom).toBe('Brave Browser');
		expect(navigateurInstalle('chrome', mac(installes('Microsoft Edge')))).toBeNull();
	});
});
