/**
 * Moteurs du mode démo (`GET moteurs`, `POST moteurLier`) : les trois trouvés ; Claude Code prêt ; Codex avec des hooks
 * encore à approuver (la commande à taper dans Codex) ; Mistral Vibe pas encore lié (ni serveur MCP, ni hooks), que
 * « Lier à Mnemo » lie comme le service, pour voir Réglages › Système › Moteurs sans service.
 */
import type { IdMoteur } from '@mnemo/commun';
import type { EtapeLiaisonVue, LiaisonMoteurVue, MoteurVue, PointMoteurVue, ReponseLiaisonMoteur, ReponseMoteurs } from '@mnemo/contrat';
import { ErreurApi } from './api.ts';

const CLAUDE_CODE: MoteurVue = {
	id: 'claude-code',
	nom: 'Claude Code',
	indisponible: null,
	manuel: false,
	version: '2.1.120',
	modeles: ['opus', 'sonnet', 'haiku'],
	poste: [
		{ cle: 'commande', libelle: 'Commande', ok: true, etat: 'trouvée', detail: '~/.local/bin/claude' },
		{ cle: 'version', libelle: 'Version', ok: true, etat: '2.1.120' },
		{ cle: 'mcp', libelle: 'Serveur MCP mnemo', ok: true, etat: 'déclaré' },
	],
};

const CODEX: MoteurVue = {
	id: 'codex',
	nom: 'Codex',
	indisponible: null,
	manuel: false,
	version: '0.171.0-alpha.13',
	modeles: ['gpt-6.2-sol', 'gpt-6.2-astra', 'gpt-6.1-terra'],
	poste: [
		{ cle: 'commande', libelle: 'Commande', ok: true, etat: 'trouvée', detail: '/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex' },
		{ cle: 'version', libelle: 'Version', ok: true, etat: '0.171.0-alpha.13' },
		{ cle: 'mcp', libelle: 'Serveur MCP mnemo', ok: true, etat: 'déclaré' },
		{ cle: 'hooks', libelle: 'Hooks de Mnemo', ok: true, etat: 'installés' },
		{
			cle: 'approbation',
			libelle: 'Approbation des hooks',
			ok: false,
			etat: 'à approuver',
			detail: '7 hook(s) de Mnemo sur 7 sans approbation : à approuver dans Codex (/hooks).',
			remede: { texte: '/hooks', dans: 'moteur' },
		},
	],
};

const MISTRAL_VIBE: MoteurVue = {
	id: 'mistral-vibe',
	nom: 'Mistral Vibe',
	indisponible: null,
	manuel: false,
	version: '3.1.5',
	modeles: ['mistral-large-4-0', 'mistral-medium-3.5'],
	poste: [
		{ cle: 'commande', libelle: 'Commande', ok: true, etat: 'trouvée', detail: '~/.local/bin/vibe' },
		{ cle: 'version', libelle: 'Version', ok: true, etat: '3.1.5' },
		{
			cle: 'mcp',
			libelle: 'Serveur MCP mnemo',
			ok: false,
			etat: 'non déclaré',
			detail: 'Les sessions de Mistral Vibe lancées hors de Mnemo ne lisent pas la mémoire.',
			remede: { texte: 'mnemo declarer --moteur mistral-vibe --lier', dans: 'terminal' },
		},
		{ cle: 'hooks', libelle: 'Hooks de Mnemo', ok: false, etat: 'non installés', detail: 'Sans eux, Mnemo ne suit pas les sessions lancées.', remede: { texte: 'mnemo declarer --moteur mistral-vibe --lier', dans: 'terminal' } },
	],
};

const TOUS = [CLAUDE_CODE, CODEX, MISTRAL_VIBE];

const SATISFAITS: Partial<Record<PointMoteurVue['cle'], PointMoteurVue>> = {
	mcp: { cle: 'mcp', libelle: 'Serveur MCP mnemo', ok: true, etat: 'déclaré' },
	hooks: { cle: 'hooks', libelle: 'Hooks de Mnemo', ok: true, etat: 'installés' },
};

/** Les moteurs de la démo, chacun lié par `lier` le temps de la page. */
export function creerMoteursDemo() {
	const moteurs = structuredClone(TOUS);
	/** `poste` : avec les points vérifiés du poste. */
	const lire = (poste: boolean): ReponseMoteurs => ({ moteurs: moteurs.map(({ poste: points, ...m }) => (poste && points !== undefined ? { ...structuredClone(m), poste: structuredClone(points) } : structuredClone(m))) });
	/** Comme le service : serveur MCP et hooks non satisfaits déclarés et installés, puis le poste relu (404 moteur inconnu). */
	const lier = (id: string): ReponseLiaisonMoteur => {
		const m = moteurs.find((x) => x.id === id);
		if (m === undefined) throw new ErreurApi(`Moteur inconnu : « ${id} ».`, 404);
		const etape = (cle: 'mcp' | 'hooks'): EtapeLiaisonVue | undefined => {
			const i = (m.poste ?? []).findIndex((x) => x.cle === cle);
			if (i < 0) return undefined;
			const deja = m.poste![i]!.ok === true;
			m.poste![i] = structuredClone(SATISFAITS[cle]!);
			if (cle === 'mcp') return deja ? { resultat: 'deja', message: `Serveur MCP déjà déclaré à ${m.nom}.` } : { resultat: 'declare', message: `Serveur MCP déclaré pour toutes les sessions ${m.nom}.` };
			return deja ? { resultat: 'deja', message: `Hooks de Mnemo déjà installés chez ${m.nom}.` } : { resultat: 'installe', message: `Hooks de Mnemo installés chez ${m.nom}.` };
		};
		const mcp = etape('mcp') ?? { resultat: 'deja', message: `Serveur MCP déjà déclaré à ${m.nom}.` };
		const hooks = etape('hooks');
		const liaison: LiaisonMoteurVue = { id: m.id as IdMoteur, lie: true, ok: true, mcp, ...(hooks === undefined ? {} : { hooks }) };
		return { ...lire(true), liaison };
	};
	return { lire, lier };
}
