/** Codex sur le poste : sa commande et la déclaration du serveur MCP, sans jamais lancer le vrai `codex`. */
import { realpathSync } from 'node:fs';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { commandeDeclarer } from '../../src/adaptateurs/cli/declaration.ts';
import type { AppelDeclaration, Executer } from '../../src/application/ports.ts';
import { commandeManuelleCodex, lireDeclarationCodex } from '../../src/domaine/moteurs/codex/declaration.ts';
import { DECLARATION_MCP_CODEX } from '../../src/infra/moteurs/codex/declaration-mcp.ts';
import { trouverCodex } from '../../src/infra/moteurs/codex/trouver-codex.ts';
import { MOTEURS, MOTEURS_DU_POSTE } from '../../src/infra/moteurs/moteurs.ts';
import { dossierTemporaire } from '../aides/dossier-temporaire.ts';

afterEach(() => {
	vi.unstubAllEnvs();
	process.exitCode = undefined;
});

async function executable(dossier: string, nom: string): Promise<string> {
	await mkdir(dossier, { recursive: true });
	const chemin = join(dossier, nom);
	await writeFile(chemin, '#!/bin/sh\nexit 0\n');
	await chmod(chemin, 0o755);
	return chemin;
}

/** Un shim npm `codex.cmd` (forme de cmd-shim) et le script du paquet `@openai/codex` qu'il lance ; rend le chemin du script. */
async function shimNpmCodex(dossier: string, texte?: string): Promise<string> {
	const paquet = join(dossier, 'node_modules', '@openai', 'codex', 'bin');
	await mkdir(paquet, { recursive: true });
	const script = join(paquet, 'codex.js');
	await writeFile(script, '');
	await writeFile(join(dossier, 'codex.cmd'), texte ?? '@ECHO off\r\nSETLOCAL\r\nCALL :find_dp0\r\n"%_prog%"  "%dp0%\\node_modules\\@openai\\codex\\bin\\codex.js" %*\r\n');
	return script;
}

