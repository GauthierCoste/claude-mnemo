/** Mistral Vibe, calcul pur : outils, déclaration MCP et hooks dans ses fichiers TOML, modèles, télémétrie, version. */
import { describe, expect, it } from 'vitest';
import { blocDeDeclaration, commandeManuelleMistralVibe, declarationDansConfig, texteAvecDeclaration, texteSansDeclaration } from '../../src/domaine/moteurs/mistral-vibe/declaration.ts';
import { blocsAttendus, commandeDuHook, etatDesHooksMistralVibe, HOOKS_MISTRAL_VIBE_INSTALLES, hooksDeMnemo, texteAvecHooks } from '../../src/domaine/moteurs/mistral-vibe/hooks-installes.ts';
import { modelesDeConfig, MODELES_INTEGRES_MISTRAL_VIBE } from '../../src/domaine/moteurs/mistral-vibe/modeles.ts';
import { OUTILS_MISTRAL_VIBE } from '../../src/domaine/moteurs/mistral-vibe/outils.ts';
import { fenetreDansEtatDuMoteur, fenetreMistralVibe, generationCourante, tokensDansLaProjection, tokensDansLeJournal } from '../../src/domaine/moteurs/mistral-vibe/telemetrie.ts';
import { refusDeVersionMistralVibe } from '../../src/domaine/moteurs/mistral-vibe/version.ts';
import { elementsDuTableau, entreesToml } from '../../src/domaine/moteurs/toml-lecture.ts';
import { versionDans } from '../../src/domaine/moteurs/version.ts';

const NODE = '/opt/node/bin/node';
const MAIN = '/opt/mnemo/src/adaptateurs/cli/main.ts';

describe('outils de Mistral Vibe', () => {
	it('écriture : file_path (ou path) de write_file et edit ; sans chemin lisible : illisible ; autre outil : non concerné', () => {
		expect(OUTILS_MISTRAL_VIBE.cheminsEcrits({ nom: 'file_system.write_file', entree: { file_path: '/p/secret.txt', content: 'x' } })).toEqual(['/p/secret.txt']);
		expect(OUTILS_MISTRAL_VIBE.cheminsEcrits({ nom: 'file_system.edit', entree: { path: 'a.md' } })).toEqual(['a.md']);
		expect(OUTILS_MISTRAL_VIBE.cheminsEcrits({ nom: 'file_system.write_file', entree: { file_path: 3 } })).toBe('illisible');
		expect(OUTILS_MISTRAL_VIBE.cheminsEcrits({ nom: 'file_system.read_file', entree: { file_path: '/p/a' } })).toBeNull();
	});

	it('commande : bash et process.start (command), un shell -c déplié ; autre outil : non concerné', () => {
		expect(OUTILS_MISTRAL_VIBE.commande({ nom: 'file_system.bash', entree: { command: 'git push --force', timeout: 120 } })).toBe('git push --force');
		expect(OUTILS_MISTRAL_VIBE.commande({ nom: 'process.start', entree: { command: ['/bin/bash', '-c', 'rm -rf x'] } })).toBe('rm -rf x');
		expect(OUTILS_MISTRAL_VIBE.commande({ nom: 'file_system.bash', entree: {} })).toBe('');
		expect(OUTILS_MISTRAL_VIBE.commande({ nom: 'mcp_mnemo.lire', entree: { id: 'x' } })).toBeNull();
		expect(OUTILS_MISTRAL_VIBE.prefixeMcp).toBe('mcp_mnemo.');
	});
});

const CONFIG = `# réglages de l'utilisateur
active_model = "local"

[[mcp_servers]]
name = "autre"
transport = "stdio"
command = "npx"
`;

