import { CATALOGUE_MOTEURS } from '../../domaine/moteurs/catalogue.ts';
import { HOOKS_COPILOT_CLI } from '../../application/moteurs/copilot-cli/hooks.ts';
import { fichiersDeSessionCopilotCli, preparerCopilotCli } from '../../application/moteurs/copilot-cli/session.ts';
import type { Moteur } from '../../application/ports.ts';
import { OUTILS_COPILOT_CLI } from '../../domaine/moteurs/copilot-cli/outils.ts';
import { TOUCHES_COPILOT_CLI } from '../../domaine/moteurs/copilot-cli/touches.ts';
import { refusDeVersionCopilotCli } from '../../domaine/moteurs/copilot-cli/version.ts';
import { definies } from '../../domaine/valeurs.ts';
import { DECLARATION_MCP_COPILOT_CLI } from './copilot-cli/declaration-mcp.ts';
import { HOOKS_DU_POSTE_COPILOT_CLI } from './copilot-cli/hooks-du-poste.ts';
import { modelesCopilotCli } from './copilot-cli/modeles.ts';
import { lectureTranscriptionCopilotCli } from './copilot-cli/transcription.ts';
import { trouverCopilot } from './copilot-cli/trouver-copilot.ts';
import { versionParCommande } from './version-par-commande.ts';

/**
 * GitHub Copilot CLI : `copilot` (`MNEMO_COPILOT`, le PATH, Homebrew, npm global), une consigne par session (fichier
 * d'instructions dans le dossier de session de Mnemo, `COPILOT_CUSTOM_INSTRUCTIONS_DIRS`, skills listées), le serveur MCP
 * `mnemo` et ses outils permis posés pour la session (`--additional-mcp-config`, `--allow-tool`), ses hooks installés pour tout
 * le poste (`hooks/mnemo.json`, inertes hors d'une session Mnemo), ses outils, identifiant imposé (`--session-id`, le même en
 * reprise : le `fil` est connu d'avance), arrêt par `/exit`. Aucun hook avant le premier message d'un lancement, et l'écran de
 * confiance du dossier à chaque lancement (`debutAuPremierMessage`). La déclaration MCP permanente est écrite par Mnemo dans
 * `mcp-config.json`. Introuvable : la session est refusée. Télémétrie : fenêtre lue dans `session-state/<fil>/events.jsonl` ;
 * pas de quota.
 */
export const MOTEUR_COPILOT_CLI: Moteur = {
	id: 'copilot-cli',
	nom: CATALOGUE_MOTEURS['copilot-cli'].nom,
	commandeParDefaut: 'copilot',
	installation: {
		optionInit: CATALOGUE_MOTEURS['copilot-cli'].optionInit,
		facultatif: { bloc: 'copilot', etape: 'copilot', etapeHooks: 'copilot_hooks' },
		recherche: 'commande copilot absente du PATH, de Homebrew et de ~/.npm-global/bin, ou MNEMO_COPILOT invalide',
		desactivation: '"mnemo" dans disabledMcpServers de settings.json',
		retraitManuel: 'l’entrée « mnemo » de mcpServers dans mcp-config.json',
		approbation: null,
	},
	modeles: modelesCopilotCli(),
	sansCommande: 'refus',
	trouver: (env, plateforme) => trouverCopilot(env, plateforme as NodeJS.Platform),
	declarationMcp: DECLARATION_MCP_COPILOT_CLI,
	hooksDuPoste: HOOKS_DU_POSTE_COPILOT_CLI,
	// sans mise à jour automatique pendant la lecture de la version
	version: versionParCommande((env) => definies({ ...env, COPILOT_AUTO_UPDATE: 'false' })),
	refusDeVersion: refusDeVersionCopilotCli,
	// l'identifiant de la session chez Copilot (`--session-id=<uuid>`) : la marque dans la ligne de commande
	marqueDeSession: (uuid) => uuid,
	motifSansReprise: () => null,
	debutAuPremierMessage: true,
	filImpose: true,
	fichiersDeSession: fichiersDeSessionCopilotCli,
	preparer: preparerCopilotCli,
	touches: TOUCHES_COPILOT_CLI,
	hooks: HOOKS_COPILOT_CLI,
	outils: OUTILS_COPILOT_CLI,
	// relue à chaque hook sauf avant un outil (`outil`)
	telemetrie: { fenetre: lectureTranscriptionCopilotCli(), evenementsLus: new Set(['debut', 'message', 'apres_outil', 'arret', 'fin']), quotas: () => null },
};