describe('trouverCodex', () => {
	it('MNEMO_CODEX : un .mjs lancé par le Node courant, un exécutable directement, un fichier absent : null (sans repli)', async () => {
		const d = await dossierTemporaire();
		const faux = join(d, 'faux-codex.mjs');
		await writeFile(faux, '');
		const bin = await executable(join(d, 'bin'), 'codex');
		expect(trouverCodex({ MNEMO_CODEX: faux, PATH: '' }, 'darwin', '/nulle/part')).toEqual({ commande: process.execPath, avant: [faux] });
		expect(trouverCodex({ MNEMO_CODEX: bin }, 'linux')).toEqual({ commande: bin, avant: [] });
		expect(trouverCodex({ MNEMO_CODEX: join(d, 'absent'), PATH: join(d, 'bin') }, 'linux')).toBeNull();
	});

	it('PATH, puis sous macOS l’exécutable de ChatGPT.app ; ailleurs, rien', async () => {
		const d = await dossierTemporaire();
		const bin = await executable(join(d, 'bin'), 'codex');
		const bundle = await executable(join(d, 'bundle'), 'codex');
		expect(trouverCodex({ PATH: `${join(d, 'vide')}:${join(d, 'bin')}` }, 'linux')).toEqual({ commande: bin, avant: [] });
		expect(trouverCodex({ PATH: join(d, 'vide') }, 'darwin', bundle)).toEqual({ commande: bundle, avant: [] });
		expect(trouverCodex({ PATH: join(d, 'vide') }, 'linux', bundle)).toBeNull();
		expect(trouverCodex({ PATH: join(d, 'vide') }, 'darwin', join(d, 'absent'))).toBeNull();
	});

	it('le script shell du bundle (codex-cli/bin/codex) dans le PATH : l’exécutable du bundle à sa place', async () => {
		const d = await dossierTemporaire();
		const racine = join(d, 'codex-cli');
		await executable(join(racine, 'bin'), 'codex');
		const reel = await executable(join(racine, 'CodexCLI.app', 'Contents', 'MacOS'), 'codex');
		expect(trouverCodex({ PATH: join(racine, 'bin') }, 'darwin', '/nulle/part')).toEqual({ commande: realpathSync.native(reel), avant: [] });
	});

	it('le script du bundle sans son exécutable réel : jamais rendu (PATH ou MNEMO_CODEX), null ; le PATH continue', async () => {
		const d = await dossierTemporaire();
		const script = await executable(join(d, 'codex-cli', 'bin'), 'codex');
		expect(trouverCodex({ PATH: join(d, 'codex-cli', 'bin') }, 'darwin', '/nulle/part')).toBeNull();
		expect(trouverCodex({ MNEMO_CODEX: script }, 'darwin', '/nulle/part')).toBeNull();
		const suivant = await executable(join(d, 'suivant'), 'codex');
		expect(trouverCodex({ PATH: `${join(d, 'codex-cli', 'bin')}:${join(d, 'suivant')}` }, 'linux')).toEqual({ commande: suivant, avant: [] });
		const reel = await executable(join(d, 'codex-cli', 'CodexCLI.app', 'Contents', 'MacOS'), 'codex');
		expect(trouverCodex({ MNEMO_CODEX: script }, 'darwin', '/nulle/part')).toEqual({ commande: realpathSync.native(reel), avant: [] });
	});

	it('Windows : codex.cmd (shim npm) → son script Node, lancé par le Node courant ; codex.exe préféré ; MNEMO_CODEX vers le shim', async () => {
		const d = await dossierTemporaire();
		const script = await shimNpmCodex(join(d, 'npm'));
		expect(trouverCodex({ Path: join(d, 'npm') }, 'win32')).toEqual({ commande: process.execPath, avant: [script] });
		expect(trouverCodex({ MNEMO_CODEX: join(d, 'npm', 'codex.cmd') }, 'win32')).toEqual({ commande: process.execPath, avant: [script] });
		await mkdir(join(d, 'exe'));
		await writeFile(join(d, 'exe', 'codex.exe'), '');
		expect(trouverCodex({ Path: `${join(d, 'npm')};${join(d, 'exe')}` }, 'win32')).toEqual({ commande: join(d, 'exe', 'codex.exe'), avant: [] });
	});

	it('Windows : shim illisible mais script du paquet à côté → ce script ; shim vers un exécutable natif → lui ; sans cible → null', async () => {
		const d = await dossierTemporaire();
		const script = await shimNpmCodex(join(d, 'repli'), "@ECHO off\r\nrem rien d'utile\r\n");
		expect(trouverCodex({ Path: join(d, 'repli') }, 'win32')).toEqual({ commande: process.execPath, avant: [script] });
		await mkdir(join(d, 'natif', 'bin'), { recursive: true });
		await writeFile(join(d, 'natif', 'bin', 'codex-x86_64.exe'), '');
		await writeFile(join(d, 'natif', 'codex.cmd'), '@ECHO off\r\n"%dp0%\\node.exe" "%dp0%\\bin\\codex-x86_64.exe" %*\r\n');
		expect(trouverCodex({ Path: join(d, 'natif') }, 'win32')).toEqual({ commande: join(d, 'natif', 'bin', 'codex-x86_64.exe'), avant: [] });
		await mkdir(join(d, 'vide'));
		await writeFile(join(d, 'vide', 'codex.cmd'), '@ECHO off\r\n"%dp0%\\absent.js" %*\r\n');
		expect(trouverCodex({ Path: join(d, 'vide') }, 'win32')).toBeNull();
	});

	it('Windows : codex.exe du PATH ; un .cmd sans cible trouvable : null (jamais de shell)', async () => {
		const d = await dossierTemporaire();
		await writeFile(join(d, 'codex.cmd'), '@echo off');
		expect(trouverCodex({ Path: d }, 'win32')).toBeNull();
		await writeFile(join(d, 'codex.exe'), '');
		expect(trouverCodex({ Path: d }, 'win32')).toEqual({ commande: join(d, 'codex.exe'), avant: [] });
		expect(trouverCodex({ MNEMO_CODEX: join(d, 'codex.cmd') }, 'win32')).toBeNull();
	});
});

