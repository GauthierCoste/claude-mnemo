import { describe, expect, it } from 'vitest';
import { HOOKS_CODEX } from '../../src/application/moteurs/codex/hooks.ts';
import { consigneAvecSkills } from '../../src/application/moteurs/consigne-avec-skills.ts';
import { argumentsCodex, CONSIGNE_MAX, LIGNE_ARGUMENTS_MAX, longueurSurLaLigne, environnementCodex, fichiersDeSessionCodex, motifSansRepriseCodex, preparerCodex } from '../../src/application/moteurs/codex/session.ts';
import type { AppelHook, ContextePreparation } from '../../src/application/ports.ts';
import { CONSIGNE_TRAVAIL_PAR_DEFAUT, SKILLS_PAR_DEFAUT } from '../../src/application/profil.ts';
import { PROFILS_PAR_DEFAUT } from '../../src/domaine/profil.ts';
import type { Profil } from '../../src/domaine/profil.ts';
import type { EvenementHook, Session } from '../../src/domaine/session.ts';
import { fauxPorts } from '../aides/faux-ports.ts';

const ID = '0f1e2d3c-4b5a-4968-8776-655443322110';
const FIL = '01a212be-e0fe-7133-ab30-f2f26e13f9ec';
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
	moteur: 'codex',
	modele: '',
	...champs,
});
const PROFIL: Profil = { ...PROFILS_PAR_DEFAUT.travail, nom: 'redaction', hooks: [...PROFILS_PAR_DEFAUT.travail.hooks], consigne: 'Rédige les courriers.\n', moteur: 'codex' };
const APPEL = { node: '/opt/node "26"/bin/node', main: 'C:\\mnemo\\src\\adaptateurs\\cli\\main.ts', version: '9.9.9-essai' };
const RACINE = '/maison/Mnemo';

/** Valeurs des `-c` : `clé` → valeur TOML. */
function configs(args: string[]): Map<string, string> {
	const m = new Map<string, string>();
	args.forEach((a, i) => {
		if (i > 0 && args[i - 1] === '-c') m.set(a.slice(0, a.indexOf('=')), a.slice(a.indexOf('=') + 1));
	});
	return m;
}

