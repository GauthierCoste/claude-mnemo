import { describe, expect, it } from 'vitest';
import { HOOKS_CLAUDE_CODE } from '../../src/application/moteurs/claude-code/hooks.ts';
import { HOOKS_COPILOT_CLI } from '../../src/application/moteurs/copilot-cli/hooks.ts';
import { argumentsCopilotCli, declarationDeSession, FICHIER_DE_CONSIGNE, fichiersDeSessionCopilotCli, preparerCopilotCli, texteDeConsigne, variablesDeCopilot } from '../../src/application/moteurs/copilot-cli/session.ts';
import { hooksDuMoteur } from '../../src/application/moteurs/hooks.ts';
import type { AppelHook, ContextePreparation } from '../../src/application/ports.ts';
import { OUTILS_MNEMO_PERMIS } from '../../src/domaine/moteurs/outils-permis.ts';
import { PROFILS_PAR_DEFAUT } from '../../src/domaine/profil.ts';
import type { Profil } from '../../src/domaine/profil.ts';
import type { EvenementHook, Session } from '../../src/domaine/session.ts';
import { fauxPorts } from '../aides/faux-ports.ts';

const ID = '0f1e2d3c-4b5a-4968-8776-655443322110';
const session = (champs: Partial<Session> = {}): Session => ({
	id: ID,
	profil: 'redaction',
	dossier: 'alpha',
	position: 'projets/alpha',
	projet: 'alpha',
	objectif: null,
	etat: 'attend',
	creeeMs: 0,
	majMs: 0,
	arretAttendu: null,
	bilanDemandeMs: null,
	commitDebut: null,
	branche: null,
	pid: null,
	moteur: 'copilot-cli',
	modele: '',
	...champs,
});
const PROFIL: Profil = { ...PROFILS_PAR_DEFAUT.travail, nom: 'redaction', hooks: [...PROFILS_PAR_DEFAUT.travail.hooks], consigne: 'Rédige les courriers.\n', moteur: 'copilot-cli' };
const APPEL = { node: '/opt/node/bin/node', main: '/opt/mnemo/src/adaptateurs/cli/main.ts', version: '9.9.9-essai' };
const RACINE = '/maison/Mnemo';
const DE_SESSION = { MNEMO_SESSION: ID, MNEMO_MOTEUR: 'copilot-cli', MNEMO_PROJET: 'alpha', MNEMO_RACINE: RACINE };
const PERMIS = OUTILS_MNEMO_PERMIS.map((o) => `--allow-tool=mnemo(${o})`);

describe('arguments de copilot', () => {
	it('nouvelle session : --session-id (marque et fil), serveur MCP de la session, outils permis ; modèle, racine et premier message collés à leur option', () => {
		const mcp = `--additional-mcp-config=${declarationDeSession(APPEL, DE_SESSION)}`;
		expect(argumentsCopilotCli({ session: session(), profil: { lancement: 'projet' }, racine: RACINE, deSession: DE_SESSION, appel: APPEL })).toEqual([`--session-id=${ID}`, mcp, '--enable-mcp-server=mnemo', ...PERMIS]);
		expect(argumentsCopilotCli({ session: session({ modele: 'gpt-5.2' }), profil: { lancement: 'memoire' }, racine: RACINE, deSession: DE_SESSION, appel: APPEL, objectif: '--help' })).toEqual([
			`--session-id=${ID}`,
			'--model=gpt-5.2',
			`--add-dir=${RACINE}`,
			mcp,
			'--enable-mcp-server=mnemo',
			...PERMIS,
			'--interactive=--help',
		]);
		expect(JSON.parse(declarationDeSession(APPEL, DE_SESSION))).toEqual({
			mcpServers: { mnemo: { type: 'local', command: APPEL.node, args: [APPEL.main, 'mcp'], env: DE_SESSION, tools: ['*'] } },
		});
	});

	it('uuid ou modèle invalides : refusés ; un objectif vide n’est pas envoyé', () => {
		expect(() => argumentsCopilotCli({ session: session({ id: 'x' }), profil: { lancement: 'projet' }, racine: RACINE, deSession: DE_SESSION, appel: APPEL })).toThrow(/uuid/u);
		expect(() => argumentsCopilotCli({ session: session({ modele: '-x y' }), profil: { lancement: 'projet' }, racine: RACINE, deSession: DE_SESSION, appel: APPEL })).toThrow(/Modèle/u);
		expect(argumentsCopilotCli({ session: session(), profil: { lancement: 'projet' }, racine: RACINE, deSession: DE_SESSION, appel: APPEL, objectif: '  ' }).some((a) => a.startsWith('--interactive'))).toBe(false);
	});
});

