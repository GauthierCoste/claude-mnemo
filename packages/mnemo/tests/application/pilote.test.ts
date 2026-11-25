import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { creerPilote, ligneManuelle } from '../../src/application/pilote.ts';
import type { Pilote } from '../../src/application/pilote.ts';
import type { CommandeMoteur, EtatSessions, FichierPlugin, Pilotage } from '../../src/application/ports.ts';
import type { Session } from '../../src/domaine/session.ts';
import { ouvrirEtat } from '../../src/infra/etat-sqlite.ts';
import { dossierTemporaire } from '../aides/dossier-temporaire.ts';
import { DEPOT_ABSENT, fauxPorts } from '../aides/faux-ports.ts';
import { fauxTerminaux } from '../aides/faux-terminaux.ts';
import type { FauxTerminaux } from '../aides/faux-terminaux.ts';
import { moteursDeTest } from '../aides/moteurs.ts';

const RACINE = '/racine';
const DEMARRAGE = 1_700_000_000_000;
const APPEL = { node: '/usr/bin/node', main: '/opt/mnemo/main.ts', version: '0.0.0-essai' };
const CLAUDE = { commande: '/usr/bin/node', avant: ['/aides/faux-claude.mjs'] };
const entete = (type: string, extra = '') => `---\nid: 01ABC\ntype: ${type}\n${extra}updated: 2026-11-01\n---\n`;

const ouverts: EtatSessions[] = [];
const pilotes: Pilote[] = [];
afterEach(async () => {
	while (pilotes.length > 0) await pilotes.pop()!.arreterTout();
	while (ouverts.length > 0) ouverts.pop()!.fermer();
});

type Contexte = {
	pilote: Pilote;
	dep: ReturnType<typeof fauxPorts>;
	etat: EtatSessions;
	terminaux: FauxTerminaux;
	pil: Pilotage;
	plugins: Map<string, FichierPlugin[]>;
	/** pid → ce que l'hôte en dit (absent : mort). */
	processus: Map<number, 'session' | 'autre'>;
	interroges: number[];
	nettoyes: number[];
	existants: Set<string>;
	/** Chemin réel de certains dossiers (liens). */
	liens: Map<string, string>;
};

async function contexte(
	options: { claude?: CommandeMoteur | null; plateforme?: string; sessions?: Session[]; ecrire?: (session: string, f: FichierPlugin[]) => Promise<string> } = {},
): Promise<Contexte> {
	const dep = fauxPorts();
	await dep.coffre.ecrire('projets/alpha/alpha.md', `${entete('dossier', 'dossier_projet: alpha\nportee: projet:alpha\n')}# Alpha\n`);
	await dep.coffre.ecrire('clients/acme/acme.md', `${entete('entite', 'dossier_projet: travaux/acme\nportee: client:acme\n')}# Acme\n`);
	const etat = ouvrirEtat(join(await dossierTemporaire(), 'etat.sqlite'));
	ouverts.push(etat);
	for (const s of options.sessions ?? []) await etat.creer(s);
	const terminaux = fauxTerminaux();
	const plugins = new Map<string, FichierPlugin[]>();
	const processus = new Map<number, 'session' | 'autre'>();
	const interroges: number[] = [];
	const nettoyes: number[] = [];
	const existants = new Set(['', 'alpha', 'travaux/acme', 'ailleurs', '_mnemo', 'Projets/Lumen', 'Travail/site', 'Code/lumen']);
	const liens = new Map<string, string>();
	const pil: Pilotage = {
		etat,
		terminaux,
		depot: DEPOT_ABSENT,
		plugin: {
			ecrire:
				options.ecrire ??
				(async (session, fichiers) => {
					plugins.set(session, fichiers);
					return `${RACINE}/.mnemo/plugins/${session}`;
				}),
			retirer: async (session) => {
				plugins.delete(session);
			},
			appel: APPEL,
			racine: RACINE,
		},
		moteurs: moteursDeTest(options.claude === undefined ? CLAUDE : options.claude),
		hote: {
			env: { PATH: '/bin', HOME: '/home/u', ANTHROPIC_API_KEY: 'sk-secret', CLAUDECODE: '1' },
			plateforme: options.plateforme ?? 'darwin',
			dossier: async (relatif) => (existants.has(relatif) ? { absolu: relatif === '' ? RACINE : `${RACINE}/${relatif}`, reel: liens.get(relatif) ?? relatif } : null),
			processus: async (pid) => {
				interroges.push(pid);
				return processus.get(pid) ?? 'mort';
			},
			demarrageMachineMs: () => DEMARRAGE,
			nettoyerRestes: async (s) => {
				nettoyes.push(s.pid!);
			},
		},
	};
	const pilote = creerPilote(dep, pil);
	pilotes.push(pilote);
	return { pilote, dep, etat, terminaux, pil, plugins, processus, interroges, nettoyes, existants, liens };
}

