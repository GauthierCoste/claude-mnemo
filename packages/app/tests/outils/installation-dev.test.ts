// `pnpm installer-dev` (outils/installation-dev.ts) : HOME, dossier Mnemo et paquet factices, rien n'est lancé.
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { chmod, mkdir, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ErreurInstallation, identifiantPaquet, installerDev, MAIN, type OptionsInstallerDev, PAQUET, pathDuTerminal } from '../../outils/installation-dev.ts';
import { validerConfiguration } from '../../src/domaine/configuration.ts';
import { cheminConfiguration } from '../../src/infra/configuration-fichier.ts';

const dossiers: string[] = [];
afterEach(() => {
	for (const d of dossiers.splice(0)) rmSync(d, { recursive: true, force: true });
});

function dossierTemporaire(): string {
	const d = realpathSync(mkdtempSync(join(tmpdir(), 'mnemo-app-installer-dev-')));
	dossiers.push(d);
	return d;
}

/** Un dossier Mnemo factice (`_mnemo/SCHEMA.md`), avec un sous-dossier de projet. */
function dossierMnemo(): string {
	const racine = dossierTemporaire();
	mkdirSync(join(racine, '_mnemo'));
	writeFileSync(join(racine, '_mnemo', 'SCHEMA.md'), '# Schéma\n');
	mkdirSync(join(racine, 'projet'));
	return racine;
}

const plist = (identifiant: string) =>
	`<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0">\n<dict>\n\t<key>CFBundleIdentifier</key>\n\t<string>${identifiant}</string>\n</dict>\n</plist>\n`;

/** Un paquet factice : Info.plist, un exécutable, et un lien relatif comme ceux du framework d'Electron. */
async function paquetFactice(identifiant = 'local.mnemo.app'): Promise<string> {
	const paquet = join(dossierTemporaire(), 'dist', 'Mnemo.app');
	await mkdir(join(paquet, 'Contents', 'MacOS'), { recursive: true });
	await mkdir(join(paquet, 'Contents', 'Frameworks', 'Cadre', 'Versions', 'A'), { recursive: true });
	await writeFile(join(paquet, 'Contents', 'Info.plist'), plist(identifiant));
	await writeFile(join(paquet, 'Contents', 'MacOS', 'Mnemo'), 'binaire');
	await chmod(join(paquet, 'Contents', 'MacOS', 'Mnemo'), 0o755);
	await symlink('A', join(paquet, 'Contents', 'Frameworks', 'Cadre', 'Versions', 'Current'));
	return paquet;
}

const NODE = '/opt/exemple/node/bin/node';

/** Lance l'outil dans le processus ; sortie et erreur rendues. */
async function installer(args: string[], options: Partial<OptionsInstallerDev> & { home: string }): Promise<{ code: number; lignes: string[]; erreur: string }> {
	const lignes: string[] = [];
	try {
		await installerDev(args, { dossierCourant: options.home, env: { PATH: '/usr/bin' }, node: NODE, ...options, ecrire: (l) => lignes.push(l) });
		return { code: 0, lignes, erreur: '' };
	} catch (e) {
		if (!(e instanceof ErreurInstallation)) throw e;
		return { code: e.code, lignes, erreur: e.message };
	}
}

const lireConfiguration = (home: string): unknown => JSON.parse(readFileSync(cheminConfiguration(home), 'utf8'));

// `pnpm installer-dev` est un outil de développement de macOS : PATH à « : » et paquet Mnemo.app
describe.skipIf(process.platform === 'win32')('chemins et PATH', () => {
	it('le paquet est celui de construire-app ; le main.ts, celui du paquet mnemo', () => {
		expect(PAQUET.endsWith(join('app', 'dist', 'Mnemo.app'))).toBe(true);
		expect(existsSync(MAIN)).toBe(true);
		expect(MAIN.endsWith(join('packages', 'mnemo', 'src', 'adaptateurs', 'cli', 'main.ts'))).toBe(true);
	});

	it('PATH du terminal : sans ce que pnpm ajoute devant ; vide : celui par défaut', () => {
		const pnpm = ['/depot/app/node_modules/.bin', '/depot/node_modules/.bin', '/opt/pnpm/dist/node-gyp-bin'];
		expect(pathDuTerminal([...pnpm, '/opt/homebrew/bin', '/usr/bin'].join(':'))).toBe('/opt/homebrew/bin:/usr/bin');
		expect(pathDuTerminal('')).toBe('/usr/bin:/bin');
		expect(pathDuTerminal(undefined)).toBe('/usr/bin:/bin');
		expect(pathDuTerminal(pnpm.join(':'))).toBe('/usr/bin:/bin');
	});
});

