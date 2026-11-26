/** Liaison d'un moteur à Mnemo (`lierMoteur`) : déclaration MCP et hooks du poste factices, rien n'est lancé ni écrit. */
import { describe, expect, it } from 'vitest';
import { liaisonEchouee, lierMoteur } from '../../src/application/moteurs/lier.ts';
import type { AppelLiaison } from '../../src/application/moteurs/lier.ts';
import type { DeclarationMcp, HooksDuPoste, LectureDeclaration, LectureHooksDuPoste, MoteurDuPoste, ResultatDeclaration, ResultatInstallationHooks, ResultatRedeclaration, ResultatRemplacementHooks } from '../../src/application/ports.ts';

const APPEL: AppelLiaison = { executer: async () => ({ code: 0, sortie: '', erreur: '' }), main: '/opt/mnemo/main.ts', node: '/opt/node', commande: { commande: '/opt/bin/codex', avant: [] }, plateforme: 'darwin', env: { CODEX_HOME: '/maison/.codex' } };

type Reglages = {
	mcp?: LectureDeclaration | Error;
	declarer?: ResultatDeclaration;
	remplacer?: ResultatRedeclaration;
	hooks?: LectureHooksDuPoste | null;
	installer?: ResultatInstallationHooks;
	remplacerHooks?: ResultatRemplacementHooks;
};

/** Codex factice : chaque appel noté dans `appels` ; `hooks: null` : un moteur sans hooks du poste (Claude Code). */
function moteur(o: Reglages): { moteur: MoteurDuPoste; appels: string[] } {
	const appels: string[] = [];
	const note = <T>(nom: string, r: T) => async (): Promise<T> => (appels.push(nom), r);
	const declarationMcp: DeclarationMcp = {
		manuelle: () => 'codex mcp add mnemo -- …',
		lire: async () => {
			appels.push('mcp.lire');
			if (o.mcp instanceof Error) throw o.mcp;
			return o.mcp ?? 'absent';
		},
		declarer: note('mcp.declarer', o.declarer ?? 'declare'),
		remplacer: note('mcp.remplacer', o.remplacer ?? 'remplace'),
		retirer: note('mcp.retirer', 'retire' as const),
	};
	const hooksDuPoste: HooksDuPoste = {
		chemin: () => '/maison/.codex/hooks.json',
		lire: note('hooks.lire', o.hooks ?? { etat: 'absent', chemin: '/maison/.codex/hooks.json' }),
		installer: note('hooks.installer', o.installer ?? 'installe'),
		remplacer: note('hooks.remplacer', o.remplacerHooks ?? 'mis_a_jour'),
		retirer: note('hooks.retirer', 'retire' as const),
	};
	return {
		appels,
		moteur: {
			id: 'codex',
			commandeParDefaut: 'codex',
			installation: { recherche: 'codex absent', desactivation: 'enabled = false', retraitManuel: '`codex mcp remove mnemo`', approbation: { commande: '/hooks', consigne: 'approuvez-les une fois dans Codex (/hooks).' } },
			trouver: () => APPEL.commande,
			declarationMcp,
			...(o.hooks === null ? {} : { hooksDuPoste }),
		},
	};
}

