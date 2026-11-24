import { execFile, execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readlinkSync, realpathSync, statSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { lireService, processusVivant } from '../../src/infra/service-local.ts';
import { jusqua } from '../aides/service-faux.ts';
import { portDemande } from '../../src/adaptateurs/cli/adresse.ts';
import { REGLAGES_PAR_DEFAUT } from '../../src/domaine/reglages.ts';
import { ecrireReglagesDuDossier } from '../../src/infra/reglages-fichier.ts';
import { initialiser } from '../../src/application/initialiser.ts';
import { dependancesReelles } from '../../src/infra/systeme.ts';
import { dossierTemporaire } from '../aides/dossier-temporaire.ts';
import { versionMnemo } from '../../src/infra/version.ts';

const MAIN = resolve(import.meta.dirname, '../../src/adaptateurs/cli/main.ts');

/** `claude` introuvable, jamais de navigateur, HOME factice. */
const env = (home: string, plus: Record<string, string> = {}) => ({
	...process.env,
	HOME: home,
	MNEMO_CLAUDE: join(home, 'aucun-claude'),
	MNEMO_SANS_NAVIGATEUR: '1',
	MNEMO_SANS_MCP: '1',
	...plus,
});

function mnemo(cwd: string, home: string, args: string[], plus: Record<string, string> = {}): Promise<{ code: number; out: string; err: string }> {
	return new Promise((resoudre) => {
		execFile(process.execPath, [MAIN, ...args], { cwd, env: env(home, plus), timeout: 60_000 }, (erreur, out, err) => {
			resoudre({ code: erreur === null ? 0 : typeof erreur.code === 'number' ? erreur.code : 1, out, err });
		});
	});
}

async function dossierMnemo(): Promise<string> {
	const racine = await dossierTemporaire();
	const schema = await readFile(join(import.meta.dirname, '../../modeles/SCHEMA.md'), 'utf8');
	const dep = dependancesReelles(racine);
	try {
		await initialiser(dep, schema);
	} finally {
		dep.index.fermer();
	}
	return racine;
}

describe('mnemo jeton', () => {
	it('affiche l’adresse de première ouverture avec le jeton du dossier ; --renouveler en crée un autre', async () => {
		const racine = await dossierMnemo();
		const home = await dossierTemporaire();
		const lu = await mnemo(racine, home, ['jeton'], { MNEMO_PORT: '4800' });
		expect(lu.code, lu.err).toBe(0);
		const jeton = (await readFile(join(racine, '.mnemo', 'jeton'), 'utf8')).trim();
		expect(lu.out).toContain(`http://127.0.0.1:4800/#jeton=${jeton}`);
		// relu, pas recréé
		expect((await mnemo(racine, home, ['jeton'], { MNEMO_PORT: '4800' })).out).toContain(jeton);

		const neuf = await mnemo(racine, home, ['jeton', '--renouveler'], { MNEMO_PORT: '4800' });
		expect(neuf.code, neuf.err).toBe(0);
		const autre = (await readFile(join(racine, '.mnemo', 'jeton'), 'utf8')).trim();
		expect(autre).toMatch(/^[0-9a-f]{64}$/u);
		expect(autre).not.toBe(jeton);
		expect(neuf.out).toContain(`#jeton=${autre}`);
		expect(neuf.out).toMatch(/prochain démarrage/u);
		expect((await mnemo(racine, home, ['jeton', '--pirouette'])).code).toBe(2);
	});
});

describe('port fixe', () => {
	it('4747 par défaut ; MNEMO_PORT le remplace (0 : un port libre) ; invalide → erreur', () => {
		expect(REGLAGES_PAR_DEFAUT.service.port).toBe(4747);
		expect(portDemande({})).toBe(4747);
		expect(portDemande({ MNEMO_PORT: '' })).toBe(4747);
		expect(portDemande({ MNEMO_PORT: '4800' })).toBe(4800);
		expect(portDemande({ MNEMO_PORT: '0' })).toBe(0);
		for (const faux of ['-1', '65536', 'abc', '47 47']) expect(() => portDemande({ MNEMO_PORT: faux })).toThrow(/MNEMO_PORT invalide/u);
	});

	it('réglage service.port : remplace 4747 ; MNEMO_PORT le remplace à son tour', () => {
		expect(portDemande({}, 4800)).toBe(4800);
		expect(portDemande({ MNEMO_PORT: '' }, 4800)).toBe(4800);
		expect(portDemande({ MNEMO_PORT: '4900' }, 4800)).toBe(4900);
	});

	it('mnemo jeton sans service : l’adresse prend le port du réglage', async () => {
		const racine = await dossierMnemo();
		const home = await dossierTemporaire();
		ecrireReglagesDuDossier(racine, { ...REGLAGES_PAR_DEFAUT, service: { ...REGLAGES_PAR_DEFAUT.service, port: 4801 } });
		const r = await mnemo(racine, home, ['jeton'], { MNEMO_PORT: '' });
		expect(r.code).toBe(0);
		expect(r.out).toContain('http://127.0.0.1:4801/#jeton=');
	});

	it('port pris par un autre programme : message clair, code 1, aucun autre port essayé', async () => {
		const racine = await dossierMnemo();
		const home = await dossierTemporaire();
		const occupant = createServer();
		await new Promise<void>((r) => occupant.listen(0, '127.0.0.1', r));
		try {
			const { port } = occupant.address() as AddressInfo;
			const r = await mnemo(racine, home, [racine], { MNEMO_PORT: String(port) });
			expect(r.code).toBe(1);
			expect(r.err).toContain(`Le port ${port} est déjà pris`);
			expect(r.err).toContain('.mnemo/reglages.json');
			expect(r.err).not.toContain('Réglages ›');
			expect(r.err).toContain('MNEMO_PORT');
			expect(r.out).not.toMatch(/http:\/\/127\.0\.0\.1:\d+/u);
		} finally {
			occupant.close();
		}
	});
});

/** Services détachés démarrés par `mnemo ouvrir` : arrêtés après chaque test (pid lu dans service.json). */
const racinesOuvertes: string[] = [];
afterEach(async () => {
	for (const racine of racinesOuvertes.splice(0)) {
		const s = lireService(racine);
		if (s === null) continue;
		try {
			process.kill(s.pid, 'SIGTERM');
		} catch {
			continue;
		}
		if (!(await jusqua(() => !processusVivant(s.pid), 15_000))) process.kill(s.pid, 'SIGKILL');
	}
});

/** Une interface construite factice, avec les icônes du lanceur (PNG minimaux, signature seulement). */
async function interfaceAvecIcones(): Promise<string> {
	const dist = await dossierTemporaire();
	await mkdir(join(dist, 'icones'));
	for (const taille of [256, 512, 1024]) await writeFile(join(dist, 'icones', `icone-${taille}.png`), Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(String(taille))]));
	return dist;
}

