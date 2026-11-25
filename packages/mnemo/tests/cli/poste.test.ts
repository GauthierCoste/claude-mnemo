/** `mnemo verifier-poste` : git, Claude Code, Codex, Mistral Vibe et Node, sans lancer ni le vrai `git`, ni le vrai `claude`, ni le vrai `codex`, ni le vrai `vibe`. */
import type { PosteVerifie } from '@mnemo/contrat';
import { describe, expect, it } from 'vitest';
import type { Executer } from '../../src/application/ports.ts';
import { commandeVerifierPoste, verifierPoste } from '../../src/adaptateurs/cli/poste.ts';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { hooksAttendus, remplacerHooks } from '../../src/domaine/moteurs/codex/hooks-installes.ts';
import { texteJsonReecrit } from '../../src/domaine/moteurs/codex/json-texte.ts';
import { nodeDurable } from '../../src/infra/node-durable.ts';
import { dossierTemporaire } from '../aides/dossier-temporaire.ts';

const gitRepond = (code: number, sortie: string, erreur = ''): Executer => async (commande, args) => {
	expect([commande, ...args]).toEqual(['git', '--version']);
	return { code, sortie, erreur };
};
const gitAbsent: Executer = async () => Promise.reject(Object.assign(new Error('spawn git ENOENT'), { code: 'ENOENT' }));
const CLAUDE = () => ({ commande: '/opt/outils/claude', avant: [] });
/** Sans Codex : rien d'autre n'est lancé que `git`. */
const sansCodex = { main: '/chemin/absolu/main.ts', plateforme: 'darwin', env: {} };
const CODEX_ABSENT = { ok: false, motif: expect.stringMatching(/^Codex introuvable/u) };
const MISTRAL_ABSENT = { ok: false, motif: expect.stringMatching(/^Mistral Vibe introuvable/u) };

describe('verifierPoste', () => {
	it('tout est là : versions et chemin', async () => {
		expect(await verifierPoste({ executer: gitRepond(0, 'git version 2.50.1 (Apple Git-155)\n'), trouver: { 'claude-code': CLAUDE, codex: () => null, 'mistral-vibe': () => null }, versionNode: '26.13.1', ...sansCodex })).toEqual({
			git: { ok: true, version: '2.50.1' },
			claude: { ok: true, chemin: '/opt/outils/claude' },
			codex: CODEX_ABSENT,
			mistral: MISTRAL_ABSENT,
			node: { version: '26.13.1' },
		});
	});

	it('git absent, claude introuvable : motifs', async () => {
		const poste = await verifierPoste({ executer: gitAbsent, trouver: { 'claude-code': () => null, codex: () => null, 'mistral-vibe': () => null }, versionNode: '24.0.0', ...sansCodex });
		expect(poste.git).toEqual({ ok: false, motif: 'git introuvable dans le PATH.' });
		expect(poste.claude.ok).toBe(false);
		expect(poste.claude.motif).toMatch(/Claude Code introuvable/u);
	});

	it('git du système sans outils de développement (macOS) : la première ligne de son erreur', async () => {
		const poste = await verifierPoste({ executer: gitRepond(1, '', 'xcrun: error: invalid active developer path\nautre'), trouver: { 'claude-code': CLAUDE, codex: () => null, 'mistral-vibe': () => null }, versionNode: '26.0.0', ...sansCodex });
		expect(poste.git).toEqual({ ok: false, motif: 'xcrun: error: invalid active developer path' });
	});

	it('claude par un script (MNEMO_CLAUDE en .mjs) : le chemin est celui du script', async () => {
		const poste = await verifierPoste({ executer: gitRepond(0, 'git version 2.40.0'), trouver: { 'claude-code': () => ({ commande: '/bin/node', avant: ['/tmp/faux-claude.mjs'] }), codex: () => null, 'mistral-vibe': () => null }, versionNode: '26.0.0', ...sansCodex });
		expect(poste.claude).toEqual({ ok: true, chemin: '/tmp/faux-claude.mjs' });
	});
});

