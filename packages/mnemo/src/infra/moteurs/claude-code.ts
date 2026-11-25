import { HOOKS_CLAUDE_CODE } from '../../application/moteurs/claude-code/hooks.ts';
import { assemblerPlugin, preparerClaudeCode } from '../../application/moteurs/claude-code/plugin.ts';
import type { LectureFenetre, Moteur } from '../../application/ports.ts';
import { ALIAS_CLAUDE_CODE } from '../../domaine/moteurs/claude-code/modeles.ts';
import { OUTILS_CLAUDE_CODE } from '../../domaine/moteurs/claude-code/outils.ts';
import { quotasDeLimites } from '../../domaine/moteurs/claude-code/quotas.ts';
import { TOUCHES_CLAUDE_CODE } from '../../domaine/moteurs/claude-code/touches.ts';
import { DECLARATION_MCP_CLAUDE_CODE } from './claude-code/declaration-mcp.ts';
import { fenetreDeTranscription } from './claude-code/fenetre-transcription.ts';
import type { LectureTranscription } from './claude-code/fenetre-transcription.ts';
import { trouverClaude } from './claude-code/trouver-claude.ts';

/** La fenêtre lue dans la transcription ; jamais de quotas (ceux de Claude Code viennent de sa ligne d'état). */
function sansQuotas(transcription: LectureTranscription): LectureFenetre {
	return {
		async lire({ chemin, dossier }) {
			if (chemin === undefined) return null;
			const fenetre = await transcription.lire(chemin, dossier);
			return fenetre === null ? null : { fenetre };
		},
	};
}

/**
 * Claude Code : `claude` (`MNEMO_CLAUDE`, sinon le PATH), un plugin par session (hooks, réglages, consigne, skills), ses hooks
 * et ses outils, sa transcription (`~/.claude/projects/`) pour la fenêtre de contexte et sa ligne d'état pour les quotas ;
 * le serveur MCP déclaré par `claude mcp`.
 */
export const MOTEUR_CLAUDE_CODE: Moteur = {
	id: 'claude-code',
	commandeParDefaut: 'claude',
	installation: {
		recherche: 'commande claude absente du PATH, ou MNEMO_CLAUDE invalide',
		desactivation: 'désactivé',
		retraitManuel: '`claude mcp remove mnemo --scope user`',
		approbation: null,
	},
	// les alias de `--model`, sans commande à lancer
	modeles: async () => ALIAS_CLAUDE_CODE,
	// introuvable : la ligne à coller, avec `claude`
	sansCommande: 'manuel',
	trouver: (env, plateforme) => trouverClaude(env, plateforme as NodeJS.Platform),
	declarationMcp: DECLARATION_MCP_CLAUDE_CODE,
	// lancé avec `--session-id` / `--resume <uuid>` : l'uuid de Mnemo est dans sa ligne de commande
	marqueDeSession: (uuid) => uuid,
	// reprise par `--resume <uuid de Mnemo>` : toujours possible
	motifSansReprise: () => null,
	fichiersDeSession: assemblerPlugin,
	preparer: preparerClaudeCode,
	touches: TOUCHES_CLAUDE_CODE,
	hooks: HOOKS_CLAUDE_CODE,
	outils: OUTILS_CLAUDE_CODE,
	// relue après une réponse ou un outil, jamais avant un outil (`outil`) ni à la fin
	telemetrie: { fenetre: sansQuotas(fenetreDeTranscription()), evenementsLus: new Set(['debut', 'message', 'apres_outil', 'arret']), quotas: quotasDeLimites },
};