describe('lecture de « codex mcp get mnemo --json »', () => {
	it('stdio : commande et arguments ; autre transport ; sortie illisible : null', () => {
		const sortie = JSON.stringify({ name: 'mnemo', enabled: true, transport: { type: 'stdio', command: '/n/node', args: ['/m/main.ts', 'mcp'], env: null } });
		expect(lireDeclarationCodex(sortie)).toEqual({ stdio: true, commande: '/n/node', args: ['/m/main.ts', 'mcp'], active: true, reglages: [] });
		expect(lireDeclarationCodex(JSON.stringify({ transport: { type: 'streamable_http', url: 'http://x' } }))).toEqual({ stdio: false, active: true, reglages: [] });
		// `enabled` absent : active ; réglages lus dans le JSON
		const reglee = JSON.stringify({ name: 'mnemo', enabled: false, transport: { type: 'stdio', command: '/n/node', args: [], env: { A: '1' }, env_vars: [], cwd: null }, startup_timeout_sec: 20.0 });
		expect(lireDeclarationCodex(reglee)).toMatchObject({ active: false, reglages: ['enabled = false', 'env', 'startup_timeout_sec'] });
		expect(lireDeclarationCodex('Error')).toBeNull();
		expect(lireDeclarationCodex(JSON.stringify({ transport: { type: 'stdio', command: 1, args: [] } }))).toBeNull();
	});

	it('commande manuelle : POSIX ou PowerShell', () => {
		expect(commandeManuelleCodex('/a b/node', "/x/l'y/main.ts", 'darwin')).toBe(`codex mcp add mnemo -- '/a b/node' '/x/l'\\''y/main.ts' mcp`);
		expect(commandeManuelleCodex('C:\\node.exe', "C:\\u's\\main.ts", 'win32')).toBe(`codex mcp add mnemo -- 'C:\\node.exe' 'C:\\u''s\\main.ts' mcp`);
	});
});

const MAIN = '/chemin/absolu/main.ts';
const ANCIEN = '/ancien/depot/packages/mnemo/src/adaptateurs/cli/main.ts';
const CODEX = { commande: '/opt/codex', avant: [] };
const ABSENT = { code: 1, sortie: '', erreur: "Error: No MCP server named 'mnemo' found.\n" };
const get = (command: string, args: string[]) => ({ code: 0, sortie: JSON.stringify({ name: 'mnemo', transport: { type: 'stdio', command, args } }), erreur: '' });

function simule(reponses: { code: number; sortie: string; erreur: string }[], env: Record<string, string> = { CODEX_HOME: '/nulle/part' }) {
	const appels: string[][] = [];
	const executer: Executer = async (commande, args) => {
		appels.push([commande, ...args]);
		return reponses.shift() ?? { code: 0, sortie: '', erreur: '' };
	};
	const appel = (commande: AppelDeclaration['commande'] = CODEX): AppelDeclaration => ({ executer, main: MAIN, commande, plateforme: 'darwin', env });
	return { appels, appel };
}

