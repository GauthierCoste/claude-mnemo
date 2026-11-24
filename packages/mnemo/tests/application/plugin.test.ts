import { describe, expect, it } from 'vitest';
import { argumentsClaude, assemblerPlugin, enabledPluginsDe, environnementClaude } from '../../src/application/plugin.ts';
import type { PluginInstalle } from '../../src/application/ports.ts';
import type { FichierPlugin } from '../../src/application/plugin.ts';
import { chargerProfil, cheminDeProfil, CONSIGNE_ARCHIVISTE_PAR_DEFAUT, CONSIGNE_TRAVAIL_PAR_DEFAUT, SKILLS_PAR_DEFAUT } from '../../src/application/profil.ts';
import { PROFILS_PAR_DEFAUT } from '../../src/domaine/profil.ts';
import type { Profil } from '../../src/domaine/profil.ts';
import type { EtatIndicateur } from '../../src/domaine/refus-outil.ts';
import type { Session } from '../../src/domaine/session.ts';
import { mkdir, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { coffreFichiers } from '../../src/infra/coffre-fichiers.ts';
import { dossierTemporaire } from '../aides/dossier-temporaire.ts';
import { fauxPorts } from '../aides/faux-ports.ts';

const ID = '0f1e2d3c-4b5a-4968-8776-655443322110';
const session = (champs: Partial<Session> = {}): Session => ({
	id: ID,
	profil: 'travail',
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
	...champs,
});
const TRAVAIL: Profil = { ...PROFILS_PAR_DEFAUT.travail, hooks: [...PROFILS_PAR_DEFAUT.travail.hooks], consigne: CONSIGNE_TRAVAIL_PAR_DEFAUT };
const ARCHIVISTE: Profil = { ...PROFILS_PAR_DEFAUT.archiviste, hooks: [...PROFILS_PAR_DEFAUT.archiviste.hooks], consigne: CONSIGNE_ARCHIVISTE_PAR_DEFAUT };
const APPEL = { node: '/usr/local/bin/node', main: '/opt/mnemo/src/adaptateurs/cli/main.ts', version: '9.9.9-essai' };

const fichier = (fichiers: FichierPlugin[], chemin: string) => fichiers.find((f) => f.chemin === chemin)?.texte;
const json = (fichiers: FichierPlugin[], chemin: string) => JSON.parse(fichier(fichiers, chemin) ?? 'null') as unknown;
const hook = (evenement: string, timeout: number, appel = APPEL, ...options: string[]) => ({ type: 'command', command: appel.node, args: [appel.main, 'hook', evenement, ...options], timeout });
/** Réglages de session : auto-mémoire coupée ; outils de Mnemo utiles au bilan permis d'avance (lecture et proposer). */
const REGLAGES = {
	autoMemoryEnabled: false,
	permissions: {
		allow: ['mcp__mnemo__proposer', 'mcp__mnemo__chercher', 'mcp__mnemo__lire', 'mcp__mnemo__lister', 'mcp__mnemo__voisins', 'mcp__mnemo__chronologie', 'mcp__mnemo__contexte', 'mcp__mnemo__diagnostiquer'],
	},
	// aucun plugin Claude Code installé : rien à allumer ni à éteindre
	enabledPlugins: {},
	// quotas du compte transmis au service, rien d'affiché
	statusLine: { type: 'command', command: `"${APPEL.node}" "${APPEL.main}" ligne-etat` },
};
const installe = (id: string): PluginInstalle => ({ id, nom: id.split('@')[0]!, version: '1.0.0', portee: 'user', skills: [], hooks: false });

describe('assemblerPlugin', () => {
	it('profil travail : manifeste, réglages, consigne et hooks.json des six événements', async () => {
		const fichiers = await assemblerPlugin(fauxPorts(), session(), TRAVAIL, APPEL);
		expect(json(fichiers, '.claude-plugin/plugin.json')).toEqual({ name: 'mnemo-0f1e2d3c', version: APPEL.version });
		expect(json(fichiers, 'settings.json')).toEqual(REGLAGES);
		expect(fichier(fichiers, 'consigne.md')).toBe(`${CONSIGNE_TRAVAIL_PAR_DEFAUT}\n`);
		expect(json(fichiers, 'hooks/hooks.json')).toEqual({
			hooks: {
				SessionStart: [{ hooks: [hook('debut', 10)] }],
				UserPromptSubmit: [{ hooks: [hook('message', 5)] }],
				// un hook outil qui plante ou dépasse son délai bloque l'outil au lieu de le laisser passer
				PreToolUse: [{ matcher: '*', hooks: [{ ...hook('outil', 3), onFailure: 'block' }] }],
				// après la lecture ou l'écriture d'un fichier ou d'une fiche : le sujet de la session a changé
				PostToolUse: [{ matcher: 'Read|Edit|MultiEdit|Write|NotebookEdit|mcp__mnemo__.*', hooks: [hook('apres_outil', 3)] }],
				Stop: [{ hooks: [hook('arret', 3)] }],
				Notification: [{ hooks: [hook('arret', 3, APPEL, '--notification')] }],
				SessionEnd: [{ hooks: [hook('fin', 15)] }],
			},
		});
		// aucun serveur MCP déclaré par le plugin
		expect(fichiers.some((f) => f.chemin === '.mcp.json')).toBe(false);
		expect(fichier(fichiers, '.claude-plugin/plugin.json')).not.toContain('mcpServers');
	});

	it('onFailure « block » sur le hook outil seulement si la mémoire peut contenir des consignes vérifiées au lancement', async () => {
		const outil = async (indicateur: EtatIndicateur) => {
			const dep = fauxPorts();
			dep.indicateur.etat = indicateur;
			const hooks = json(await assemblerPlugin(dep, session(), TRAVAIL, APPEL), 'hooks/hooks.json') as { hooks: { PreToolUse: unknown } };
			return hooks.hooks.PreToolUse;
		};
		const bloquant = [{ matcher: '*', hooks: [{ ...hook('outil', 3), onFailure: 'block' }] }];
		const permissif = [{ matcher: '*', hooks: [hook('outil', 3)] }];
		expect(await outil({ genre: 'note', presentes: true, horodatageMs: 1 })).toEqual(bloquant);
		expect(await outil({ genre: 'illisible' })).toEqual(bloquant);
		expect(await outil({ genre: 'absent', indexExiste: true })).toEqual(bloquant);
		expect(await outil({ genre: 'note', presentes: false, horodatageMs: 1 })).toEqual(permissif);
		expect(await outil({ genre: 'absent', indexExiste: false })).toEqual(permissif);
	});

	it('profil archiviste : les hooks d’état toujours (debut, message sans contexte, arret, fin), pas outil', async () => {
		const fichiers = await assemblerPlugin(fauxPorts(), session({ profil: 'archiviste', dossier: '_mnemo' }), ARCHIVISTE, APPEL);
		expect(json(fichiers, 'hooks/hooks.json')).toEqual({
			hooks: {
				SessionStart: [{ hooks: [hook('debut', 10)] }],
				UserPromptSubmit: [{ hooks: [hook('message', 5, APPEL, '--sans-contexte')] }],
				Stop: [{ hooks: [hook('arret', 3)] }],
				Notification: [{ hooks: [hook('arret', 3, APPEL, '--notification')] }],
				SessionEnd: [{ hooks: [hook('fin', 15)] }],
			},
		});
		expect(json(fichiers, 'settings.json')).toEqual(REGLAGES);
		expect(fichier(fichiers, 'consigne.md')).toBe(`${CONSIGNE_ARCHIVISTE_PAR_DEFAUT}\n`);
	});

	it('profil réduit à [fin] : debut et message sans contexte, arret et fin quand même ; jamais outil', async () => {
		const fichiers = await assemblerPlugin(fauxPorts(), session(), { ...TRAVAIL, hooks: ['fin'] }, APPEL);
		const hooks = (json(fichiers, 'hooks/hooks.json') as { hooks: Record<string, unknown> }).hooks;
		expect(Object.keys(hooks).sort()).toEqual(['Notification', 'SessionEnd', 'SessionStart', 'Stop', 'UserPromptSubmit']);
		expect(hooks.SessionStart).toEqual([{ hooks: [hook('debut', 10, APPEL, '--sans-contexte')] }]);
		expect(hooks.UserPromptSubmit).toEqual([{ hooks: [hook('message', 5, APPEL, '--sans-contexte')] }]);
	});

	it('chemins Windows (espaces, antislashs) : passés tels quels, un argument chacun, sans shell', async () => {
		const appel = { ...APPEL, node: 'C:\\Program Files\\nodejs\\node.exe', main: 'C:\\Users\\Jean Dupont\\mnemo\\src\\adaptateurs\\cli\\main.ts' };
		const fichiers = await assemblerPlugin(fauxPorts(), session(), TRAVAIL, appel);
		const hooks = json(fichiers, 'hooks/hooks.json') as { hooks: Record<string, { hooks: unknown[] }[]> };
		expect(hooks.hooks.SessionStart![0]!.hooks[0]).toEqual(hook('debut', 10, appel));
	});

	it('un chemin qui contient un guillemet double est refusé', async () => {
		await expect(assemblerPlugin(fauxPorts(), session(), TRAVAIL, { ...APPEL, node: '/opt/"node"/bin/node' })).rejects.toThrow(/guillemet/);
		await expect(assemblerPlugin(fauxPorts(), session(), TRAVAIL, { ...APPEL, main: '/opt/a"b/main.ts' })).rejects.toThrow(/guillemet/);
	});

	it('travail : copie les skills sans champ projets ou qui nomment le projet, avec leurs fichiers', async () => {
		const dep = fauxPorts();
		dep.fichiers.set('skills/skills.md', '---\ntype: dossier\n---\n# Skills\n');
		dep.fichiers.set('skills/revue/SKILL.md', '---\ndescription: Revue\n---\nRelis.\n');
		dep.fichiers.set('skills/revue/exemples/bon.md', 'Un bon exemple.\n');
		dep.fichiers.set('skills/alpha/SKILL.md', '---\ndescription: Alpha\nprojets: [alpha]\n---\nAlpha.\n');
		dep.fichiers.set('skills/beta/SKILL.md', '---\ndescription: Beta\nprojets: [beta]\n---\nBeta.\n');
		dep.fichiers.set('skills/sans-skill/notes.md', 'Pas de SKILL.md.\n');
		const fichiers = await assemblerPlugin(dep, session(), TRAVAIL, APPEL);
		const skills = fichiers.filter((f) => f.chemin.startsWith('skills/')).map((f) => f.chemin).sort();
		expect(skills).toEqual(['skills/alpha/SKILL.md', 'skills/revue/SKILL.md', 'skills/revue/exemples/bon.md']);
		expect(fichier(fichiers, 'skills/revue/exemples/bon.md')).toBe('Un bon exemple.\n');
		expect(dep.commits).toHaveLength(0);
	});

	it("archiviste : dépose ses skills par défaut au premier lancement (un commit), ne les réécrit jamais, et les copie", async () => {
		const dep = fauxPorts();
		const fichiers = await assemblerPlugin(dep, session({ profil: 'archiviste' }), ARCHIVISTE, APPEL);
		const noms = SKILLS_PAR_DEFAUT.archiviste!.map((s) => s.nom).sort();
		expect(noms).toEqual(['comptes-rendus', 'emails', 'menage', 'specs']);
		expect(fichiers.filter((f) => f.chemin.startsWith('skills/')).map((f) => f.chemin).sort()).toEqual(noms.map((n) => `skills/${n}/SKILL.md`));
		expect(dep.commits).toEqual([{ message: 'mnemo: skills par défaut profils/archiviste/skills', chemins: SKILLS_PAR_DEFAUT.archiviste!.map((s) => `profils/archiviste/skills/${s.nom}/SKILL.md`) }]);

		dep.fichiers.set('profils/archiviste/skills/emails/SKILL.md', '---\ndescription: À moi\n---\nMa version.\n');
		dep.fichiers.set('profils/archiviste/skills/devis/SKILL.md', '---\ndescription: Devis\n---\nDevis.\n');
		const ensuite = await assemblerPlugin(dep, session({ profil: 'archiviste' }), ARCHIVISTE, APPEL);
		expect(dep.commits).toHaveLength(1);
		expect(fichier(ensuite, 'skills/emails/SKILL.md')).toBe('---\ndescription: À moi\n---\nMa version.\n');
		expect(fichier(ensuite, 'skills/devis/SKILL.md')).toContain('Devis.');
		// les skills du projet ne sont pas copiées pour l'archiviste
		dep.fichiers.set('skills/revue/SKILL.md', 'Relis.\n');
		expect((await assemblerPlugin(dep, session({ profil: 'archiviste' }), ARCHIVISTE, APPEL)).some((f) => f.chemin === 'skills/revue/SKILL.md')).toBe(false);
	});

	it('enabledPlugins : vrai pour les plugins du profil installés, faux pour tous les autres installés', async () => {
		const dep = fauxPorts();
		dep.pluginsClaude.plugins.push(installe('a@m'), installe('b@m'));
		const fichiers = await assemblerPlugin(dep, session(), { ...TRAVAIL, plugins: ['a@m'] }, APPEL);
		expect(json(fichiers, 'settings.json')).toEqual({ ...REGLAGES, enabledPlugins: { 'a@m': true, 'b@m': false } });
	});

	it('un plugin listé mais non installé est ignoré, sans erreur', async () => {
		const fichiers = await assemblerPlugin(fauxPorts(), session(), { ...TRAVAIL, plugins: ['disparu@m'] }, APPEL);
		expect(json(fichiers, 'settings.json')).toEqual({ ...REGLAGES, enabledPlugins: {} });
	});

	it('skillsMemoire par nom : seules les skills nommées de la mémoire sont copiées', async () => {
		const dep = fauxPorts();
		dep.fichiers.set('skills/revue/SKILL.md', '---\ndescription: Revue\n---\nRelis.\n');
		dep.fichiers.set('skills/autre/SKILL.md', '---\ndescription: Autre\n---\nAutre.\n');
		const fichiers = await assemblerPlugin(dep, session(), { ...TRAVAIL, skillsMemoire: ['revue'] }, APPEL);
		expect(fichiers.filter((f) => f.chemin.startsWith('skills/')).map((f) => f.chemin)).toEqual(['skills/revue/SKILL.md']);
	});

	it('skills propres au profil toujours copiées, avec celles de la mémoire ; même nom : celle du profil gagne', async () => {
		const dep = fauxPorts();
		dep.fichiers.set('skills/revue/SKILL.md', '---\ndescription: Revue\n---\nMémoire.\n');
		dep.fichiers.set('skills/autre/SKILL.md', '---\ndescription: Autre\n---\nAutre.\n');
		dep.fichiers.set('profils/dev/skills/revue/SKILL.md', '---\ndescription: Revue\n---\nProfil.\n');
		dep.fichiers.set('profils/dev/skills/tests/SKILL.md', '---\ndescription: Tests\n---\nTeste.\n');
		const fichiers = await assemblerPlugin(dep, session({ profil: 'dev' }), { ...TRAVAIL, nom: 'dev' }, APPEL);
		expect(fichiers.filter((f) => f.chemin.startsWith('skills/')).map((f) => f.chemin).sort()).toEqual(['skills/autre/SKILL.md', 'skills/revue/SKILL.md', 'skills/tests/SKILL.md']);
		expect(fichier(fichiers, 'skills/revue/SKILL.md')).toContain('Profil.');
		expect(dep.commits).toEqual([]);
	});
});

describe('enabledPluginsDe', () => {
	it('vrai pour chaque installé listé, faux pour chaque autre installé ; un listé non installé est absent', () => {
		expect(enabledPluginsDe({ ...TRAVAIL, plugins: ['a@m', 'disparu@m'] }, [installe('a@m'), installe('b@m')])).toEqual({ 'a@m': true, 'b@m': false });
		expect(enabledPluginsDe(TRAVAIL, [])).toEqual({});
	});
});

describe('skills et liens symboliques (vrai coffre)', () => {
	async function depReel() {
		const racine = await dossierTemporaire();
		const memoire = join(racine, '_mnemo');
		await mkdir(memoire);
		return { dep: { ...fauxPorts(), coffre: coffreFichiers(memoire) }, memoire, dehors: join(racine, 'dehors') };
	}
	const ecrire = async (chemin: string, texte: string) => {
		await mkdir(join(chemin, '..'), { recursive: true });
		await writeFile(chemin, texte);
	};

	it('une skill dont le SKILL.md est un lien symbolique (ou absent) est écartée', async () => {
		const { dep, memoire, dehors } = await depReel();
		await ecrire(join(dehors, 'secret.md'), 'Hors mémoire.\n');
		await ecrire(join(memoire, 'skills', 'bonne', 'SKILL.md'), 'Bonne.\n');
		await mkdir(join(memoire, 'skills', 'liee'), { recursive: true });
		await symlink(join(dehors, 'secret.md'), join(memoire, 'skills', 'liee', 'SKILL.md'));
		await ecrire(join(memoire, 'skills', 'sans', 'notes.md'), 'x');
		const fichiers = await assemblerPlugin(dep, session(), TRAVAIL, APPEL);
		expect(fichiers.filter((f) => f.chemin.startsWith('skills/')).map((f) => f.chemin)).toEqual(['skills/bonne/SKILL.md']);
		expect(fichiers.some((f) => f.texte.includes('Hors mémoire.'))).toBe(false);
	});

	it('skills/ ou profils/<nom>/skills/ lien symbolique : jamais suivi', async () => {
		const { dep, memoire, dehors } = await depReel();
		await ecrire(join(dehors, 'revue', 'SKILL.md'), 'Hors mémoire.\n');
		for (const s of SKILLS_PAR_DEFAUT.archiviste!) await ecrire(join(dehors, s.nom, 'SKILL.md'), 'Hors mémoire.\n');
		await symlink(dehors, join(memoire, 'skills'));
		await mkdir(join(memoire, 'profils', 'archiviste'), { recursive: true });
		await symlink(dehors, join(memoire, 'profils', 'archiviste', 'skills'));
		const travail = await assemblerPlugin(dep, session(), TRAVAIL, APPEL);
		const archiviste = await assemblerPlugin(dep, session({ profil: 'archiviste' }), ARCHIVISTE, APPEL);
		for (const fichiers of [travail, archiviste]) {
			expect(fichiers.filter((f) => f.chemin.startsWith('skills/'))).toEqual([]);
		}
	});
});

describe('chargerProfil', () => {
	it('profil illisible ou absent → défaut ; fiche valide → ses champs', async () => {
		const dep = fauxPorts();
		expect(await chargerProfil(dep, 'archiviste')).toEqual(ARCHIVISTE);
		expect(await chargerProfil(dep, 'travail')).toEqual(TRAVAIL);
		dep.fichiers.set('profils/archiviste/archiviste.md', '---\ntype: [oups\n---\n# x');
		expect(await chargerProfil(dep, 'archiviste')).toEqual(ARCHIVISTE);
		dep.fichiers.set('profils/archiviste/archiviste.md', '---\ntype: profil\nhooks: [debut, fin]\n---\n# Archiviste\n\nRange tout.\n');
		expect(await chargerProfil(dep, 'archiviste')).toEqual({ ...ARCHIVISTE, consigne: 'Range tout.', consignePersonnalisee: true, hooks: ['debut', 'fin'] });
	});
	it('un profil inconnu part des valeurs du profil travail, sous son nom', async () => {
		expect(await chargerProfil(fauxPorts(), 'reve')).toEqual({ ...TRAVAIL, nom: 'reve' });
	});
	it('un nom de profil invalide désigne le profil travail', async () => {
		const dep = fauxPorts();
		dep.fichiers.set('profils/travail/travail.md', '---\ntype: profil\n---\n# Travail\n\nConsigne travail.\n');
		for (const nom of ['../x', 'Archiviste', 'a/b', '', '-x', 'a'.repeat(41), 'é', 'x\n']) {
			expect(await chargerProfil(dep, nom), nom).toEqual({ ...TRAVAIL, consigne: 'Consigne travail.', consignePersonnalisee: true });
		}
		expect((await chargerProfil(dep, 'a'.repeat(40))).nom).toBe('a'.repeat(40));
		expect(cheminDeProfil('../../etc')).toBe('profils/travail/travail.md');
	});
});

describe('argumentsClaude', () => {
	const dossiers = { plugin: '/m/.mnemo/plugins/x', racine: '/m' };
	const communs = ['--plugin-dir', '/m/.mnemo/plugins/x', '--settings', '/m/.mnemo/plugins/x/settings.json', '--append-system-prompt-file', '/m/.mnemo/plugins/x/consigne.md'];

	it('nouvelle : --session-id, puis le plugin, puis l\'objectif en dernier', () => {
		expect(argumentsClaude(session(), TRAVAIL, dossiers, 'nouvelle')).toEqual(['--session-id', ID, ...communs]);
		expect(argumentsClaude(session(), TRAVAIL, dossiers, 'nouvelle', 'Corriger la facture')).toEqual(['--session-id', ID, ...communs, 'Corriger la facture']);
	});

	it('reprise : --resume, jamais d\'objectif', () => {
		expect(argumentsClaude(session(), TRAVAIL, dossiers, 'reprise', 'ignoré')).toEqual(['--resume', ID, ...communs]);
	});

	it('archiviste : --add-dir sur la racine, avant le plugin (il prend plusieurs valeurs) ; l\'objectif reste le dernier', () => {
		expect(argumentsClaude(session({ profil: 'archiviste' }), ARCHIVISTE, dossiers, 'nouvelle')).toEqual(['--session-id', ID, '--add-dir', '/m', ...communs]);
		expect(argumentsClaude(session({ profil: 'archiviste' }), ARCHIVISTE, dossiers, 'nouvelle', 'Range ces emails')).toEqual([
			'--session-id',
			ID,
			'--add-dir',
			'/m',
			'--plugin-dir',
			'/m/.mnemo/plugins/x',
			'--settings',
			'/m/.mnemo/plugins/x/settings.json',
			'--append-system-prompt-file',
			'/m/.mnemo/plugins/x/consigne.md',
			'Range ces emails',
		]);
		expect(argumentsClaude(session({ profil: 'archiviste' }), ARCHIVISTE, dossiers, 'reprise')).toEqual(['--resume', ID, '--add-dir', '/m', ...communs]);
	});

	it('--add-dir suit le lancement, plus le nom : une copie de l\'archiviste lancée dans la mémoire le reçoit, travail non', () => {
		const copie = session({ profil: 'copie-archiviste', dossier: '_mnemo' });
		const profil: Profil = { ...ARCHIVISTE, nom: 'copie-archiviste' };
		expect(argumentsClaude(copie, profil, dossiers, 'nouvelle')).toEqual(['--session-id', ID, '--add-dir', '/m', ...communs]);
		expect(argumentsClaude(session(), TRAVAIL, dossiers, 'nouvelle')).not.toContain('--add-dir');
	});

	it('un objectif qui commence par « - » n\'est jamais lu comme une option ; un objectif blanc est omis', () => {
		expect(argumentsClaude(session(), TRAVAIL, dossiers, 'nouvelle', '--dangerously-skip-permissions').at(-1)).toBe(' --dangerously-skip-permissions');
		expect(argumentsClaude(session(), TRAVAIL, dossiers, 'nouvelle', '   ')).toEqual(['--session-id', ID, ...communs]);
	});

	it('chemins Windows : les fichiers du plugin gardent les antislashs', () => {
		const args = argumentsClaude(session(), TRAVAIL, { plugin: 'C:\\m\\.mnemo\\plugins\\x', racine: 'C:\\m' }, 'nouvelle');
		expect(args).toContain('C:\\m\\.mnemo\\plugins\\x\\settings.json');
		expect(args).toContain('C:\\m\\.mnemo\\plugins\\x\\consigne.md');
	});

	it('identifiant de session qui n\'est pas un uuid : refusé', () => {
		expect(() => argumentsClaude(session({ id: 'pas-un-uuid' }), TRAVAIL, dossiers, 'nouvelle')).toThrow(/uuid/i);
	});
});

describe('environnementClaude', () => {
	it("retire les accès à l'API et pose les variables de la session", () => {
		const env = environnementClaude(
			{
				PATH: '/usr/bin',
				HOME: '/Users/x',
				ANTHROPIC_API_KEY: 'sk-ant-secret',
				ANTHROPIC_AUTH_TOKEN: 't',
				ANTHROPIC_BASE_URL: 'https://proxy',
				CLAUDE_CODE_USE_BEDROCK: '1',
				CLAUDE_CODE_USE_VERTEX: '1',
				VIDE: undefined,
				MNEMO_SESSION: 'ancienne',
			},
			session(),
			'/m',
		);
		expect(env).toEqual({ PATH: '/usr/bin', HOME: '/Users/x', MNEMO_SESSION: ID, MNEMO_PROJET: 'alpha', MNEMO_RACINE: '/m', CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1' });
	});

	it("retire les marques d'une session Claude Code parente (service lancé depuis Claude Code)", () => {
		const env = environnementClaude({ PATH: '/usr/bin', CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'cli' }, session(), '/m');
		expect(env.CLAUDECODE).toBeUndefined();
		expect(env.CLAUDE_CODE_ENTRYPOINT).toBeUndefined();
		expect(env.PATH).toBe('/usr/bin');
	});

	it('retire tout sélecteur de fournisseur CLAUDE_CODE_USE_* sauf PowerShell, et CLAUDE_CODE_CHILD_SESSION', () => {
		const env = environnementClaude(
			{
				CLAUDE_CODE_USE_FOUNDRY: '1',
				CLAUDE_CODE_USE_MANTLE: '1',
				CLAUDE_CODE_USE_ANTHROPIC_AWS: '1',
				CLAUDE_CODE_USE_ANTHROPIC_GOOGLE_CLOUD: '1',
				claude_code_use_bedrock: '1',
				CLAUDE_CODE_USE_POWERSHELL_TOOL: '1',
				CLAUDE_CODE_CHILD_SESSION: '1',
				CLAUDE_CODE_AUTRE: 'garde',
			},
			session(),
			'/m',
		);
		expect(Object.keys(env).filter((k) => !k.startsWith('MNEMO_') && k !== 'CLAUDE_CODE_DISABLE_AUTO_MEMORY').sort()).toEqual(['CLAUDE_CODE_AUTRE', 'CLAUDE_CODE_USE_POWERSHELL_TOOL']);
	});

	it('retire les variables interdites quelle que soit leur casse (Windows)', () => {
		const env = environnementClaude({ Anthropic_Api_Key: 'sk', Path: 'C:\\bin' }, session(), 'C:\\m');
		expect(env.Anthropic_Api_Key).toBeUndefined();
		expect(env.Path).toBe('C:\\bin');
	});
});