const MAC = process.platform === 'darwin';

describe.skipIf(!MAC)('mnemo lanceur (HOME factice, rien n’est lancé)', () => {
	it('crée ~/Applications/Mnemo.app : Info.plist valide, exécutable qui ouvre ce dossier avec ce node et ce main.ts, icône .icns', async () => {
		const racine = await dossierMnemo();
		const home = await dossierTemporaire();
		const r = await mnemo(racine, home, ['lanceur'], { MNEMO_UI_DIST: await interfaceAvecIcones() });
		expect(r.code, r.err).toBe(0);
		const app = join(home, 'Applications', 'Mnemo.app');
		expect(r.out).toContain(app);
		// le chemin de node et de main.ts est affiché, avec la consigne de recréer le lanceur s'ils bougent
		expect(r.out).toContain(process.execPath);
		expect(r.out).toContain(MAIN);
		expect(r.out).toMatch(/relancez « mnemo lanceur »/u);

		const plist = readFileSync(join(app, 'Contents', 'Info.plist'), 'utf8');
		expect(plist).toMatch(/<key>CFBundleExecutable<\/key>\s*<string>mnemo-lanceur<\/string>/u);
		expect(plist).toMatch(/<key>CFBundleIdentifier<\/key>\s*<string>local\.mnemo\.lanceur<\/string>/u);
		expect(plist).toMatch(/<key>CFBundlePackageType<\/key>\s*<string>APPL<\/string>/u);
		expect(plist).toMatch(/<key>CFBundleIconFile<\/key>\s*<string>Mnemo<\/string>/u);
		expect(plist).toMatch(/<key>LSUIElement<\/key>\s*<true\/>/u);
		expect(plist).toContain(`<key>CFBundleShortVersionString</key>\n\t<string>${versionMnemo()}</string>`);
		// plutil vérifie la syntaxe sans rien lancer
		expect(execFileSync('plutil', ['-lint', join(app, 'Contents', 'Info.plist')], { encoding: 'utf8' })).toMatch(/OK/u);

		const executable = join(app, 'Contents', 'MacOS', 'mnemo-lanceur');
		expect(statSync(executable).mode & 0o111).not.toBe(0);
		const script = readFileSync(executable, 'utf8');
		// Node par un lien du paquet : la ligne #! ne tient pas un chemin à espace
		expect(script.split('\n')[0]).toBe(`#!${join(app, 'Contents', 'MacOS', 'node')}`);
		expect(readlinkSync(join(app, 'Contents', 'MacOS', 'node'))).toBe(process.execPath);
		// le dossier tel que le voit le processus (macOS : /var → /private/var)
		const reel = realpathSync(racine);
		for (const attendu of [JSON.stringify(MAIN), JSON.stringify(reel), JSON.stringify('ouvrir'), JSON.stringify(join(reel, '.mnemo', 'service.log'))]) expect(script).toContain(attendu);
		// aucun shell
		expect(script).not.toMatch(/\bsh\b|shell:\s*true/u);

		const icns = readFileSync(join(app, 'Contents', 'Resources', 'Mnemo.icns'));
		expect(icns.subarray(0, 4).toString('latin1')).toBe('icns');
		expect(icns.readUInt32BE(4)).toBe(icns.length);
		for (const type of ['ic08', 'ic09', 'ic10']) expect(icns.includes(Buffer.from(type, 'latin1'))).toBe(true);

		// rien n'a été démarré
		expect(existsSync(join(racine, '.mnemo', 'service.json'))).toBe(false);
	});

	it('--retirer le supprime ; un Mnemo.app qui n’est pas le nôtre n’est ni remplacé ni supprimé', async () => {
		const racine = await dossierMnemo();
		const home = await dossierTemporaire();
		const app = join(home, 'Applications', 'Mnemo.app');
		expect((await mnemo(racine, home, ['lanceur'])).code).toBe(0);
		// le message de première ouverture suit le réglage du navigateur
		ecrireReglagesDuDossier(racine, { ...REGLAGES_PAR_DEFAUT, service: { ...REGLAGES_PAR_DEFAUT.service, navigateur: 'defaut' } });
		// recréé par-dessus le nôtre : remplacé
		const encore = await mnemo(racine, home, ['lanceur']);
		expect(encore.code, encore.err).toBe(0);
		expect(encore.out).toMatch(/remplacé/u);
		expect(encore.out).toContain('ouvrez une fois dans votre navigateur par défaut');
		const retire = await mnemo(racine, home, ['lanceur', '--retirer']);
		expect(retire.code, retire.err).toBe(0);
		expect(existsSync(app)).toBe(false);
		expect((await mnemo(racine, home, ['lanceur', '--retirer'])).out).toMatch(/Aucun lanceur/u);

		await mkdir(join(app, 'Contents'), { recursive: true });
		await writeFile(join(app, 'Contents', 'Info.plist'), '<plist><dict><key>CFBundleIdentifier</key><string>com.autre.mnemo</string></dict></plist>');
		const refus = await mnemo(racine, home, ['lanceur']);
		expect(refus.code).toBe(1);
		expect(refus.err).toMatch(/pas été créé par « mnemo lanceur »/u);
		expect((await mnemo(racine, home, ['lanceur', '--retirer'])).code).toBe(1);
		expect(readFileSync(join(app, 'Contents', 'Info.plist'), 'utf8')).toContain('com.autre.mnemo');
		expect((await mnemo(racine, home, ['lanceur', '--bidule'])).code).toBe(2);
	});
});