describe('déclaration MCP chez Codex', () => {
	it('declarer : rien de déclaré → `codex mcp add mnemo -- <node> <main> mcp`', async () => {
		const { appels, appel } = simule([ABSENT, { code: 0, sortie: '', erreur: '' }]);
		expect(await DECLARATION_MCP_CODEX.declarer(appel())).toBe('declare');
		expect(appels).toEqual([
			['/opt/codex', 'mcp', 'get', 'mnemo', '--json'],
			['/opt/codex', 'mcp', 'add', 'mnemo', '--', process.execPath, MAIN, 'mcp'],
		]);
	});

	it('declarer : une déclaration existante n’est jamais réécrite', async () => {
		const cas: [ReturnType<typeof get>, 'deja' | { perime: true; remplacable: boolean }][] = [
			[get(process.execPath, [MAIN, 'mcp']), 'deja'],
			[get('/vieux/node', [ANCIEN, 'mcp']), { perime: true, remplacable: true }],
			[get('/usr/bin/python3', ['/opt/serveur.py']), { perime: true, remplacable: false }],
		];
		for (const [reponse, attendu] of cas) {
			const { appels, appel } = simule([reponse]);
			const r = await DECLARATION_MCP_CODEX.declarer(appel());
			if (typeof attendu === 'string') expect(r).toBe(attendu);
			else expect(r).toMatchObject({ ...attendu, manuel: expect.stringContaining('codex mcp add mnemo -- ') });
			expect(appels).toHaveLength(1);
		}
	});

	it('declarer : codex introuvable ou en erreur → commande manuelle, rien n’est ajouté', async () => {
		const introuvable = simule([]);
		expect(await DECLARATION_MCP_CODEX.declarer(introuvable.appel(null))).toMatchObject({ introuvable: true, manuel: expect.stringContaining('codex mcp add mnemo') });
		expect(introuvable.appels).toEqual([]);
		const erreur = simule([{ code: 1, sortie: '', erreur: 'Error: config.toml invalide\n' }]);
		expect(await DECLARATION_MCP_CODEX.declarer(erreur.appel())).toMatchObject({ introuvable: false, raison: 'Error: config.toml invalide' });
		expect(erreur.appels).toHaveLength(1);
	});

	/** Un `CODEX_HOME` temporaire avec ce `config.toml`. */
	const home = async (config: string) => {
		const d = await dossierTemporaire();
		await writeFile(join(d, 'config.toml'), config);
		return { CODEX_HOME: d };
	};
	const NUE = `model = "x"\n\n[mcp_servers.mnemo]\ncommand = "/vieux/node"\nargs = ["${ANCIEN}", "mcp"]\n\n[mcp_servers.autre]\ncommand = "a"\nenv = { A = "1" }\n`;

	it('remplacer : seulement une déclaration de Mnemo périmée, réécrite par `codex mcp add`', async () => {
		const { appels, appel } = simule([get('/vieux/node', [ANCIEN, 'mcp']), { code: 0, sortie: '', erreur: '' }], await home(NUE));
		expect(await DECLARATION_MCP_CODEX.remplacer(appel())).toBe('remplace');
		expect(appels[1]).toEqual(['/opt/codex', 'mcp', 'add', 'mnemo', '--', process.execPath, MAIN, 'mcp']);
		for (const [reponse, attendu] of [
			[ABSENT, 'absent'],
			[get(process.execPath, [MAIN, 'mcp']), 'deja'],
			[get('/usr/bin/python3', ['/opt/serveur.py']), 'autre'],
		] as const) {
			const s = simule([reponse]);
			expect(await DECLARATION_MCP_CODEX.remplacer(s.appel())).toBe(attendu);
			expect(s.appels).toHaveLength(1);
		}
	});

	it('remplacer : jamais sur des réglages que Mnemo ne pose pas (get --json ou config.toml) : échec qui dit quoi changer', async () => {
		const brut = (extra: Record<string, unknown>, transport: Record<string, unknown> = {}) => ({
			code: 0,
			sortie: JSON.stringify({ name: 'mnemo', enabled: true, transport: { type: 'stdio', command: '/vieux/node', args: [ANCIEN, 'mcp'], env: null, env_vars: [], cwd: null, ...transport }, enabled_tools: null, disabled_tools: null, startup_timeout_sec: null, tool_timeout_sec: null, ...extra }),
			erreur: '',
		});
		const env = await home(NUE);
		for (const [reponse, reglage] of [
			[brut({ enabled: false }), 'enabled = false'],
			[brut({}, { env: { A: '1' } }), 'env'],
			[brut({}, { env_vars: ['B'] }), 'env_vars'],
			[brut({}, { cwd: '/tmp' }), 'cwd'],
			[brut({ enabled_tools: ['lire'] }), 'enabled_tools'],
			[brut({ disabled_tools: [] , tool_timeout_sec: 5 }), 'tool_timeout_sec'],
		] as const) {
			const s = simule([reponse], env);
			const r = await DECLARATION_MCP_CODEX.remplacer(s.appel());
			expect(r, reglage).toMatchObject({ echec: expect.stringContaining(reglage) });
			expect((r as { echec: string }).echec).toContain(`command = ${JSON.stringify(process.execPath)} et args = [${JSON.stringify(MAIN)}, "mcp"]`);
			expect(s.appels).toHaveLength(1);
		}
		for (const [config, reglage] of [
			[`${NUE}\n[mcp_servers.mnemo.tools.lire]\napproval_mode = "approve"\n`, 'tools.lire.approval_mode'],
			[NUE.replace('args = [', 'default_tools_approval_mode = "approve"\nargs = ['), 'default_tools_approval_mode'],
			[`mcp_servers."mnemo".tools.proposer.approval_mode = "approve"\n${NUE}`, 'tools.proposer.approval_mode'],
			[`[mcp_servers]\nmnemo = { command = "/vieux/node", args = ["${ANCIEN}", "mcp"] }\n`, 'mnemo = { … }'],
		] as const) {
			const s = simule([get('/vieux/node', [ANCIEN, 'mcp'])], await home(config));
			expect(await DECLARATION_MCP_CODEX.remplacer(s.appel()), reglage).toMatchObject({ echec: expect.stringContaining(reglage) });
			expect(s.appels).toHaveLength(1);
		}
		const illisible = simule([get('/vieux/node', [ANCIEN, 'mcp'])], { CODEX_HOME: '/nulle/part' });
		expect(await DECLARATION_MCP_CODEX.remplacer(illisible.appel())).toMatchObject({ echec: expect.stringContaining('illisible') });
		expect(illisible.appels).toHaveLength(1);
	});

	it('désactivée (enabled = false) : lue « desactive », jamais déclarée ni réactivée', async () => {
		const desactivee = { code: 0, sortie: JSON.stringify({ name: 'mnemo', enabled: false, transport: { type: 'stdio', command: process.execPath, args: [MAIN, 'mcp'] } }), erreur: '' };
		expect(await DECLARATION_MCP_CODEX.lire(simule([desactivee]).appel())).toBe('desactive');
		const s = simule([desactivee]);
		expect(await DECLARATION_MCP_CODEX.declarer(s.appel())).toMatchObject({ introuvable: false, raison: expect.stringContaining('désactivée') });
		expect(s.appels).toHaveLength(1);
	});

	it('délai de l’appel transmis à chaque commande de codex', async () => {
		const options: unknown[] = [];
		const executer: Executer = async (_c, _a, o) => (options.push(o), ABSENT);
		await DECLARATION_MCP_CODEX.lire({ executer, main: MAIN, commande: CODEX, plateforme: 'darwin', env: {}, delaiMs: 10_000 });
		expect(options).toEqual([{ delaiMs: 10_000 }]);
	});

	it('retirer : seulement celle qui lance ce Node et ce main.ts', async () => {
		const { appels, appel } = simule([get(process.execPath, [MAIN, 'mcp']), { code: 0, sortie: '', erreur: '' }]);
		expect(await DECLARATION_MCP_CODEX.retirer(appel())).toBe('retire');
		expect(appels[1]).toEqual(['/opt/codex', 'mcp', 'remove', 'mnemo']);
		const autre = simule([get('/vieux/node', [ANCIEN, 'mcp'])]);
		expect(await DECLARATION_MCP_CODEX.retirer(autre.appel())).toBe('autre');
		expect(autre.appels).toHaveLength(1);
		expect(await DECLARATION_MCP_CODEX.retirer(simule([]).appel(null))).toMatchObject({ echec: expect.stringContaining('codex') });
	});

	it('lire : sans rien changer', async () => {
		for (const [reponse, attendu] of [
			[ABSENT, 'absent'],
			[get(process.execPath, [MAIN, 'mcp']), 'deja'],
			[get('/vieux/node', [ANCIEN, 'mcp']), 'perime'],
			[get('/usr/bin/python3', ['/opt/serveur.py']), 'autre'],
		] as const) {
			const s = simule([reponse]);
			expect(await DECLARATION_MCP_CODEX.lire(s.appel())).toBe(attendu);
			expect(s.appels).toHaveLength(1);
		}
	});
});

