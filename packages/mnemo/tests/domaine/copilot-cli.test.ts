/** GitHub Copilot CLI, calcul pur : outils, déclaration MCP, hooks de `hooks/mnemo.json`, modèles, télémétrie, version, touches. */
import { describe, expect, it } from 'vitest';
import { commandeManuelleCopilotCli, declarationDansConfig, desactiveDansReglages, entreeAColler, texteAvecDeclaration } from '../../src/domaine/moteurs/copilot-cli/declaration.ts';
import { commandesDuHook, etatDuFichierDeHooks, fichierDeHooksAttendu, fichierSansCetteInstallation, HOOKS_COPILOT_CLI_INSTALLES } from '../../src/domaine/moteurs/copilot-cli/hooks-installes.ts';
import { texteJsonReecrit } from '../../src/domaine/moteurs/json-texte.ts';
import { modelesDeLAide } from '../../src/domaine/moteurs/copilot-cli/modeles.ts';
import { OUTILS_COPILOT_CLI } from '../../src/domaine/moteurs/copilot-cli/outils.ts';
import { fenetreDansLeJournal } from '../../src/domaine/moteurs/copilot-cli/telemetrie.ts';
import { TOUCHES_COPILOT_CLI } from '../../src/domaine/moteurs/copilot-cli/touches.ts';
import { refusDeVersionCopilotCli } from '../../src/domaine/moteurs/copilot-cli/version.ts';
import { outilsDuMoteur } from '../../src/domaine/moteurs/outils.ts';
import { versionDans } from '../../src/domaine/moteurs/version.ts';

const NODE = '/opt/node/bin/node';
const MAIN = '/opt/mnemo/src/adaptateurs/cli/main.ts';

describe('outils de GitHub Copilot CLI', () => {
	it('écriture : path de create, edit, str_replace_editor (sauf view) ; apply_patch par ses en-têtes ; sans chemin lisible : illisible', () => {
		expect(outilsDuMoteur('copilot-cli')).toBe(OUTILS_COPILOT_CLI);
		expect(OUTILS_COPILOT_CLI.cheminsEcrits({ nom: 'create', entree: { path: '/p/secret.txt', file_text: 'x' } })).toEqual(['/p/secret.txt']);
		expect(OUTILS_COPILOT_CLI.cheminsEcrits({ nom: 'edit', entree: { path: '/p/a.md', old_str: 'a', new_str: 'b' } })).toEqual(['/p/a.md']);
		expect(OUTILS_COPILOT_CLI.cheminsEcrits({ nom: 'str_replace_editor', entree: { command: 'create', path: 'b.md' } })).toEqual(['b.md']);
		expect(OUTILS_COPILOT_CLI.cheminsEcrits({ nom: 'str_replace_editor', entree: { command: 'view', path: 'b.md' } })).toBeNull();
		expect(OUTILS_COPILOT_CLI.cheminsEcrits({ nom: 'create', entree: { path: 3 } })).toBe('illisible');
		expect(OUTILS_COPILOT_CLI.cheminsEcrits({ nom: 'edit', entree: {} })).toBe('illisible');
		const patch = '*** Begin Patch\n*** Add File: notes/a.md\n+x\n*** Update File: b.md\n*** Move to: c.md\n*** End Patch';
		expect(OUTILS_COPILOT_CLI.cheminsEcrits({ nom: 'apply_patch', entree: { input: patch } })).toEqual(['notes/a.md', 'b.md', 'c.md']);
		expect(OUTILS_COPILOT_CLI.cheminsEcrits({ nom: 'apply_patch', entree: { input: 'rm -rf /' } })).toBe('illisible');
		expect(OUTILS_COPILOT_CLI.cheminsEcrits({ nom: 'apply_patch', entree: {} })).toBe('illisible');
		expect(OUTILS_COPILOT_CLI.cheminsEcrits({ nom: 'apply_patch', entree: { input: '*** Begin Patch\n*** End Patch' } })).toEqual([]);
	});

	it('lectures connues, commandes et outils MCP : jamais des écritures ; un autre outil de Copilot qui porte un chemin : une écriture (prudence)', () => {
		for (const nom of ['view', 'grep', 'glob', 'bash', 'read_bash']) expect(OUTILS_COPILOT_CLI.cheminsEcrits({ nom, entree: { path: '/p/a' } }), nom).toBeNull();
		expect(OUTILS_COPILOT_CLI.cheminsEcrits({ nom: 'mnemo-proposer', entree: { path: 'a.md' } })).toBeNull();
		expect(OUTILS_COPILOT_CLI.cheminsEcrits({ nom: 'github-mcp-server-create_file', entree: { path: 'a.md' } })).toBeNull();
		expect(OUTILS_COPILOT_CLI.cheminsEcrits({ nom: 'delete_file', entree: { path: '/p/b' } })).toEqual(['/p/b']);
		expect(OUTILS_COPILOT_CLI.cheminsEcrits({ nom: 'rename', entree: { file_path: 4 } })).toBe('illisible');
		expect(OUTILS_COPILOT_CLI.cheminsEcrits({ nom: 'report_intent', entree: { intent: 'x' } })).toBeNull();
	});

	it('commande : bash et powershell (command) ; saisie à un shell lancé : illisible ; autre outil : non concerné', () => {
		expect(OUTILS_COPILOT_CLI.commande({ nom: 'bash', entree: { command: 'git push --force', description: 'x' } })).toBe('git push --force');
		expect(OUTILS_COPILOT_CLI.commande({ nom: 'powershell', entree: { command: 'git push --force' } })).toBe('git push --force');
		expect(OUTILS_COPILOT_CLI.commande({ nom: 'bash', entree: {} })).toBe('');
		expect(OUTILS_COPILOT_CLI.commande({ nom: 'write_bash', entree: { input: 'y' } })).toEqual({ illisible: true });
		expect(OUTILS_COPILOT_CLI.commande({ nom: 'view', entree: { path: 'a' } })).toBeNull();
		expect(OUTILS_COPILOT_CLI.prefixeMcp).toBe('mnemo-');
		const motif = new RegExp(`^(?:${OUTILS_COPILOT_CLI.motifApresOutil})$`, 'u');
		for (const nom of ['create', 'edit', 'apply_patch', 'mnemo-proposer']) expect(motif.test(nom), nom).toBe(true);
		for (const nom of ['bash', 'view', 'mnemo-', 'recreate']) expect(motif.test(nom), nom).toBe(false);
	});
});

