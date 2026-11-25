import { HOOKS_CODEX } from '../../application/moteurs/codex/hooks.ts';
import { fichiersDeSessionCodex, motifSansRepriseCodex, preparerCodex } from '../../application/moteurs/codex/session.ts';
import type { Moteur } from '../../application/ports.ts';
import { OUTILS_CODEX } from '../../domaine/moteurs/codex/outils.ts';
import { TOUCHES_CODEX } from '../../domaine/moteurs/codex/touches.ts';
import { DECLARATION_MCP_CODEX } from './codex/declaration-mcp.ts';
import { HOOKS_DU_POSTE_CODEX } from './codex/hooks-json.ts';
import { modelesCodex } from './codex/modeles.ts';
import { trouverCodex } from './codex/trouver-codex.ts';

/** Marque d'une session dans la ligne de commande de `codex` : l'argument `-c mnemo_session="<uuid>"`. */
export const marqueCodex = (uuid: string): string => `mnemo_session="${uuid}"`;

/**
 * Codex : `codex` (`MNEMO_CODEX`, le PATH, puis ChatGPT.app), une consigne par session (`developer_instructions`, skills
 * listées), ses hooks installés pour tout le poste (`~/.codex/hooks.json`, inertes hors d'une session Mnemo), ses outils,
 * reprise par `codex resume <fil>`, arrêt par `/quit` ; le serveur MCP déclaré par `codex mcp`. Introuvable : la session est
 * refusée (une ligne à coller ne lancerait rien). Télémétrie (fenêtre de contexte, quotas) : pas encore lue.
 */
export const MOTEUR_CODEX: Moteur = {
	id: 'codex',
	nom: 'Codex',
	commandeParDefaut: 'codex',
	modeles: modelesCodex(),
	sansCommande: 'refus',
	trouver: (env, plateforme) => trouverCodex(env, plateforme as NodeJS.Platform),
	declarationMcp: DECLARATION_MCP_CODEX,
	hooksDuPoste: HOOKS_DU_POSTE_CODEX,
	marqueDeSession: marqueCodex,
	motifSansReprise: motifSansRepriseCodex,
	fichiersDeSession: fichiersDeSessionCodex,
	preparer: preparerCodex,
	touches: TOUCHES_CODEX,
	hooks: HOOKS_CODEX,
	outils: OUTILS_CODEX,
	telemetrie: { fenetre: { lire: async () => null }, quotas: () => null },
};