describe('arguments de codex', () => {
	it('nouvelle session : marque, sans serveur partagé, mémoire coupée, consigne, serveur MCP et outils approuvés, objectif après --', () => {
		const args = argumentsCodex({ session: session(), profil: PROFIL, mode: 'nouvelle', consigne: 'Dis "bonjour".\nPuis C:\\fin', racine: RACINE, appel: APPEL, objectif: '-v fais le point' });
		expect(args.slice(0, 6)).toEqual(['-c', `mnemo_session='${ID}'`, '--no-daemon', '--no-alt-screen', '--disable', 'memories']);
		expect(args.slice(-2)).toEqual(['--', '-v fais le point']);
		expect(args).not.toContain('-m');
		expect(args).not.toContain('--add-dir');
		const c = configs(args);
		// littérales quand c'est possible (aucun guillemet double, ni échappement) : sur plusieurs lignes pour la consigne
		expect(c.get('developer_instructions')).toBe("'''Dis \"bonjour\".\nPuis C:\\fin'''");
		expect(c.get('mcp_servers.mnemo.command')).toBe('\'/opt/node "26"/bin/node\'');
		expect(c.get('mcp_servers.mnemo.args')).toBe("['C:\\mnemo\\src\\adaptateurs\\cli\\main.ts', 'mcp']");
		expect(c.get('mcp_servers.mnemo.enabled')).toBe('true');
		expect(c.get('mcp_servers.mnemo.env_vars')).toBe("['MNEMO_SESSION', 'MNEMO_MOTEUR', 'MNEMO_PROJET', 'MNEMO_RACINE']");
		for (const outil of ['proposer', 'chercher', 'lire', 'lister', 'voisins', 'chronologie', 'contexte', 'diagnostiquer']) {
			expect(c.get(`mcp_servers.mnemo.tools.${outil}.approval_mode`), outil).toBe("'approve'");
		}
		expect(c.has('mcp_servers.mnemo.tools.entretenir.approval_mode')).toBe(false);
	});

	it('modèle de la session (-m), racine en --add-dir pour un profil lancé dans la mémoire ; sans objectif, rien après les options', () => {
		const args = argumentsCodex({ session: session({ modele: 'gpt-6.2-sol' }), profil: { lancement: 'memoire' }, mode: 'nouvelle', consigne: 'C', racine: RACINE, appel: APPEL, objectif: '  ' });
		expect(args.slice(6, 10)).toEqual(['-m', 'gpt-6.2-sol', '--add-dir', RACINE]);
		expect(args).not.toContain('--');
	});

	it('reprise : codex resume, les mêmes options, puis -- <fil> et la consigne tapée d’emblée', () => {
		const args = argumentsCodex({ session: session({ fil: FIL, modele: 'gpt-6.2-sol' }), profil: PROFIL, mode: 'reprise', consigne: 'C', racine: RACINE, appel: APPEL, objectif: 'Fais le bilan.' });
		expect(args[0]).toBe('resume');
		expect(args.slice(1, 9)).toEqual(['-c', `mnemo_session='${ID}'`, '--no-daemon', '--no-alt-screen', '--disable', 'memories', '-m', 'gpt-6.2-sol']);
		expect(args.slice(-3)).toEqual(['--', FIL, 'Fais le bilan.']);
	});

	it('reprise sans fil connu : refusée avec la raison ; uuid ou modèle invalides : refusés', () => {
		expect(motifSansRepriseCodex({})).toMatch(/identifiant chez Codex est inconnu/u);
		expect(motifSansRepriseCodex({ fil: FIL })).toBeNull();
		expect(() => argumentsCodex({ session: session(), profil: PROFIL, mode: 'reprise', consigne: 'C', racine: RACINE, appel: APPEL })).toThrow(/Reprise impossible : session Codex/u);
		expect(() => argumentsCodex({ session: session({ id: 'pas-un-uuid' }), profil: PROFIL, mode: 'nouvelle', consigne: 'C', racine: RACINE, appel: APPEL })).toThrow(/uuid attendu/u);
		expect(() => argumentsCodex({ session: session({ modele: 'a b' }), profil: PROFIL, mode: 'nouvelle', consigne: 'C', racine: RACINE, appel: APPEL })).toThrow(/Modèle de session refusé/u);
		// consigne trop longue pour la ligne de commande : refusée avec la longueur et la limite
		expect(() => argumentsCodex({ session: session(), profil: PROFIL, mode: 'nouvelle', consigne: 'x'.repeat(CONSIGNE_MAX), racine: RACINE, appel: APPEL })).toThrow(/Consigne de session trop longue .*\(24002 caractères, 24000 au plus\)/u);
		expect(() => argumentsCodex({ session: session(), profil: PROFIL, mode: 'nouvelle', consigne: 'x'.repeat(CONSIGNE_MAX - 2), racine: RACINE, appel: APPEL })).not.toThrow();
	});

	it('ligne de commande bornée sous la limite de Windows (32 767) : au-delà de LIGNE_ARGUMENTS_MAX, refusée avec la longueur', () => {
		expect(longueurSurLaLigne(['ab', 'c"d\\e'])).toBe(2 + 3 + 5 + 2 + 3);
		const appel = (consigne: string, objectif: string) => ({ session: session(), profil: PROFIL, mode: 'nouvelle' as const, consigne, racine: RACINE, appel: APPEL, objectif });
		// consigne pleine (guillemets doublés au pire) et objectif long : refusée
		expect(() => argumentsCodex(appel('"'.repeat(CONSIGNE_MAX - 10), 'o'.repeat(5000)))).toThrow(new RegExp(`^Ligne de commande de Codex trop longue \\(\\d+ caractères, ${LIGNE_ARGUMENTS_MAX} au plus`, 'u'));
		const permis = argumentsCodex(appel('x'.repeat(CONSIGNE_MAX - 2), 'o'.repeat(4000)));
		expect(longueurSurLaLigne(permis)).toBeLessThanOrEqual(LIGNE_ARGUMENTS_MAX);
		expect(LIGNE_ARGUMENTS_MAX).toBeLessThan(32_767);
	});
});

