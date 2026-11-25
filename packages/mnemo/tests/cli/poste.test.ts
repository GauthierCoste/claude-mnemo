/** `mnemo verifier-poste` : git, Claude Code, Codex et Node, sans lancer ni le vrai `git`, ni le vrai `claude`, ni le vrai `codex`. */
import type { PosteVerifie } from '@mnemo/contrat';
import { describe, expect, it } from 'vitest';
import type { Executer } from '../../src/application/ports.ts';
import { commandeVerifierPoste, verifierPoste } from '../../src/adaptateurs/cli/poste.ts';

const gitRepond = (code: number, sortie: string, erreur = ''): Executer => async (commande, args) => {
	expect([commande, ...args]).toEqual(['git', '--version']);
	return { code, sortie, erreur };
};
const gitAbsent: Executer = async () => Promise.reject(Object.assign(new Error('spawn git ENOENT'), { code: 'ENOENT' }));
const claude = () => ({ commande: '/opt/outils/claude', avant: [] });
/** Sans Codex : rien d'autre n'est lancé que `git`. */
const sansCodex = { codex: () => null, main: '/chemin/absolu/main.ts', plateforme: 'darwin', env: {} };
const CODEX_ABSENT = { ok: false, motif: expect.stringMatching(/^Codex introuvable/u) };

describe('verifierPoste', () => {
	it('tout est là : versions et chemin', async () => {
		expect(await verifierPoste({ executer: gitRepond(0, 'git version 2.50.1 (Apple Git-155)\n'), claude, versionNode: '26.13.1', ...sansCodex })).toEqual({
			git: { ok: true, version: '2.50.1' },
			claude: { ok: true, chemin: '/opt/outils/claude' },
			codex: CODEX_ABSENT,
			node: { version: '26.13.1' },
		});
	});

	it('git absent, claude introuvable : motifs', async () => {
		const poste = await verifierPoste({ executer: gitAbsent, claude: () => null, versionNode: '24.0.0', ...sansCodex });
		expect(poste.git).toEqual({ ok: false, motif: 'git introuvable dans le PATH.' });
		expect(poste.claude.ok).toBe(false);
		expect(poste.claude.motif).toMatch(/Claude Code introuvable/u);
	});

	it('git du système sans outils de développement (macOS) : la première ligne de son erreur', async () => {
		const poste = await verifierPoste({ executer: gitRepond(1, '', 'xcrun: error: invalid active developer path\nautre'), claude, versionNode: '26.0.0', ...sansCodex });
		expect(poste.git).toEqual({ ok: false, motif: 'xcrun: error: invalid active developer path' });
	});

	it('claude par un script (MNEMO_CLAUDE en .mjs) : le chemin est celui du script', async () => {
		const poste = await verifierPoste({ executer: gitRepond(0, 'git version 2.40.0'), claude: () => ({ commande: '/bin/node', avant: ['/tmp/faux-claude.mjs'] }), versionNode: '26.0.0', ...sansCodex });
		expect(poste.claude).toEqual({ ok: true, chemin: '/tmp/faux-claude.mjs' });
	});
});

describe('mnemo verifier-poste', () => {
	it('--json : un objet sur une ligne, même s’il manque quelque chose', async () => {
		const lignes: string[] = [];
		await commandeVerifierPoste(['--json'], { executer: gitAbsent, claude, versionNode: '26.13.1', ...sansCodex }, (l) => lignes.push(l));
		expect(lignes).toHaveLength(1);
		expect(JSON.parse(lignes[0]!) as PosteVerifie).toEqual({ git: { ok: false, motif: 'git introuvable dans le PATH.' }, claude: { ok: true, chemin: '/opt/outils/claude' }, codex: CODEX_ABSENT, node: { version: '26.13.1' } });
	});

	it('texte : une ligne par élément ; il manque claude : code 1', async () => {
		const lignes: string[] = [];
		await expect(commandeVerifierPoste([], { executer: gitRepond(0, 'git version 2.50.1'), claude: () => null, versionNode: '26.13.1', ...sansCodex }, (l) => lignes.push(l))).rejects.toMatchObject({ code: 1 });
		expect(lignes[0]).toBe('git : 2.50.1');
		expect(lignes[1]).toMatch(/^Claude Code : absent — /u);
		expect(lignes[2]).toMatch(/^Codex : absent \(facultatif\) — /u);
		expect(lignes[3]).toBe('Node : 26.13.1');
	});

	it('option inconnue : erreur d’usage', async () => {
		await expect(commandeVerifierPoste(['--tout'], { executer: gitAbsent, claude, versionNode: '1', ...sansCodex }, () => {})).rejects.toMatchObject({ code: 2 });
	});
});