describe('consigne et environnement de copilot', () => {
	it('fichier d’instructions de la session : la consigne, sans en-tête ; une consigne qui commence par --- n’en devient jamais un', async () => {
		const fichiers = await fichiersDeSessionCopilotCli(fauxPorts(), session(), PROFIL, APPEL);
		expect(fichiers.map((f) => f.chemin)).toEqual([FICHIER_DE_CONSIGNE]);
		expect(FICHIER_DE_CONSIGNE).toBe('.github/instructions/mnemo.instructions.md');
		expect(fichiers[0]!.texte.startsWith('Rédige les courriers.')).toBe(true);
		expect(fichiers[0]!.texte.endsWith('\n')).toBe(true);
		expect(texteDeConsigne('Une ligne.\n\n')).toBe('Une ligne.\n');
		expect(texteDeConsigne('---\nx: 1\n---\nTexte')).toBe('\n---\nx: 1\n---\nTexte\n');
	});

	it('dossier de session en tête des dossiers d’instructions, ceux de l’utilisateur gardés ; une virgule dans le chemin est refusée', () => {
		expect(variablesDeCopilot({}, '/r/.mnemo/plugins/x')).toEqual({ COPILOT_CUSTOM_INSTRUCTIONS_DIRS: '/r/.mnemo/plugins/x' });
		expect(variablesDeCopilot({ COPILOT_CUSTOM_INSTRUCTIONS_DIRS: '/a,/b' }, '/r/x')).toEqual({ COPILOT_CUSTOM_INSTRUCTIONS_DIRS: '/r/x,/a,/b' });
		expect(() => variablesDeCopilot({}, '/r/a,b')).toThrow(/virgule/u);
	});

	it('preparer : variables de la session et de la consigne ; celles de l’utilisateur gardées', () => {
		const c: ContextePreparation = {
			session: session(),
			profil: PROFIL,
			mode: 'reprise',
			objectif: 'Fais le bilan.',
			dossierFichiers: '/r/.mnemo/plugins/x',
			fichiers: [],
			racine: RACINE,
			appel: APPEL,
			env: { PATH: '/bin', COPILOT_HOME: '/c', COPILOT_GITHUB_TOKEN: 'gho', GITHUB_TOKEN: 'ghp', CODEX_API_KEY: 'k', Mistral_Api_Key: 'm', ANTHROPIC_BASE_URL: 'http://x', CLAUDECODE: '1' },
		};
		const l = preparerCopilotCli(c);
		expect(l.args[0]).toBe(`--session-id=${ID}`);
		expect(l.args.at(-1)).toBe('--interactive=Fais le bilan.');
		expect(l.env).toMatchObject({ PATH: '/bin', COPILOT_HOME: '/c', ...DE_SESSION, COPILOT_CUSTOM_INSTRUCTIONS_DIRS: '/r/.mnemo/plugins/x' });
		expect(Object.keys(l.ajouts).sort()).toEqual(['COPILOT_CUSTOM_INSTRUCTIONS_DIRS', 'MNEMO_HOOKS', 'MNEMO_MOTEUR', 'MNEMO_PROJET', 'MNEMO_RACINE', 'MNEMO_SESSION']);
		// variables d'un autre fournisseur retirées (sans la casse) ; COPILOT_GITHUB_TOKEN et GITHUB_TOKEN gardées
		expect(l.env).toMatchObject({ COPILOT_GITHUB_TOKEN: 'gho', GITHUB_TOKEN: 'ghp' });
		for (const v of ['CODEX_API_KEY', 'Mistral_Api_Key', 'ANTHROPIC_BASE_URL', 'CLAUDECODE']) expect(l.env).not.toHaveProperty(v);
		expect(l.retirees).toEqual(['CODEX_API_KEY', 'Mistral_Api_Key', 'ANTHROPIC_BASE_URL', 'CLAUDECODE']);
	});
});