describe('déclaration MCP dans mcp-config.json', () => {
	it('lecture : absente, de Mnemo, réglages personnels, autre type ; JSONC lu (commentaires, virgules finales) ; illisible refusé', () => {
		expect(declarationDansConfig(null)).toEqual({ racine: {}, jsonc: false, declaration: null });
		expect(declarationDansConfig('{"mcpServers":{"autre":{"command":"x"}}}')).toMatchObject({ declaration: null, jsonc: false });
		expect(declarationDansConfig(JSON.stringify({ mcpServers: { mnemo: { type: 'local', command: NODE, args: [MAIN, 'mcp'], tools: ['*'] } } }))).toMatchObject({
			declaration: { lancement: { commande: NODE, args: [MAIN, 'mcp'] }, reglages: [] },
		});
		expect(declarationDansConfig(JSON.stringify({ mcpServers: { mnemo: { command: NODE, args: [MAIN, 'mcp'], env: { A: '1' }, tools: ['lire'] } } }))).toMatchObject({
			declaration: { reglages: ['env', 'tools'] },
		});
		expect(declarationDansConfig(JSON.stringify({ mcpServers: { mnemo: { type: 'http', url: 'https://x' } } }))).toMatchObject({ declaration: { lancement: null } });
		const jsonc = '{\n  // serveurs\n  "mcpServers": {\n    "mnemo": { "command": "/n", "args": ["/m", "mcp"], },\n  },\n  "cle": "a // pas un commentaire",\n}\n';
		expect(declarationDansConfig(jsonc)).toMatchObject({ jsonc: true, racine: { cle: 'a // pas un commentaire' }, declaration: { lancement: { commande: '/n' } } });
		expect(declarationDansConfig('{')).toHaveProperty('echec');
		expect(declarationDansConfig('[]')).toHaveProperty('echec');
		expect(declarationDansConfig('{"mcpServers":[]}')).toHaveProperty('echec');
	});

	it('écriture : entrée ajoutée ou remplacée à sa place, le reste et le style gardés ; retrait ; commande et entrée à coller', () => {
		const texte = '{\r\n\t"mcpServers": {\r\n\t\t"autre": {"command": "x", "inconnu": 1}\r\n\t},\r\n\t"apres": true\r\n}\r\n';
		const lue = declarationDansConfig(texte) as { racine: Record<string, unknown> };
		const avec = texteAvecDeclaration(texte, lue.racine, { node: NODE, main: MAIN });
		expect(avec.split('\r\n')[1]).toBe('\t"mcpServers": {');
		expect(avec).not.toMatch(/[^\r]\n/u);
		expect(JSON.parse(avec)).toEqual({ mcpServers: { autre: { command: 'x', inconnu: 1 }, mnemo: { type: 'local', command: NODE, args: [MAIN, 'mcp'], tools: ['*'] } }, apres: true });
		const sans = texteAvecDeclaration(avec, (declarationDansConfig(avec) as { racine: Record<string, unknown> }).racine, null);
		expect(JSON.parse(sans)).toEqual({ mcpServers: { autre: { command: 'x', inconnu: 1 } }, apres: true });
		expect(texteAvecDeclaration(null, {}, { node: NODE, main: MAIN })).toBe(`${JSON.stringify({ mcpServers: { mnemo: { type: 'local', command: NODE, args: [MAIN, 'mcp'], tools: ['*'] } } }, null, 2)}\n`);
		expect(commandeManuelleCopilotCli(NODE, MAIN, 'darwin')).toBe(`copilot mcp add mnemo -- '${NODE}' '${MAIN}' mcp`);
		expect(entreeAColler(NODE, MAIN)).toBe(`"mnemo": {"type":"local","command":"${NODE}","args":["${MAIN}","mcp"],"tools":["*"]}`);
	});

	it('désactivation : mnemo dans disabledMcpServers de settings.json ; absent ou illisible : actif', () => {
		expect(desactiveDansReglages('{"disabledMcpServers":["mnemo"]}')).toBe(true);
		expect(desactiveDansReglages('{\n  // x\n  "disabledMcpServers": ["autre"],\n}')).toBe(false);
		expect(desactiveDansReglages(null)).toBe(false);
		expect(desactiveDansReglages('{')).toBe(false);
	});
});

