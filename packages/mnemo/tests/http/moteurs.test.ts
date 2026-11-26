import { describe, expect, it } from 'vitest';
import { ROUTES } from '@mnemo/contrat';
import type { MoteurVue, ReponseMoteurs } from '@mnemo/contrat';
import type { CommandeMoteur, Executer, HooksDuPoste, LectureDeclaration, LectureHooksDuPoste, Moteur, Pilotage } from '../../src/application/ports.ts';
import { MOTEUR_CLAUDE_CODE } from '../../src/infra/moteurs/claude-code.ts';
import { MOTEUR_CODEX } from '../../src/infra/moteurs/codex.ts';
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
			{ cle: 'mcp', libelle: 'Serveur MCP mnemo', ok: false, etat: 'périmé', detail: expect.any(String), remede: { texte: 'mnemo declarer --moteur codex --remplacer', dans: 'terminal' } },
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

	it('poste : la commande adoptée est celle du pilotage (sessions lancées ensuite) et de la vue suivante sans poste', async () => {
		const pils: Pilotage[] = [];
		const s = await serviceFaux({}, { pil: (p) => void pils.push(p) });
		const pil = pils[0]!;
		const moteurs = pil.moteurs;
		moteurs.codex = { moteur: codex({ trouvee: COMMANDE, version: '0.171.0' }), commande: null };
		const vue = async (poste: boolean): Promise<MoteurVue | undefined> => {
			const r = await appeler(s.service.port, 'GET', `${ROUTES.moteurs}${poste ? '?poste=1' : ''}`, { jeton: s.service.jeton });
			return (r.corps as ReponseMoteurs).moteurs.find((m) => m.id === 'codex');
		};
		expect((await vue(false))?.indisponible).toContain('Codex introuvable');
		await vue(true);
		expect(pil.moteurs).toBe(moteurs);
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

	it('poste : MCP et hooks absents → mnemo init --codex ; approbation inconnue → à vérifier par /hooks', async () => {
		const [absent] = await lire({ codex: { moteur: codex({ version: '0.171.0' }), commande: COMMANDE } }, true);
		expect(absent?.poste?.filter((p) => p.remede !== undefined).map((p) => [p.cle, p.remede?.texte])).toEqual([
			['mcp', 'mnemo init --codex'],
			['hooks', 'mnemo init --codex'],
		]);
		const [inconnu] = await lire({ codex: { moteur: codex({ version: null, mcp: 'deja', hooks: { etat: 'a_jour', chemin: '/h', approbation: { etat: 'inconnu', motif: 'config.toml illisible' } } }), commande: COMMANDE } }, true);
		expect(inconnu?.poste?.find((p) => p.cle === 'version')).toMatchObject({ ok: null, etat: 'illisible' });
		expect(inconnu?.poste?.find((p) => p.cle === 'approbation')).toMatchObject({ ok: null, etat: 'inconnue', remede: { texte: '/hooks', dans: 'moteur' } });
	});
});
