/**
 * Moteurs du mode démo (`GET moteurs`) : les quatre trouvés ; Codex avec des hooks encore à approuver, GitHub Copilot CLI sans
 * déclaration MCP permanente (pour voir les commandes qui y remédient dans Réglages › Système › Moteurs, rédigées comme le
 * service les rédige).
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
		{ cle: 'mcp', libelle: 'Serveur MCP mnemo', ok: true, etat: 'déclaré' },
		{ cle: 'hooks', libelle: 'Hooks de Mnemo', ok: true, etat: 'installés' },
	],
};

const COPILOT_CLI: MoteurVue = {
	id: 'copilot-cli',
	nom: 'GitHub Copilot CLI',
	indisponible: null,
	manuel: false,
	version: '1.0.116',
	modeles: ['claude-sonnet-5.5', 'gpt-6.2-sol', 'gemini-4-neon'],
	poste: [
		{ cle: 'commande', libelle: 'Commande', ok: true, etat: 'trouvée', detail: '/opt/homebrew/bin/copilot' },
		{ cle: 'version', libelle: 'Version', ok: true, etat: '1.0.116' },
		{
			cle: 'mcp',
			libelle: 'Serveur MCP mnemo',
			ok: false,
			etat: 'non déclaré',
			detail: 'Les sessions de GitHub Copilot CLI lancées hors de Mnemo ne lisent pas la mémoire.',
			remede: { texte: 'mnemo init --copilot', dans: 'terminal' },
		},
		{ cle: 'hooks', libelle: 'Hooks de Mnemo', ok: true, etat: 'installés' },
	],
};

const TOUS = [CLAUDE_CODE, CODEX, MISTRAL_VIBE, COPILOT_CLI];

/** `poste` : avec les points vérifiés du poste. */
export function moteursDemo(poste: boolean): ReponseMoteurs {
	const sans = ({ poste: _, ...m }: MoteurVue): MoteurVue => m;
	return { moteurs: TOUS.map((m) => (poste ? structuredClone(m) : sans(m))) };
}