describe('déclaration MCP dans config.toml', () => {
	it('absente, ajoutée à la fin sans rien toucher, puis lue : lancement, active, aucun réglage', () => {
		expect(declarationDansConfig(CONFIG)).toEqual({ declaration: null });
		expect(declarationDansConfig(null)).toEqual({ declaration: null });
		const texte = texteAvecDeclaration(CONFIG, NODE, MAIN);
		expect(texte.startsWith(CONFIG)).toBe(true);
		expect(texte.endsWith(blocDeDeclaration(NODE, MAIN))).toBe(true);
		const lue = declarationDansConfig(texte);
		expect(lue).toMatchObject({ declaration: { lancement: { commande: NODE, args: [MAIN, 'mcp'] }, active: true, reglages: [] } });
		expect(texteAvecDeclaration(null, NODE, MAIN)).toBe(blocDeDeclaration(NODE, MAIN));
	});

	it('commande en liste, désactivée, réglages personnels (env, sous-table comprise) ; autre transport : sans lancement', () => {
		const liste = `${CONFIG}\n[[mcp_servers]]\nname = "mnemo"\ntransport = "stdio"\ncommand = ["${NODE}", "${MAIN}"]\nargs = ["mcp"]\ndisabled = true\nstartup_timeout_sec = 30\n[mcp_servers.env]\nA = "1"\n`;
		expect(declarationDansConfig(liste)).toMatchObject({ declaration: { lancement: { commande: NODE, args: [MAIN, 'mcp'] }, active: false, reglages: ['disabled', 'startup_timeout_sec', 'env'] } });
		expect(declarationDansConfig('[[mcp_servers]]\nname = "mnemo"\ntransport = "http"\nurl = "http://x"\n')).toMatchObject({ declaration: { lancement: null } });
	});

	it('remplacée à sa place, retirée sans le reste ; TOML illisible ou tableau en ligne : échec', () => {
		const ancienne = texteAvecDeclaration(CONFIG, '/autre/node', MAIN);
		const d = declarationDansConfig(`${ancienne}\n[tools.bash]\npermission = "ask"\n`);
		if (!('declaration' in d) || d.declaration === null) throw new Error('déclaration attendue');
		const avec = `${ancienne}\n[tools.bash]\npermission = "ask"\n`;
		const refaite = texteAvecDeclaration(avec, NODE, MAIN, d.declaration.plages);
		expect(refaite).toContain(`command = '${NODE}'`);
		expect(refaite).not.toContain('/autre/node');
		expect(refaite).toContain('[tools.bash]\npermission = "ask"');
		expect(texteSansDeclaration(avec, d.declaration.plages)).toBe(`${CONFIG}\n[tools.bash]\npermission = "ask"\n`);
		expect(declarationDansConfig('a = "ouvert\n')).toEqual({ echec: expect.stringContaining('TOML') });
		expect(declarationDansConfig('mcp_servers = [{ name = "mnemo" }]\n')).toEqual({ echec: expect.stringContaining('tableau en ligne') });
	});

	it('sous-table [mcp_servers.env] écrite après [tools.bash] : retirée ou remplacée sans toucher [tools.bash]', () => {
		const texte = `active_model = "x"\n\n[[mcp_servers]]\nname = "mnemo"\ntransport = "stdio"\ncommand = "/usr/bin/node"\nargs = ["${MAIN}", "mcp"]\n\n[tools.bash]\npermission = "never"\n\n[mcp_servers.env]\nA = "1"\n`;
		const d = declarationDansConfig(texte);
		if (!('declaration' in d) || d.declaration === null) throw new Error('déclaration attendue');
		expect(d.declaration.reglages).toEqual(['env']);
		expect(texteSansDeclaration(texte, d.declaration.plages)).toBe('active_model = "x"\n\n[tools.bash]\npermission = "never"\n');
		expect(texteAvecDeclaration(texte, NODE, MAIN, d.declaration.plages)).toBe(`active_model = "x"\n\n${blocDeDeclaration(NODE, MAIN)}\n[tools.bash]\npermission = "never"\n`);
	});

	it('commande à coller : vibe mcp add, chemins cités pour le shell de la plateforme', () => {
		expect(commandeManuelleMistralVibe("/n o'de", MAIN, 'darwin')).toBe(`vibe mcp add mnemo --transport stdio --command '/n o'\\''de' --arg '${MAIN}' --arg mcp`);
		expect(commandeManuelleMistralVibe('C:\\node.exe', 'C:\\m\\main.ts', 'win32')).toBe("vibe mcp add mnemo --transport stdio --command 'C:\\node.exe' --arg 'C:\\m\\main.ts' --arg mcp");
	});
});

const HOOKS_UTILISATEUR = '# mes hooks\n[[hooks]]\nname = "a-moi"\ntype = "session_start"\ncommand = "true"\n';

