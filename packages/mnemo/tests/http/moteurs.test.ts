import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROUTES } from '@mnemo/contrat';
import type { MoteurVue, ReponseLiaisonMoteur, ReponseMoteurs } from '@mnemo/contrat';
import type { CommandeMoteur, Executer, HooksDuPoste, LectureDeclaration, LectureHooksDuPoste, Moteur, Pilotage } from '../../src/application/ports.ts';
import type { PosteDesMoteurs } from '../../src/adaptateurs/http/moteurs.ts';
import { blocDeDeclaration } from '../../src/domaine/moteurs/mistral-vibe/declaration.ts';
import { MOTEUR_CLAUDE_CODE } from '../../src/infra/moteurs/claude-code.ts';
import { MOTEUR_CODEX } from '../../src/infra/moteurs/codex.ts';
import { MOTEUR_MISTRAL_VIBE } from '../../src/infra/moteurs/mistral-vibe.ts';
import { nodeDurable } from '../../src/infra/node-durable.ts';
import { dossierTemporaire } from '../aides/dossier-temporaire.ts';
import { appeler, serviceFaux } from '../aides/service-faux.ts';

const COMMANDE = { commande: '/opt/bin/codex', avant: [] };

/** Codex dont la commande trouvée maintenant, la déclaration MCP, les hooks, la version et les modèles sont ceux donnés (aucune commande lancée). */
function codex(o: { trouvee?: CommandeMoteur | null; mcp?: LectureDeclaration; hooks?: LectureHooksDuPoste; version?: string | null; modeles?: string[]; appels?: unknown[][] }): Moteur {
	const hooksDuPoste: HooksDuPoste = { ...MOTEUR_CODEX.hooksDuPoste!, lire: async () => o.hooks ?? { etat: 'absent', chemin: '/maison/.codex/hooks.json' } };
	return {
		...MOTEUR_CODEX,
		declarationMcp: { ...MOTEUR_CODEX.declarationMcp, lire: async () => o.mcp ?? 'absent' },
		hooksDuPoste,
		trouver: () => (o.trouvee === undefined ? COMMANDE : o.trouvee),
		version: async (...a) => {
			o.appels?.push(a);
			return o.version ?? null;
		},
		modeles: async () => o.modeles ?? [],
	};
}

const CLAUDE: Moteur = { ...MOTEUR_CLAUDE_CODE, declarationMcp: { ...MOTEUR_CLAUDE_CODE.declarationMcp, lire: async () => 'deja' } };
const claudeTrouve = (trouvee: CommandeMoteur | null): Moteur => ({ ...CLAUDE, trouver: () => trouvee });

async function lire(moteurs: Pilotage['moteurs'], poste: boolean, executer?: Executer): Promise<MoteurVue[]> {
	const s = await serviceFaux({}, { moteurs: { moteurs, ...(executer === undefined ? {} : { executer }) } });
	const r = await appeler(s.service.port, 'GET', `${ROUTES.moteurs}${poste ? '?poste=1' : ''}`, { jeton: s.service.jeton });
	expect(r.statut).toBe(200);
	return (r.corps as ReponseMoteurs).moteurs;
}