describe('mnemo verifier-poste', () => {
	it('--json : un objet sur une ligne, même s’il manque quelque chose', async () => {
		const lignes: string[] = [];
		await commandeVerifierPoste(['--json'], { executer: gitAbsent, trouver: { 'claude-code': CLAUDE, codex: () => null, 'mistral-vibe': () => null }, versionNode: '26.13.1', ...sansCodex }, (l) => lignes.push(l));
		expect(lignes).toHaveLength(1);
		expect(JSON.parse(lignes[0]!) as PosteVerifie).toEqual({ git: { ok: false, motif: 'git introuvable dans le PATH.' }, claude: { ok: true, chemin: '/opt/outils/claude' }, codex: CODEX_ABSENT, mistral: MISTRAL_ABSENT, node: { version: '26.13.1' } });
	});

	it('texte : une ligne par élément ; il manque claude : code 1', async () => {
		const lignes: string[] = [];
		await expect(commandeVerifierPoste([], { executer: gitRepond(0, 'git version 2.50.1'), trouver: { 'claude-code': () => null, codex: () => null, 'mistral-vibe': () => null }, versionNode: '26.13.1', ...sansCodex }, (l) => lignes.push(l))).rejects.toMatchObject({ code: 1 });
		expect(lignes[0]).toBe('git : 2.50.1');
		expect(lignes[1]).toMatch(/^Claude Code : absent ; /u);
		expect(lignes[2]).toMatch(/^Codex : absent \(facultatif\) ; /u);
		expect(lignes[3]).toMatch(/^Mistral Vibe : absent \(facultatif\) ; /u);
		expect(lignes[4]).toBe('Node : 26.13.1');
	});

	it('option inconnue : erreur d’usage', async () => {
		await expect(commandeVerifierPoste(['--tout'], { executer: gitAbsent, trouver: { 'claude-code': CLAUDE, codex: () => null, 'mistral-vibe': () => null }, versionNode: '1', ...sansCodex }, () => {})).rejects.toMatchObject({ code: 2 });
	});
});

