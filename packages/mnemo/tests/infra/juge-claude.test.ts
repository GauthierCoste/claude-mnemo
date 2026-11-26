import { describe, expect, it } from 'vitest';
import { environnementClaudeHorsSession } from '../../src/application/moteurs/claude-code/plugin.ts';
import type { Executer, OptionsExecution } from '../../src/application/ports.ts';
import { CONSIGNE_JUGE, ReponseDuJugeIllisible, texteAJuger } from '../../src/domaine/consigne-juge.ts';
import type { MessageAJuger } from '../../src/domaine/consigne-juge.ts';
import { executeurReel } from '../../src/infra/executeur.ts';
import { argumentsDuJuge, DELAI_JUGE_MS, jugeClaude, resultatDeClaude } from '../../src/infra/juge-claude.ts';
import { EchecClaudePrint, executerClaudePrint, motifDEchecClaude } from '../../src/infra/moteurs/claude-code/claude-print.ts';

const CLAUDE = { commande: '/bin/claude', avant: ['--avant'] };
const MESSAGE: MessageAJuger = {
	message: 'et pour la cuisson ?',
	precedent: null,
	candidates: [
		{ chemin: 'a.md', titre: 'A', ligne: 'la', synthese: 'sa' },
		{ chemin: 'b.md', titre: 'B', ligne: 'lb', synthese: 'sb' },
	],
};
/** Sortie de `claude -p --output-format json` dont la réponse est `texte`. */
const sortieJson = (texte: string, extra: Record<string, unknown> = {}) => JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: texte, ...extra });
const reponse = (elements: { chemin: string; jugement: string; confiance: number; raison?: string }[]) => JSON.stringify({ jugements: elements });
const DEUX = reponse([
	{ chemin: 'a.md', jugement: 'pertinente', confiance: 0.9, raison: 'utile' },
	{ chemin: 'b.md', jugement: 'non_pertinente', confiance: 0.6, raison: 'non' },
]);

type Appel = { commande: string; args: string[]; options: OptionsExecution | undefined };
/** Exécuteur factice : rend les sorties données, une par appel (la dernière ensuite). */
function factice(sorties: (string | (() => never))[], appels: Appel[] = []): Executer {
	return async (commande, args, options) => {
		appels.push({ commande, args, options });
		const s = sorties[Math.min(appels.length - 1, sorties.length - 1)]!;
		return { code: 0, sortie: typeof s === 'string' ? s : s(), erreur: '' };
	};
}