describe('route moteurs', () => {
	it('sans poste : trouvé ou non, version, modèles (alias de Claude Code, catalogue de Codex), sans points', async () => {
		const [claude, cx] = await lire({ 'claude-code': { moteur: CLAUDE, commande: null }, codex: { moteur: codex({ version: '0.171.0', modeles: ['gpt-a', 'gpt-b'] }), commande: COMMANDE } }, false);
		expect(claude).toEqual({ id: 'claude-code', nom: 'Claude Code', indisponible: expect.stringContaining('Claude Code introuvable sur ce poste'), manuel: true, version: null, modeles: ['opus', 'sonnet', 'haiku'] });
		expect(cx).toEqual({ id: 'codex', nom: 'Codex', indisponible: null, manuel: false, version: '0.171.0', modeles: ['gpt-a', 'gpt-b'] });
	});

	it('Codex trop ancien : indisponible avec la raison', async () => {
		const [cx] = await lire({ codex: { moteur: codex({ version: '0.160.2' }), commande: COMMANDE } }, false);
		expect(cx?.indisponible).toBe('Codex 0.160.2 trop ancien, 0.171 ou plus requis.');
	});

	it('Codex introuvable : refusé, pas de ligne à coller ; points réduits à la commande', async () => {
		const [cx] = await lire({ codex: { moteur: codex({ trouvee: null }), commande: null } }, true);
		expect(cx).toMatchObject({ indisponible: expect.stringContaining('Codex introuvable'), manuel: false });
		expect(cx?.poste).toEqual([{ cle: 'commande', libelle: 'Commande', ok: false, etat: 'introuvable', detail: expect.stringContaining('MNEMO_CODEX') }]);
	});

	it('poste : chaque point non satisfaisant avec sa commande', async () => {
		const [claude, cx] = await lire(
			{
				'claude-code': { moteur: claudeTrouve({ commande: '/opt/bin/claude', avant: [] }), commande: { commande: '/opt/bin/claude', avant: [] } },
				codex: { moteur: codex({ version: '0.171.0', mcp: 'perime', hooks: { etat: 'a_jour', chemin: '/h', approbation: { etat: 'a_approuver', motif: 'jamais approuvés' } } }), commande: COMMANDE },
			},
			true,
		);
		expect(claude?.poste).toEqual([
			{ cle: 'commande', libelle: 'Commande', ok: true, etat: 'trouvée', detail: '/opt/bin/claude' },
			{ cle: 'mcp', libelle: 'Serveur MCP mnemo', ok: true, etat: 'déclaré' },
		]);
		expect(cx?.poste).toEqual([
			{ cle: 'commande', libelle: 'Commande', ok: true, etat: 'trouvée', detail: '/opt/bin/codex' },
			{ cle: 'version', libelle: 'Version', ok: true, etat: '0.171.0' },
			{ cle: 'mcp', libelle: 'Serveur MCP mnemo', ok: false, etat: 'périmé', detail: expect.any(String), remede: { texte: 'mnemo declarer --moteur codex --lier', dans: 'terminal' } },
			{ cle: 'hooks', libelle: 'Hooks de Mnemo', ok: true, etat: 'installés' },
			{ cle: 'approbation', libelle: 'Approbation des hooks', ok: false, etat: 'à approuver', detail: 'jamais approuvés', remede: { texte: '/hooks', dans: 'moteur' } },
		]);
	});

	it('poste : version relue sans le cache, avec l’exécuteur de la route ; sans poste, le cache', async () => {
		const appels: unknown[][] = [];
		const executer: Executer = async () => ({ code: 0, sortie: '', erreur: '' });
		await lire({ codex: { moteur: codex({ version: '0.171.0', appels }), commande: COMMANDE } }, true, executer);
		await lire({ codex: { moteur: codex({ version: '0.171.0', appels }), commande: COMMANDE } }, false, executer);
		expect(appels.map((a) => [a[2], a[3]])).toEqual([
			[executer, { relire: true }],
			[executer, { relire: false }],
		]);
	});

	it('poste : commande installée depuis le démarrage (null → trouvée) adoptée par le service, version relue pour elle', async () => {
		const appels: unknown[][] = [];
		const moteurs: Pilotage['moteurs'] = { codex: { moteur: codex({ trouvee: COMMANDE, version: '0.171.0', appels }), commande: null } };
		const [cx] = await lire(moteurs, true);
		expect(moteurs.codex?.commande).toEqual(COMMANDE);
		expect(cx).toMatchObject({ indisponible: null, version: '0.171.0' });
		expect(cx?.poste?.[0]).toEqual({ cle: 'commande', libelle: 'Commande', ok: true, etat: 'trouvée', detail: '/opt/bin/codex' });
		expect(cx?.poste?.some((p) => p.remede?.texte === 'mnemo arreter')).toBe(false);
		expect(appels.map((a) => [a[0], a[3]])).toEqual([[COMMANDE, { relire: true }]]);
	});

	it('poste : commande changée depuis le démarrage adoptée par le service, version relue pour la nouvelle', async () => {
		const appels: unknown[][] = [];
		const autre = { commande: '/autre/codex', avant: [] };
		const moteurs: Pilotage['moteurs'] = { codex: { moteur: codex({ trouvee: autre, version: '0.171.0', appels }), commande: COMMANDE } };
		const [cx] = await lire(moteurs, true);
		expect(moteurs.codex?.commande).toEqual(autre);
		expect(cx?.poste?.[0]).toEqual({ cle: 'commande', libelle: 'Commande', ok: true, etat: 'trouvée', detail: '/autre/codex' });
		expect(appels.map((a) => [a[0], a[3]])).toEqual([[autre, { relire: true }]]);
	});

	it('poste : commande disparue depuis le démarrage non adoptée, le service garde la sienne', async () => {
		const claude = { commande: '/opt/bin/claude', avant: [] };
		const moteurs: Pilotage['moteurs'] = { 'claude-code': { moteur: claudeTrouve(null), commande: claude } };
		const [retiree] = await lire(moteurs, true);
		expect(moteurs['claude-code']?.commande).toEqual(claude);
		expect(retiree?.poste?.[0]).toEqual({ cle: 'commande', libelle: 'Commande', ok: false, etat: 'introuvable maintenant', detail: expect.stringContaining('/opt/bin/claude') });
	});

	it('poste : la commande adoptée est celle du pilotage et de la vue suivante sans poste', async () => {
		const pils: Pilotage[] = [];
		const s = await serviceFaux({}, { pil: (p) => void pils.push(p) });
		const pil = pils[0]!;
		// seul Codex, factice : aucune commande cherchée ni lancée pour Claude Code
		delete pil.moteurs['claude-code'];
		pil.moteurs.codex = { moteur: codex({ trouvee: COMMANDE, version: '0.171.0' }), commande: null };
		const vue = async (poste: boolean): Promise<MoteurVue | undefined> => {
			const r = await appeler(s.service.port, 'GET', `${ROUTES.moteurs}${poste ? '?poste=1' : ''}`, { jeton: s.service.jeton });
			return (r.corps as ReponseMoteurs).moteurs.find((m) => m.id === 'codex');
		};
		expect((await vue(false))?.indisponible).toContain('Codex introuvable');
		await vue(true);
		expect(pil.moteurs.codex?.commande).toEqual(COMMANDE);
		expect(await vue(false)).toMatchObject({ indisponible: null, version: '0.171.0' });
	});

	it('poste : une seule vérification en vol, partagée entre les appels', async () => {
		let lectures = 0;
		let liberer = (): void => {};
		const attente = new Promise<void>((r) => (liberer = r));
		const lent: Moteur = { ...codex({ version: '0.171.0' }), declarationMcp: { ...MOTEUR_CODEX.declarationMcp, lire: async () => (lectures++, await attente, 'deja') } };
		const s = await serviceFaux({}, { moteurs: { moteurs: { codex: { moteur: lent, commande: COMMANDE } } } });
		const appel = () => appeler(s.service.port, 'GET', `${ROUTES.moteurs}?poste=1`, { jeton: s.service.jeton });
		const deux = [appel(), appel()];
		await new Promise((r) => setTimeout(r, 100));
		liberer();
		const [a, b] = await Promise.all(deux);
		expect(lectures).toBe(1);
		expect(a!.corps).toEqual(b!.corps);
		await appel();
		expect(lectures).toBe(2);
	});

	it('poste : MCP et hooks absents → mnemo declarer --moteur codex --lier ; approbation inconnue → à vérifier par /hooks', async () => {
		const [absent] = await lire({ codex: { moteur: codex({ version: '0.171.0' }), commande: COMMANDE } }, true);
		expect(absent?.poste?.filter((p) => p.remede !== undefined).map((p) => [p.cle, p.remede?.texte])).toEqual([
			['mcp', 'mnemo declarer --moteur codex --lier'],
			['hooks', 'mnemo declarer --moteur codex --lier'],
		]);
		const [inconnu] = await lire({ codex: { moteur: codex({ version: null, mcp: 'deja', hooks: { etat: 'a_jour', chemin: '/h', approbation: { etat: 'inconnu', motif: 'config.toml illisible' } } }), commande: COMMANDE } }, true);
		expect(inconnu?.poste?.find((p) => p.cle === 'version')).toMatchObject({ ok: null, etat: 'illisible' });
		expect(inconnu?.poste?.find((p) => p.cle === 'approbation')).toMatchObject({ ok: null, etat: 'inconnue', remede: { texte: '/hooks', dans: 'moteur' } });
	});
});

