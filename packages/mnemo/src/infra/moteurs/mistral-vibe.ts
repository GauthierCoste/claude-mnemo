import { CATALOGUE_MOTEURS } from '../../domaine/moteurs/catalogue.ts';
import { HOOKS_MISTRAL_VIBE } from '../../application/moteurs/mistral-vibe/hooks.ts';
import { agentDeSession, fichiersDeSessionMistralVibe, motifSansRepriseMistralVibe, preparerMistralVibe } from '../../application/moteurs/mistral-vibe/session.ts';
import type { Moteur } from '../../application/ports.ts';
import { OUTILS_MISTRAL_VIBE } from '../../domaine/moteurs/mistral-vibe/outils.ts';
import { TOUCHES_MISTRAL_VIBE } from '../../domaine/moteurs/mistral-vibe/touches.ts';
import { refusDeVersionMistralVibe } from '../../domaine/moteurs/mistral-vibe/version.ts';
import { DECLARATION_MCP_MISTRAL_VIBE } from './mistral-vibe/declaration-mcp.ts';
import { hooksDuPosteMistralVibe } from './mistral-vibe/hooks-toml.ts';
import { modelesMistralVibe } from './mistral-vibe/modeles.ts';
import { lectureTranscriptionMistralVibe } from './mistral-vibe/transcription.ts';
import { trouverVibe } from './mistral-vibe/trouver-vibe.ts';
import { versionParCommande } from './version-par-commande.ts';
import { definies } from '../../domaine/valeurs.ts';


/**
 * Mistral Vibe : `vibe` (`MNEMO_VIBE`, le PATH, puis `~/.local/bin` d'`uv tool`), une consigne par session (profil d'agent dans
 * le dossier de session de Mnemo, `--agent`, skills listées), le serveur MCP `mnemo` et ses outils permis posés pour la
 * session par l'environnement (`VIBE_MCP_SERVERS`, `VIBE_TOOLS`), ses hooks installés pour tout le poste (`hooks.toml`, inertes
 * hors d'une session Mnemo), ses outils, reprise par `--resume=<fil>`, arrêt par `/exit` ; la déclaration MCP permanente
 * écrite par Mnemo dans `config.toml`. Introuvable : la session est refusée. Télémétrie : fenêtre de contexte lue dans le
 * dossier de session ; pas de quota (Vibe ne l'écrit pas).
 */
export const MOTEUR_MISTRAL_VIBE: Moteur = {
	id: 'mistral-vibe',
	nom: CATALOGUE_MOTEURS['mistral-vibe'].nom,
	commandeParDefaut: 'vibe',
	installation: {
		optionInit: CATALOGUE_MOTEURS['mistral-vibe'].optionInit,
		facultatif: { bloc: 'mistral', etape: 'mistral', etapeHooks: 'mistral_hooks' },
		recherche: 'commande vibe absente du PATH et de ~/.local/bin, ou MNEMO_VIBE invalide',
		desactivation: 'disabled = true',
		retraitManuel: 'le bloc [[mcp_servers]] name = "mnemo" de config.toml',
		approbation: null,
	},
	modeles: modelesMistralVibe,
	sansCommande: 'refus',
	trouver: (env, plateforme) => trouverVibe(env, plateforme as NodeJS.Platform),
	declarationMcp: DECLARATION_MCP_MISTRAL_VIBE,
	// Vibe lance les hooks par le shell de la plateforme : celle de ce processus
	hooksDuPoste: hooksDuPosteMistralVibe(process.platform),
	version: versionParCommande(definies),
	refusDeVersion: refusDeVersionMistralVibe,
	marqueDeSession: agentDeSession,
	motifSansReprise: motifSansRepriseMistralVibe,
	fichiersDeSession: fichiersDeSessionMistralVibe,
	preparer: preparerMistralVibe,
	touches: TOUCHES_MISTRAL_VIBE,
	hooks: HOOKS_MISTRAL_VIBE,
	outils: OUTILS_MISTRAL_VIBE,
	// relue à chaque hook sauf avant un outil (`outil`)
	telemetrie: { fenetre: lectureTranscriptionMistralVibe(), evenementsLus: new Set(['debut', 'message', 'apres_outil', 'arret', 'fin']), quotas: () => null },
};