/**
 * Faux `codex` (MNEMO_CODEX) : `mcp get --json | add | remove` sur un fichier d'état à côté de lui, `add` écrivant aussi un
 * `config.toml` nu dans son dossier (le `CODEX_HOME` des tests) ; chaque appel journalisé.
 */
const FAUX_CODEX = `import { appendFileSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
const etat = new URL('./etat.json', import.meta.url);
const a = process.argv.slice(2);
appendFileSync(new URL('./appels.log', import.meta.url), a.join(' ') + '\\n');
const lu = () => (existsSync(etat) ? JSON.parse(readFileSync(etat, 'utf8')) : null);
if (a.join(' ') === 'mcp get mnemo --json') {
	const d = lu();
	if (d === null) { process.stderr.write("Error: No MCP server named 'mnemo' found.\\n"); process.exit(1); }
	process.stdout.write(JSON.stringify({ name: 'mnemo', enabled: true, transport: { type: 'stdio', command: d.command, args: d.args, env: null } }));
} else if (a.slice(0, 4).join(' ') === 'mcp add mnemo --') {
	writeFileSync(etat, JSON.stringify({ command: a[4], args: a.slice(5) }));
	writeFileSync(new URL('./config.toml', import.meta.url), '[mcp_servers.mnemo]\\ncommand = ' + JSON.stringify(a[4]) + '\\nargs = ' + JSON.stringify(a.slice(5)) + '\\n');
	process.stdout.write("Added global MCP server 'mnemo'.\\n");
} else if (a.join(' ') === 'mcp remove mnemo') {
	rmSync(etat, { force: true });
} else { process.stderr.write('inattendu : ' + a.join(' ')); process.exit(2); }
`;