describe('lierMoteur', () => {
	it('MCP et hooks absents : déclaré puis installés, avec la consigne d’approbation', async () => {
		const { moteur: m, appels } = moteur({});
		const r = await lierMoteur(m, APPEL);
		expect(r.mcp).toEqual({ resultat: 'declare', message: 'Serveur MCP déclaré pour toutes les sessions Codex.' });
		expect(r.hooks).toEqual({ resultat: 'installe', message: expect.stringContaining('approuvez-les une fois dans Codex (/hooks)') });
		expect(appels).toEqual(['mcp.lire', 'mcp.declarer', 'hooks.lire', 'hooks.installer']);
		expect(liaisonEchouee(r)).toBe(false);
	});

	it('périmés : déclaration et hooks de Mnemo refaits (comme declarer --remplacer)', async () => {
		const { moteur: m, appels } = moteur({ mcp: 'perime', hooks: { etat: 'perime', chemin: '/h' } });
		const r = await lierMoteur(m, APPEL);
		expect(r.mcp.resultat).toBe('remplace');
		expect(r.hooks?.resultat).toBe('remplace');
		expect(appels).toEqual(['mcp.lire', 'mcp.remplacer', 'hooks.lire', 'hooks.remplacer']);
	});

	it('à jour : rien n’est écrit', async () => {
		const { moteur: m, appels } = moteur({ mcp: 'deja', hooks: { etat: 'a_jour', chemin: '/h' } });
		const r = await lierMoteur(m, APPEL);
		expect([r.mcp.resultat, r.hooks?.resultat]).toEqual(['deja', 'deja']);
		expect(appels).toEqual(['mcp.lire', 'hooks.lire']);
	});

	it('déclaration de l’utilisateur (désactivée, autre serveur) : jamais touchée, le message le dit ; hooks tout de même installés', async () => {
		for (const [mcp, attendu] of [
			['desactive', 'enabled = false'],
			['autre', 'codex mcp remove mnemo'],
		] as const) {
			const { moteur: m, appels } = moteur({ mcp });
			const r = await lierMoteur(m, APPEL);
			expect(r.mcp).toEqual({ resultat: 'laisse', message: expect.stringContaining(attendu) });
			expect(r.hooks?.resultat).toBe('installe');
			expect(appels).toEqual(['mcp.lire', 'hooks.lire', 'hooks.installer']);
			expect(liaisonEchouee(r)).toBe(false);
		}
	});

	it('déclarée entre la lecture et la déclaration (périmée ou non) : laissée, jamais remplacée', async () => {
		const { moteur: m, appels } = moteur({ declarer: { perime: true, manuel: 'm', remplacable: true } });
		expect((await lierMoteur(m, APPEL)).mcp.resultat).toBe('laisse');
		expect(appels).not.toContain('mcp.remplacer');
	});

	it('retirés entre la lecture et le remplacement : déclarés et installés à neuf', async () => {
		const { moteur: m, appels } = moteur({ mcp: 'perime', remplacer: 'absent', hooks: { etat: 'perime', chemin: '/h' }, remplacerHooks: 'absent' });
		const r = await lierMoteur(m, APPEL);
		expect([r.mcp.resultat, r.hooks?.resultat]).toEqual(['declare', 'installe']);
		expect(appels).toEqual(['mcp.lire', 'mcp.remplacer', 'mcp.declarer', 'hooks.lire', 'hooks.remplacer', 'hooks.installer']);
	});

	it('échecs : dans leur étape, sans lever ; les hooks tentés malgré l’échec du MCP', async () => {
		const leve = moteur({ mcp: new Error('codex muet'), installer: { echec: 'hooks.json illisible' } });
		const r = await lierMoteur(leve.moteur, APPEL);
		expect(r.mcp).toEqual({ resultat: 'echec', message: 'Serveur MCP de Codex : codex muet' });
		expect(r.hooks).toEqual({ resultat: 'echec', message: 'Hooks de Mnemo chez Codex : hooks.json illisible' });
		expect(liaisonEchouee(r)).toBe(true);
		const manuel = await lierMoteur(moteur({ declarer: { manuel: 'codex mcp add …', introuvable: false, raison: 'code 1' } }).moteur, APPEL);
		expect(manuel.mcp).toEqual({ resultat: 'echec', message: expect.stringContaining('codex mcp add …') });
		const illisible = await lierMoteur(moteur({ mcp: { echec: 'config.toml illisible' }, hooks: { echec: 'hooks illisibles' } }).moteur, APPEL);
		expect([illisible.mcp.resultat, illisible.hooks?.resultat]).toEqual(['echec', 'echec']);
	});

	it('moteur sans hooks du poste (Claude Code) : le serveur MCP seulement', async () => {
		const { moteur: m, appels } = moteur({ hooks: null });
		const r = await lierMoteur(m, APPEL);
		expect(r).toEqual({ mcp: expect.objectContaining({ resultat: 'declare' }) });
		expect(appels).toEqual(['mcp.lire', 'mcp.declarer']);
	});

	it('les hooks reçoivent le Node et le main.ts de l’appel', async () => {
		const recus: unknown[] = [];
		const { moteur: m } = moteur({});
		const hooks = m.hooksDuPoste!;
		await lierMoteur({ ...m, hooksDuPoste: { ...hooks, lire: async (a) => (recus.push(a), hooks.lire(a)) } }, APPEL);
		expect(recus).toEqual([{ node: '/opt/node', main: '/opt/mnemo/main.ts', env: APPEL.env }]);
	});
});
