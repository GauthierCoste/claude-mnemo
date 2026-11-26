/** `mnemo init` guidé : questions sur un dossier vierge, `--oui` sans aucune question, rien téléchargé ni installé sans accord. */
import { execFile } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { PassThrough, Readable, Writable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cheminSaisi, commandeInit } from '../../src/adaptateurs/cli/init.ts';
import { dossierTemporaire } from '../aides/dossier-temporaire.ts';
import { ENV_TEST } from '../aides/env-test.ts';

const MAIN = join(import.meta.dirname, '../../src/adaptateurs/cli/main.ts');

/** Sortie capturée. */
function capture(): { flux: Writable; texte(): string } {
	let texte = '';
	const flux = new Writable({
		write(morceau, _e, fini) {
			texte += String(morceau);
			fini();
		},
	});
	return { flux, texte: () => texte };
}

/** Entrée qui fait échouer le test si on la lit. */
function entreeInterdite(): Readable {
	return new Readable({
		read() {
			this.destroy(new Error('aucune question ne devait être posée'));
		},
	});
}

// les tests qui attendent la déclaration MCP la remplacent par un faux (`actions.declarerMcp`) : jamais le vrai `claude`
afterEach(() => {
	vi.unstubAllEnvs();
	vi.restoreAllMocks();
});
const avecMcpFactice = () => vi.stubEnv('MNEMO_SANS_MCP', '');

const actions = () => ({
	installerModeles: vi.fn(async () => {}),
	creerLanceur: vi.fn(async () => {}),
	installerCommande: vi.fn(async () => {}),
	commandeAJour: vi.fn(() => false),
	declarerMcp: vi.fn(async () => 'declare' as const),
});

async function dossierAvecSousDossiers(): Promise<string> {
	const racine = await dossierTemporaire();
	for (const d of ['Projets/A/.git', 'Projets/B', 'Notes']) await mkdir(join(racine, d), { recursive: true });
	await mkdir(join(racine, 'Projets/B/Makefile-dossier'), { recursive: true });
	return racine;
}

describe('mnemo init --oui', () => {
	it('processus réel : aucune question, mémoire créée, ni modèle, ni lanceur, ni téléchargement', async () => {
		const racine = await dossierTemporaire();
		const home = await dossierTemporaire();
		const modeles = await dossierTemporaire();
		const r = await new Promise<{ code: number; out: string; err: string }>((resoudre) => {
			execFile(process.execPath, [MAIN, 'init', '--oui'], { cwd: racine, env: { ...ENV_TEST, HOME: home, MNEMO_MODELES: modeles }, timeout: 30_000 }, (e, out, err) =>
				resoudre({ code: e ? Number(e.code) : 0, out, err }),
			);
		});
		expect(r.code).toBe(0);
		expect(r.out).toContain('Mémoire créée');
		expect(r.out).not.toMatch(/\[[oO]\/[nN]\]/u);
		expect(r.out).toContain('mnemo modeles installer');
		expect(existsSync(join(racine, '_mnemo', 'SCHEMA.md'))).toBe(true);
		expect(readdirSync(modeles)).toEqual([]);
		expect(existsSync(join(home, 'Applications'))).toBe(false);
	});

	it('même devant un terminal, --oui ne lit rien et prend les défauts (modèles et lanceur : non)', async () => {
		const racine = await dossierAvecSousDossiers();
		const sortie = capture();
		const a = actions();
		avecMcpFactice();
		await commandeInit(['--oui', racine], { entree: entreeInterdite(), sortie: sortie.flux, interactif: true, plateforme: 'darwin', actions: a });
		expect(a.installerModeles).not.toHaveBeenCalled();
		expect(a.creerLanceur).not.toHaveBeenCalled();
		expect(a.declarerMcp).toHaveBeenCalledOnce();
		expect(sortie.texte()).not.toMatch(/projets? détectés?/u);
		expect(existsSync(join(racine, '.mnemo', 'reglages.json'))).toBe(false);
	});
});

