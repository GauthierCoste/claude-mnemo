import { describe, expect, it } from 'vitest';
import { ROUTES } from '@mnemo/contrat';
import type { MoteurVue, ReponseMoteurs } from '@mnemo/contrat';
import type { HooksDuPoste, LectureDeclaration, LectureHooksDuPoste, Moteur, Pilotage } from '../../src/application/ports.ts';
import { MOTEUR_CLAUDE_CODE } from '../../src/infra/moteurs/claude-code.ts';
import { MOTEUR_CODEX } from '../../src/infra/moteurs/codex.ts';
import { appeler, serviceFaux } from '../aides/service-faux.ts';

const COMMANDE = { commande: '/opt/bin/codex', avant: [] };

/** Codex dont la déclaration MCP, les hooks, la version et les modèles sont ceux donnés (aucune commande lancée). */
function codex(o: { mcp?: LectureDeclaration; hooks?: LectureHooksDuPoste; version?: string | null; modeles?: string[] }): Moteur {
	const hooksDuPoste: HooksDuPoste = { ...MOTEUR_CODEX.hooksDuPoste!, lire: async () => o.hooks ?? { etat: 'absent', chemin: '/maison/.codex/hooks.json' } };
	return {
		...MOTEUR_CODEX,
		declarationMcp: { ...MOTEUR_CODEX.declarationMcp, lire: async () => o.mcp ?? 'absent' },
		hooksDuPoste,
		version: async () => o.version ?? null,
		modeles: async () => o.modeles ?? [],
	};
}

const CLAUDE: Moteur = { ...MOTEUR_CLAUDE_CODE, declarationMcp: { ...MOTEUR_CLAUDE_CODE.declarationMcp, lire: async () => 'deja' } };

async function lire(moteurs: Pilotage['moteurs'], poste: boolean): Promise<MoteurVue[]> {
	const s = await serviceFaux({}, { moteurs: { moteurs } });
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
		const [cx] = await lire({ codex: { moteur: codex({}), commande: null } }, true);
		expect(cx).toMatchObject({ indisponible: expect.stringContaining('Codex introuvable'), manuel: false });
		expect(cx?.poste).toEqual([{ cle: 'commande', libelle: 'Commande', ok: false, etat: 'introuvable', detail: expect.stringContaining('MNEMO_CODEX') }]);
	});

	it('poste : chaque point non satisfaisant avec sa commande', async () => {
		const [claude, cx] = await lire(
			{
				'claude-code': { moteur: CLAUDE, commande: { commande: '/opt/bin/claude', avant: [] } },
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