describe('mnemo declarer --moteur codex (faux codex par MNEMO_CODEX)', () => {
	it('--remplacer puis --retirer, sortie JSON ; Claude Code jamais lancé', async () => {
		const d = await dossierTemporaire();
		await writeFile(join(d, 'faux-codex.mjs'), FAUX_CODEX);
		await writeFile(join(d, 'etat.json'), JSON.stringify({ command: '/vieux/node', args: [ANCIEN, 'mcp'] }));
		await writeFile(join(d, 'config.toml'), `[mcp_servers.mnemo]\ncommand = "/vieux/node"\nargs = ["${ANCIEN}", "mcp"]\n`);
		vi.stubEnv('MNEMO_CODEX', join(d, 'faux-codex.mjs'));
		const lignes: string[] = [];
		const claude = vi.fn(() => null);
		await commandeDeclarer(['--moteur', 'codex', '--remplacer', '--json'], { claude, main: MAIN, env: { CODEX_HOME: d } }, (l) => lignes.push(l));
		expect(JSON.parse(lignes[0]!)).toEqual({ resultat: 'remplace', message: 'Codex : Déclaration MCP refaite avec ce Node et ce Mnemo.' });
		expect(JSON.parse(await readFile(join(d, 'etat.json'), 'utf8'))).toEqual({ command: process.execPath, args: [MAIN, 'mcp'] });
		await commandeDeclarer(['--retirer', '--moteur', 'codex', '--json'], { claude, main: MAIN, env: { CODEX_HOME: d } }, (l) => lignes.push(l));
		expect(JSON.parse(lignes[1]!)).toMatchObject({ resultat: 'retire' });
		await commandeDeclarer(['--moteur', 'codex', '--retirer'], { claude, main: MAIN }, (l) => lignes.push(l));
		expect(lignes[2]).toBe('Codex : Aucune déclaration MCP « mnemo » : rien à faire.');
		expect(claude).not.toHaveBeenCalled();
		expect((await readFile(join(d, 'appels.log'), 'utf8')).trim().split('\n')).toEqual([
			'mcp get mnemo --json',
			`mcp add mnemo -- ${process.execPath} ${MAIN} mcp`,
			'mcp get mnemo --json',
			'mcp remove mnemo',
			'mcp get mnemo --json',
		]);
		expect(process.exitCode).toBeUndefined();
	});

	it('--remplacer sur une déclaration aux réglages personnels (approbations d’outils) : échec motivé, code 1, rien de réécrit', async () => {
		const d = await dossierTemporaire();
		await writeFile(join(d, 'faux-codex.mjs'), FAUX_CODEX);
		await writeFile(join(d, 'etat.json'), JSON.stringify({ command: '/vieux/node', args: [ANCIEN, 'mcp'] }));
		const config = `[mcp_servers.mnemo]\ncommand = "/vieux/node"\nargs = ["${ANCIEN}", "mcp"]\n\n[mcp_servers.mnemo.tools.lire]\napproval_mode = "approve"\n`;
		await writeFile(join(d, 'config.toml'), config);
		vi.stubEnv('MNEMO_CODEX', join(d, 'faux-codex.mjs'));
		const lignes: string[] = [];
		await commandeDeclarer(['--moteur', 'codex', '--remplacer', '--json'], { main: MAIN, env: { CODEX_HOME: d } }, (l) => lignes.push(l));
		const sortie = JSON.parse(lignes[0]!) as { resultat: string; message: string };
		expect(sortie.resultat).toBe('echec');
		expect(sortie.message).toContain('réglages personnels (tools.lire.approval_mode)');
		expect(sortie.message).toContain(`command = ${JSON.stringify(process.execPath)}`);
		expect(process.exitCode).toBe(1);
		expect(await readFile(join(d, 'config.toml'), 'utf8')).toBe(config);
		expect((await readFile(join(d, 'appels.log'), 'utf8')).trim().split('\n')).toEqual(['mcp get mnemo --json']);
	});

	it('codex introuvable : échec, code 1 ; moteur inconnu ou --moteur sans valeur : erreur d’usage', async () => {
		vi.stubEnv('MNEMO_CODEX', '/nulle/part/codex');
		const lignes: string[] = [];
		await commandeDeclarer(['--moteur', 'codex', '--remplacer', '--json'], { main: MAIN }, (l) => lignes.push(l));
		expect(JSON.parse(lignes[0]!)).toMatchObject({ resultat: 'echec' });
		expect(process.exitCode).toBe(1);
		await expect(commandeDeclarer(['--moteur', 'gemini', '--remplacer'], {})).rejects.toMatchObject({ code: 2 });
		await expect(commandeDeclarer(['--remplacer', '--moteur'], {})).rejects.toMatchObject({ code: 2 });
		await expect(commandeDeclarer(['--remplacer', '--moteur', 'codex', '--moteur', 'codex'], {})).rejects.toMatchObject({ code: 2 });
	});
});

describe('registres', () => {
	it('Codex est connu du poste (déclaration MCP) mais ne lance pas de session : absent de MOTEURS', () => {
		expect(MOTEURS_DU_POSTE.codex.declarationMcp).toBe(DECLARATION_MCP_CODEX);
		expect(MOTEURS.some((m) => m.id === 'codex')).toBe(false);
		expect(MOTEURS_DU_POSTE['claude-code']).toBe(MOTEURS.find((m) => m.id === 'claude-code'));
	});
});