describe('mnemo ouvrir', () => {
	it('service absent : le démarre détaché (journal .mnemo/service.log, 0600), puis donne l’adresse fixe ; déjà là : rien de plus', async () => {
		const racine = await dossierMnemo();
		racinesOuvertes.push(racine);
		const home = await dossierTemporaire();
		const r = await mnemo(home, home, ['ouvrir', racine]);
		expect(r.code, r.err).toBe(0);
		const s = lireService(racine);
		expect(s).not.toBeNull();
		expect(processusVivant(s!.pid)).toBe(true);
		expect(r.out).toContain(`http://127.0.0.1:${s!.port}/`);
		// l'adresse ouverte n'a jamais le jeton (il resterait dans la ligne de commande du navigateur)
		expect(r.out).not.toContain(s!.jeton);
		const journal = join(racine, '.mnemo', 'service.log');
		if (process.platform !== 'win32') expect(statSync(journal).mode & 0o777).toBe(0o600);
		expect(await jusqua(() => readFileSync(journal, 'utf8').includes('Ctrl-C'), 10_000)).toBe(true);
		// le journal n'a jamais le jeton
		expect(readFileSync(journal, 'utf8')).not.toContain(s!.jeton);

		const encore = await mnemo(home, home, ['ouvrir', racine]);
		expect(encore.code, encore.err).toBe(0);
		expect(lireService(racine)!.pid).toBe(s!.pid);
		// renouveler pendant que le service tourne : le message dit de redémarrer Mnemo avant d'ouvrir la nouvelle adresse
		const neuf = await mnemo(racine, home, ['jeton', '--renouveler']);
		expect(neuf.code, neuf.err).toBe(0);
		expect(neuf.out).toMatch(/refuse encore ce nouveau jeton/u);
		expect(neuf.out).toContain('« mnemo arreter » puis « mnemo ouvrir »');

		// un service détaché s'arrête par « mnemo arreter » (sans terminal, pas de Ctrl-C)
		const arret = await mnemo(home, home, ['arreter', racine]);
		expect(arret.code, arret.err).toBe(0);
		expect(processusVivant(s!.pid)).toBe(false);
		// par l'API, comme sous Windows où un signal tue sans arrêt propre
		expect(readFileSync(journal, 'utf8')).toMatch(/arrêt demandé/u);
		expect(lireService(racine)).toBeNull();
		expect((await mnemo(home, home, ['arreter', racine])).out).toMatch(/ne tourne pas/u);
	}, 60_000);

	it('le service ne démarre pas (port pris) : erreur lisible qui renvoie au journal', async () => {
		const racine = await dossierMnemo();
		racinesOuvertes.push(racine);
		const home = await dossierTemporaire();
		const occupant = createServer();
		await new Promise<void>((r) => occupant.listen(0, '127.0.0.1', r));
		try {
			const { port } = occupant.address() as AddressInfo;
			const r = await mnemo(home, home, ['ouvrir', racine], { MNEMO_PORT: String(port) });
			expect(r.code).toBe(1);
			expect(r.err).toMatch(/service\.log/u);
			expect(r.err).toContain(`Le port ${port} est déjà pris`);
		} finally {
			occupant.close();
		}
	}, 60_000);
});
