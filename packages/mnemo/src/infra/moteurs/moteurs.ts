import { IDS_MOTEURS } from '@mnemo/commun';
import type { Moteur, MoteurDuPoste, MoteurDuService, Pilotage } from '../../application/ports.ts';
import type { IdMoteur } from '../../domaine/moteurs/moteur.ts';
import { MOTEUR_CLAUDE_CODE } from './claude-code.ts';
import { MOTEUR_CODEX } from './codex.ts';
import { MOTEUR_COPILOT_CLI } from './copilot-cli.ts';
import { MOTEUR_MISTRAL_VIBE } from './mistral-vibe.ts';

/** Tous les moteurs, qui font tourner des sessions (commande, déclaration MCP, hooks du poste). */
const MOTEURS_DE_SESSION: Readonly<Record<IdMoteur, Moteur>> = { 'claude-code': MOTEUR_CLAUDE_CODE, codex: MOTEUR_CODEX, 'mistral-vibe': MOTEUR_MISTRAL_VIBE, 'copilot-cli': MOTEUR_COPILOT_CLI };

/** Tous les moteurs connus sur le poste. */
export const MOTEURS_DU_POSTE: Readonly<Record<IdMoteur, MoteurDuPoste>> = MOTEURS_DE_SESSION;

/** Moteurs qui font tourner des sessions, dans l'ordre de `IDS_MOTEURS`. */
export const MOTEURS: readonly Moteur[] = IDS_MOTEURS.map((id) => MOTEURS_DE_SESSION[id]);

/** Chaque moteur de sessions, avec sa commande cherchée dans cet environnement (null : introuvable). */
export function moteursDuService(env: Record<string, string | undefined>, plateforme: string): Pilotage['moteurs'] {
	const moteurs: Pilotage['moteurs'] = {};
	for (const moteur of MOTEURS) moteurs[moteur.id] = { moteur, commande: moteur.trouver(env, plateforme) } satisfies MoteurDuService;
	return moteurs;
}