describe('mnemo init interactif (entrées simulées)', () => {
	it('dossier, MCP, modèles oui, lanceur non : aucune question ni liste sur les projets, aucun réglage écrit', async () => {
		const parent = await dossierAvecSousDossiers();
		const entree = new PassThrough();
		// dossier : la racine, confirmée ; MCP : défaut (oui) ; modèles : o ; lanceur : n
		entree.end([parent, '', '', 'o', 'n', ''].join('\n'));
		const sortie = capture();
		const a = actions();
		avecMcpFactice();
		await commandeInit([], { entree, sortie: sortie.flux, interactif: true, plateforme: 'darwin', actions: a });
		const texte = sortie.texte();
		expect(texte).toMatch(/Dossier Mnemo/u);
		expect(texte).toContain('Mémoire créée');
		expect(texte).not.toMatch(/projets? détectés?|Ces projets|Marqueurs de projet|Profondeur/u);
		expect(existsSync(join(parent, '.mnemo', 'reglages.json'))).toBe(false);
		expect(a.declarerMcp).toHaveBeenCalledOnce();
		expect(a.installerModeles).toHaveBeenCalledWith(parent);
		expect(a.creerLanceur).not.toHaveBeenCalled();
		expect(texte).toContain('mnemo jeton');
	});

	it('réponse invalide : reposée', async () => {
		const racine = await dossierTemporaire();
		const entree = new PassThrough();
		entree.end(['peut-être', 'o'].join('\n'));
		const sortie = capture();
		const a = actions();
		await commandeInit([racine, '--sans-mcp'], { entree, sortie: sortie.flux, interactif: true, plateforme: 'linux', actions: a });
		// pas de question de dossier (donné) ; modèles : « peut-être » puis « o »
		expect(sortie.texte()).toMatch(/Répondre par o \(oui\) ou n \(non\)/u);
		expect(a.installerModeles).toHaveBeenCalledOnce();
		expect(a.declarerMcp).not.toHaveBeenCalled();
		// Linux : pas de lanceur proposé
		expect(sortie.texte()).not.toMatch(/lanceur macOS .*\?/u);
	});

	it('fin de l’entrée : les défauts (rien installé)', async () => {
		const racine = await dossierTemporaire();
		const entree = new PassThrough();
		entree.end('');
		const a = actions();
		await commandeInit([racine, '--sans-mcp'], { entree, sortie: capture().flux, interactif: true, plateforme: 'darwin', actions: a });
		expect(a.installerModeles).not.toHaveBeenCalled();
		expect(a.creerLanceur).not.toHaveBeenCalled();
		expect(existsSync(join(racine, '_mnemo', 'SCHEMA.md'))).toBe(true);
	});

	it('une mémoire existante : jamais réécrite ; seules la commande et l’application sont proposées (oui par défaut)', async () => {
		const racine = await dossierTemporaire();
		await commandeInit([racine, '--oui', '--sans-mcp'], { entree: entreeInterdite(), sortie: capture().flux, interactif: false, plateforme: 'linux', actions: actions() });
		const schema = readFileSync(join(racine, '_mnemo', 'SCHEMA.md'), 'utf8');
		const sortie = capture();
		const a = actions();
		const entree = new PassThrough();
		entree.end('\n\n');
		await commandeInit([racine, '--sans-mcp'], { entree, sortie: sortie.flux, interactif: true, plateforme: 'darwin', actions: a });
		expect(sortie.texte()).toContain('existe déjà');
		expect(sortie.texte()).not.toMatch(/modèles locaux .*\?/iu);
		expect(readFileSync(join(racine, '_mnemo', 'SCHEMA.md'), 'utf8')).toBe(schema);
		expect(a.installerModeles).not.toHaveBeenCalled();
		expect(a.installerCommande).toHaveBeenCalledOnce();
		expect(a.creerLanceur).toHaveBeenCalledWith(racine);
		expect(sortie.texte()).toContain('ouvrir l’application Mnemo');
	});

	it('commande déjà à jour : pas reproposée ; fin de l’entrée : ni commande ni application', async () => {
		const racine = await dossierTemporaire();
		const entree = new PassThrough();
		entree.end('');
		const sortie = capture();
		const a = { ...actions(), commandeAJour: vi.fn(() => true) };
		await commandeInit([racine, '--sans-mcp'], { entree, sortie: sortie.flux, interactif: true, plateforme: 'darwin', actions: a });
		expect(sortie.texte()).not.toMatch(/Installer la commande/u);
		expect(a.installerCommande).not.toHaveBeenCalled();
		expect(a.creerLanceur).not.toHaveBeenCalled();
		expect(sortie.texte()).toContain(`Pour démarrer : mnemo ${racine}.`);
	});
});

