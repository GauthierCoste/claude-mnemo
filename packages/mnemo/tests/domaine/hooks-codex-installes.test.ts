import { describe, expect, it } from 'vitest';
import { commandesDuHook, estHookMnemo, etatDesHooks, HOOKS_CODEX_INSTALLES, hooksAttendus, lireHooksJson, nomDansLaCle, remplacerHooks, texteHooksJson } from '../../src/domaine/moteurs/codex/hooks-installes.ts';

const NODE = '/opt/node/bin/node';
const MAIN = "/maison/a/Mes projets/l'outil/packages/mnemo/src/adaptateurs/cli/main.ts";
const attendus = hooksAttendus(NODE, MAIN);
const etranger = { type: 'command', command: '/usr/local/bin/autre-outil --hook', timeout: 5 };

const lire = (texte: string | null): Record<string, unknown> => {
	const lu = lireHooksJson(texte);
	if ('echec' in lu) throw new Error(lu.echec);
	return lu.racine;
};

describe('commandes des hooks de Codex', () => {
	it('POSIX : chemins entre apostrophes (apostrophe échappée) ; Windows : appel PowerShell, apostrophes doublées', () => {
		expect(commandesDuHook(NODE, MAIN, ['arret', '--notification'])).toEqual({
			command: `'/opt/node/bin/node' '/maison/a/Mes projets/l'\\''outil/packages/mnemo/src/adaptateurs/cli/main.ts' hook arret --notification --moteur codex`,
			commandWindows: `& '/opt/node/bin/node' '/maison/a/Mes projets/l''outil/packages/mnemo/src/adaptateurs/cli/main.ts' hook arret --notification --moteur codex`,
		});
	});

	it('reconnaît une commande de Mnemo (toute installation), jamais une autre', () => {
		for (const [, groupe] of attendus) expect(estHookMnemo(groupe.hooks[0])).toBe(true);
		expect(estHookMnemo({ type: 'command', command: `'/autre/node' 'C:\\m\\adaptateurs\\cli\\main.ts' hook fin --moteur codex` })).toBe(true);
		expect(estHookMnemo(etranger)).toBe(false);
		expect(estHookMnemo({ type: 'command', command: `'${NODE}' '${MAIN}' hook fin --moteur claude-code` })).toBe(false);
		expect(estHookMnemo({ type: 'command', command: `'${NODE}' '${MAIN}' hook fin --moteur codex ; rm -rf ~` })).toBe(false);
		expect(estHookMnemo({ type: 'prompt', command: `'${NODE}' '${MAIN}' hook fin --moteur codex` })).toBe(false);
	});

	it('un groupe par événement, SessionEnd sous 3 s, PostToolUse sur apply_patch et les outils MCP de Mnemo', () => {
		expect([...attendus.keys()]).toEqual(['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop', 'PermissionRequest', 'SessionEnd']);
		expect(HOOKS_CODEX_INSTALLES.find((h) => h.evenement === 'SessionEnd')!.timeout).toBeLessThanOrEqual(3);
		expect(attendus.get('PostToolUse')!.matcher).toBe('apply_patch|mcp__mnemo__.*');
		expect(nomDansLaCle('UserPromptSubmit')).toBe('user_prompt_submit');
		expect(nomDansLaCle('Stop')).toBe('stop');
	});
});

describe('hooks.json de Codex', () => {
	it('absent ou vide : installé, état à jour, une clé par événement', () => {
		const racine = remplacerHooks(lire(null), attendus);
		expect(etatDesHooks(racine, attendus)).toEqual({ etat: 'a_jour', cles: ['session_start:0:0', 'user_prompt_submit:0:0', 'pre_tool_use:0:0', 'post_tool_use:0:0', 'stop:0:0', 'permission_request:0:0', 'session_end:0:0'] });
		expect(etatDesHooks(lire(''), attendus)).toEqual({ etat: 'absent', cles: [] });
		expect(texteHooksJson(racine).endsWith('}\n')).toBe(true);
	});

	it('JSON illisible ou de forme inattendue : échec motivé', () => {
		expect(lireHooksJson('{ "hooks": ')).toMatchObject({ echec: expect.stringMatching(/^JSON illisible/u) });
		expect(lireHooksJson('[]')).toMatchObject({ echec: expect.stringContaining('racine') });
		expect(lireHooksJson('{ "hooks": [] }')).toMatchObject({ echec: expect.stringContaining('« hooks »') });
		expect(lireHooksJson('{ "hooks": { "Stop": {} } }')).toMatchObject({ echec: expect.stringContaining('hooks.Stop') });
	});

	it('les entrées d’autres outils et les autres clés sont gardées, dans leur ordre ; Mnemo ajouté à la fin de chaque événement', () => {
		const avant = { version: 2, hooks: { Stop: [{ hooks: [etranger] }], Notification: [{ matcher: 'x', hooks: [etranger] }] } };
		const apres = remplacerHooks(lire(JSON.stringify(avant)), attendus);
		expect(Object.keys(apres)).toEqual(['version', 'hooks']);
		const hooks = apres.hooks as Record<string, unknown[]>;
		expect(hooks.Stop).toEqual([{ hooks: [etranger] }, attendus.get('Stop')]);
		expect(hooks.Notification).toEqual([{ matcher: 'x', hooks: [etranger] }]);
		expect(etatDesHooks(apres, attendus).cles).toContain('stop:1:0');
		expect(etatDesHooks(apres, attendus).etat).toBe('a_jour');
		// retrait : seul Mnemo part
		expect(remplacerHooks(apres, new Map())).toEqual(avant);
	});

	it('mise à jour (autre Node) : même rang, donc même clé d’approbation ; une commande étrangère dans le même groupe reste', () => {
		const ancien = hooksAttendus('/ancien/node', MAIN);
		const avant = { hooks: { Stop: [{ hooks: [etranger] }, ancien.get('Stop'), { hooks: [etranger] }], PreToolUse: [{ hooks: [etranger, ...ancien.get('PreToolUse')!.hooks] }] } };
		expect(etatDesHooks(avant, attendus).etat).toBe('perime');
		const apres = remplacerHooks(avant, attendus);
		const hooks = apres.hooks as Record<string, unknown[]>;
		expect(hooks.Stop).toEqual([{ hooks: [etranger] }, attendus.get('Stop'), { hooks: [etranger] }]);
		expect(hooks.PreToolUse).toEqual([{ hooks: [etranger] }, attendus.get('PreToolUse')]);
		expect(etatDesHooks(apres, attendus).etat).toBe('a_jour');
		// déjà à jour : rien ne change
		expect(remplacerHooks(apres, attendus)).toEqual(apres);
	});

	it('doublon ou événement manquant : périmé ; le doublon disparaît à l’installation', () => {
		const installe = remplacerHooks({}, attendus);
		const hooks = installe.hooks as Record<string, unknown[]>;
		const double = { hooks: { ...hooks, Stop: [...hooks.Stop!, attendus.get('Stop')] } };
		expect(etatDesHooks(double, attendus).etat).toBe('perime');
		expect(remplacerHooks(double, attendus)).toEqual(installe);
		const { SessionEnd: _, ...sansFin } = hooks;
		expect(etatDesHooks({ hooks: sansFin }, attendus).etat).toBe('perime');
	});

	it('retrait : une liste vidée par le retrait disparaît, une liste déjà vide reste', () => {
		const racine = remplacerHooks({ hooks: { Notification: [] } }, attendus);
		expect(remplacerHooks(racine, new Map())).toEqual({ hooks: { Notification: [] } });
	});
});