function session(id: string, champs: Partial<Session> = {}): Session {
	return {
		id,
		profil: 'travail',
		dossier: 'alpha',
		position: 'projets/alpha',
		projet: 'alpha',
		objectif: null,
		etat: 'attend',
		creeeMs: 1,
		majMs: 1,
		arretAttendu: null,
		bilanDemandeMs: null,
		commitDebut: null,
		branche: null,
		pid: null,
		...champs,
	};
}

const ID_A = 'aaaaaaaa-0000-4000-8000-000000000001';
const ID_B = 'bbbbbbbb-0000-4000-8000-000000000002';
const ID_C = 'cccccccc-0000-4000-8000-000000000003';
const ID_D = 'dddddddd-0000-4000-8000-000000000004';
const ID_E = 'eeeeeeee-0000-4000-8000-000000000005';

async function lancee(c: Contexte, d: { profil: string; dossier: string; objectif?: string }): Promise<Session> {
	const r = await c.pilote.lancer(d);
	if (!('session' in r)) throw new Error(`refus inattendu : ${r.refus}`);
	return r.session;
}

describe('Pilote.lancer', () => {
	it('crée la session (attend, uuid, position, projet), écrit le plugin et lance claude dans le dossier, 120×32', async () => {
		const c = await contexte();
		const avant = Date.now();
		const r = await c.pilote.lancer({ profil: 'travail', dossier: 'alpha', objectif: 'Refaire le catalogue' });
		expect('manuel' in r).toBe(false);
		if (!('session' in r)) throw new Error('refus');
		const s = r.session;
		expect(s.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
		expect(s).toMatchObject({ profil: 'travail', dossier: 'alpha', position: 'projets/alpha', projet: 'alpha', objectif: 'Refaire le catalogue', etat: 'attend', arretAttendu: null });
		expect(c.terminaux.lances).toHaveLength(1);
		const t = c.terminaux.lances[0]!;
		const plugin = `${RACINE}/.mnemo/plugins/${s.id}`;
		expect(t.options).toMatchObject({ commande: CLAUDE.commande, dossier: `${RACINE}/alpha`, colonnes: 120, lignes: 32 });
		expect(t.options.args).toEqual([
			...CLAUDE.avant,
			'--session-id',
			s.id,
			'--plugin-dir',
			plugin,
			'--settings',
			`${plugin}/settings.json`,
			'--append-system-prompt-file',
			`${plugin}/consigne.md`,
			'Refaire le catalogue',
		]);
		// environnement : celui de l'utilisateur, sans clé d'API ni marque d'une session parente, plus la session Mnemo
		expect(t.options.env).toMatchObject({ PATH: '/bin', HOME: '/home/u', MNEMO_SESSION: s.id, MNEMO_PROJET: 'alpha', MNEMO_RACINE: RACINE, CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1' });
		expect(t.options.env).not.toHaveProperty('ANTHROPIC_API_KEY');
		expect(t.options.env).not.toHaveProperty('CLAUDECODE');
		// plugin assemblé : hooks vers mnemo hook
		const hooks = c.plugins.get(s.id)?.find((f) => f.chemin === 'hooks/hooks.json')?.texte ?? '';
		expect(JSON.parse(hooks).hooks.SessionStart[0].hooks[0]).toMatchObject({ command: APPEL.node, args: [APPEL.main, 'hook', 'debut'] });
		// pid enregistré avec sa trace (démarrage de la machine, lancement, battement), terminal tenu
		const lue = await c.etat.lire(s.id);
		expect(lue).toMatchObject({ pid: t.pid, demarrageMachineMs: DEMARRAGE });
		expect(lue!.lanceMs).toBeGreaterThanOrEqual(avant);
		expect(lue!.vuVivantMs).toBeGreaterThanOrEqual(lue!.lanceMs!);
		expect(c.pilote.enCours(s.id)).toBe(true);
	});

	it('projet : portée client de la position (dossier_projet), sinon « divers » ; dossier racine permis', async () => {
		const c = await contexte();
		expect(await lancee(c, { profil: 'travail', dossier: 'travaux/acme' })).toMatchObject({ position: 'clients/acme', projet: 'acme' });
		expect(await lancee(c, { profil: 'travail', dossier: 'ailleurs' })).toMatchObject({ position: '', projet: 'divers' });
		expect(await lancee(c, { profil: 'travail', dossier: '' })).toMatchObject({ dossier: '', position: '', projet: 'divers' });
		// séparateurs Windows et « / » final normalisés
		expect(await lancee(c, { profil: 'travail', dossier: 'travaux\\acme\\' })).toMatchObject({ dossier: 'travaux/acme' });
	});

	it('la session lancée enregistre son moteur (Claude Code) et un modèle vide', async () => {
		const c = await contexte();
		expect(await lancee(c, { profil: 'travail', dossier: 'alpha' })).toMatchObject({ moteur: 'claude-code', modele: '' });
	});

	it('Projets/Lumen couvert par projets/Lumen/Lumen.md (dossier_projet) : position et projet Lumen, rattaché', async () => {
		const c = await contexte();
		await c.dep.coffre.ecrire('projets/Lumen/Lumen.md', `${entete('dossier', 'dossier_projet: Projets/Lumen\nportee: projet:Lumen\n')}# Lumen\n`);
		expect(await lancee(c, { profil: 'travail', dossier: 'Projets/Lumen' })).toMatchObject({ position: 'projets/Lumen', projet: 'Lumen', dossierNonRattache: false });
		expect(await c.etat.dossiersNonRattaches()).toEqual([]);
	});

	it('Projets/Lumen : les skills limitées au projet Lumen sont actives, celles d\'un autre projet non', async () => {
		const c = await contexte();
		await c.dep.coffre.ecrire('projets/Lumen/Lumen.md', `${entete('dossier', 'dossier_projet: Projets/Lumen\nportee: projet:Lumen\n')}# Lumen\n`);
		await c.dep.coffre.ecrire('episodes/Lumen/Lumen.md', `${entete('dossier')}# Lumen\n`);
		await c.dep.coffre.ecrire('projets/projets.md', `${entete('dossier')}# Projets\n`);
		await c.dep.coffre.ecrire('skills/lumen-tests/SKILL.md', '---\ndescription: Tests de Lumen\nprojets: [Lumen]\n---\nLance les tests.\n');
		await c.dep.coffre.ecrire('skills/autre/SKILL.md', '---\ndescription: Autre\nprojets: [autre]\n---\nAutre.\n');
		const s = await lancee(c, { profil: 'travail', dossier: 'Projets/Lumen' });
		expect(s).toMatchObject({ position: 'projets/Lumen', projet: 'Lumen' });
		const skills = (c.plugins.get(s.id) ?? []).map((f) => f.chemin).filter((ch) => ch.startsWith('skills/'));
		expect(skills).toEqual(['skills/lumen-tests/SKILL.md']);
	});

	it('reecrirePlugin : une session lancée sans lien, rattachée ensuite, reçoit les skills de son projet', async () => {
		const c = await contexte();
		await c.dep.coffre.ecrire('skills/lumen-tests/SKILL.md', '---\ndescription: Tests de Lumen\nprojets: [Lumen]\n---\nLance les tests.\n');
		const s = await lancee(c, { profil: 'travail', dossier: 'Projets/Lumen' });
		const skills = () => (c.plugins.get(s.id) ?? []).map((f) => f.chemin).filter((ch) => ch.startsWith('skills/'));
		expect(skills()).toEqual([]);
		await c.etat.modifier(s.id, { position: 'projets/Lumen', projet: 'Lumen', dossierNonRattache: false });
		await c.pilote.reecrirePlugin(s.id);
		expect(skills()).toEqual(['skills/lumen-tests/SKILL.md']);
	});

	it('projet : portée déclarée par la fiche du dossier, hors des dossiers projets/ et clients/', async () => {
		const c = await contexte();
		await c.dep.coffre.ecrire('travail/lumen/lumen.md', `${entete('dossier', 'dossier_projet: Code/lumen\nportee: projet:Lumen\n')}# Lumen\n`);
		expect(await lancee(c, { profil: 'travail', dossier: 'Code/lumen' })).toMatchObject({ position: 'travail/lumen', projet: 'Lumen' });
	});

	it('dossier sans lien (un dossier de la mémoire du même nom ne compte pas) : racine, dossier non rattaché gardé et noté', async () => {
		const c = await contexte();
		await c.dep.coffre.ecrire('g1/site/site.md', `${entete('dossier')}# Site\n`);
		const s = await lancee(c, { profil: 'travail', dossier: 'Travail/site' });
		expect(s).toMatchObject({ position: '', projet: 'divers', dossierNonRattache: true });
		expect((await c.etat.lire(s.id))?.dossierNonRattache).toBe(true);
		expect((await c.etat.dossiersNonRattaches()).map((d) => d.dossier)).toEqual(['Travail/site']);
	});

	it('archiviste lancé dans la mémoire : rien à rattacher', async () => {
		const c = await contexte();
		const s = await lancee(c, { profil: 'archiviste', dossier: 'alpha' });
		expect(s.dossierNonRattache).toBe(false);
		expect(await c.etat.dossiersNonRattaches()).toEqual([]);
	});

	it('accepte un dossier caché ou de n’importe quel nom', async () => {
		const c = await contexte();
		for (const dossier of ['.notes', 'Clients/.archives', 'Notes "client" ?']) {
			c.existants.add(dossier);
			expect(await lancee(c, { profil: 'travail', dossier }), dossier).toMatchObject({ dossier });
		}
	});

	it('refuse un dossier invalide, inexistant, dans _mnemo/ ou .mnemo/ : rien n’est créé ni lancé', async () => {
		const c = await contexte();
		for (const dossier of ['_mnemo', '_Mnemo/fiches', '.mnemo', '.mnemo/plugins', '../dehors', '/absolu', 'C:/x', 'absent', 'a//b']) {
			const r = await c.pilote.lancer({ profil: 'travail', dossier });
			expect(r, dossier).toHaveProperty('refus');
		}
		expect(await c.etat.lister({ archivees: true })).toEqual([]);
		expect(c.terminaux.lances).toHaveLength(0);
	});

	it('archiviste : lancé dans _mnemo/, la racine ajoutée par --add-dir', async () => {
		const c = await contexte();
		const s = await lancee(c, { profil: 'archiviste', dossier: 'alpha' });
		expect(s).toMatchObject({ profil: 'archiviste', dossier: '_mnemo', projet: 'divers' });
		const t = c.terminaux.lances[0]!;
		expect(t.options.dossier).toBe(`${RACINE}/_mnemo`);
		expect(t.options.args.slice(0, 5)).toEqual([...CLAUDE.avant, '--session-id', s.id, '--add-dir', RACINE]);
	});

	it('mode dégradé (node-pty absent) : session créée, ligne de commande à coller, aucun terminal', async () => {
		const c = await contexte();
		c.terminaux.indisponible = "node-pty n'est pas installé";
		const r = await c.pilote.lancer({ profil: 'travail', dossier: 'alpha', objectif: "L'objectif" });
		if (!('manuel' in r)) throw new Error('manuel attendu');
		expect(c.terminaux.lances).toHaveLength(0);
		expect(await c.etat.lire(r.session.id)).toMatchObject({ etat: 'attend', pid: null });
		expect(r.manuel).toContain(`cd '${RACINE}/alpha' && `);
		expect(r.manuel).toContain(`MNEMO_SESSION='${r.session.id}'`);
		expect(r.manuel).toContain(`'--session-id' '${r.session.id}'`);
		expect(r.manuel).toContain(`'L'\\''objectif'`);
		// les variables interdites présentes chez l'utilisateur sont retirées
		expect(r.manuel).toContain('env -u ANTHROPIC_API_KEY -u CLAUDECODE ');
		expect(c.pilote.enCours(r.session.id)).toBe(false);
	});

	it('claude introuvable : ligne de commande avec « claude »', async () => {
		const c = await contexte({ claude: null });
		const r = await c.pilote.lancer({ profil: 'travail', dossier: 'alpha' });
		if (!('manuel' in r)) throw new Error('manuel attendu');
		expect(r.manuel).toMatch(/ claude '--session-id'/u);
		expect(c.terminaux.lances).toHaveLength(0);
	});

	it('ligne manuelle PowerShell', () => {
		const ligne = ligneManuelle(
			{ commande: 'C:\\Program Files\\claude.exe', avant: [] },
			["--session-id", 'x', "l'objectif"],
			'C:\\Users\\Jean\\projet',
			{ MNEMO_SESSION: 'x' },
			['ANTHROPIC_API_KEY'],
			'win32',
		);
		expect(ligne).toBe(
			"Set-Location -LiteralPath 'C:\\Users\\Jean\\projet'; Remove-Item -ErrorAction SilentlyContinue Env:ANTHROPIC_API_KEY; $env:MNEMO_SESSION = 'x'; & 'C:\\Program Files\\claude.exe' '--session-id' 'x' 'l''objectif'",
		);
	});

	it('dossier qui est un lien vers _mnemo/ ou .mnemo/ (chemin réel revalidé) : refusé', async () => {
		const c = await contexte();
		c.existants.add('lien');
		c.existants.add('cache');
		c.liens.set('lien', '_mnemo/fiches');
		c.liens.set('cache', '.mnemo');
		expect(await c.pilote.lancer({ profil: 'travail', dossier: 'lien' })).toEqual({ refus: expect.stringMatching(/« _mnemo\/fiches ».*Chemin demandé : « lien »/u) });
		expect(await c.pilote.lancer({ profil: 'travail', dossier: 'cache' })).toHaveProperty('refus');
		expect(await c.etat.lister({ archivees: true })).toEqual([]);
		expect(c.terminaux.lances).toHaveLength(0);
	});

	it('lancement raté à mi-chemin (écriture du plugin) : refus, session terminée par abandon, jamais reprise', async () => {
		const c = await contexte({
			ecrire: async () => {
				throw new Error('disque plein');
			},
		});
		const r = await c.pilote.lancer({ profil: 'travail', dossier: 'alpha' });
		expect(r).toEqual({ refus: expect.stringContaining('disque plein') });
		const [s] = await c.etat.lister({ archivees: true });
		expect(s).toMatchObject({ etat: 'terminee', arretAttendu: 'abandon', pid: null });
		expect(c.terminaux.lances).toHaveLength(0);
		expect(await c.pilote.reprendreAuDemarrage()).toEqual([]);
		expect(await c.pilote.reprendre(s!.id)).toMatchObject({ etat: 'terminee' });
		expect(c.terminaux.lances).toHaveLength(0);
	});

	it('dossier devenu invalide pendant le lancement : refus, session abandonnée', async () => {
		let c: Contexte | null = null;
		c = await contexte({
			ecrire: async (session) => {
				c!.existants.delete('alpha');
				return `${RACINE}/.mnemo/plugins/${session}`;
			},
		});
		expect(await c.pilote.lancer({ profil: 'travail', dossier: 'alpha' })).toHaveProperty('refus');
		expect((await c.etat.lister({ archivees: true }))[0]).toMatchObject({ etat: 'terminee', arretAttendu: 'abandon' });
		expect(c.terminaux.lances).toHaveLength(0);
	});

	it('après arreterTout : plus aucun lancement', async () => {
		const c = await contexte();
		await c.pilote.arreterTout();
		expect(await c.pilote.lancer({ profil: 'travail', dossier: 'alpha' })).toHaveProperty('refus');
		expect(c.terminaux.lances).toHaveLength(0);
	});
});

describe('Pilote : terminal', () => {
	it('sortie : relecture du tampon puis flux ; entrée et taille transmises ; abonné qui lève sans effet', async () => {
		const c = await contexte();
		const s = await lancee(c, { profil: 'travail', dossier: 'alpha' });
		const t = c.terminaux.lances[0]!;
		t.emettre('bonjour ');
		const recus: string[] = [];
		const mauvais = c.pilote.abonner(s.id, () => {
			throw new Error('abonné en panne');
		});
		const a = c.pilote.abonner(s.id, (d) => recus.push(d));
		expect(a?.relecture).toBe('bonjour ');
		t.emettre('monde');
		expect(recus).toEqual(['monde']);
		a?.desabonner();
		mauvais?.desabonner();
		t.emettre('!');
		expect(recus).toEqual(['monde']);
		expect(c.pilote.abonner(s.id, () => {})?.relecture).toBe('bonjour monde!');
		c.pilote.entree(s.id, 'ls\r');
		c.pilote.taille(s.id, 100, 40);
		c.pilote.taille(s.id, 0, 40);
		c.pilote.taille(s.id, 1.5, 40);
		expect(t.ecrits).toEqual(['ls\r']);
		expect(t.tailles).toEqual([[100, 40]]);
		expect(c.pilote.abonner('inconnue', () => {})).toBeNull();
	});

	it('processus fini seul : pid effacé, session à relire, changement signalé, plus en cours', async () => {
		const c = await contexte();
		const s = await lancee(c, { profil: 'travail', dossier: 'alpha' });
		const vus: Session[] = [];
		c.pilote.surChangement((x) => vus.push(x));
		c.terminaux.lances[0]!.finir(1);
		await attendre(() => vus.length > 0);
		expect(await c.etat.lire(s.id)).toMatchObject({ pid: null, etat: 'a_relire' });
		expect(vus.at(-1)).toMatchObject({ id: s.id, etat: 'a_relire' });
		expect(c.pilote.enCours(s.id)).toBe(false);
	});
});

describe('Pilote : pause et reprise', () => {
	it('pause : arrêt attendu « pause », terminal arrêté, session en_pause, pid effacé', async () => {
		const c = await contexte();
		const s = await lancee(c, { profil: 'travail', dossier: 'alpha' });
		const apres = await c.pilote.pause(s.id);
		expect(apres).toMatchObject({ etat: 'en_pause', arretAttendu: 'pause', pid: null });
		expect(c.terminaux.lances[0]!.arrets).toHaveLength(1);
		expect(c.pilote.enCours(s.id)).toBe(false);
		expect(await c.pilote.pause('inconnue')).toBeNull();
	});

	it('pause pendant un lancement en cours : attend le lancement, puis arrête son terminal', async () => {
		let debloquer: () => void = () => {};
		const bloque = new Promise<void>((r) => {
			debloquer = r;
		});
		const c = await contexte({
			ecrire: async (session) => {
				await bloque;
				return `${RACINE}/.mnemo/plugins/${session}`;
			},
		});
		let id: string | null = null;
		c.pilote.surChangement((s) => {
			id ??= s.id;
		});
		const lancement = c.pilote.lancer({ profil: 'travail', dossier: 'alpha' });
		await attendre(() => id !== null);
		const pause = c.pilote.pause(id!);
		await new Promise((r) => setTimeout(r, 20));
		expect(c.terminaux.lances).toHaveLength(0);
		debloquer();
		await lancement;
		const apres = await pause;
		expect(c.terminaux.lances).toHaveLength(1);
		expect(c.terminaux.lances[0]!.arrets).toHaveLength(1);
		expect(apres).toMatchObject({ etat: 'en_pause', arretAttendu: 'pause', pid: null });
		expect(c.pilote.enCours(id!)).toBe(false);
	});

	it('reprendre : plugin réassemblé, --resume, arrêt attendu effacé, état attend', async () => {
		const c = await contexte();
		const s = await lancee(c, { profil: 'travail', dossier: 'alpha', objectif: 'Objectif' });
		await c.pilote.pause(s.id);
		c.plugins.clear();
		const apres = await c.pilote.reprendre(s.id);
		expect(apres).toMatchObject({ etat: 'attend', arretAttendu: null });
		expect(c.plugins.has(s.id)).toBe(true);
		const t = c.terminaux.lances[1]!;
		expect(t.options.args.slice(0, 3)).toEqual([...CLAUDE.avant, '--resume', s.id]);
		// l'objectif n'est pas renvoyé comme prompt
		expect(t.options.args).not.toContain('Objectif');
		expect(apres?.pid).toBe(t.pid);
		expect(c.pilote.enCours(s.id)).toBe(true);
	});

	it('niveauModeles : noté, signalé, gardé à la pause et à la reprise ; null le retire', async () => {
		const c = await contexte();
		const s = await lancee(c, { profil: 'travail', dossier: 'alpha' });
		expect(s.niveauModeles).toBeUndefined();
		const vus: Session[] = [];
		c.pilote.surChangement((x) => vus.push(x));
		expect(await c.pilote.niveauModeles(s.id, 'sens')).toMatchObject({ niveauModeles: 'sens' });
		expect(vus.at(-1)).toMatchObject({ id: s.id, niveauModeles: 'sens' });
		await c.pilote.pause(s.id);
		expect(await c.pilote.reprendre(s.id)).toMatchObject({ etat: 'attend', niveauModeles: 'sens' });
		const retire = await c.pilote.niveauModeles(s.id, null);
		expect(retire).not.toHaveProperty('niveauModeles');
		expect(await c.pilote.niveauModeles('inconnue', 'coupes')).toBeNull();
	});

	it('deux reprendre en même temps → un seul terminal ; reprendre une session qui tourne → rien', async () => {
		const c = await contexte();
		const s = await lancee(c, { profil: 'travail', dossier: 'alpha' });
		await c.pilote.pause(s.id);
		await Promise.all([c.pilote.reprendre(s.id), c.pilote.reprendre(s.id), c.pilote.reprendre(s.id)]);
		expect(c.terminaux.lances).toHaveLength(2);
		await c.pilote.reprendre(s.id);
		expect(c.terminaux.lances).toHaveLength(2);
	});

	it('reprendre une session dont le pid enregistré vit encore (autre service) : refusé, rien de lancé', async () => {
		const c = await contexte({ sessions: [session(ID_A, { etat: 'en_pause', pid: 4242 })] });
		c.processus.set(4242, 'session');
		expect(await c.pilote.reprendre(ID_A)).toMatchObject({ etat: 'en_pause', pid: 4242 });
		expect(c.terminaux.lances).toHaveLength(0);
	});

	it('reprendre une session terminée : refusé', async () => {
		const c = await contexte({ sessions: [session(ID_A, { etat: 'terminee' })] });
		expect(await c.pilote.reprendre(ID_A)).toMatchObject({ etat: 'terminee' });
		expect(c.terminaux.lances).toHaveLength(0);
		expect(await c.pilote.reprendre('inconnue')).toBeNull();
	});
});

describe('Pilote : redémarrage du service', () => {
	it('relance par --resume, espacées de 300 ms ; pid vivant de la session → en_pause, jamais signalé ; pid mort → restes du groupe tués ; pid réattribué → effacé et relancé', async () => {
		const ID_F = 'ffffffff-0000-4000-8000-000000000006';
		const c = await contexte({
			sessions: [
				session(ID_A, { etat: 'attend', pid: 4242 }),
				session(ID_B, { etat: 'a_relire', pid: 5151 }),
				session(ID_C, { etat: 'en_pause' }),
				session(ID_D, { etat: 'terminee', pid: 6161 }),
				session(ID_E, { etat: 'travaille', arretAttendu: 'service' }),
				session(ID_F, { etat: 'attend', pid: 7171 }),
			],
		});
		c.processus.set(4242, 'session');
		c.processus.set(7171, 'autre');
		const debut = Date.now();
		const relancees = await c.pilote.reprendreAuDemarrage();
		expect(relancees.sort()).toEqual([ID_B, ID_E, ID_F]);
		expect(c.terminaux.lances).toHaveLength(3);
		for (const t of c.terminaux.lances) expect(t.options.args).toContain('--resume');
		expect(Date.now() - debut).toBeGreaterThanOrEqual(590);
		// processus d'un service précédent lancé pour cette session : laissé en vie, session en pause, pid gardé
		expect(await c.etat.lire(ID_A)).toMatchObject({ etat: 'en_pause', pid: 4242 });
		expect(c.pilote.enCours(ID_A)).toBe(false);
		// pid mort : seuls ses restes de groupe sont nettoyés ; pid vivant (à nous ou non) : jamais
		expect(c.nettoyes).toEqual([5151]);
		expect(await c.etat.lire(ID_B)).toMatchObject({ etat: 'attend', arretAttendu: null });
		expect(await c.etat.lire(ID_E)).toMatchObject({ etat: 'attend', arretAttendu: null });
		// pid réattribué à un autre processus : effacé, la session relancée avec son nouveau pid
		const f = await c.etat.lire(ID_F);
		expect(f?.pid).not.toBe(7171);
		expect(c.pilote.enCours(ID_F)).toBe(true);
		expect(await c.etat.lire(ID_C)).toMatchObject({ etat: 'en_pause' });
		expect(c.pilote.enCours(ID_C)).toBe(false);
		// le pid d'une session terminée n'est même pas interrogé
		expect(c.interroges).not.toContain(6161);
	});
});

describe('Pilote : redémarrage après plantage du service', () => {
	it('pid enregistré mort sans arrêt attendu (travaille, attend) → a_relire avec épisode minimal, puis relancée ; arrêt « service » : ni l’un ni l’autre', async () => {
		const c = await contexte({
			sessions: [session(ID_A, { etat: 'travaille', pid: 4242 }), session(ID_B, { etat: 'attend', pid: 5151, arretAttendu: 'service' }), session(ID_C, { etat: 'attend' })],
		});
		const vus: [string, string][] = [];
		c.pilote.surChangement((s) => vus.push([s.id, s.etat]));
		const relancees = await c.pilote.reprendreAuDemarrage();
		expect(relancees.sort()).toEqual([ID_A, ID_B, ID_C]);
		expect(vus).toContainEqual([ID_A, 'a_relire']);
		expect(vus).not.toContainEqual([ID_B, 'a_relire']);
		expect(vus).not.toContainEqual([ID_C, 'a_relire']);
		expect(c.dep.commits.filter((x) => x.message.startsWith('mnemo: episode'))).toHaveLength(1);
		const episodes = [...c.dep.fichiers.entries()].filter(([chemin]) => chemin.startsWith('episodes/'));
		expect(episodes.filter(([, texte]) => texte.includes(ID_A) && texte.includes('minimal: true'))).toHaveLength(1);
		expect(episodes.filter(([, texte]) => texte.includes(ID_B) || texte.includes(ID_C))).toEqual([]);
		expect(await c.etat.lire(ID_A)).toMatchObject({ etat: 'attend', arretAttendu: null });
		expect(c.pilote.enCours(ID_A)).toBe(true);
	});
});

describe('Pilote.arreterTout', () => {
	it('arrêt attendu « service » pour chaque session vivante, arrêts en parallèle, pid effacés, états gardés', async () => {
		const c = await contexte();
		c.terminaux.arretFinit = false;
		const s1 = await lancee(c, { profil: 'travail', dossier: 'alpha' });
		const s2 = await lancee(c, { profil: 'travail', dossier: 'ailleurs' });
		await c.etat.appliquer(s1.id, 'message', Date.now() + 10_000);
		let fini = false;
		const arret = c.pilote.arreterTout().then(() => {
			fini = true;
		});
		await attendre(() => c.terminaux.lances.every((t) => t.arrets.length === 1));
		// les deux arrêts sont demandés avant qu'aucun ne finisse
		expect(fini).toBe(false);
		expect((await c.etat.lire(s1.id))?.arretAttendu).toBe('service');
		for (const t of c.terminaux.lances) t.finir(null);
		await arret;
		expect(await c.etat.lire(s1.id)).toMatchObject({ etat: 'travaille', arretAttendu: 'service', pid: null });
		expect(await c.etat.lire(s2.id)).toMatchObject({ etat: 'attend', arretAttendu: 'service', pid: null });
		expect(c.pilote.enCours(s1.id)).toBe(false);
	});
});

describe('Pilote : battement', () => {
	it('un seul minuteur rafraîchit vuVivantMs des sessions tenues ; arreterTout l’arrête', async () => {
		const c = await contexte();
		vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
		try {
			const s1 = await lancee(c, { profil: 'travail', dossier: 'alpha' });
			const s2 = await lancee(c, { profil: 'travail', dossier: 'ailleurs' });
			expect(vi.getTimerCount()).toBe(1);
			const avant = (await c.etat.lire(s1.id))!.vuVivantMs!;
			vi.advanceTimersByTime(10_000);
			await vi.waitFor(async () => expect((await c.etat.lire(s1.id))!.vuVivantMs).toBe(avant + 10_000));
			expect((await c.etat.lire(s2.id))!.vuVivantMs).toBe(avant + 10_000);
			await c.pilote.arreterTout();
			expect(vi.getTimerCount()).toBe(0);
		} finally {
			vi.useRealTimers();
		}
	});
});

describe('Pilote.arreterTout pendant une pause', () => {
	it('ne remplace pas l’arrêt attendu « pause » : la session finit en pause', async () => {
		const c = await contexte();
		c.terminaux.arretFinit = false;
		const s = await lancee(c, { profil: 'travail', dossier: 'alpha' });
		const pause = c.pilote.pause(s.id);
		await attendre(() => c.terminaux.lances[0]!.arrets.length === 1);
		const arret = c.pilote.arreterTout();
		await new Promise((r) => setTimeout(r, 20));
		expect((await c.etat.lire(s.id))?.arretAttendu).toBe('pause');
		c.terminaux.lances[0]!.finir(null);
		await arret;
		expect(await pause).toMatchObject({ etat: 'en_pause', arretAttendu: 'pause', pid: null });
		expect(await c.etat.lire(s.id)).toMatchObject({ etat: 'en_pause', arretAttendu: 'pause', pid: null });
	});
});

async function attendre(condition: () => boolean, maxMs = 2000): Promise<void> {
	const fin = Date.now() + maxMs;
	while (!condition()) {
		if (Date.now() > fin) throw new Error('condition jamais remplie');
		await new Promise((r) => setTimeout(r, 5));
	}
}