describe('hooks de Mnemo dans hooks.toml', () => {
	it('un bloc par événement Vibe, gardé par MNEMO_MOTEUR, timeout et match ; relus par la lecture TOML', () => {
		const texte = texteAvecHooks(HOOKS_UTILISATEUR, [], blocsAttendus(NODE, MAIN, 'darwin'));
		expect(texte.startsWith(HOOKS_UTILISATEUR)).toBe(true);
		const elements = elementsDuTableau(entreesToml(texte)!, 'hooks')!.elements.map((e) => e.valeurs);
		expect(elements).toHaveLength(1 + HOOKS_MISTRAL_VIBE_INSTALLES.length);
		expect(elements.map((e) => e['type'])).toEqual(['session_start', 'session_start', 'pre_agent', 'pre_tool', 'post_tool', 'post_agent', 'notification', 'session_end']);
		expect(elements[2]).toMatchObject({ name: 'mnemo-pre_agent', match: 'main', command: `[ "$MNEMO_MOTEUR" = mistral-vibe ] || exit 0; '${NODE}' '${MAIN}' hook message --moteur mistral-vibe` });
		expect(elements[3]).not.toHaveProperty('strict');
		expect(elements[6]!['command']).toContain('hook arret --notification --moteur mistral-vibe');
		expect(commandeDuHook('C:\\node.exe', 'C:\\m\\main.ts', ['fin'], 'win32')).toBe('if "%MNEMO_MOTEUR%"=="mistral-vibe" "C:\\node.exe" "C:\\m\\main.ts" hook fin --moteur mistral-vibe');
	});

	it('état : absent, à jour, périmé (autre installation, ou un hook en moins) ; les hooks de l’utilisateur ne comptent pas', () => {
		const lire = (t: string) => {
			const h = hooksDeMnemo(t);
			if ('echec' in h) throw new Error(h.echec);
			return h.elements;
		};
		expect(etatDesHooksMistralVibe(HOOKS_UTILISATEUR, lire(HOOKS_UTILISATEUR), NODE, MAIN, 'darwin')).toEqual({ etat: 'absent', autres: false });
		const aJour = texteAvecHooks(HOOKS_UTILISATEUR, [], blocsAttendus(NODE, MAIN, 'darwin'));
		expect(etatDesHooksMistralVibe(aJour, lire(aJour), NODE, MAIN, 'darwin')).toEqual({ etat: 'a_jour', autres: false });
		const autre = texteAvecHooks(HOOKS_UTILISATEUR, [], blocsAttendus('/autre/node', MAIN, 'darwin'));
		expect(etatDesHooksMistralVibe(autre, lire(autre), NODE, MAIN, 'darwin')).toEqual({ etat: 'perime', autres: true });
		const incomplet = texteAvecHooks(HOOKS_UTILISATEUR, [], blocsAttendus(NODE, MAIN, 'darwin').slice(1));
		expect(etatDesHooksMistralVibe(incomplet, lire(incomplet), NODE, MAIN, 'darwin')).toEqual({ etat: 'perime', autres: false });
		// refaits sur ce Node : ceux de l'autre installation remplacés, ceux de l'utilisateur gardés
		const refaits = texteAvecHooks(autre, lire(autre), blocsAttendus(NODE, MAIN, 'darwin'));
		expect(refaits).toBe(aJour);
		// retirés : seulement ceux que le filtre désigne
		expect(texteAvecHooks(aJour, lire(aJour), [])).toBe(HOOKS_UTILISATEUR);
		expect(texteAvecHooks(aJour, lire(aJour), [], () => false)).toBe(aJour);
	});

	it('hooks.toml illisible ou en tableau en ligne : échec, jamais réécrit', () => {
		expect(hooksDeMnemo('[[hooks]\n')).toEqual({ echec: expect.stringContaining('TOML') });
		expect(hooksDeMnemo('hooks = []\n')).toEqual({ echec: expect.stringContaining('tableau en ligne') });
		expect(hooksDeMnemo(null)).toEqual({ elements: [] });
	});
});

describe('modèles, télémétrie et version de Mistral Vibe', () => {
	it('modèles : alias de [[models]] puis les intégrés, sans doublon ; config illisible : les intégrés', () => {
		const config = '[[models]]\nname = "factice"\nprovider = "sonde"\nalias = "local"\n[[models]]\nname = "x"\nalias = "mistral-large-4-0"\n';
		expect(modelesDeConfig(config)).toEqual(['local', ...MODELES_INTEGRES_MISTRAL_VIBE]);
		expect(modelesDeConfig('a = "ouvert\n')).toEqual([...MODELES_INTEGRES_MISTRAL_VIBE]);
		expect(modelesDeConfig(null)).toEqual([...MODELES_INTEGRES_MISTRAL_VIBE]);
	});

	it('télémétrie : dernier contextUsage du journal, de la projection ; fenêtre de l’état du moteur ; génération courante', () => {
		const ligne = (total: number) => JSON.stringify({ type: 'projection_delta', payload: { delta: [{ op: 'set_envelope', state: { session: { contextUsage: { inputTokens: total - 10, outputTokens: 10, totalTokens: total } } } }] } });
		expect(tokensDansLeJournal([ligne(100), ligne(1290), '{illisible', '{"autre":1}'])).toBe(1290);
		expect(tokensDansLeJournal([JSON.stringify({ x: { contextUsage: { inputTokens: 5, outputTokens: 2 } } })])).toBe(7);
		expect(tokensDansLeJournal([])).toBeNull();
		expect(tokensDansLaProjection(JSON.stringify({ snapshot: { session: { contextUsage: { totalTokens: 42 } } } }))).toBe(42);
		expect(fenetreDansEtatDuMoteur(JSON.stringify({ core_settings: { context: { model_facts: { context_window: 262144 } } } }))).toBe(262144);
		expect(fenetreDansEtatDuMoteur('{}')).toBeNull();
		expect(fenetreMistralVibe(1290, 262144)).toEqual({ utilises: 1290, max: 262144 });
		expect(fenetreMistralVibe(0, 262144)).toBeNull();
		expect(generationCourante('{"generation":"0000000000000048"}')).toBe('0000000000000048');
		expect(generationCourante('{"generation":"../x"}')).toBeNull();
	});

	it('version : lue dans « vibe 3.1.5 » ; sous 3.1.5 refusée, illisible permise', () => {
		expect(versionDans('vibe 3.1.5\n')).toBe('3.1.5');
		expect(refusDeVersionMistralVibe('3.1.4')).toBe('Mistral Vibe 3.1.4 trop ancien, 3.1.5 ou plus requis');
		expect(refusDeVersionMistralVibe('3.1.5')).toBeNull();
		expect(refusDeVersionMistralVibe('3.2.0')).toBeNull();
		expect(refusDeVersionMistralVibe(null)).toBeNull();
	});
});
