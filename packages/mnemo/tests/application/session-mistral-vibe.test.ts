import { describe, expect, it } from 'vitest';
import { HOOKS_MISTRAL_VIBE } from '../../src/application/moteurs/mistral-vibe/hooks.ts';
import { agentDeSession, argumentsMistralVibe, fichiersDeSessionMistralVibe, motifSansRepriseMistralVibe, preparerMistralVibe, profilDAgent } from '../../src/application/moteurs/mistral-vibe/session.ts';
import type { AppelHook, ContextePreparation } from '../../src/application/ports.ts';
import { OUTILS_MNEMO_PERMIS } from '../../src/domaine/moteurs/outils-permis.ts';
import { entreesToml } from '../../src/domaine/moteurs/toml-lecture.ts';
import { PROFILS_PAR_DEFAUT } from '../../src/domaine/profil.ts';
import type { Profil } from '../../src/domaine/profil.ts';
import type { EvenementHook, Session } from '../../src/domaine/session.ts';
import { fauxPorts } from '../aides/faux-ports.ts';

const ID = '0f1e2d3c-4b5a-4968-8776-655443322110';
const FIL = '51c9e649-852b-5600-3455-d7bdd6bed1e3';
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
	moteur: 'mistral-vibe',
	modele: '',
	...champs,
});
const PROFIL: Profil = { ...PROFILS_PAR_DEFAUT.travail, nom: 'redaction', hooks: [...PROFILS_PAR_DEFAUT.travail.hooks], consigne: 'Rédige les courriers.\n', moteur: 'mistral-vibe' };
const APPEL = { node: '/opt/node/bin/node', main: '/opt/mnemo/src/adaptateurs/cli/main.ts', version: '9.9.9-essai' };
const RACINE = '/maison/Mnemo';

describe('arguments de vibe', () => {
	it('nouvelle session : agent de la session (marque), modèle, racine pour un profil de la mémoire, objectif après --', () => {
		expect(argumentsMistralVibe({ session: session(), profil: { lancement: 'projet' }, mode: 'nouvelle', racine: RACINE })).toEqual(['--agent', `mnemo-${ID}`]);
		expect(argumentsMistralVibe({ session: session({ modele: 'local' }), profil: { lancement: 'memoire' }, mode: 'nouvelle', racine: RACINE, objectif: '--help' })).toEqual([
			'--agent',
			`mnemo-${ID}`,
			'--model',
			'local',
			'--add-dir',
			RACINE,
			'--',
			'--help',
		]);
		expect(agentDeSession(ID)).toBe(`mnemo-${ID}`);
	});

	it('reprise : --resume <fil>, sans --model ; sans fil : refusée, avec la raison ; uuid ou modèle invalides : refusés', () => {
		expect(argumentsMistralVibe({ session: session({ fil: FIL, modele: 'local' }), profil: { lancement: 'projet' }, mode: 'reprise', racine: RACINE })).toEqual(['--resume', FIL, '--agent', `mnemo-${ID}`]);
		expect(() => argumentsMistralVibe({ session: session(), profil: { lancement: 'projet' }, mode: 'reprise', racine: RACINE })).toThrow(/Reprise impossible : session Mistral Vibe/u);
		expect(motifSansRepriseMistralVibe({ fil: FIL })).toBeNull();
		expect(() => argumentsMistralVibe({ session: session({ id: 'x' }), profil: { lancement: 'projet' }, mode: 'nouvelle', racine: RACINE })).toThrow(/uuid/u);
		expect(() => argumentsMistralVibe({ session: session({ modele: '-x y' }), profil: { lancement: 'projet' }, mode: 'nouvelle', racine: RACINE })).toThrow(/Modèle/u);
	});
});