const NODE = nodeDurable(process.platform);
/** Un `main.ts` de Mnemo (les hooks de Mnemo se reconnaissent à son chemin). */
const MAIN = '/opt/mnemo/src/adaptateurs/cli/main.ts';
const VIBE = { commande: '/opt/bin/vibe', avant: [] };

/** Mistral Vibe réel dans un VIBE_HOME jetable (config.toml, hooks.toml), sa commande donnée, version et modèles sans rien lancer. */
const vibe = (trouvee: CommandeMoteur | null = VIBE): Moteur => ({ ...MOTEUR_MISTRAL_VIBE, trouver: () => trouvee, version: async () => '3.2.0', modeles: async () => [] });

async function lier(moteurs: Pilotage['moteurs'], id: string, poste: Partial<PosteDesMoteurs> = {}): Promise<{ statut: number; corps: unknown }> {
	const s = await serviceFaux({}, { moteurs: { moteurs, node: NODE, main: MAIN, ...poste } });
	return appeler(s.service.port, 'POST', ROUTES.moteurLier.replace(':id', encodeURIComponent(id)), { jeton: s.service.jeton });
}

describe('route moteurLier', () => {
	it('Mistral Vibe à lier : serveur MCP déclaré et hooks installés dans VIBE_HOME, la vue relue au vert ; relancée : rien à faire', async () => {
		const home = await dossierTemporaire();
		const s = await serviceFaux({}, { moteurs: { moteurs: { 'mistral-vibe': { moteur: vibe(), commande: VIBE } }, node: NODE, main: MAIN, env: { VIBE_HOME: home } } });
		const appel = () => appeler(s.service.port, 'POST', ROUTES.moteurLier.replace(':id', 'mistral-vibe'), { jeton: s.service.jeton });
		const r = await appel();
		expect(r.statut).toBe(200);
		const corps = r.corps as ReponseLiaisonMoteur;
		expect(corps.liaison).toEqual({
			id: 'mistral-vibe',
			lie: true,
			ok: true,
			mcp: { resultat: 'declare', message: 'Serveur MCP déclaré pour toutes les sessions Mistral Vibe.' },
			hooks: { resultat: 'installe', message: expect.stringContaining('hooks.toml') },
		});
		expect(await readFile(join(home, 'config.toml'), 'utf8')).toContain(MAIN);
		expect(await readFile(join(home, 'hooks.toml'), 'utf8')).toContain(MAIN);
		const vue = corps.moteurs.find((m) => m.id === 'mistral-vibe');
		expect(vue?.poste?.filter((p) => p.cle === 'mcp' || p.cle === 'hooks').map((p) => [p.cle, p.ok, p.etat])).toEqual([
			['mcp', true, 'déclaré'],
			['hooks', true, 'installés'],
		]);
		const encore = (await appel()).corps as ReponseLiaisonMoteur;
		expect([encore.liaison.mcp.resultat, encore.liaison.hooks?.resultat]).toEqual(['deja', 'deja']);
	});

	it('déclaration de l’utilisateur désactivée : jamais touchée, la réponse le dit ; les hooks installés tout de même', async () => {
		const home = await dossierTemporaire();
		const config = `${blocDeDeclaration(NODE, '/ailleurs/main.ts')}disabled = true\n`;
		await writeFile(join(home, 'config.toml'), config);
		const r = await lier({ 'mistral-vibe': { moteur: vibe(), commande: VIBE } }, 'mistral-vibe', { env: { VIBE_HOME: home } });
		const { liaison } = r.corps as ReponseLiaisonMoteur;
		expect(liaison).toMatchObject({ lie: false, ok: true, mcp: { resultat: 'laisse', message: expect.stringContaining('laissée telle quelle') }, hooks: { resultat: 'installe' } });
		expect(await readFile(join(home, 'config.toml'), 'utf8')).toBe(config);
	});

	it('Claude Code : déclaré par `claude mcp add-json` (portée utilisateur), avec l’exécuteur de la route ; aucun hook du poste', async () => {
		const appels: string[][] = [];
		let declare = false;
		const delais = new Set<unknown>();
		const executer: Executer = async (commande, args, options) => {
			appels.push([commande, ...args]);
			delais.add(options?.delaiMs);
			if (args[1] === 'add-json') {
				declare = true;
				return { code: 0, sortie: '', erreur: '' };
			}
			if (args[1] === 'get' && declare) return { code: 0, sortie: `mnemo:\n  Scope: User config (available in all your projects)\n  Type: stdio\n  Command: ${NODE}\n  Args: ${MAIN} mcp\n`, erreur: '' };
			return { code: 1, sortie: '', erreur: 'No MCP server found' };
		};
		const claude = { commande: '/opt/bin/claude', avant: [] };
		const r = await lier({ 'claude-code': { moteur: { ...MOTEUR_CLAUDE_CODE, trouver: () => claude }, commande: claude } }, 'claude-code', { executer, env: {} });
		expect(r.statut).toBe(200);
		const corps = r.corps as ReponseLiaisonMoteur;
		expect(corps.liaison).toEqual({ id: 'claude-code', lie: true, ok: true, mcp: { resultat: 'declare', message: 'Serveur MCP déclaré pour toutes les sessions Claude Code.' } });
		expect(appels.find((a) => a[2] === 'add-json')?.slice(0, 6)).toEqual(['/opt/bin/claude', 'mcp', 'add-json', '--scope', 'user', 'mnemo']);
		expect(corps.moteurs[0]?.poste?.find((p) => p.cle === 'mcp')).toMatchObject({ ok: true, etat: 'déclaré' });
		// chaque commande du moteur, liaison comprise, avec le délai de la lecture du poste
		expect([...delais]).toEqual([10_000]);
	});

	it('Codex périmé : déclaration et hooks refaits (comme declarer --remplacer)', async () => {
		const faits: string[] = [];
		const hooks: HooksDuPoste = {
			...MOTEUR_CODEX.hooksDuPoste!,
			lire: async () => ({ etat: faits.includes('hooks') ? 'a_jour' : 'perime', chemin: '/maison/.codex/hooks.json' }),
			remplacer: async () => (faits.push('hooks'), 'mis_a_jour'),
		};
		const moteur: Moteur = {
			...codex({ version: '0.171.0' }),
			declarationMcp: { ...MOTEUR_CODEX.declarationMcp, lire: async () => (faits.includes('mcp') ? 'deja' : 'perime'), remplacer: async () => (faits.push('mcp'), 'remplace') },
			hooksDuPoste: hooks,
		};
		const r = await lier({ codex: { moteur, commande: COMMANDE } }, 'codex', { env: { CODEX_HOME: '/maison/.codex' } });
		const corps = r.corps as ReponseLiaisonMoteur;
		expect(corps.liaison).toMatchObject({ ok: true, mcp: { resultat: 'remplace' }, hooks: { resultat: 'remplace', message: expect.stringContaining('/hooks') } });
		expect(faits).toEqual(['mcp', 'hooks']);
		expect(corps.moteurs[0]?.poste?.filter((p) => p.cle === 'mcp' || p.cle === 'hooks').every((p) => p.ok === true)).toBe(true);
	});

	it('échec d’une étape : 200, `ok` faux et le motif dans l’étape', async () => {
		const home = await dossierTemporaire();
		await writeFile(join(home, 'config.toml'), '[[mcp_servers]\n');
		const r = await lier({ 'mistral-vibe': { moteur: vibe(), commande: VIBE } }, 'mistral-vibe', { env: { VIBE_HOME: home } });
		expect(r.statut).toBe(200);
		expect((r.corps as ReponseLiaisonMoteur).liaison).toMatchObject({ lie: false, ok: false, mcp: { resultat: 'echec' } });
	});

	it('commande installée depuis le démarrage : adoptée par le service, puis liée', async () => {
		const home = await dossierTemporaire();
		const moteurs: Pilotage['moteurs'] = { 'mistral-vibe': { moteur: vibe(), commande: null } };
		const r = await lier(moteurs, 'mistral-vibe', { env: { VIBE_HOME: home } });
		expect(r.statut).toBe(200);
		expect(moteurs['mistral-vibe']?.commande).toEqual(VIBE);
		expect((r.corps as ReponseLiaisonMoteur).liaison.mcp.resultat).toBe('declare');
	});

	it('refus : 404 moteur inconnu (ou absent du service), 409 commande introuvable, 409 MNEMO_SANS_MCP=1 ; rien n’est écrit', async () => {
		const home = await dossierTemporaire();
		const moteurs = (): Pilotage['moteurs'] => ({ 'mistral-vibe': { moteur: vibe(null), commande: null } });
		const inconnu = await lier(moteurs(), 'gemini');
		expect(inconnu).toMatchObject({ statut: 404, corps: { erreur: expect.stringContaining('gemini') } });
		expect((await lier(moteurs(), 'codex')).statut).toBe(404);
		const introuvable = await lier(moteurs(), 'mistral-vibe', { env: { VIBE_HOME: home } });
		expect(introuvable).toMatchObject({ statut: 409, corps: { erreur: expect.stringContaining('Mistral Vibe introuvable') } });
		const sansMcp = await lier({ 'mistral-vibe': { moteur: vibe(), commande: VIBE } }, 'mistral-vibe', { env: { VIBE_HOME: home, MNEMO_SANS_MCP: '1' } });
		expect(sansMcp).toMatchObject({ statut: 409, corps: { erreur: expect.stringContaining('MNEMO_SANS_MCP=1') } });
		await expect(readFile(join(home, 'config.toml'), 'utf8')).rejects.toThrow();
	});

	it('une seule liaison à la fois par moteur : la seconde refusée en 409, une autre possible après', async () => {
		let liberer = (): void => {};
		const attente = new Promise<void>((r) => (liberer = r));
		let lectures = 0;
		const lent: Moteur = { ...codex({ version: '0.171.0', mcp: 'deja', hooks: { etat: 'a_jour', chemin: '/h' } }) };
		const lire = lent.declarationMcp.lire;
		lent.declarationMcp = { ...lent.declarationMcp, lire: async (a) => (lectures++ === 0 ? await attente : undefined, lire(a)) };
		const s = await serviceFaux({}, { moteurs: { moteurs: { codex: { moteur: lent, commande: COMMANDE } }, env: {} } });
		const appel = () => appeler(s.service.port, 'POST', ROUTES.moteurLier.replace(':id', 'codex'), { jeton: s.service.jeton });
		const premiere = appel();
		await new Promise((r) => setTimeout(r, 100));
		expect(await appel()).toMatchObject({ statut: 409, corps: { erreur: expect.stringContaining('déjà en cours') } });
		liberer();
		expect((await premiere).statut).toBe(200);
		expect((await appel()).statut).toBe(200);
	});

	it('jeton exigé, comme toute route', async () => {
		const s = await serviceFaux({}, { moteurs: { moteurs: { 'mistral-vibe': { moteur: vibe(), commande: VIBE } }, env: {} } });
		expect((await appeler(s.service.port, 'POST', ROUTES.moteurLier.replace(':id', 'mistral-vibe'))).statut).toBe(401);
	});
});