describe('hooks de Mnemo dans hooks/mnemo.json', () => {
	it('fichier attendu : une commande gardée par événement de Copilot, bash et powershell, délais ; aucun matcher ; notification, jamais permissionRequest', () => {
		const attendu = fichierDeHooksAttendu(NODE, MAIN);
		expect(attendu.version).toBe(1);
		expect(Object.keys(attendu.hooks)).toEqual(['sessionStart', 'userPromptSubmitted', 'preToolUse', 'postToolUse', 'agentStop', 'notification', 'sessionEnd']);
		// 10 s : Copilot laisse passer l'outil à son délai ; Mnemo décide en 2 s
		expect(attendu.hooks['preToolUse']).toEqual([{ type: 'command', ...commandesDuHook(NODE, MAIN, ['outil']), timeoutSec: 10 }]);
		// après chaque outil : le dialogue ouvert est effacé
		expect(attendu.hooks['postToolUse']).toEqual([{ type: 'command', ...commandesDuHook(NODE, MAIN, ['apres_outil']), timeoutSec: 3 }]);
		expect(attendu.hooks['notification']).toEqual([{ type: 'command', ...commandesDuHook(NODE, MAIN, ['arret', '--notification']), timeoutSec: 3 }]);
		expect(commandesDuHook(NODE, MAIN, ['arret', '--notification']).bash).toBe(`[ "$MNEMO_MOTEUR" = copilot-cli ] || exit 0; '${NODE}' '${MAIN}' hook arret --notification --moteur copilot-cli`);
		expect(commandesDuHook(NODE, MAIN, ['fin']).powershell).toMatch(/^if \(\$env:MNEMO_MOTEUR -ne 'copilot-cli'\) \{ exit 0 \}; & /u);
		expect(HOOKS_COPILOT_CLI_INSTALLES.every((h) => h.timeoutSec >= 3)).toBe(true);
	});

	it('état : absent, à jour, périmé (autre installation), personnel ; retrait de cette installation seulement', () => {
		const attendu = fichierDeHooksAttendu(NODE, MAIN);
		expect(etatDuFichierDeHooks(null, NODE, MAIN).etat).toBe('absent');
		expect(etatDuFichierDeHooks({}, NODE, MAIN).etat).toBe('absent');
		expect(etatDuFichierDeHooks(JSON.parse(texteJsonReecrit(attendu, null)), NODE, MAIN)).toEqual({ etat: 'a_jour', autres: false, deCetteInstallation: true, personnels: [] });
		const autre = fichierDeHooksAttendu('/autre/node', MAIN);
		expect(etatDuFichierDeHooks(autre, NODE, MAIN)).toEqual({ etat: 'perime', autres: true, deCetteInstallation: false, personnels: [] });
		// une commande de l'utilisateur, une clé ajoutée : personnelles
		const perso = { ...attendu, hooks: { ...attendu.hooks, preToolUse: [...attendu.hooks['preToolUse']!, { type: 'command', bash: 'echo x' }], agentStop: [{ ...(attendu.hooks['agentStop']![0] as object), env: { A: '1' } }] } };
		expect(etatDuFichierDeHooks(perso, NODE, MAIN)).toMatchObject({ etat: 'perime', personnels: ['hooks.preToolUse[1]', 'hooks.agentStop[0].env'] });
		expect(etatDuFichierDeHooks([], NODE, MAIN).personnels).toHaveLength(1);
		// mêlé à une autre installation : seules ses commandes partent ; seul : plus rien (fichier à supprimer)
		expect(fichierSansCetteInstallation(attendu, NODE, MAIN)).toBeNull();
		const meles = { version: 1, hooks: { preToolUse: [...attendu.hooks['preToolUse']!, ...autre.hooks['preToolUse']!], sessionEnd: attendu.hooks['sessionEnd']! } };
		expect(fichierSansCetteInstallation(meles, NODE, MAIN)).toEqual({ version: 1, hooks: { preToolUse: autre.hooks['preToolUse'] } });
	});
});