describe('hooks de GitHub Copilot CLI', () => {
	const ENV = { MNEMO_SESSION: ID, MNEMO_MOTEUR: 'copilot-cli' };
	const appel = (evenement: EvenementHook, entree: Record<string, unknown> = {}, options: string[] = [], env: Record<string, string> = ENV): AppelHook => ({
		evenement,
		options: new Set(options),
		lecture: { texte: JSON.stringify({ sessionId: ID, timestamp: 1795634385845, cwd: '/p', ...entree }) },
		env,
		maintenantMs: 1,
		cwdProcessus: '/q',
		reel: (c) => c,
	});

	it('arguments : noms Mnemo ou événements de Copilot ; notification : arret --notification ; permissionRequest : inconnu', () => {
		expect(hooksDuMoteur('copilot-cli')).toBe(HOOKS_COPILOT_CLI);
		expect(HOOKS_COPILOT_CLI.lireArguments(['sessionStart'])).toEqual({ evenement: 'debut', options: new Set() });
		expect(HOOKS_COPILOT_CLI.lireArguments(['preToolUse'])?.evenement).toBe('outil');
		expect(HOOKS_COPILOT_CLI.lireArguments(['notification'])).toEqual({ evenement: 'arret', options: new Set(['--notification']) });
		expect(HOOKS_COPILOT_CLI.lireArguments(['permissionRequest'])).toBeNull();
		expect(HOOKS_COPILOT_CLI.lireArguments(['arret', '--notification'])).toEqual({ evenement: 'arret', options: new Set(['--notification']) });
		expect(HOOKS_COPILOT_CLI.lireArguments(['preMcpToolCall'])).toBeNull();
	});

	it('traduction de l’entrée en camelCase : fil, source, message, outil (objet, ou patch en chaîne), journal de la session', () => {
		expect(HOOKS_COPILOT_CLI.traduire(appel('debut', { source: 'new', initialPrompt: 'Bonjour' }))).toEqual({ entree: { evenement: 'debut', session: ID, horodatageMs: 1, cwd: '/p', fil: ID, source: 'startup' } });
		expect(HOOKS_COPILOT_CLI.traduire(appel('debut', { source: 'resume' }))?.entree.source).toBe('resume');
		expect(HOOKS_COPILOT_CLI.traduire(appel('message', { prompt: 'Bonjour' }))?.entree.prompt).toBe('Bonjour');
		expect(HOOKS_COPILOT_CLI.traduire(appel('outil', { toolCallId: 'c1', toolName: 'bash', toolArgs: { command: 'git push --force', description: 'x' } }))?.entree.outil).toEqual({
			nom: 'bash',
			entree: { command: 'git push --force', description: 'x' },
		});
		expect(HOOKS_COPILOT_CLI.traduire(appel('outil', { toolName: 'apply_patch', toolArgs: '*** Begin Patch\n*** Add File: a.md\n+x\n*** End Patch' }))?.entree.outil).toEqual({
			nom: 'apply_patch',
			entree: { input: '*** Begin Patch\n*** Add File: a.md\n+x\n*** End Patch' },
		});
		expect(HOOKS_COPILOT_CLI.traduire(appel('arret', { transcriptPath: '/c/session-state/x/events.jsonl', stopReason: 'end_turn' }))).toMatchObject({ entree: { arret: 'stop' }, transcription: '/c/session-state/x/events.jsonl' });
		// la notification d'une demande d'approbation affichée (mesuré) : un dialogue ouvert ; une autre notification : ignorée
		const notification = (type: string) => ({ hook_event_name: 'Notification', notification_type: type, title: 'Permission needed', message: 'Run command: touch a' });
		expect(HOOKS_COPILOT_CLI.traduire(appel('arret', notification('permission_prompt'), ['--notification']))?.entree.arret).toBe('notification');
		expect(HOOKS_COPILOT_CLI.traduire(appel('arret', notification('elicitation_dialog'), ['--notification']))?.entree.arret).toBe('notification');
		expect(HOOKS_COPILOT_CLI.traduire(appel('arret', notification('agent_completed'), ['--notification']))).toBeNull();
		// `permissionRequest` reçu par la commande `arret --notification` d'un fichier d'avant : appelé pour tout outil évalué,
		// dialogue affiché ou non (mesuré) ; jamais un dialogue
		expect(HOOKS_COPILOT_CLI.traduire(appel('arret', { hookName: 'permissionRequest', toolName: 'bash', toolInput: { command: 'ls' }, permissionSuggestions: [] }, ['--notification']))).toBeNull();
		// sans cwd : le dossier du processus
		expect(HOOKS_COPILOT_CLI.traduire({ ...appel('message'), lecture: { texte: '{"sessionId":"x"}' } })?.entree.cwd).toBe('/q');
	});

	it('apres_outil que le profil ne demande pas : l’état seulement (il efface le dialogue ouvert), sans contexte ni fiche notée ; outil non demandé : rien', () => {
		const sansApresOutil = { ...ENV, MNEMO_HOOKS: 'debut,message,arret,fin' };
		expect(HOOKS_COPILOT_CLI.traduire(appel('apres_outil', { toolName: 'bash', toolArgs: { command: 'ls' } }, [], sansApresOutil))?.entree).toMatchObject({ evenement: 'apres_outil', sansContexte: true });
		expect(HOOKS_COPILOT_CLI.traduire(appel('outil', { toolName: 'bash', toolArgs: { command: 'ls' } }, [], sansApresOutil))).toBeNull();
		expect(HOOKS_COPILOT_CLI.traduire(appel('apres_outil', { toolName: 'bash', toolArgs: { command: 'ls' } }, [], { ...ENV, MNEMO_HOOKS: 'debut,message,apres_outil,arret,fin' }))?.entree.sansContexte).toBeUndefined();
	});

	it('fins : user_exit et complete comptent, clear est ignorée ; inerte hors d’une session GitHub Copilot CLI de Mnemo', () => {
		expect(HOOKS_COPILOT_CLI.traduire(appel('fin', { reason: 'user_exit' }))?.entree.evenement).toBe('fin');
		expect(HOOKS_COPILOT_CLI.traduire(appel('fin', { reason: 'clear' }))).toBeNull();
		expect(HOOKS_COPILOT_CLI.finIgnoreeSiVivante).toBe(true);
		for (const env of [{}, { MNEMO_SESSION: ID, MNEMO_MOTEUR: 'codex' }, { MNEMO_SESSION: 'x', MNEMO_MOTEUR: 'copilot-cli' }] as Record<string, string>[]) {
			expect(HOOKS_COPILOT_CLI.inerte(env)).toBe(true);
			expect(HOOKS_COPILOT_CLI.traduire(appel('debut', {}, [], env))).toBeNull();
		}
		expect(HOOKS_COPILOT_CLI.inerte(ENV)).toBe(false);
	});

	it('sorties : refus par permissionDecision deny, contexte par additionalContext au premier niveau ; rien sinon', () => {
		expect(JSON.parse(HOOKS_COPILOT_CLI.sortie('outil', { refus: 'Mnemo : non.' }))).toEqual({ permissionDecision: 'deny', permissionDecisionReason: 'Mnemo : non.' });
		expect(HOOKS_COPILOT_CLI.sortie('outil', {})).toBe('');
		for (const e of ['debut', 'message', 'apres_outil'] as const) expect(JSON.parse(HOOKS_COPILOT_CLI.sortie(e, { contexte: '## Consignes' }))).toEqual({ additionalContext: '## Consignes' });
		expect(HOOKS_COPILOT_CLI.sortie('arret', { contexte: 'x' })).toBe('');
		expect(HOOKS_COPILOT_CLI.sortie('debut', { contexte: ' ' })).toBe('');
	});

	it('hooks de Claude Code d’un .claude/settings.json lancés par Copilot (noms et entrée de Claude Code) : inertes dans sa session', () => {
		// ce que Copilot passe à un hook au format Claude Code (mesuré) : `session_id` est celui de Copilot
		const entree = { hook_event_name: 'PreToolUse', session_id: ID, timestamp: '2026-11-25T10:00:00.000Z', cwd: '/p', tool_name: 'Bash', tool_input: { command: 'git push --force' } };
		expect(HOOKS_CLAUDE_CODE.lireArguments(['PreToolUse'])?.evenement).toBe('outil');
		expect(HOOKS_CLAUDE_CODE.inerte(ENV)).toBe(true);
		// dans une session Claude Code de Mnemo, hors de Mnemo, ou chez un moteur qui ne les lit pas : jamais inertes, comme avant
		expect(HOOKS_CLAUDE_CODE.inerte({ MNEMO_SESSION: ID, MNEMO_MOTEUR: 'claude-code' })).toBe(false);
		expect(HOOKS_CLAUDE_CODE.inerte({ MNEMO_SESSION: ID, MNEMO_MOTEUR: 'codex' })).toBe(false);
		expect(HOOKS_CLAUDE_CODE.inerte({})).toBe(false);
		expect(HOOKS_CLAUDE_CODE.inerte({ MNEMO_MOTEUR: '' })).toBe(false);
		expect(HOOKS_CLAUDE_CODE.traduire({ ...appel('outil'), lecture: { texte: JSON.stringify(entree) }, env: { MNEMO_SESSION: ID, MNEMO_MOTEUR: 'claude-code' } })?.entree.outil).toEqual({
			nom: 'Bash',
			entree: { command: 'git push --force' },
		});
	});
});