describe('consigne et environnement de vibe', () => {
	it('profil d’agent : la consigne en instructions, relue telle quelle par la lecture TOML', async () => {
		const consigne = 'Ligne « une » avec """ et \\ et \'\n- skill : x\n';
		const entrees = entreesToml(profilDAgent(consigne))!;
		expect(entrees.find((e) => e.genre === 'valeur' && e.cle[0] === 'instructions')).toMatchObject({ valeur: consigne });
		const dep = fauxPorts();
		const fichiers = await fichiersDeSessionMistralVibe(dep, session(), PROFIL, APPEL);
		expect(fichiers.map((f) => f.chemin)).toEqual([`mnemo-${ID}.toml`]);
		expect(fichiers[0]!.texte).toContain('Rédige les courriers.');
	});

	it('preparer : variables de la session, serveur MCP de la session, outils de Mnemo permis, dossier des agents ; celles de l’utilisateur gardées', () => {
		const c: ContextePreparation = {
			session: session({ modele: 'local' }),
			profil: PROFIL,
			mode: 'nouvelle',
			objectif: 'Commence.',
			dossierFichiers: '/r/.mnemo/plugins/x',
			fichiers: [],
			racine: RACINE,
			appel: APPEL,
			env: {
				PATH: '/bin',
				MISTRAL_API_KEY: 'k',
				VIBE_MCP_SERVERS: JSON.stringify([{ name: 'autre', transport: 'stdio', command: 'x' }, { name: 'mnemo', transport: 'stdio', command: 'vieux' }]),
				VIBE_TOOLS: JSON.stringify({ bash: { permission: 'ask' } }),
				VIBE_AGENT_PATHS: '["/mes/agents"]',
			},
		};
		const l = preparerMistralVibe(c);
		expect(l.args).toEqual(['--agent', `mnemo-${ID}`, '--model', 'local', '--', 'Commence.']);
		expect(l.env).toMatchObject({ PATH: '/bin', MISTRAL_API_KEY: 'k', MNEMO_MOTEUR: 'mistral-vibe', MNEMO_SESSION: ID, MNEMO_PROJET: 'alpha', MNEMO_RACINE: RACINE });
		const serveurs = JSON.parse(l.env.VIBE_MCP_SERVERS!) as Record<string, unknown>[];
		expect(serveurs).toEqual([
			{ name: 'autre', transport: 'stdio', command: 'x' },
			{ name: 'mnemo', transport: 'stdio', command: APPEL.node, args: [APPEL.main, 'mcp'], env: { MNEMO_SESSION: ID, MNEMO_MOTEUR: 'mistral-vibe', MNEMO_PROJET: 'alpha', MNEMO_RACINE: RACINE } },
		]);
		const outils = JSON.parse(l.env.VIBE_TOOLS!) as Record<string, unknown>;
		expect(outils['bash']).toEqual({ permission: 'ask' });
		for (const o of OUTILS_MNEMO_PERMIS) expect(outils[`mnemo_${o}`]).toEqual({ permission: 'always' });
		expect(JSON.parse(l.env.VIBE_AGENT_PATHS!)).toEqual(['/r/.mnemo/plugins/x', '/mes/agents']);
		expect(Object.keys(l.ajouts).sort()).toEqual(['MNEMO_HOOKS', 'MNEMO_MOTEUR', 'MNEMO_PROJET', 'MNEMO_RACINE', 'MNEMO_SESSION', 'VIBE_AGENT_PATHS', 'VIBE_MCP_SERVERS', 'VIBE_TOOLS']);
		expect(l.retirees).toEqual([]);
		// variables de l'utilisateur illisibles : celles de la session seules
		const seules = preparerMistralVibe({ ...c, env: { VIBE_MCP_SERVERS: '{', VIBE_TOOLS: '[]', VIBE_AGENT_PATHS: 'x' } });
		expect((JSON.parse(seules.env.VIBE_MCP_SERVERS!) as unknown[]).length).toBe(1);
		expect(JSON.parse(seules.env.VIBE_AGENT_PATHS!)).toEqual(['/r/.mnemo/plugins/x']);
	});
});