describe.skipIf(process.platform !== 'darwin')('pnpm installer-dev (HOME et paquet factices, rien n’est lancé)', () => {
	it('installe ~/Applications/Mnemo.app (liens et droits gardés) et écrit config.json (0600) au format de l’app', async () => {
		const home = dossierTemporaire();
		const racine = dossierMnemo();
		const paquet = await paquetFactice();
		const r = await installer([racine], { home, paquet, env: { PATH: '/depot/node_modules/.bin:/opt/x/bin:/usr/bin' } });
		expect(r.code, r.erreur).toBe(0);
		const installe = join(home, 'Applications', 'Mnemo.app');
		expect(r.lignes[0]).toBe(`App installée : ${installe} (dossier ${racine}).`);
		expect(identifiantPaquet(installe)).toBe('local.mnemo.app');
		expect(lstatSync(join(installe, 'Contents', 'Frameworks', 'Cadre', 'Versions', 'Current')).isSymbolicLink()).toBe(true);
		expect(readlinkSync(join(installe, 'Contents', 'Frameworks', 'Cadre', 'Versions', 'Current'))).toBe('A');
		expect(statSync(join(installe, 'Contents', 'MacOS', 'Mnemo')).mode & 0o777).toBe(0o755);

		const chemin = join(home, 'Library', 'Application Support', 'Mnemo', 'config.json');
		expect(statSync(chemin).mode & 0o777).toBe(0o600);
		const configuration = lireConfiguration(home);
		expect(configuration).toEqual({ racine, node: NODE, main: MAIN, path: '/opt/x/bin:/usr/bin' });
		expect(validerConfiguration(configuration).ok).toBe(true);
		// l'app lance sa propre copie : la consigne de la reconstruire après une mise à jour des sources
		expect(r.lignes.join('\n')).toMatch(/relancez « pnpm construire-app » puis « pnpm installer-dev »/u);
		// aucun reste de la copie
		expect(readdirSync(join(home, 'Applications'))).toEqual(['Mnemo.app']);
	});

	it('sans dossier : celui d’où la commande est lancée, ou son dossier Mnemo parent ; aucun : refus, rien d’installé', async () => {
		const home = dossierTemporaire();
		const racine = dossierMnemo();
		const paquet = await paquetFactice();
		const r = await installer([], { home, paquet, dossierCourant: join(racine, 'projet') });
		expect(r.code, r.erreur).toBe(0);
		expect(lireConfiguration(home)).toMatchObject({ racine });

		const autre = dossierTemporaire();
		const refus = await installer([], { home: autre, paquet, dossierCourant: autre });
		expect(refus.code).toBe(1);
		expect(refus.erreur).toMatch(/Aucune mémoire Mnemo/u);
		expect(existsSync(join(autre, 'Applications'))).toBe(false);
	});

	it('MNEMO_PORT posé : repris en nombre ; invalide : refus (code 2), rien d’installé', async () => {
		const home = dossierTemporaire();
		const racine = dossierMnemo();
		const paquet = await paquetFactice();
		expect((await installer([racine], { home, paquet, env: { PATH: '/usr/bin', MNEMO_PORT: '4800' } })).code).toBe(0);
		const configuration = lireConfiguration(home);
		expect(configuration).toMatchObject({ port: 4800 });
		expect(validerConfiguration(configuration).ok).toBe(true);

		const autre = dossierTemporaire();
		const refus = await installer([racine], { home: autre, paquet, env: { PATH: '/usr/bin', MNEMO_PORT: 'abc' } });
		expect(refus.code).toBe(2);
		expect(refus.erreur).toMatch(/MNEMO_PORT invalide/u);
		expect(existsSync(join(autre, 'Applications'))).toBe(false);
	});

	it('remplace notre lanceur et une version précédente ; refuse une autre application du même nom', async () => {
		const home = dossierTemporaire();
		const racine = dossierMnemo();
		const paquet = await paquetFactice();
		const installe = join(home, 'Applications', 'Mnemo.app');
		await mkdir(join(installe, 'Contents'), { recursive: true });
		await writeFile(join(installe, 'Contents', 'Info.plist'), plist('local.mnemo.lanceur'));
		await writeFile(join(installe, 'Contents', 'vieux'), '');
		const lanceur = await installer([racine], { home, paquet });
		expect(lanceur.code, lanceur.erreur).toBe(0);
		expect(lanceur.lignes[0]).toMatch(/^App installée à la place du lanceur/u);
		expect(identifiantPaquet(installe)).toBe('local.mnemo.app');
		expect(existsSync(join(installe, 'Contents', 'vieux'))).toBe(false);

		const encore = await installer([racine], { home, paquet });
		expect(encore.lignes[0]).toMatch(/^App remplacée/u);

		await writeFile(join(installe, 'Contents', 'Info.plist'), plist('com.autre.mnemo'));
		const refus = await installer([racine], { home, paquet });
		expect(refus.code).toBe(1);
		expect(refus.erreur).toMatch(/ni par « pnpm installer-dev » ni par « mnemo lanceur »/u);
		expect(identifiantPaquet(installe)).toBe('com.autre.mnemo');
		const retrait = await installer(['--retirer'], { home });
		expect(retrait.code).toBe(1);
		expect(identifiantPaquet(installe)).toBe('com.autre.mnemo');
	});

	it('Mnemo.app en lien symbolique cassé : refusé et laissé en place', async () => {
		const home = dossierTemporaire();
		const racine = dossierMnemo();
		const paquet = await paquetFactice();
		const installe = join(home, 'Applications', 'Mnemo.app');
		await mkdir(join(home, 'Applications'));
		await symlink(join(home, 'nulle-part.app'), installe);
		const refus = await installer([racine], { home, paquet });
		expect(refus.code).toBe(1);
		expect(refus.erreur).toMatch(/ni par « pnpm installer-dev » ni par « mnemo lanceur »/u);
		expect(lstatSync(installe).isSymbolicLink()).toBe(true);
		expect(readdirSync(join(home, 'Applications'))).toEqual(['Mnemo.app']);
	});

	it('paquet non construit (ou qui n’est pas l’app) : le dit, avec « pnpm construire-app » ; rien d’écrit', async () => {
		const home = dossierTemporaire();
		const racine = dossierMnemo();
		for (const paquet of [join(home, 'absent', 'Mnemo.app'), await paquetFactice('com.autre.app')]) {
			const r = await installer([racine], { home, paquet });
			expect(r.code).toBe(1);
			expect(r.erreur).toMatch(/App non construite .*pnpm construire-app/u);
		}
		expect(existsSync(join(home, 'Applications'))).toBe(false);
		expect(existsSync(cheminConfiguration(home))).toBe(false);
	});

	it('--retirer : retire l’app et la configuration ; garde le reste du dossier et une configuration qui n’est pas la nôtre', async () => {
		const home = dossierTemporaire();
		const racine = dossierMnemo();
		expect((await installer([racine], { home, paquet: await paquetFactice() })).code).toBe(0);
		const preferences = join(home, 'Library', 'Application Support', 'Mnemo', 'preferences.json');
		await writeFile(preferences, '{}');
		const retrait = await installer(['--retirer'], { home });
		expect(retrait.code, retrait.erreur).toBe(0);
		expect(retrait.lignes).toEqual([`App retirée : ${join(home, 'Applications', 'Mnemo.app')}.`, `Configuration retirée : ${cheminConfiguration(home)}.`]);
		expect(existsSync(join(home, 'Applications', 'Mnemo.app'))).toBe(false);
		expect(existsSync(cheminConfiguration(home))).toBe(false);
		expect(existsSync(preferences)).toBe(true);
		expect((await installer(['--retirer'], { home })).lignes).toEqual([`Aucune app à retirer (${join(home, 'Applications', 'Mnemo.app')}).`]);

		// configuration écrite par l'assistant de l'app empaquetée (sans node ni main) : la nôtre aussi
		await writeFile(cheminConfiguration(home), JSON.stringify({ racine, path: '/usr/bin:/bin' }));
		expect((await installer(['--retirer'], { home })).lignes).toContain(`Configuration retirée : ${cheminConfiguration(home)}.`);

		await writeFile(cheminConfiguration(home), '{"autre": true}');
		const refus = await installer(['--retirer'], { home });
		expect(refus.code).toBe(1);
		expect(refus.erreur).toMatch(/n'a pas le format de la configuration de l'app/u);
		expect(existsSync(cheminConfiguration(home))).toBe(true);
	});

	it('le lanceur n’est pas retiré par « --retirer » ; option inconnue, deux dossiers, dossier avec --retirer : code 2', async () => {
		const home = dossierTemporaire();
		const installe = join(home, 'Applications', 'Mnemo.app');
		await mkdir(join(installe, 'Contents'), { recursive: true });
		await writeFile(join(installe, 'Contents', 'Info.plist'), plist('local.mnemo.lanceur'));
		const r = await installer(['--retirer'], { home });
		expect(r.code).toBe(1);
		expect(existsSync(installe)).toBe(true);
		expect((await installer(['--bidule'], { home })).code).toBe(2);
		expect((await installer(['/a', '/b'], { home })).code).toBe(2);
		expect((await installer(['/a', '--retirer'], { home })).code).toBe(2);
	});
});
