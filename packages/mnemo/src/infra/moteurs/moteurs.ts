import type { Moteur, MoteurDuPoste, MoteurDuService, Pilotage } from '../../application/ports.ts';
import type { IdMoteur } from '../../domaine/moteurs/moteur.ts';
import { MOTEUR_CLAUDE_CODE } from './claude-code.ts';
import { MOTEUR_CODEX } from './codex.ts';
import { MOTEUR_MISTRAL_VIBE } from './mistral-vibe.ts';

/** Moteurs qui font tourner des sessions. */
export const MOTEURS: readonly Moteur[] = [MOTEUR_CLAUDE_CODE, MOTEUR_CODEX, MOTEUR_MISTRAL_VIBE];

/** Tous les moteurs connus sur le poste (commande, déclaration MCP, hooks du poste). */
export const MOTEURS_DU_POSTE: Readonly<Record<IdMoteur, MoteurDuPoste>> = { 'claude-code': MOTEUR_CLAUDE_CODE, codex: MOTEUR_CODEX, 'mistral-vibe': MOTEUR_MISTRAL_VIBE };

/** Un moteur facultatif : `mnemo init` ne le touche que sur son option ; il a son bloc dans `PosteVerifie`. */
export type MoteurFacultatif = MoteurDuPoste & { installation: { facultatif: NonNullable<MoteurDuPoste['installation']['facultatif']> } };

/** Les moteurs facultatifs, dans l'ordre des moteurs du poste. */
export const MOTEURS_FACULTATIFS: readonly MoteurFacultatif[] = Object.values(MOTEURS_DU_POSTE).filter((m): m is MoteurFacultatif => m.installation.facultatif !== undefined);

/** Chaque moteur de sessions, avec sa commande cherchée dans cet environnement (null : introuvable). */
export function moteursDuService(env: Record<string, string | undefined>, plateforme: string): Pilotage['moteurs'] {
	const moteurs: Pilotage['moteurs'] = {};
	for (const moteur of MOTEURS) moteurs[moteur.id] = { moteur, commande: moteur.trouver(env, plateforme) } satisfies MoteurDuService;
	return moteurs;
}