describe('verifier-poste : Codex', () => {
	const MAIN = '/chemin/absolu/main.ts';
	const CODEX = { commande: '/opt/outils/codex', avant: [] };
	/** `git --version` répond ; `codex --version` rend `version` ; `codex mcp get mnemo --json` rend `get`. */
	const repond = (get: { code: number; sortie: string; erreur: string }, version = 'codex-cli 0.171.0-alpha.13\n'): Executer => async (commande, args, options) => {
		if (commande === 'git') return { code: 0, sortie: 'git version 2.50.1', erreur: '' };
		if (args[0] === '--version') {
			expect(commande).toBe('/opt/outils/codex');
			// délai court, environnement des sessions (sans CODEX_API_KEY)
			expect(options).toEqual({ delaiMs: 5000, env: { CODEX_HOME: expect.any(String) } });
			return { code: 0, sortie: version, erreur: '' };
		}
		expect([commande, ...args]).toEqual(['/opt/outils/codex', 'mcp', 'get', 'mnemo', '--json']);
		// délai court dédié, comme `git --version`
		expect(options).toEqual({ delaiMs: 10_000 });
		return get;
	};
	const declaration = (command: string, args: string[]) => ({ code: 0, sortie: JSON.stringify({ name: 'mnemo', enabled: true, transport: { type: 'stdio', command, args } }), erreur: '' });
	/** `CODEX_HOME` jetable, jamais le vrai `~/.codex` ; vide par défaut : aucun hook. */
	const MAISON = join('/nulle-part', 'codex-home-absent');
	const deps = (executer: Executer, maison = MAISON) => ({ executer, trouver: { 'claude-code': CLAUDE, codex: () => CODEX, 'mistral-vibe': () => null }, versionNode: '26.13.1', main: MAIN, plateforme: 'darwin', env: { CODEX_HOME: maison, CODEX_API_KEY: 'sk-secret' } });

	it('trouvé : son chemin et l’état de sa déclaration MCP, lue sans rien changer', async () => {
		const cas: [{ code: number; sortie: string; erreur: string }, string][] = [
			[declaration(process.execPath, [MAIN, 'mcp']), 'deja'],
			[{ code: 1, sortie: '', erreur: "Error: No MCP server named 'mnemo' found.\n" }, 'absent'],
			[declaration('/vieux/node', ['/autre/packages/mnemo/src/adaptateurs/cli/main.ts', 'mcp']), 'perime'],
			[declaration('/usr/bin/python3', ['/opt/serveur.py']), 'autre'],
		];
		for (const [get, etat] of cas) expect((await verifierPoste(deps(repond(get)))).codex, etat).toEqual({ ok: true, chemin: '/opt/outils/codex', version: '0.171.0-alpha.13', mcp: { etat }, hooks: { etat: 'absent' } });
		const desactivee = JSON.stringify({ name: 'mnemo', enabled: false, transport: { type: 'stdio', command: process.execPath, args: [MAIN, 'mcp'] } });
		expect((await verifierPoste(deps(repond({ code: 0, sortie: desactivee, erreur: '' })))).codex.mcp).toEqual({ etat: 'desactive', motif: expect.stringContaining('enabled = false') });
		const illisible = await verifierPoste(deps(repond({ code: 0, sortie: 'pas du JSON', erreur: '' })));
		expect(illisible.codex.mcp).toEqual({ etat: 'echec', motif: expect.any(String) });
	});

	it('texte : une ligne Codex ; Codex absent n’est pas un manque (code 0)', async () => {
		const lignes: string[] = [];
		await commandeVerifierPoste([], deps(repond({ code: 1, sortie: '', erreur: "Error: No MCP server named 'mnemo' found." })), (l) => lignes.push(l));
		expect(lignes[2]).toBe('Codex : /opt/outils/codex (0.171.0-alpha.13) ; serveur MCP non déclaré (mnemo init --codex) ; hooks non installés (mnemo init --codex)');
		// trop ancien : dit ; illisible : absente, sans autre conséquence
		const ancien: string[] = [];
		await commandeVerifierPoste([], deps(repond(declaration(process.execPath, [MAIN, 'mcp']), 'codex-cli 0.150.0')), (l) => ancien.push(l));
		expect(ancien[2]).toMatch(/^Codex : \/opt\/outils\/codex \(Codex 0\.150\.0 trop ancien, 0\.171 ou plus requis\) ; serveur MCP déclaré/u);
		const illisible = await verifierPoste(deps(repond(declaration(process.execPath, [MAIN, 'mcp']), 'codex dev')));
		expect(illisible.codex).not.toHaveProperty('version');
		expect(illisible.codex.ok).toBe(true);
		const sans: string[] = [];
		await commandeVerifierPoste([], { ...deps(repond(declaration('x', []))), trouver: { 'claude-code': CLAUDE, codex: () => null, 'mistral-vibe': () => null } }, (l) => sans.push(l));
		expect(sans[2]).toMatch(/^Codex : absent \(facultatif\)/u);
	});

	it('hooks de Mnemo : à jour et à approuver, approuvés (empreinte non recalculée, dit), périmés, illisibles', async () => {
		const maison = await dossierTemporaire();
		await mkdir(maison, { recursive: true });
		const get = declaration(process.execPath, [MAIN, 'mcp']);
		const MAIN_MNEMO = '/depot/packages/mnemo/src/adaptateurs/cli/main.ts';
		const avec = (executer: Executer) => ({ ...deps(executer, maison), main: MAIN_MNEMO });
		const fichier = join(maison, 'hooks.json');
		await writeFile(fichier, texteJsonReecrit(remplacerHooks({}, hooksAttendus(nodeDurable('darwin'), MAIN_MNEMO)), null));
		expect((await verifierPoste(avec(repond(get)))).codex.hooks).toEqual({ etat: 'a_jour', approbation: { etat: 'a_approuver', motif: expect.stringContaining('7 hook(s) de Mnemo sur 7') } });
		const cles = ['session_start', 'user_prompt_submit', 'pre_tool_use', 'post_tool_use', 'stop', 'permission_request', 'session_end'];
		await writeFile(join(maison, 'config.toml'), cles.map((c) => `[hooks.state."${fichier}:${c}:0:0"]\ntrusted_hash = "sha256:0"\n`).join('\n'));
		const approuves = (await verifierPoste(avec(repond(get)))).codex.hooks;
		expect(approuves).toEqual({ etat: 'a_jour', approbation: { etat: 'approuves', motif: expect.stringContaining('recalculer') } });
		const lignes: string[] = [];
		await commandeVerifierPoste([], avec(repond(get)), (l) => lignes.push(l));
		expect(lignes[2]).toMatch(/^Codex : \/opt\/outils\/codex \(0\.171\.0-alpha\.13\) ; .* ; hooks installés, approuvés \(approbation enregistrée/u);
		await writeFile(fichier, texteJsonReecrit(remplacerHooks({}, hooksAttendus('/vieux/node', MAIN_MNEMO)), null));
		expect((await verifierPoste(avec(repond(get)))).codex.hooks).toEqual({ etat: 'perime' });
		await writeFile(fichier, '{');
		expect((await verifierPoste(avec(repond(get)))).codex.hooks).toEqual({ etat: 'echec', motif: expect.stringContaining('JSON illisible') });
	});
});