describe('modèles, télémétrie, version et touches de GitHub Copilot CLI', () => {
	it('modèles : la liste du réglage model de copilot help config, dans l’ordre, sans doublon ni nom refusé', () => {
		const aide = 'Configuration Settings:\n\n  `model`: AI model to use.\n    - "claude-sonnet-4.5"\n    - "gpt-5.2"\n    - "gpt-5.2"\n    - "-x"\n\n  `theme`: …\n    - "dark"\n';
		expect(modelesDeLAide(aide)).toEqual(['claude-sonnet-4.5', 'gpt-5.2']);
		expect(modelesDeLAide('rien')).toEqual([]);
	});

	it('fenêtre : le dernier usage de l’agent de la session (entrée + sortie, maxPromptTokens) ; autre interaction, ligne illisible : ignorées', () => {
		const usage = (u: Record<string, unknown>) => JSON.stringify({ type: 'session.usage_record', data: { usage: u }, id: 'x' });
		const lignes = [
			usage({ inputTokens: 100, outputTokens: 10, maxPromptTokens: 1000, interactionType: 'conversation-agent' }),
			usage({ inputTokens: 1200, outputTokens: 30, maxPromptTokens: 200000, interactionType: 'conversation-agent' }),
			usage({ inputTokens: 5, outputTokens: 1, maxPromptTokens: 1000, interactionType: 'title-generation' }),
			'{"type":"session.usage_record", tronquée',
		];
		expect(fenetreDansLeJournal(lignes)).toEqual({ utilises: 1230, max: 200000 });
		expect(fenetreDansLeJournal([usage({ inputTokens: 7, maxPromptTokens: 100 })])).toEqual({ utilises: 7, max: 100 });
		expect(fenetreDansLeJournal([usage({ inputTokens: 7 }), '{"type":"assistant.message"}'])).toBeNull();
		expect(fenetreDansLeJournal([])).toBeNull();
	});

	it('version : « GitHub Copilot CLI 1.0.116. » lue, 1.0.116 au moins ; touches de l’arrêt', () => {
		expect(versionDans('GitHub Copilot CLI 1.0.116.\nRun copilot update to check for updates.\n')).toBe('1.0.116');
		expect(versionDans('GitHub Copilot CLI 1.0.117-1.')).toBe('1.0.117-1');
		expect(refusDeVersionCopilotCli('1.0.116')).toBeNull();
		expect(refusDeVersionCopilotCli('1.0.115')).toMatch(/GitHub Copilot CLI/u);
		expect(refusDeVersionCopilotCli(null)).toBeNull();
		expect(TOUCHES_COPILOT_CLI).toMatchObject({ arret: '\x15/exit', entree: '\r', echap: '\x1b' });
	});
});
