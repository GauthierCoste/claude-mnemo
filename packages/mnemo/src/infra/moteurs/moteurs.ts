import type { Moteur, MoteurDuService, Pilotage } from '../../application/ports.ts';
import { MOTEUR_CLAUDE_CODE } from './claude-code.ts';

/** Moteurs implémentés. */
export const MOTEURS: readonly Moteur[] = [MOTEUR_CLAUDE_CODE];

/** Chaque moteur implémenté, avec sa commande cherchée dans cet environnement (null : introuvable). */
export function moteursDuService(env: Record<string, string | undefined>, plateforme: string): Pilotage['moteurs'] {
	const moteurs: Pilotage['moteurs'] = {};
	for (const moteur of MOTEURS) moteurs[moteur.id] = { moteur, commande: moteur.trouver(env, plateforme) } satisfies MoteurDuService;
	return moteurs;
}