describe('juge Claude : la commande', () => {
	it('claude -p, sortie JSON, aucun outil, aucun MCP, sans session gardée, consigne en prompt système ; le message sur l\'entrée', async () => {
		const appels: Appel[] = [];
		const env = { PATH: '/bin', ANTHROPIC_API_KEY: 'sk-interdite', MNEMO_SESSION: '1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed', MNEMO_MOTEUR: 'claude-code', Mnemo_Racine: '/r', OPENAI_API_KEY: 'sk-o' };
		const propositions = await jugeClaude({ executer: factice([sortieJson(DEUX)], appels), claude: CLAUDE, env, cwd: '/neutre' }).juger(MESSAGE);
		expect(propositions).toEqual({ 'a.md': { jugement: 'pertinente', confiance: 0.9, raison: 'utile' }, 'b.md': { jugement: 'non_pertinente', confiance: 0.6, raison: 'non' } });
		expect(appels).toHaveLength(1);
		const { commande, args, options } = appels[0]!;
		expect(commande).toBe('/bin/claude');
		expect(args).toEqual(['--avant', ...argumentsDuJuge()]);
		expect(args[1]).toBe('-p');
		expect(args[args.indexOf('--output-format') + 1]).toBe('json');
		// `--tools ""` : aucun outil ; l'option qui suit ferme la liste
		expect(args[args.indexOf('--tools') + 1]).toBe('');
		expect(args[args.indexOf('--tools') + 2]!.startsWith('--')).toBe(true);
		expect(args).toContain('--strict-mcp-config');
		expect(args).not.toContain('--mcp-config');
		expect(args).toContain('--no-session-persistence');
		expect(args).not.toContain('--model');
		expect(args[args.indexOf('--system-prompt') + 1]).toBe(CONSIGNE_JUGE);
		expect(args.at(-1)).toBe(CONSIGNE_JUGE);
		expect(options?.entree).toBe(texteAJuger(MESSAGE));
		expect(options?.cwd).toBe('/neutre');
		expect(options?.delaiMs).toBe(DELAI_JUGE_MS);
		// ni clé d'API, ni autre fournisseur, ni session Mnemo (les hooks du poste restent inertes) ; auto-mémoire coupée
		expect(options?.env).toEqual({ PATH: '/bin', CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1' });
	});

	it('environnement hors session : aucune variable MNEMO_ (sans la casse), ni clé d\'API ni marque de session Claude parente', () => {
		expect(environnementClaudeHorsSession({ HOME: '/h', MNEMO_HOOKS: 'x', mnemo_projet: 'p', CLAUDECODE: '1', CLAUDE_CODE_USE_BEDROCK: '1', ANTHROPIC_AUTH_TOKEN: 't', VIDE: undefined, CLAUDE_CODE_DISABLE_AUTO_MEMORY: '0' })).toEqual({
			HOME: '/h',
			CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1',
		});
	});
});

describe('juge Claude : la réponse', () => {
	it('sortie JSON de claude : champ result ; is_error : échec de claude ; autre forme : illisible', () => {
		expect(resultatDeClaude(sortieJson('bonjour'))).toBe('bonjour');
		expect(() => resultatDeClaude(sortieJson('Not logged in', { is_error: true }))).toThrow(EchecClaudePrint);
		expect(() => resultatDeClaude(sortieJson('Not logged in', { is_error: true }))).toThrow(/erreur : Not logged in/u);
		expect(() => resultatDeClaude('bonjour')).toThrow(ReponseDuJugeIllisible);
		expect(() => resultatDeClaude('[1]')).toThrow(ReponseDuJugeIllisible);
		expect(() => resultatDeClaude('{"type":"result"}')).toThrow(/result/u);
	});

	it('réponse illisible : redemandée une fois ; illisible deux fois : erreur', async () => {
		const appels: Appel[] = [];
		const juge = jugeClaude({ executer: factice([sortieJson('Je ne sais pas.'), sortieJson(`\`\`\`json\n${DEUX}\n\`\`\``)], appels), claude: CLAUDE, env: {} });
		expect(Object.keys(await juge.juger(MESSAGE))).toEqual(['a.md', 'b.md']);
		expect(appels).toHaveLength(2);
		const toujours = jugeClaude({ executer: factice(['pas du JSON']), claude: CLAUDE, env: {} });
		await expect(toujours.juger(MESSAGE)).rejects.toThrow(ReponseDuJugeIllisible);
	});

	it('réponse incomplète : redemandée une fois, la plus complète gardée', async () => {
		const une = reponse([{ chemin: 'a.md', jugement: 'pertinente', confiance: 0.9 }]);
		const appels: Appel[] = [];
		const juge = jugeClaude({ executer: factice([sortieJson(une), sortieJson('{"jugements": []}')], appels), claude: CLAUDE, env: {} });
		expect(await juge.juger(MESSAGE)).toEqual({ 'a.md': { jugement: 'pertinente', confiance: 0.9, raison: '' } });
		expect(appels).toHaveLength(2);
		const vide = jugeClaude({ executer: factice([sortieJson('{"jugements": []}')]), claude: CLAUDE, env: {} });
		await expect(vide.juger(MESSAGE)).rejects.toThrow(/aucune candidate/u);
	});

	it('claude en échec (code, délai, abandon) : erreur lisible, pas de nouvel essai, jamais le texte jugé', async () => {
		let lances = 0;
		const echec: Executer = async () => (lances++, { code: 1, sortie: '', erreur: 'Invalid API key\n' });
		await expect(jugeClaude({ executer: echec, claude: CLAUDE, env: {} }).juger(MESSAGE)).rejects.toThrow(/code 1.*Invalid API key/u);
		expect(lances).toBe(1);
		const tue: Executer = async () => {
			throw Object.assign(new Error(`Command failed: claude ${texteAJuger(MESSAGE)}`), { killed: true, code: null });
		};
		const erreur = await jugeClaude({ executer: tue, claude: CLAUDE, env: {} }).juger(MESSAGE).catch((e: unknown) => e);
		expect((erreur as Error).message).toBe('claude -p tué au bout de 2 minutes : délai dépassé.');
		const controleur = new AbortController();
		const bloque: Executer = (_c, _a, options) => new Promise((_r, rejeter) => options?.signal?.addEventListener('abort', () => rejeter(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
		const attente = jugeClaude({ executer: bloque, claude: CLAUDE, env: {} }).juger(MESSAGE, controleur.signal);
		controleur.abort();
		await expect(attente).rejects.toThrow(/interrompu/u);
	});
});

describe('claude -p hors session', () => {
	it('déjà abandonné : rien n\'est lancé', async () => {
		let lances = 0;
		const executer: Executer = async () => (lances++, { code: 0, sortie: '', erreur: '' });
		const controleur = new AbortController();
		controleur.abort();
		await expect(executerClaudePrint(executer, CLAUDE, { args: ['-p'], cwd: '/', env: {}, delaiMs: 1000, signal: controleur.signal })).rejects.toThrow(EchecClaudePrint);
		expect(lances).toBe(0);
	});

	it('motifs : délai en minutes ou en secondes, programme illancable', () => {
		expect(motifDEchecClaude({ killed: true }, undefined, 30 * 60_000)).toMatch(/30 minutes/u);
		expect(motifDEchecClaude({ killed: true }, undefined, 60_000)).toMatch(/1 minute :/u);
		expect(motifDEchecClaude({ killed: true }, undefined, 90_000)).toMatch(/90 secondes/u);
		expect(motifDEchecClaude({ code: 'ENOENT' }, undefined, 1000)).toBe("claude -p n'a pas pu aboutir (ENOENT).");
	});

	it('l\'exécuteur réel écrit `entree` sur l\'entrée du programme, puis la ferme', async () => {
		const r = await executeurReel()(process.execPath, ['-e', 'let t = ""; process.stdin.on("data", (d) => (t += d)); process.stdin.on("end", () => process.stdout.write(t.toUpperCase()));'], { entree: 'é et ça\n' });
		expect(r).toEqual({ code: 0, sortie: 'É ET ÇA\n', erreur: '' });
	});
});
