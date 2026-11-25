import type { EtapeInit } from '@mnemo/contrat';
import type { IdMoteur } from '../domaine/moteurs/moteur.ts';

/**
 * Ce que Mnemo dit de chaque moteur sur le poste (`mnemo init`, `mnemo verifier-poste`, Réglages › Système) : la commande qui
 * déclare le serveur MCP et installe les hooks (`declarer`), celle qui les refait sur ce Node et ce Mnemo (`remplacer`), où la
 * commande du moteur est cherchée (`recherche`, dit quand elle est introuvable), le réglage qui éteint sa déclaration MCP
 * (`desactivation`), comment retirer une déclaration « mnemo » qui ne lance pas Mnemo (`retrait`), et ce qu'il faut faire pour
 * que le moteur lance des hooks installés (`approbation` ; null : il les lance sans approbation).
 */
export type RemedesDuMoteur = { declarer: string; remplacer: string; recherche: string; desactivation: string; retrait: string; approbation: string | null };

export const REMEDES: Readonly<Record<IdMoteur, RemedesDuMoteur>> = {
	'claude-code': {
		declarer: 'mnemo init --mcp',
		remplacer: 'mnemo declarer --remplacer',
		recherche: 'commande claude absente du PATH, ou MNEMO_CLAUDE invalide',
		desactivation: 'désactivé',
		retrait: '`claude mcp remove mnemo --scope user`',
		approbation: null,
	},
	codex: {
		declarer: 'mnemo init --codex',
		remplacer: 'mnemo declarer --moteur codex --remplacer',
		recherche: 'commande codex absente du PATH et de ChatGPT.app, ou MNEMO_CODEX invalide',
		desactivation: 'enabled = false',
		retrait: '`codex mcp remove mnemo`',
		approbation: 'approuvez-les une fois dans Codex (/hooks) : sans approbation, Codex ne les lance pas.',
	},
	'mistral-vibe': {
		declarer: 'mnemo init --mistral',
		remplacer: 'mnemo declarer --moteur mistral-vibe --remplacer',
		recherche: 'commande vibe absente du PATH et de ~/.local/bin, ou MNEMO_VIBE invalide',
		desactivation: 'disabled = true',
		retrait: 'le bloc [[mcp_servers]] name = "mnemo" de config.toml',
		approbation: null,
	},
};

/** Un moteur facultatif, que `mnemo init` ne touche que sur son option, avec son bloc dans `PosteVerifie`. */
export type MoteurFacultatif = { id: Exclude<IdMoteur, 'claude-code'>; option: string; etape: EtapeInit; etapeHooks: EtapeInit; bloc: 'codex' | 'mistral' };

export const MOTEURS_FACULTATIFS: readonly MoteurFacultatif[] = [
	{ id: 'codex', option: '--codex', etape: 'codex', etapeHooks: 'codex_hooks', bloc: 'codex' },
	{ id: 'mistral-vibe', option: '--mistral', etape: 'mistral', etapeHooks: 'mistral_hooks', bloc: 'mistral' },
];
