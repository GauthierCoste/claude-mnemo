import { HOOKS_CODEX } from '../../application/moteurs/codex/hooks.ts';
import { fichiersDeSessionCodex, motifSansRepriseCodex, preparerCodex } from '../../application/moteurs/codex/session.ts';
import type { Moteur } from '../../application/ports.ts';
import { OUTILS_CODEX } from '../../domaine/moteurs/codex/outils.ts';
import { TOUCHES_CODEX } from '../../domaine/moteurs/codex/touches.ts';
import { DECLARATION_MCP_CODEX } from './codex/declaration-mcp.ts';
import { HOOKS_DU_POSTE_CODEX } from './codex/hooks-json.ts';
import { modelesCodex } from './codex/modeles.ts';
import { reglagesMcpCodex } from './codex/reglages-mcp.ts';
import { versionCodex } from './codex/version.ts';
import { refusDeVersionCodex } from '../../domaine/moteurs/codex/version.ts';
import { lectureTranscriptionCodex } from './codex/transcription.ts';
import { trouverCodex } from './codex/trouver-codex.ts';

/** Marque d'une session dans la ligne de commande de `codex` : l'argument `-c mnemo_session='<uuid>'` (chaîne littérale TOML). */
export const marqueCodex = (uuid: string): string => `mnemo_session='${uuid}'`;

/**
 * Codex : `codex` (`MNEMO_CODEX`, le PATH, puis ChatGPT.app), une consigne par session (`developer_instructions`, skills
 * listées), ses hooks installés pour tout le poste (`~/.codex/hooks.json`, inertes hors d'une session Mnemo), ses outils,
 * reprise par `codex resume <fil>`, arrêt par `/quit` ; le serveur MCP déclaré par `codex mcp`. Introuvable : la session est
 * refusée (une ligne à coller ne lancerait rien). Télémétrie : fenêtre de contexte et quotas de l'abonnement ChatGPT lus
 * dans la transcription (`token_count`) ; pas de ligne d'état.
 */
export const MOTEUR_CODEX: Moteur = {
	id: 'codex',
	commandeParDefaut: 'codex',
	installation: {
		recherche: 'commande codex absente du PATH et de ChatGPT.app, ou MNEMO_CODEX invalide',
		desactivation: 'enabled = false',
		retraitManuel: '`codex mcp remove mnemo`',
		approbation: { commande: '/hooks', consigne: 'approuvez-les une fois dans Codex (/hooks) : sans approbation, Codex ne les lance pas.' },
	},
	modeles: modelesCodex(),
	sansCommande: 'refus',
	trouver: (env, plateforme) => trouverCodex(env, plateforme as NodeJS.Platform),
	declarationMcp: DECLARATION_MCP_CODEX,
	hooksDuPoste: HOOKS_DU_POSTE_CODEX,
	reglagesMcp: reglagesMcpCodex,
	version: versionCodex(),
	refusDeVersion: refusDeVersionCodex,
	marqueDeSession: marqueCodex,
	motifSansReprise: motifSansRepriseCodex,
	fichiersDeSession: fichiersDeSessionCodex,
	preparer: preparerCodex,
	touches: TOUCHES_CODEX,
	hooks: HOOKS_CODEX,
	outils: OUTILS_CODEX,
	// relue à chaque hook sauf avant un outil (`outil`) : `fin` relève le dernier `token_count` de la session
	telemetrie: { fenetre: lectureTranscriptionCodex(), evenementsLus: new Set(['debut', 'message', 'apres_outil', 'arret', 'fin']), quotas: () => null },
};