describe('hooks de Mistral Vibe', () => {
	const appel = (evenement: EvenementHook, entree: Record<string, unknown> = {}, options: string[] = [], env: Record<string, string> = { MNEMO_SESSION: ID, MNEMO_MOTEUR: 'mistral-vibe' }): AppelHook => ({
		evenement,
		options: new Set(options),
		lecture: { texte: JSON.stringify({ session_id: FIL, transcript_path: '/v/logs/session/unified/x', cwd: '/p', ...entree }) },
		env,
		maintenantMs: 1,
		cwdProcessus: '/q',
		reel: (c) => c,
	});

	it('arguments : noms Mnemo ou types de hooks de Vibe ; notification : un arrêt de notification', () => {
		expect(HOOKS_MISTRAL_VIBE.lireArguments(['session_start'])).toEqual({ evenement: 'debut', options: new Set() });
		expect(HOOKS_MISTRAL_VIBE.lireArguments(['pre_tool'])?.evenement).toBe('outil');
		expect(HOOKS_MISTRAL_VIBE.lireArguments(['notification'])).toEqual({ evenement: 'arret', options: new Set(['--notification']) });
		expect(HOOKS_MISTRAL_VIBE.lireArguments(['arret', '--notification'])).toEqual({ evenement: 'arret', options: new Set(['--notification']) });
		expect(HOOKS_MISTRAL_VIBE.lireArguments(['pre_llm'])).toBeNull();
	});

	it('traduction : fil, dossier de session, outil ; inerte hors d’une session Mistral Vibe de Mnemo', () => {
		expect(HOOKS_MISTRAL_VIBE.traduire(appel('debut', { source: 'resume' }))).toEqual({
			entree: { evenement: 'debut', session: ID, horodatageMs: 1, cwd: '/p', fil: FIL, source: 'resume' },
			transcription: '/v/logs/session/unified/x',
		});
		expect(HOOKS_MISTRAL_VIBE.traduire(appel('outil', { tool_name: 'file_system.bash', tool_input: { command: 'ls', timeout: 120 } }))?.entree.outil).toEqual({ nom: 'file_system.bash', entree: { command: 'ls', timeout: 120 } });
		expect(HOOKS_MISTRAL_VIBE.traduire(appel('message', { prompt: 'Bonjour' }))?.entree.prompt).toBe('Bonjour');
		for (const env of [{}, { MNEMO_SESSION: ID, MNEMO_MOTEUR: 'codex' }, { MNEMO_SESSION: 'x', MNEMO_MOTEUR: 'mistral-vibe' }] as Record<string, string>[]) {
			expect(HOOKS_MISTRAL_VIBE.inerte(env)).toBe(true);
			expect(HOOKS_MISTRAL_VIBE.traduire(appel('debut', {}, [], env))).toBeNull();
		}
		expect(HOOKS_MISTRAL_VIBE.inerte({ MNEMO_SESSION: ID, MNEMO_MOTEUR: 'mistral-vibe' })).toBe(false);
	});

	it('arrêts : fin du tour, dialogue ouvert (approbation, question), tour échoué ; turn_completed ignoré ; fin clear ignorée', () => {
		expect(HOOKS_MISTRAL_VIBE.traduire(appel('arret'))?.entree.arret).toBe('stop');
		expect(HOOKS_MISTRAL_VIBE.traduire(appel('arret', { notification_type: 'approval_requested' }, ['--notification']))?.entree.arret).toBe('notification');
		expect(HOOKS_MISTRAL_VIBE.traduire(appel('arret', { notification_type: 'question_asked' }, ['--notification']))?.entree.arret).toBe('notification');
		expect(HOOKS_MISTRAL_VIBE.traduire(appel('arret', { notification_type: 'turn_failed' }, ['--notification']))?.entree.arret).toBe('stop');
		expect(HOOKS_MISTRAL_VIBE.traduire(appel('arret', { notification_type: 'turn_completed' }, ['--notification']))).toBeNull();
		expect(HOOKS_MISTRAL_VIBE.traduire(appel('fin', { reason: 'clear' }))).toBeNull();
		expect(HOOKS_MISTRAL_VIBE.traduire(appel('fin', { reason: 'exit' }))?.entree.evenement).toBe('fin');
	});

	it('sorties : refus par decision deny, contexte par hook_specific_output ; rien sinon', () => {
		expect(JSON.parse(HOOKS_MISTRAL_VIBE.sortie('outil', { refus: 'Mnemo : non.' }))).toEqual({ decision: 'deny', reason: 'Mnemo : non.' });
		expect(HOOKS_MISTRAL_VIBE.sortie('outil', {})).toBe('');
		expect(JSON.parse(HOOKS_MISTRAL_VIBE.sortie('message', { contexte: '## Consignes' }))).toEqual({ hook_specific_output: { additional_context: '## Consignes' } });
		expect(HOOKS_MISTRAL_VIBE.sortie('arret', { contexte: 'x' })).toBe('');
		expect(HOOKS_MISTRAL_VIBE.sortie('debut', { contexte: ' ' })).toBe('');
	});
});
