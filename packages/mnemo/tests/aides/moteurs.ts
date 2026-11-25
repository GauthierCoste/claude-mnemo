import type { CommandeMoteur, Pilotage } from '../../src/application/ports.ts';
import { MOTEUR_CLAUDE_CODE } from '../../src/infra/moteurs/claude-code.ts';

/** Moteurs d'un pilotage de test : Claude Code, avec cette commande (null : introuvable). */
export const moteursDeTest = (commande: CommandeMoteur | null): Pilotage['moteurs'] => ({ 'claude-code': { moteur: MOTEUR_CLAUDE_CODE, commande } });

/** Remplace la commande de Claude Code d'un pilotage. */
export function commandeClaude(pil: Pilotage, commande: CommandeMoteur | null): void {
	pil.moteurs = { ...pil.moteurs, ...moteursDeTest(commande) };
}