describe('verifier-poste : Codex', () => {
	const MAIN = '/chemin/absolu/main.ts';
	const CODEX = { commande: '/opt/outils/codex', avant: [] };
	/** `git --version` répond ; `codex mcp get mnemo --json` rend `get`. */
	const repond = (get: { code: number; sortie: string; erreur: string }): Executer => async (commande, args, options) => {
		if (commande === 'git') return { code: 0, sortie: 'git version 2.50.1', erreur: '' };
		expect([commande, ...args]).toEqual(['/opt/outils/codex', 'mcp', 'get', 'mnemo', '--json']);
		// délai court dédié, comme `git --version`
		expect(options).toEqual({ delaiMs: 10_000 });
		return get;
	};
	const declaration = (command: string, args: string[]) => ({ code: 0, sortie: JSON.stringify({ name: 'mnemo', enabled: true, transport: { type: 'stdio', command, args } }), erreur: '' });
	const deps = (executer: Executer) => ({ executer, claude, codex: () => CODEX, versionNode: '26.13.1', main: MAIN, plateforme: 'darwin', env: {} });

	it('trouvé : son chemin et l’état de sa déclaration MCP, lue sans rien changer', async () => {
		const cas: [{ code: number; sortie: string; erreur: string }, string][] = [
			[declaration(process.execPath, [MAIN, 'mcp']), 'deja'],
			[{ code: 1, sortie: '', erreur: "Error: No MCP server named 'mnemo' found.\n" }, 'absent'],
			[declaration('/vieux/node', ['/autre/packages/mnemo/src/adaptateurs/cli/main.ts', 'mcp']), 'perime'],
			[declaration('/usr/bin/python3', ['/opt/serveur.py']), 'autre'],
		];
		for (const [get, etat] of cas) expect((await verifierPoste(deps(repond(get)))).codex, etat).toEqual({ ok: true, chemin: '/opt/outils/codex', mcp: { etat } });
		const desactivee = JSON.stringify({ name: 'mnemo', enabled: false, transport: { type: 'stdio', command: process.execPath, args: [MAIN, 'mcp'] } });
		expect((await verifierPoste(deps(repond({ code: 0, sortie: desactivee, erreur: '' })))).codex.mcp).toEqual({ etat: 'desactive', motif: expect.stringContaining('enabled = false') });
		const illisible = await verifierPoste(deps(repond({ code: 0, sortie: 'pas du JSON', erreur: '' })));
		expect(illisible.codex.mcp).toEqual({ etat: 'echec', motif: expect.any(String) });
	});

	it('texte : une ligne Codex ; Codex absent n’est pas un manque (code 0)', async () => {
		const lignes: string[] = [];
		await commandeVerifierPoste([], deps(repond({ code: 1, sortie: '', erreur: "Error: No MCP server named 'mnemo' found." })), (l) => lignes.push(l));
		expect(lignes[2]).toBe('Codex : /opt/outils/codex — serveur MCP non déclaré (mnemo init --codex)');
		const sans: string[] = [];
		await commandeVerifierPoste([], { ...deps(repond(declaration('x', []))), codex: () => null }, (l) => sans.push(l));
		expect(sans[2]).toMatch(/^Codex : absent \(facultatif\)/u);
	});
});
