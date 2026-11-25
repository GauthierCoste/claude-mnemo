/** GitHub Copilot CLI sur le poste : sa commande, sa déclaration MCP et ses hooks dans un COPILOT_HOME jetable, sa télémétrie, ses modèles, sa version ; jamais le vrai `copilot`. */
import { chmod, lstat, mkdir, readFile, stat, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { commandeDeclarer } from '../../src/adaptateurs/cli/declaration.ts';
import { commandeVerifierPoste } from '../../src/adaptateurs/cli/poste.ts';
import type { AppelDeclaration, AppelHooksDuPoste, Executer } from '../../src/application/ports.ts';
import { fichierDeHooksAttendu } from '../../src/domaine/moteurs/copilot-cli/hooks-installes.ts';
import { texteJsonReecrit } from '../../src/domaine/moteurs/json-texte.ts';
import { executeurReel } from '../../src/infra/executeur.ts';
import { MOTEUR_COPILOT_CLI } from '../../src/infra/moteurs/copilot-cli.ts';
import { DECLARATION_MCP_COPILOT_CLI } from '../../src/infra/moteurs/copilot-cli/declaration-mcp.ts';
import { HOOKS_DU_POSTE_COPILOT_CLI } from '../../src/infra/moteurs/copilot-cli/hooks-du-poste.ts';
import { modelesCopilotCli } from '../../src/infra/moteurs/copilot-cli/modeles.ts';
import { lectureTranscriptionCopilotCli } from '../../src/infra/moteurs/copilot-cli/transcription.ts';
import { trouverCopilot } from '../../src/infra/moteurs/copilot-cli/trouver-copilot.ts';
import { MOTEURS, MOTEURS_DU_POSTE, MOTEURS_FACULTATIFS } from '../../src/infra/moteurs/moteurs.ts';
import { nodeDurable } from '../../src/infra/node-durable.ts';
import { dossierTemporaire } from '../aides/dossier-temporaire.ts';

const MAIN = '/opt/mnemo/src/adaptateurs/cli/main.ts';
const NODE = nodeDurable(process.platform);
const COPILOT = { commande: '/opt/copilot', avant: [] };
const ID = '0f1e2d3c-4b5a-4968-8776-655443322110';

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

const appelDeclaration = (home: string, commande: AppelDeclaration['commande'] = COPILOT): AppelDeclaration => ({ executer: executeurReel(), main: MAIN, commande, plateforme: process.platform, env: { COPILOT_HOME: home } });
const appelHooks = (home: string, node = NODE): AppelHooksDuPoste => ({ node, main: MAIN, env: { COPILOT_HOME: home } });
const entree = (node = NODE) => ({ type: 'local', command: node, args: [MAIN, 'mcp'], tools: ['*'] });

describe('trouverCopilot', () => {
	it('MNEMO_COPILOT seul (un .mjs par le Node courant ; absent : null) ; sinon le PATH, puis npm global de l’utilisateur', async () => {
		const d = await dossierTemporaire();
		const faux = join(d, 'faux-copilot.mjs');
		await writeFile(faux, '');
		const bin = await executable(join(d, 'bin'), 'copilot');
		const npm = await executable(join(d, 'maison', '.npm-global', 'bin'), 'copilot');
		expect(trouverCopilot({ MNEMO_COPILOT: faux, PATH: join(d, 'bin') }, 'darwin')).toEqual({ commande: process.execPath, avant: [faux] });
		expect(trouverCopilot({ MNEMO_COPILOT: join(d, 'absent'), PATH: join(d, 'bin') }, 'darwin')).toBeNull();
		expect(trouverCopilot({ PATH: join(d, 'bin') }, 'darwin', join(d, 'maison'))).toEqual({ commande: bin, avant: [] });
		expect(trouverCopilot({ PATH: join(d, 'vide') }, 'linux', join(d, 'maison'))).toEqual({ commande: npm, avant: [] });
	});

	it('Windows : copilot.exe, puis le shim npm copilot.cmd remplacé par sa cible, dans le PATH puis %APPDATA%\\npm', async () => {
		const d = await dossierTemporaire();
		const npm = join(d, 'AppData', 'Roaming', 'npm');
		await mkdir(join(npm, 'node_modules', '@github', 'copilot'), { recursive: true });
		await writeFile(join(npm, 'node_modules', '@github', 'copilot', 'npm-loader.js'), '');
		await writeFile(join(npm, 'copilot.cmd'), '@ECHO off\r\n"%_prog%"  "%dp0%\\node_modules\\@github\\copilot\\npm-loader.js" %*\r\n');
		const trouve = trouverCopilot({ PATH: join(d, 'vide'), APPDATA: join(d, 'AppData', 'Roaming') }, 'win32');
		expect(trouve?.avant).toEqual([join(npm, 'node_modules', '@github', 'copilot', 'npm-loader.js')]);
		await writeFile(join(npm, 'copilot.exe'), '');
		expect(trouverCopilot({ PATH: join(d, 'vide'), APPDATA: join(d, 'AppData', 'Roaming') }, 'win32')).toEqual({ commande: join(npm, 'copilot.exe'), avant: [] });
	});
});

describe('déclaration MCP de GitHub Copilot CLI (mcp-config.json)', () => {
	it('déclare (les autres serveurs, leurs champs et le style gardés), lue « deja », retirée ; introuvable : la commande à coller', async () => {
		const home = await dossierTemporaire();
		const chemin = join(home, 'mcp-config.json');
		await writeFile(chemin, '{\n    "mcpServers": {\n        "autre": {"type": "local", "command": "x", "inconnu": {"a": 1}}\n    },\n    "cle": 2\n}\n');
		expect(await DECLARATION_MCP_COPILOT_CLI.lire(appelDeclaration(home))).toBe('absent');
		expect(await DECLARATION_MCP_COPILOT_CLI.declarer(appelDeclaration(home))).toBe('declare');
		const texte = await readFile(chemin, 'utf8');
		expect(texte.split('\n')[1]).toBe('    "mcpServers": {');
		expect(JSON.parse(texte)).toEqual({ mcpServers: { autre: { type: 'local', command: 'x', inconnu: { a: 1 } }, mnemo: entree() }, cle: 2 });
		expect(await DECLARATION_MCP_COPILOT_CLI.lire(appelDeclaration(home))).toBe('deja');
		expect(await DECLARATION_MCP_COPILOT_CLI.declarer(appelDeclaration(home))).toBe('deja');
		expect(await DECLARATION_MCP_COPILOT_CLI.retirer(appelDeclaration(home))).toBe('retire');
		expect(JSON.parse(await readFile(chemin, 'utf8'))).toEqual({ mcpServers: { autre: { type: 'local', command: 'x', inconnu: { a: 1 } } }, cle: 2 });
		expect(await DECLARATION_MCP_COPILOT_CLI.retirer(appelDeclaration(home))).toBe('absent');
		expect(await DECLARATION_MCP_COPILOT_CLI.declarer(appelDeclaration(home, null))).toMatchObject({ introuvable: true, manuel: expect.stringMatching(/^copilot mcp add mnemo -- /u) });
		// fichier absent : créé
		const vide = await dossierTemporaire();
		expect(await DECLARATION_MCP_COPILOT_CLI.declarer(appelDeclaration(vide))).toBe('declare');
		expect(JSON.parse(await readFile(join(vide, 'mcp-config.json'), 'utf8'))).toEqual({ mcpServers: { mnemo: entree() } });
	});

	it('autre Node : périmée, remplacée ; réglages personnels : refus avec l’entrée à coller ; désactivée dans settings.json : laissée ; d’un autre programme : autre', async () => {
		const home = await dossierTemporaire();
		const chemin = join(home, 'mcp-config.json');
		await writeFile(chemin, JSON.stringify({ mcpServers: { mnemo: entree('/vieux/node') } }));
		expect(await DECLARATION_MCP_COPILOT_CLI.lire(appelDeclaration(home))).toBe('perime');
		expect(await DECLARATION_MCP_COPILOT_CLI.declarer(appelDeclaration(home))).toMatchObject({ perime: true, remplacable: true });
		expect(await DECLARATION_MCP_COPILOT_CLI.retirer(appelDeclaration(home))).toBe('autre');
		expect(await DECLARATION_MCP_COPILOT_CLI.remplacer(appelDeclaration(home))).toBe('remplace');
		expect(JSON.parse(await readFile(chemin, 'utf8'))).toEqual({ mcpServers: { mnemo: entree() } });
		await writeFile(chemin, JSON.stringify({ mcpServers: { mnemo: { ...entree('/vieux/node'), env: { A: '1' } } } }));
		const refus = await DECLARATION_MCP_COPILOT_CLI.remplacer(appelDeclaration(home));
		expect(refus).toEqual({ echec: expect.stringContaining('réglages personnels (env)') });
		expect((refus as { echec: string }).echec).toContain(`"mnemo": {"type":"local","command":${JSON.stringify(NODE)}`);
		await writeFile(chemin, JSON.stringify({ mcpServers: { mnemo: { ...entree(), env: { A: '1' } } } }));
		expect(await DECLARATION_MCP_COPILOT_CLI.retirer(appelDeclaration(home))).toEqual({ echec: expect.stringContaining('Mnemo ne la retire pas') });
		await writeFile(join(home, 'settings.json'), '{\n  // réglages\n  "disabledMcpServers": ["mnemo"],\n}\n');
		expect(await DECLARATION_MCP_COPILOT_CLI.lire(appelDeclaration(home))).toBe('desactive');
		expect(await DECLARATION_MCP_COPILOT_CLI.declarer(appelDeclaration(home))).toBe('desactive');
		await writeFile(chemin, JSON.stringify({ mcpServers: { mnemo: { type: 'local', command: '/usr/bin/autre' } } }));
		expect(await DECLARATION_MCP_COPILOT_CLI.lire(appelDeclaration(home))).toBe('desactive');
		await writeFile(join(home, 'settings.json'), '{}');
		expect(await DECLARATION_MCP_COPILOT_CLI.lire(appelDeclaration(home))).toBe('autre');
		expect(await DECLARATION_MCP_COPILOT_CLI.remplacer(appelDeclaration(home))).toBe('autre');
	});

	it('JSON illisible : échec, jamais réécrit ; JSONC (commentaires) : lu, mais jamais réécrit, l’entrée à coller dite', async () => {
		const home = await dossierTemporaire();
		const chemin = join(home, 'mcp-config.json');
		await writeFile(chemin, '{ "mcpServers": ');
		expect(await DECLARATION_MCP_COPILOT_CLI.lire(appelDeclaration(home))).toEqual({ echec: expect.stringContaining('JSON illisible') });
		expect(await DECLARATION_MCP_COPILOT_CLI.declarer(appelDeclaration(home))).toMatchObject({ introuvable: false, raison: expect.stringContaining('Mnemo ne le réécrit pas') });
		expect(await readFile(chemin, 'utf8')).toBe('{ "mcpServers": ');
		const jsonc = '{\n  // mes serveurs\n  "mcpServers": {\n    "autre": { "command": "x" },\n  },\n}\n';
		await writeFile(chemin, jsonc);
		expect(await DECLARATION_MCP_COPILOT_CLI.lire(appelDeclaration(home))).toBe('absent');
		expect(await DECLARATION_MCP_COPILOT_CLI.declarer(appelDeclaration(home))).toMatchObject({ raison: expect.stringContaining('commentaires') });
		expect(await readFile(chemin, 'utf8')).toBe(jsonc);
	});
});

describe('hooks de Mnemo pour GitHub Copilot CLI (hooks/mnemo.json)', () => {
	it('installés (fichier propre à Mnemo), à jour, retirés (fichier supprimé) ; d’une autre installation : périmés, remplacés', async () => {
		const home = await dossierTemporaire();
		const chemin = join(home, 'hooks', 'mnemo.json');
		expect(HOOKS_DU_POSTE_COPILOT_CLI.chemin({ COPILOT_HOME: home })).toBe(chemin);
		expect(await HOOKS_DU_POSTE_COPILOT_CLI.lire(appelHooks(home))).toEqual({ etat: 'absent', chemin });
		expect(await HOOKS_DU_POSTE_COPILOT_CLI.remplacer(appelHooks(home))).toBe('absent');
		expect(await HOOKS_DU_POSTE_COPILOT_CLI.installer(appelHooks(home))).toBe('installe');
		expect(await readFile(chemin, 'utf8')).toBe(texteJsonReecrit(fichierDeHooksAttendu(NODE, MAIN), null));
		expect(await HOOKS_DU_POSTE_COPILOT_CLI.lire(appelHooks(home))).toEqual({ etat: 'a_jour', chemin });
		expect(await HOOKS_DU_POSTE_COPILOT_CLI.installer(appelHooks(home))).toBe('deja');
		expect(await HOOKS_DU_POSTE_COPILOT_CLI.retirer(appelHooks(home, '/autre/node'))).toBe('autre');
		expect(await HOOKS_DU_POSTE_COPILOT_CLI.retirer(appelHooks(home))).toBe('retire');
		await expect(stat(chemin)).rejects.toThrow();
		expect(await HOOKS_DU_POSTE_COPILOT_CLI.retirer(appelHooks(home))).toBe('absent');
		// une autre installation
		await mkdir(join(home, 'hooks'), { recursive: true });
		await writeFile(chemin, texteJsonReecrit(fichierDeHooksAttendu('/vieux/node', MAIN), null));
		expect(await HOOKS_DU_POSTE_COPILOT_CLI.lire(appelHooks(home))).toEqual({ etat: 'perime', chemin });
		expect(await HOOKS_DU_POSTE_COPILOT_CLI.installer(appelHooks(home))).toMatchObject({ perime: true, echec: expect.stringContaining('--moteur copilot-cli --remplacer') });
		expect(await HOOKS_DU_POSTE_COPILOT_CLI.remplacer(appelHooks(home))).toBe('mis_a_jour');
		expect(await HOOKS_DU_POSTE_COPILOT_CLI.lire(appelHooks(home))).toEqual({ etat: 'a_jour', chemin });
	});

	it('ce que Mnemo n’écrit pas dans son fichier : jamais réécrit ni supprimé, retrait refusé avec son motif ; JSON illisible : échec, fichier intact', async () => {
		const home = await dossierTemporaire();
		const chemin = join(home, 'hooks', 'mnemo.json');
		await mkdir(join(home, 'hooks'));
		const attendu = fichierDeHooksAttendu(NODE, MAIN);
		const perso = { ...attendu, hooks: { ...attendu.hooks, agentStop: [...attendu.hooks['agentStop']!, { type: 'command', bash: 'echo fin' }] } };
		await writeFile(chemin, JSON.stringify(perso));
		expect(await HOOKS_DU_POSTE_COPILOT_CLI.installer(appelHooks(home))).toEqual({ echec: expect.stringContaining('hooks.agentStop[1]') });
		const texte = await readFile(chemin, 'utf8');
		expect(await HOOKS_DU_POSTE_COPILOT_CLI.retirer(appelHooks(home))).toEqual({ echec: expect.stringMatching(/hooks\.agentStop\[1\].*ne le réécrit ni ne le supprime/u) });
		expect(await readFile(chemin, 'utf8')).toBe(texte);
		await writeFile(chemin, '{');
		for (const action of [HOOKS_DU_POSTE_COPILOT_CLI.lire, HOOKS_DU_POSTE_COPILOT_CLI.installer, HOOKS_DU_POSTE_COPILOT_CLI.remplacer, HOOKS_DU_POSTE_COPILOT_CLI.retirer]) {
			expect(await action(appelHooks(home))).toEqual({ echec: expect.stringContaining('JSON illisible') });
		}
		expect(await readFile(chemin, 'utf8')).toBe('{');
	});

	it('lien symbolique : réécrit à sa cible, retiré en supprimant le lien lui-même, jamais sa cible ; BOM lu et gardé', async () => {
		const home = await dossierTemporaire();
		const ailleurs = join(await dossierTemporaire(), 'mes-hooks.json');
		await mkdir(join(home, 'hooks'));
		const chemin = join(home, 'hooks', 'mnemo.json');
		await writeFile(ailleurs, `\uFEFF${texteJsonReecrit(fichierDeHooksAttendu('/vieux/node', MAIN), null)}`);
		await symlink(ailleurs, chemin);
		expect(await HOOKS_DU_POSTE_COPILOT_CLI.lire(appelHooks(home))).toMatchObject({ etat: 'perime' });
		expect(await HOOKS_DU_POSTE_COPILOT_CLI.remplacer(appelHooks(home))).toBe('mis_a_jour');
		expect(await readFile(ailleurs, 'utf8')).toBe(`\uFEFF${texteJsonReecrit(fichierDeHooksAttendu(NODE, MAIN), null)}`);
		expect(await HOOKS_DU_POSTE_COPILOT_CLI.retirer(appelHooks(home))).toBe('retire');
		await expect(lstat(chemin)).rejects.toThrow();
		expect((await stat(ailleurs)).isFile()).toBe(true);
	});
});

describe('mnemo declarer --moteur copilot-cli et verifier-poste', () => {
	it('--remplacer puis --retirer : déclaration et hooks, sortie JSON', async () => {
		const home = await dossierTemporaire();
		await writeFile(join(home, 'mcp-config.json'), JSON.stringify({ mcpServers: { mnemo: entree('/vieux/node') } }));
		await mkdir(join(home, 'hooks'));
		await writeFile(join(home, 'hooks', 'mnemo.json'), texteJsonReecrit(fichierDeHooksAttendu('/vieux/node', MAIN), null));
		const lignes: string[] = [];
		const copilot = () => COPILOT;
		await commandeDeclarer(['--moteur', 'copilot-cli', '--remplacer', '--json'], { trouver: { 'copilot-cli': copilot }, main: MAIN, env: { COPILOT_HOME: home } }, (l) => lignes.push(l));
		expect(JSON.parse(lignes[0]!)).toMatchObject({ resultat: 'remplace', hooks: { resultat: 'remplace' } });
		await commandeDeclarer(['--moteur', 'copilot-cli', '--retirer'], { trouver: { 'copilot-cli': copilot }, main: MAIN, env: { COPILOT_HOME: home } }, (l) => lignes.push(l));
		expect(lignes.slice(1)).toEqual(['GitHub Copilot CLI : Déclaration MCP retirée.', expect.stringMatching(/^GitHub Copilot CLI : Hooks de Mnemo retirés/u)]);
		expect(JSON.parse(await readFile(join(home, 'mcp-config.json'), 'utf8'))).toEqual({ mcpServers: {} });
	});

	it('verifier-poste : chemin, version (faux copilot), déclaration et hooks ; une option de mnemo init', async () => {
		const home = await dossierTemporaire();
		const faux = join(home, 'faux-copilot.mjs');
		await writeFile(faux, "process.stdout.write(process.argv.slice(2).join(' ') === '--version' ? 'GitHub Copilot CLI 1.0.115.\\n' : '');\n");
		const reel = executeurReel();
		const executer: Executer = async (commande, args, options) => (commande === 'git' ? { code: 0, sortie: 'git version 2.50.1\n', erreur: '' } : reel(commande, args, options));
		const lignes: string[] = [];
		await commandeVerifierPoste(['--json'], { executer, trouver: { 'claude-code': () => COPILOT, codex: () => null, 'mistral-vibe': () => null, 'copilot-cli': () => ({ commande: process.execPath, avant: [faux] }) }, versionNode: '26.0.0', main: MAIN, env: { COPILOT_HOME: home } }, (l) => lignes.push(l));
		expect(JSON.parse(lignes[0]!).copilot).toEqual({ ok: true, chemin: faux, version: '1.0.115', mcp: { etat: 'absent' }, hooks: { etat: 'absent' } });
		expect(MOTEURS_FACULTATIFS.map((m) => m.installation.optionInit)).toContain('--copilot');
	});
});

describe('télémétrie de GitHub Copilot CLI (events.jsonl)', () => {
	const usage = (entree: number) => `${JSON.stringify({ type: 'session.usage_record', data: { usage: { inputTokens: entree, outputTokens: 10, maxPromptTokens: 128000, interactionType: 'conversation-agent' } } })}\n`;

	it('fenêtre lue dans le journal du fil de la session, donné par le hook ou retrouvé ; un autre journal, hors de session-state : rien', async () => {
		const home = await dossierTemporaire();
		const dossier = join(home, 'session-state', ID);
		await mkdir(dossier, { recursive: true });
		await writeFile(join(dossier, 'events.jsonl'), usage(100) + usage(1280));
		const lecture = lectureTranscriptionCopilotCli({ env: () => ({ COPILOT_HOME: home }), accueil: '/nulle/part' });
		expect(await lecture.lire({ chemin: join(dossier, 'events.jsonl'), fil: ID })).toEqual({ fenetre: { utilises: 1290, max: 128000 } });
		expect(await lecture.lire({ fil: ID })).toEqual({ fenetre: { utilises: 1290, max: 128000 } });
		expect(await lecture.lire({ chemin: join(dossier, 'events.jsonl') })).toBeNull();
		expect(await lecture.lire({ fil: '../x' })).toBeNull();
		// le journal d'une autre session, donné par un hook : jamais lu pour celle-ci
		const autre = '11111111-2222-4333-8444-555555555555';
		await mkdir(join(home, 'session-state', autre));
		await writeFile(join(home, 'session-state', autre, 'events.jsonl'), usage(5));
		expect(await lecture.lire({ chemin: join(home, 'session-state', autre, 'events.jsonl'), fil: ID })).toEqual({ fenetre: { utilises: 1290, max: 128000 } });
		const ailleurs = await dossierTemporaire();
		await mkdir(join(ailleurs, ID));
		await writeFile(join(ailleurs, ID, 'events.jsonl'), usage(5));
		await symlink(join(ailleurs, ID, 'events.jsonl'), join(home, 'lien.jsonl'));
		expect(await lectureTranscriptionCopilotCli({ env: () => ({ COPILOT_HOME: home }), accueil: '/nulle/part' }).lire({ chemin: join(home, 'lien.jsonl'), fil: 'x' })).toBeNull();
	});
});

describe('GitHub Copilot CLI : modèles, version, registres', () => {
	it('modèles lus dans copilot help config (faux copilot), sans mise à jour automatique ; introuvable ou en échec : aucun', async () => {
		const d = await dossierTemporaire();
		const faux = join(d, 'faux-copilot.mjs');
		await writeFile(
			faux,
			"if (process.argv.slice(2).join(' ') !== 'help config' || process.env.COPILOT_AUTO_UPDATE !== 'false') process.exit(3);\nprocess.stdout.write('  `model`: Modèle.\\n    - \"gpt-5.2\"\\n    - \"claude-sonnet-4.5\"\\n\\n');\n",
		);
		const commande = trouverCopilot({ MNEMO_COPILOT: faux }, 'darwin');
		expect(await modelesCopilotCli()({ executer: executeurReel(), commande, env: {} })).toEqual(['gpt-5.2', 'claude-sonnet-4.5']);
		expect(await modelesCopilotCli()({ executer: executeurReel(), commande: null, env: {} })).toEqual([]);
		expect(await modelesCopilotCli()({ executer: executeurReel(), commande: { commande: process.execPath, avant: ['-e', 'process.exit(1)'] }, env: {} })).toEqual([]);
	});

	it('version lue par le faux copilot (copilot --version) ; trop ancienne : refus de session', async () => {
		const d = await dossierTemporaire();
		const faux = join(d, 'faux-copilot.mjs');
		await writeFile(faux, "if (process.argv.slice(2).join(' ') !== '--version') process.exit(3);\nprocess.stdout.write('GitHub Copilot CLI 1.0.115.\\nRun copilot update to check for updates.\\n');\n");
		const commande = trouverCopilot({ MNEMO_COPILOT: faux }, 'darwin')!;
		const version = await MOTEUR_COPILOT_CLI.version!(commande, {}, undefined, { relire: true });
		expect(version).toBe('1.0.115');
		expect(MOTEUR_COPILOT_CLI.refusDeVersion!(version)).toBe('GitHub Copilot CLI 1.0.115 trop ancien, 1.0.116 ou plus requis');
	});

	it('registres : le même moteur pour les sessions et le poste ; marque = uuid ; reprise toujours possible ; premier hook au premier message', () => {
		expect(MOTEURS.find((m) => m.id === 'copilot-cli')).toBe(MOTEURS_DU_POSTE['copilot-cli']);
		expect(MOTEUR_COPILOT_CLI.declarationMcp).toBe(DECLARATION_MCP_COPILOT_CLI);
		expect(MOTEUR_COPILOT_CLI.hooksDuPoste).toBe(HOOKS_DU_POSTE_COPILOT_CLI);
		expect(MOTEUR_COPILOT_CLI.sansCommande).toBe('refus');
		expect(MOTEUR_COPILOT_CLI.marqueDeSession(ID)).toBe(ID);
		expect(MOTEUR_COPILOT_CLI.debutAuPremierMessage).toBe(true);
		expect(MOTEUR_COPILOT_CLI.installation).toMatchObject({ optionInit: '--copilot', facultatif: { bloc: 'copilot', etape: 'copilot', etapeHooks: 'copilot_hooks' }, approbation: null });
	});
});
