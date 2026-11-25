/**
 * Moteurs du mode démo (`GET moteurs`) : Claude Code et Codex trouvés, Codex avec ses modèles et des hooks encore à
 * approuver (pour voir la commande qui y remédie dans Réglages › Système › Moteurs).
 */
import type { MoteurVue, ReponseMoteurs } from '@mnemo/contrat';

const CLAUDE_CODE: MoteurVue = {
	id: 'claude-code',
	nom: 'Claude Code',
	indisponible: null,
	manuel: false,
	version: null,
	modeles: ['opus', 'sonnet', 'haiku'],
	poste: [
		{ cle: 'commande', libelle: 'Commande', ok: true, etat: 'trouvée', detail: '~/.local/bin/claude' },
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
		{ cle: 'commande', libelle: 'Commande', ok: true, etat: 'trouvée', detail: '/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex' },
		{ cle: 'version', libelle: 'Version', ok: true, etat: '0.171.0-alpha.13' },
		{ cle: 'mcp', libelle: 'Serveur MCP mnemo', ok: true, etat: 'déclaré' },
		{ cle: 'hooks', libelle: 'Hooks de Mnemo', ok: true, etat: 'installés' },
		{
			cle: 'approbation',
			libelle: 'Approbation des hooks',
			ok: false,
			etat: 'à approuver',
			detail: 'aucune approbation enregistrée dans config.toml pour les hooks de Mnemo',
			remede: { texte: '/hooks', dans: 'moteur' },
		},
	],
};

/** `poste` : avec les points vérifiés du poste. */
export function moteursDemo(poste: boolean): ReponseMoteurs {
	const sans = ({ poste: _, ...m }: MoteurVue): MoteurVue => m;
	return { moteurs: poste ? [structuredClone(CLAUDE_CODE), structuredClone(CODEX)] : [sans(CLAUDE_CODE), sans(CODEX)] };
}
