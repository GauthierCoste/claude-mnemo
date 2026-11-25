/** Mistral Vibe sur le poste : sa commande, sa déclaration MCP et ses hooks dans un VIBE_HOME jetable, sa télémétrie, sa version ; jamais le vrai `vibe`. */
import { chmod, mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { commandeDeclarer } from '../../src/adaptateurs/cli/declaration.ts';
import { commandeVerifierPoste, verifierPoste } from '../../src/adaptateurs/cli/poste.ts';
import type { AppelDeclaration, AppelHooksDuPoste, Executer } from '../../src/application/ports.ts';
import { blocDeDeclaration } from '../../src/domaine/moteurs/mistral-vibe/declaration.ts';
import { blocsAttendus } from '../../src/domaine/moteurs/mistral-vibe/hooks-installes.ts';
import { MODELES_INTEGRES_MISTRAL_VIBE } from '../../src/domaine/moteurs/mistral-vibe/modeles.ts';
import { executeurReel } from '../../src/infra/executeur.ts';
import { MOTEUR_MISTRAL_VIBE } from '../../src/infra/moteurs/mistral-vibe.ts';
import { DECLARATION_MCP_MISTRAL_VIBE } from '../../src/infra/moteurs/mistral-vibe/declaration-mcp.ts';
import { hooksDuPosteMistralVibe } from '../../src/infra/moteurs/mistral-vibe/hooks-toml.ts';

const HOOKS_DU_POSTE_MISTRAL_VIBE = hooksDuPosteMistralVibe(process.platform);
import { modelesMistralVibe } from '../../src/infra/moteurs/mistral-vibe/modeles.ts';
import { lectureTranscriptionMistralVibe } from '../../src/infra/moteurs/mistral-vibe/transcription.ts';
import { trouverVibe } from '../../src/infra/moteurs/mistral-vibe/trouver-vibe.ts';
import { MOTEURS, MOTEURS_DU_POSTE } from '../../src/infra/moteurs/moteurs.ts';
import { nodeDurable } from '../../src/infra/node-durable.ts';
import { dossierTemporaire } from '../aides/dossier-temporaire.ts';

const MAIN = '/opt/mnemo/src/adaptateurs/cli/main.ts';
const NODE = nodeDurable(process.platform);
const VIBE = { commande: '/opt/vibe', avant: [] };

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

const appelDeclaration = (home: string, commande: AppelDeclaration['commande'] = VIBE): AppelDeclaration => ({ executer: executeurReel(), main: MAIN, commande, plateforme: process.platform, env: { VIBE_HOME: home } });
const appelHooks = (home: string, node = NODE): AppelHooksDuPoste => ({ node, main: MAIN, env: { VIBE_HOME: home } });

describe('trouverVibe', () => {
	it('MNEMO_VIBE seul (un .mjs par le Node courant ; absent : null) ; sinon le PATH, puis ~/.local/bin d’uv', async () => {
		const d = await dossierTemporaire();
		const faux = join(d, 'faux-vibe.mjs');
		await writeFile(faux, '');
		const bin = await executable(join(d, 'bin'), 'vibe');
		const uv = await executable(join(d, 'maison', '.local', 'bin'), 'vibe');
		expect(trouverVibe({ MNEMO_VIBE: faux, PATH: join(d, 'bin') }, 'darwin', join(d, 'maison'))).toEqual({ commande: process.execPath, avant: [faux] });
		expect(trouverVibe({ MNEMO_VIBE: join(d, 'absent'), PATH: join(d, 'bin') }, 'darwin', join(d, 'maison'))).toBeNull();
		expect(trouverVibe({ PATH: `${join(d, 'vide')}:${join(d, 'bin')}` }, 'linux', join(d, 'maison'))).toEqual({ commande: bin, avant: [] });
		expect(trouverVibe({ PATH: join(d, 'vide') }, 'darwin', join(d, 'maison'))).toEqual({ commande: uv, avant: [] });
		expect(trouverVibe({ PATH: join(d, 'vide') }, 'darwin', join(d, 'personne'))).toBeNull();
	});
});

describe('déclaration MCP dans config.toml de Mistral Vibe', () => {
	it('déclare à la fin (le reste intact), lue « deja », retirée ; introuvable : la commande à coller', async () => {
		const home = await dossierTemporaire();
		const config = '# à moi\nactive_model = "local"\n';
		await writeFile(join(home, 'config.toml'), config);
		expect(await DECLARATION_MCP_MISTRAL_VIBE.lire(appelDeclaration(home))).toBe('absent');
		expect(await DECLARATION_MCP_MISTRAL_VIBE.declarer(appelDeclaration(home))).toBe('declare');
		expect(await readFile(join(home, 'config.toml'), 'utf8')).toBe(`${config}\n${blocDeDeclaration(NODE, MAIN)}`);
		expect(await DECLARATION_MCP_MISTRAL_VIBE.lire(appelDeclaration(home))).toBe('deja');
		expect(await DECLARATION_MCP_MISTRAL_VIBE.declarer(appelDeclaration(home))).toBe('deja');
		expect(await DECLARATION_MCP_MISTRAL_VIBE.retirer(appelDeclaration(home))).toBe('retire');
		expect(await readFile(join(home, 'config.toml'), 'utf8')).toBe(config);
		expect(await DECLARATION_MCP_MISTRAL_VIBE.declarer(appelDeclaration(home, null))).toMatchObject({ introuvable: true, manuel: expect.stringContaining('vibe mcp add mnemo') });
		// config.toml absent : créé avec le seul bloc
		const neuf = await dossierTemporaire();
		expect(await DECLARATION_MCP_MISTRAL_VIBE.declarer(appelDeclaration(join(neuf, 'vibe')))).toBe('declare');
		expect(await readFile(join(neuf, 'vibe', 'config.toml'), 'utf8')).toBe(blocDeDeclaration(NODE, MAIN));
	});

	it('autre Node : périmée, remplacée à sa place ; avec des réglages personnels : refus avec les lignes à mettre ; désactivée : laissée', async () => {
		const home = await dossierTemporaire();
		const vieux = `[[mcp_servers]]\nname = "mnemo"\ntransport = "stdio"\ncommand = "/vieux/node"\nargs = ["${MAIN}", "mcp"]\n\n[tools.bash]\npermission = "ask"\n`;
		await writeFile(join(home, 'config.toml'), vieux);
		expect(await DECLARATION_MCP_MISTRAL_VIBE.lire(appelDeclaration(home))).toBe('perime');
		expect(await DECLARATION_MCP_MISTRAL_VIBE.declarer(appelDeclaration(home))).toMatchObject({ perime: true, remplacable: true });
		expect(await DECLARATION_MCP_MISTRAL_VIBE.remplacer(appelDeclaration(home))).toBe('remplace');
		expect(await readFile(join(home, 'config.toml'), 'utf8')).toBe(`${blocDeDeclaration(NODE, MAIN)}\n[tools.bash]\npermission = "ask"\n`);

		await writeFile(join(home, 'config.toml'), vieux.replace('args', 'env = { A = "1" }\nargs'));
		const refus = await DECLARATION_MCP_MISTRAL_VIBE.remplacer(appelDeclaration(home));
		expect(refus).toEqual({ echec: expect.stringMatching(/réglages personnels \(env\).*command = '.*' et args = /u) });

		// retirer celle de ce Mnemo qui porte des réglages personnels : refus motivé, fichier intact
		const avecEnv = `${blocDeDeclaration(NODE, MAIN)}\n[mcp_servers.env]\nA = "1"\n`;
		await writeFile(join(home, 'config.toml'), avecEnv);
		expect(await DECLARATION_MCP_MISTRAL_VIBE.retirer(appelDeclaration(home))).toEqual({ echec: expect.stringMatching(/réglages personnels \(env\) : Mnemo ne la retire pas ; retirez-la à la main/u) });
		expect(await readFile(join(home, 'config.toml'), 'utf8')).toBe(avecEnv);

		await writeFile(join(home, 'config.toml'), `${blocDeDeclaration(NODE, MAIN)}disabled = true\n`);
		expect(await DECLARATION_MCP_MISTRAL_VIBE.lire(appelDeclaration(home))).toBe('desactive');
		expect(await DECLARATION_MCP_MISTRAL_VIBE.declarer(appelDeclaration(home))).toBe('desactive');

		await writeFile(join(home, 'config.toml'), '[[mcp_servers]]\nname = "mnemo"\ntransport = "stdio"\ncommand = "npx"\n');
		expect(await DECLARATION_MCP_MISTRAL_VIBE.lire(appelDeclaration(home))).toBe('autre');
		expect(await DECLARATION_MCP_MISTRAL_VIBE.remplacer(appelDeclaration(home))).toBe('autre');
		expect(await DECLARATION_MCP_MISTRAL_VIBE.retirer(appelDeclaration(home))).toBe('autre');
	});

	it('TOML illisible : échec, jamais réécrit', async () => {
		const home = await dossierTemporaire();
		await writeFile(join(home, 'config.toml'), 'a = "ouvert\n');
		expect(await DECLARATION_MCP_MISTRAL_VIBE.lire(appelDeclaration(home))).toEqual({ echec: expect.stringContaining('TOML que Mnemo ne lit pas') });
		expect(await DECLARATION_MCP_MISTRAL_VIBE.declarer(appelDeclaration(home))).toMatchObject({ introuvable: false, raison: expect.stringContaining('TOML') });
		expect(await readFile(join(home, 'config.toml'), 'utf8')).toBe('a = "ouvert\n');
	});
});

describe('hooks de Mnemo dans hooks.toml de Mistral Vibe', () => {
	it('installés à la fin (hooks de l’utilisateur gardés), à jour, retirés ; d’une autre installation : périmés, remplacés', async () => {
		const home = await dossierTemporaire();
		const miens = '[[hooks]]\nname = "a-moi"\ntype = "session_start"\ncommand = "true"\n';
		await writeFile(join(home, 'hooks.toml'), miens);
		expect(await HOOKS_DU_POSTE_MISTRAL_VIBE.lire(appelHooks(home))).toEqual({ etat: 'absent', chemin: join(home, 'hooks.toml') });
		expect(await HOOKS_DU_POSTE_MISTRAL_VIBE.installer(appelHooks(home))).toBe('installe');
		expect(await readFile(join(home, 'hooks.toml'), 'utf8')).toBe(`${miens}\n${blocsAttendus(NODE, MAIN, process.platform).join('\n')}`);
		expect(await HOOKS_DU_POSTE_MISTRAL_VIBE.lire(appelHooks(home))).toMatchObject({ etat: 'a_jour' });
		expect(await HOOKS_DU_POSTE_MISTRAL_VIBE.installer(appelHooks(home))).toBe('deja');

		// un autre Node : périmés pour lui, refus d'installer par-dessus, remplacés par --remplacer
		expect(await HOOKS_DU_POSTE_MISTRAL_VIBE.lire(appelHooks(home, '/autre/node'))).toMatchObject({ etat: 'perime' });
		expect(await HOOKS_DU_POSTE_MISTRAL_VIBE.installer(appelHooks(home, '/autre/node'))).toMatchObject({ perime: true, echec: expect.stringContaining('mnemo declarer --moteur mistral-vibe --remplacer') });
		expect(await HOOKS_DU_POSTE_MISTRAL_VIBE.retirer(appelHooks(home, '/autre/node'))).toBe('autre');
		expect(await HOOKS_DU_POSTE_MISTRAL_VIBE.remplacer(appelHooks(home, '/autre/node'))).toBe('mis_a_jour');
		expect(await HOOKS_DU_POSTE_MISTRAL_VIBE.lire(appelHooks(home, '/autre/node'))).toMatchObject({ etat: 'a_jour' });
		expect(await HOOKS_DU_POSTE_MISTRAL_VIBE.retirer(appelHooks(home, '/autre/node'))).toBe('retire');
		expect(await readFile(join(home, 'hooks.toml'), 'utf8')).toBe(miens);
		expect(await HOOKS_DU_POSTE_MISTRAL_VIBE.retirer(appelHooks(home))).toBe('absent');
		expect(await HOOKS_DU_POSTE_MISTRAL_VIBE.remplacer(appelHooks(home))).toBe('absent');
	});

	it('plateforme donnée (Windows : commandes cmd) ; fichier en CRLF : blocs en CRLF, retirés sans trace', async () => {
		const home = await dossierTemporaire();
		const miens = '[[hooks]]\r\nname = "a-moi"\r\ntype = "session_start"\r\ncommand = "true"\r\n';
		await writeFile(join(home, 'hooks.toml'), miens);
		const windows = hooksDuPosteMistralVibe('win32');
		expect(await windows.installer(appelHooks(home))).toBe('installe');
		const texte = await readFile(join(home, 'hooks.toml'), 'utf8');
		expect(texte).toContain('%MNEMO_MOTEUR%');
		expect(texte.replace(/\r\n/gu, '')).not.toContain('\n');
		expect(await windows.lire(appelHooks(home))).toMatchObject({ etat: 'a_jour' });
		expect(await HOOKS_DU_POSTE_MISTRAL_VIBE.lire(appelHooks(home))).toMatchObject({ etat: process.platform === 'win32' ? 'a_jour' : 'perime' });
		expect(await windows.retirer(appelHooks(home))).toBe('retire');
		expect(await readFile(join(home, 'hooks.toml'), 'utf8')).toBe(miens);
	});

	it('hooks.toml illisible : échec à chaque action, fichier intact', async () => {
		const home = await dossierTemporaire();
		await writeFile(join(home, 'hooks.toml'), '[[hooks]\n');
		for (const action of ['lire', 'installer', 'remplacer', 'retirer'] as const) expect(await HOOKS_DU_POSTE_MISTRAL_VIBE[action](appelHooks(home)), action).toEqual({ echec: expect.stringContaining('TOML') });
		expect(await readFile(join(home, 'hooks.toml'), 'utf8')).toBe('[[hooks]\n');
	});
});

describe('mnemo declarer --moteur mistral-vibe et verifier-poste', () => {
	it('--remplacer puis --retirer : déclaration et hooks, sortie JSON', async () => {
		const home = await dossierTemporaire();
		await writeFile(join(home, 'config.toml'), `[[mcp_servers]]\nname = "mnemo"\ntransport = "stdio"\ncommand = "/vieux/node"\nargs = ["${MAIN}", "mcp"]\n`);
		await writeFile(join(home, 'hooks.toml'), blocsAttendus('/vieux/node', MAIN, process.platform).join('\n'));
		const lignes: string[] = [];
		const vibe = () => VIBE;
		await commandeDeclarer(['--moteur', 'mistral-vibe', '--remplacer', '--json'], { trouver: { 'mistral-vibe': vibe }, main: MAIN, env: { VIBE_HOME: home } }, (l) => lignes.push(l));
		expect(JSON.parse(lignes[0]!)).toEqual({
			resultat: 'remplace',
			message: 'Mistral Vibe : Déclaration MCP refaite avec ce Node et ce Mnemo.',
			hooks: { resultat: 'remplace', message: 'Mistral Vibe : Hooks de Mnemo refaits avec ce Node et ce Mnemo.' },
		});
		await commandeDeclarer(['--moteur', 'mistral-vibe', '--retirer'], { trouver: { 'mistral-vibe': vibe }, main: MAIN, env: { VIBE_HOME: home } }, (l) => lignes.push(l));
		expect(lignes.slice(1)).toEqual(['Mistral Vibe : Déclaration MCP retirée.', 'Mistral Vibe : Hooks de Mnemo retirés de hooks.toml.']);
		expect((await readFile(join(home, 'config.toml'), 'utf8')).trim()).toBe('');
	});

	it('verifier-poste : chemin, version (faux vibe), déclaration et hooks', async () => {
		const home = await dossierTemporaire();
		const faux = join(home, 'faux-vibe.mjs');
		await writeFile(faux, "process.stdout.write(process.argv.slice(2).join(' ') === '--version' ? 'vibe 3.1.4\\n' : '');\n");
		const reel = executeurReel();
		const executer: Executer = async (commande, args, options) => (commande === 'git' ? { code: 0, sortie: 'git version 2.50.1\n', erreur: '' } : reel(commande, args, options));
		const poste = await verifierPoste({
			executer,
			trouver: { 'claude-code': () => null, codex: () => null, 'mistral-vibe': () => ({ commande: process.execPath, avant: [faux] }) },
			versionNode: '26.0.0',
			main: MAIN,
			plateforme: process.platform,
			env: { VIBE_HOME: home },
		});
		const lignes: string[] = [];
		await commandeVerifierPoste([], { executer, trouver: { 'claude-code': () => VIBE, codex: () => null, 'mistral-vibe': () => ({ commande: process.execPath, avant: [faux] }) }, versionNode: '26.0.0', main: MAIN, env: { VIBE_HOME: home } }, (l) => lignes.push(l));
		expect(lignes[3]).toBe(`Mistral Vibe : ${faux} (Mistral Vibe 3.1.4 trop ancien, 3.1.5 ou plus requis) ; serveur MCP non déclaré (mnemo init --mistral) ; hooks non installés (mnemo init --mistral)`);
		expect(poste.mistral).toEqual({ ok: true, chemin: faux, version: '3.1.4', mcp: { etat: 'absent' }, hooks: { etat: 'absent' } });
	});
});

describe('télémétrie de Mistral Vibe (dossier de session)', () => {
	async function sessionVibe(home: string, id: string, journal: string): Promise<string> {
		const dossier = join(home, 'logs', 'session', 'unified', id);
		await mkdir(join(dossier, 'journal'), { recursive: true });
		await mkdir(join(dossier, 'generations', '0000000000000048'), { recursive: true });
		await writeFile(join(dossier, 'CURRENT'), '{"generation":"0000000000000048"}');
		await writeFile(join(dossier, 'journal', '0000000000000048.jsonl'), journal);
		await writeFile(join(dossier, 'journal', '0000000000000049.jsonl'), '');
		await writeFile(join(dossier, 'generations', '0000000000000048', 'runtime-state.json'), JSON.stringify({ core_settings: { context: { model_facts: { context_window: 262144 } } } }));
		await writeFile(join(dossier, 'generations', '0000000000000048', 'projection-state.json'), JSON.stringify({ snapshot: { session: { contextUsage: { totalTokens: 7 } } } }));
		return dossier;
	}
	const ligne = (total: number) => `${JSON.stringify({ type: 'projection_delta', payload: { delta: [{ op: 'set_envelope', state: { session: { contextUsage: { totalTokens: total } } } }] } })}\n`;

	it('fenêtre lue dans le dossier donné par le hook, sinon par le fil ; hors de logs/session/unified : rien', async () => {
		const home = await dossierTemporaire();
		const dossier = await sessionVibe(home, 'abc-1', ligne(100) + ligne(1290));
		const lecture = lectureTranscriptionMistralVibe({ env: () => ({ VIBE_HOME: home }), accueil: '/nulle/part' });
		expect(await lecture.lire({ chemin: dossier })).toEqual({ fenetre: { utilises: 1290, max: 262144 } });
		expect(await lecture.lire({ fil: 'abc-1' })).toEqual({ fenetre: { utilises: 1290, max: 262144 } });
		expect(await lecture.lire({ fil: '../x' })).toBeNull();
		const ailleurs = await dossierTemporaire();
		const lien = join(ailleurs, 'lien');
		await symlink(join(home, 'logs'), lien);
		expect(await lecture.lire({ chemin: join(ailleurs, 'session') })).toBeNull();
		// journal sans contextUsage : l'état de la génération courante
		const autre = await sessionVibe(home, 'abc-2', '{"type":"autre"}\n');
		expect(await lecture.lire({ chemin: autre })).toEqual({ fenetre: { utilises: 7, max: 262144 } });
	});
});

describe('Mistral Vibe : modèles, version, registres', () => {
	it('modèles : alias de config.toml puis intégrés ; introuvable : aucun', async () => {
		const home = await dossierTemporaire();
		await writeFile(join(home, 'config.toml'), '[[models]]\nname = "factice"\nalias = "local"\n');
		expect(await modelesMistralVibe({ executer: executeurReel(), commande: VIBE, env: { VIBE_HOME: home } })).toEqual(['local', ...MODELES_INTEGRES_MISTRAL_VIBE]);
		expect(await modelesMistralVibe({ executer: executeurReel(), commande: null, env: { VIBE_HOME: home } })).toEqual([]);
	});

	it('version lue par le faux vibe (vibe --version) ; trop ancienne : refus de session', async () => {
		const d = await dossierTemporaire();
		const faux = join(d, 'faux-vibe.mjs');
		await writeFile(faux, "if (process.argv.slice(2).join(' ') !== '--version') process.exit(3);\nprocess.stdout.write('vibe 3.1.4\\n');\n");
		const commande = trouverVibe({ MNEMO_VIBE: faux }, 'darwin')!;
		const version = await MOTEUR_MISTRAL_VIBE.version!(commande, {}, undefined, { relire: true });
		expect(version).toBe('3.1.4');
		expect(MOTEUR_MISTRAL_VIBE.refusDeVersion!(version)).toBe('Mistral Vibe 3.1.4 trop ancien, 3.1.5 ou plus requis');
	});

	it('registres : le même moteur pour les sessions et le poste ; marque de session dans --agent ; sans commande : refus', () => {
		expect(MOTEURS.find((m) => m.id === 'mistral-vibe')).toBe(MOTEURS_DU_POSTE['mistral-vibe']);
		expect(MOTEUR_MISTRAL_VIBE.declarationMcp).toBe(DECLARATION_MCP_MISTRAL_VIBE);
		expect(MOTEUR_MISTRAL_VIBE.hooksDuPoste?.chemin({ VIBE_HOME: '/h' })).toBe(join('/h', 'hooks.toml'));
		expect(MOTEUR_MISTRAL_VIBE.sansCommande).toBe('refus');
		expect(MOTEUR_MISTRAL_VIBE.marqueDeSession('0f1e2d3c-4b5a-4968-8776-655443322110')).toBe('mnemo-0f1e2d3c-4b5a-4968-8776-655443322110');
	});
});