describe('mnemo init : le dossier', () => {
	it('cheminSaisi : ~ et ~/… dans le dossier personnel, relatif depuis le dossier courant, ~nom refusé', () => {
		expect(cheminSaisi('~', '/maison')).toBe('/maison');
		expect(cheminSaisi('~/projets-x', '/maison')).toBe(join('/maison', 'projets-x'));
		expect(cheminSaisi('sous/dossier', '/maison')).toBe(join(process.cwd(), 'sous/dossier'));
		expect(cheminSaisi('~autre/x', '/maison')).toBeNull();
	});

	it('réponse « ~/… » : le dossier personnel, jamais un dossier « ~ » ; chemin affiché et confirmé avant création', async () => {
		const ici = await dossierTemporaire();
		vi.spyOn(process, 'cwd').mockReturnValue(ici);
		const entree = new PassThrough();
		entree.end(['~autre', '~/projets-x', 'o', ''].join('\n'));
		const sortie = capture();
		await commandeInit(['--sans-mcp'], { entree, sortie: sortie.flux, interactif: true, plateforme: 'linux', actions: actions() });
		const vise = join(homedir(), 'projets-x');
		expect(sortie.texte()).toContain('« ~autre » non prise en charge');
		expect(sortie.texte()).toContain(`${vise} n'existe pas : le créer, avec la mémoire dans ${join(vise, '_mnemo')} ? [O/n]`);
		expect(sortie.texte()).toContain(`Dossier Mnemo : ${vise}`);
		expect(existsSync(join(vise, '_mnemo', 'SCHEMA.md'))).toBe(true);
		expect(existsSync(join(ici, '~'))).toBe(false);
	});

	it('chemin relatif : résolu depuis le dossier courant, affiché ; refusé : reposé, puis rien n’est créé', async () => {
		const ici = await dossierTemporaire();
		vi.spyOn(process, 'cwd').mockReturnValue(ici);
		const entree = new PassThrough();
		entree.end(['sous/dossier', 'n', 'autre', 'n', 'encore', 'n'].join('\n'));
		const sortie = capture();
		await expect(commandeInit(['--sans-mcp'], { entree, sortie: sortie.flux, interactif: true, plateforme: 'linux', actions: actions() })).rejects.toThrow(/rien n’a été créé/u);
		expect(sortie.texte()).toContain(join(ici, 'sous', 'dossier'));
		expect(readdirSync(ici)).toEqual([]);
	});

	it('mémoire existante dans le dossier courant, sans argument : aucune question sur le dossier', async () => {
		const ici = await dossierTemporaire();
		await commandeInit([ici, '--oui', '--sans-mcp'], { sortie: capture().flux, interactif: false, plateforme: 'linux', actions: actions() });
		vi.spyOn(process, 'cwd').mockReturnValue(ici);
		const sortie = capture();
		const a = { ...actions(), commandeAJour: vi.fn(() => true) };
		await commandeInit(['--sans-mcp'], { entree: entreeInterdite(), sortie: sortie.flux, interactif: true, plateforme: 'linux', actions: a });
		expect(sortie.texte()).toContain('existe déjà');
		expect(sortie.texte()).not.toContain('Dossier Mnemo (');
		expect(sortie.texte()).toContain(`Pour démarrer : mnemo ${ici}.`);
	});
});

describe('mnemo init : déclaration MCP', () => {
	it('sans terminal ni --oui : jamais déclarée ; la commande à lancer est donnée', async () => {
		const racine = await dossierTemporaire();
		avecMcpFactice();
		const sortie = capture();
		const a = actions();
		await commandeInit([racine], { sortie: sortie.flux, interactif: false, plateforme: 'linux', actions: a });
		expect(a.declarerMcp).not.toHaveBeenCalled();
		expect(sortie.texte()).toContain('Serveur MCP non déclaré (ni terminal ni --oui)');
		expect(sortie.texte()).toContain('mnemo init --oui');
		expect(sortie.texte()).toContain('claude mcp add --scope user mnemo');
	});

	it('sous Windows, non déclarée : seule la commande de Claude Code est donnée (pas de commande « mnemo » à relancer)', async () => {
		avecMcpFactice();
		for (const interactif of [false, true]) {
			const racine = await dossierTemporaire();
			const sortie = capture();
			const entree = new PassThrough();
			entree.end('n\nn\n');
			const a = actions();
			await commandeInit([racine, '--sans-lanceur'], { entree, sortie: sortie.flux, interactif, plateforme: 'win32', actions: a });
			expect(a.declarerMcp).not.toHaveBeenCalled();
			expect(sortie.texte()).toContain('Serveur MCP non déclaré : lancer à la main : claude mcp add --scope user mnemo -- ');
			expect(sortie.texte()).not.toMatch(/mnemo init/u);
		}
	});

	it('mémoire existante, dans un terminal : la déclaration est demandée ; « n » : non déclarée', async () => {
		const racine = await dossierTemporaire();
		await commandeInit([racine, '--oui', '--sans-mcp'], { sortie: capture().flux, interactif: false, plateforme: 'linux', actions: actions() });
		avecMcpFactice();
		const entree = new PassThrough();
		entree.end('n\n');
		const a = actions();
		const sortie = capture();
		await commandeInit([racine], { entree, sortie: sortie.flux, interactif: true, plateforme: 'linux', actions: a });
		expect(a.declarerMcp).not.toHaveBeenCalled();
		expect(sortie.texte()).toContain('Serveur MCP non déclaré');
	});
});