describe('environnement de codex', () => {
	it('session, moteur codex, projet, racine et hooks du profil posés ; CODEX_API_KEY retirée sans la casse ; OPENAI_API_KEY, OPENAI_BASE_URL et le reste gardés', () => {
		const env = environnementCodex({ PATH: '/bin', openai_api_key: 'sk', codex_api_key: 'k', OPENAI_BASE_URL: 'http://x', MNEMO_MOTEUR: 'claude-code', CODEX_HOME: '/h/c', VIDE: undefined }, session(), { hooks: ['debut', 'arret', 'fin'] }, RACINE);
		expect(env).toEqual({ PATH: '/bin', openai_api_key: 'sk', OPENAI_BASE_URL: 'http://x', CODEX_HOME: '/h/c', MNEMO_SESSION: ID, MNEMO_MOTEUR: 'codex', MNEMO_PROJET: 'alpha', MNEMO_RACINE: RACINE, MNEMO_HOOKS: 'debut,arret,fin' });
	});
});

describe('consigne et fichiers de session de Codex', () => {
	it('consigne du profil, puis les skills avec description et identifiant du SKILL.md ; sans skill, la consigne seule', () => {
		const skills = [
			{ nom: 'revue', dossier: 'skills/revue', texte: '---\ndescription: |\n  Relire\n  un texte\n---\nRelis.\n' },
			{ nom: 'brute', dossier: 'profils/redaction/skills/brute', texte: 'Sans frontmatter.\n' },
		];
		const consigne = consigneAvecSkills({ consigne: '  Rédige.\n' }, skills);
		expect(consigne.startsWith('Rédige.\n\n## Skills de Mnemo\n')).toBe(true);
		expect(consigne).toContain('avec l\'outil `lire` de Mnemo');
		expect(consigne).toContain('- revue : Relire un texte (`skills/revue/SKILL.md`)\n');
		expect(consigne).toContain('- brute (`profils/redaction/skills/brute/SKILL.md`)\n');
		expect(consigneAvecSkills({ consigne: 'Rédige.' }, [])).toBe('Rédige.\n');
	});

	it('fichiers de session : la consigne seule ; skills du profil (par défaut déposées), puis celles de la mémoire retenues pour le projet', async () => {
		const dep = fauxPorts();
		dep.fichiers.set('skills/revue/SKILL.md', '---\ndescription: Revue\n---\nRelis.\n');
		dep.fichiers.set('skills/beta/SKILL.md', '---\ndescription: Beta\nprojets: [beta]\n---\nBeta.\n');
		const travail: Profil = { ...PROFIL, nom: 'travail', consigne: CONSIGNE_TRAVAIL_PAR_DEFAUT };
		const fichiers = await fichiersDeSessionCodex(dep, session({ profil: 'travail' }), travail, APPEL);
		expect(fichiers.map((f) => f.chemin)).toEqual(['consigne.md']);
		const texte = fichiers[0]!.texte;
		expect(texte.startsWith(CONSIGNE_TRAVAIL_PAR_DEFAUT.trim())).toBe(true);
		for (const s of SKILLS_PAR_DEFAUT.travail ?? []) expect(texte).toContain(`(\`profils/travail/skills/${s.nom}/SKILL.md\`)`);
		expect(texte).toContain('- revue : Revue (`skills/revue/SKILL.md`)');
		expect(texte).not.toContain('beta');
		// rien n'est écrit dans le dossier du projet
		expect([...dep.fichiers.keys()].some((c) => c.startsWith('alpha/') || c.includes('.agents'))).toBe(false);
	});

	it('preparer : consigne relue dans les fichiers de session, environnement et ligne à coller (ajouts, variables retirées)', () => {
		const c: ContextePreparation = {
			session: session(),
			profil: PROFIL,
			mode: 'nouvelle',
			objectif: 'Commence.',
			dossierFichiers: '/r/.mnemo/plugins/x',
			fichiers: [{ chemin: 'consigne.md', texte: 'Consigne avec skills.\n' }],
			racine: RACINE,
			appel: APPEL,
			env: { PATH: '/bin', OPENAI_API_KEY: 'sk', CODEX_API_KEY: 'k', ANTHROPIC_API_KEY: 'sk-ant', CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'cli', MISTRAL_API_KEY: 'm', COPILOT_GITHUB_TOKEN: 'gho', GH_TOKEN: 'ghp' },
		};
		const l = preparerCodex(c);
		expect(configs(l.args).get('developer_instructions')).toBe("'''Consigne avec skills.\n'''");
		expect(l.args.slice(-2)).toEqual(['--', 'Commence.']);
		expect(l.env).toMatchObject({ PATH: '/bin', MNEMO_MOTEUR: 'codex', MNEMO_SESSION: ID });
		expect(l.env).not.toHaveProperty('CODEX_API_KEY');
		expect(l.env).toHaveProperty('OPENAI_API_KEY', 'sk');
		expect(l.env).toHaveProperty('GH_TOKEN', 'ghp');
		for (const v of ['ANTHROPIC_API_KEY', 'CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'MISTRAL_API_KEY', 'COPILOT_GITHUB_TOKEN']) expect(l.env).not.toHaveProperty(v);
		expect(l.ajouts).toEqual({ MNEMO_SESSION: ID, MNEMO_MOTEUR: 'codex', MNEMO_PROJET: 'alpha', MNEMO_RACINE: RACINE, MNEMO_HOOKS: PROFIL.hooks.join(',') });
		expect(l.retirees).toEqual(['CODEX_API_KEY', 'ANTHROPIC_API_KEY', 'CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'MISTRAL_API_KEY', 'COPILOT_GITHUB_TOKEN']);
	});
});

describe('hooks de Codex selon le profil de la session (MNEMO_HOOKS)', () => {
	const appel = (evenement: EvenementHook, hooks: string | undefined, entree: Record<string, unknown> = {}): AppelHook => ({
		evenement,
		options: new Set(),
		lecture: { texte: JSON.stringify({ session_id: FIL, cwd: '/p', ...entree }) },
		env: { MNEMO_SESSION: ID, MNEMO_MOTEUR: 'codex', ...(hooks === undefined ? {} : { MNEMO_HOOKS: hooks }) },
		maintenantMs: 1,
		cwdProcessus: '/p',
		reel: (c) => c,
	});

	it('debut, message et apres_outil non demandés : l’état seulement (sans contexte ; apres_outil efface le dialogue ouvert) ; outil non demandé : ignoré ; arret et fin toujours', () => {
		const hooks = 'arret,fin';
		expect(HOOKS_CODEX.traduire(appel('debut', hooks))?.entree).toMatchObject({ evenement: 'debut', session: ID, fil: FIL, sansContexte: true });
		expect(HOOKS_CODEX.traduire(appel('message', hooks, { prompt: 'Bonjour' }))?.entree).toMatchObject({ evenement: 'message', prompt: 'Bonjour', sansContexte: true });
		expect(HOOKS_CODEX.traduire(appel('outil', hooks, { tool_name: 'Bash', tool_input: { command: 'ls' } }))).toBeNull();
		expect(HOOKS_CODEX.traduire(appel('apres_outil', hooks, { tool_name: 'apply_patch' }))?.entree).toMatchObject({ evenement: 'apres_outil', sansContexte: true });
		expect(HOOKS_CODEX.traduire(appel('arret', hooks))?.entree).toMatchObject({ evenement: 'arret', arret: 'stop' });
		expect(HOOKS_CODEX.traduire(appel('arret', hooks))?.entree.sansContexte).toBeUndefined();
	});

	it('demandés, ou variable absente (tous) : servis', () => {
		expect(HOOKS_CODEX.traduire(appel('debut', 'debut,outil'))?.entree.sansContexte).toBeUndefined();
		expect(HOOKS_CODEX.traduire(appel('outil', 'debut,outil', { tool_name: 'Bash', tool_input: { command: 'ls' } }))?.entree.outil).toEqual({ nom: 'Bash', entree: { command: 'ls' } });
		expect(HOOKS_CODEX.traduire(appel('apres_outil', undefined, { tool_name: 'apply_patch' }))?.entree.evenement).toBe('apres_outil');
	});
});
