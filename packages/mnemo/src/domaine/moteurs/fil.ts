import type { Session } from '../session.ts';

/** Identifiant d'une session chez son moteur (`fil`) : borné comme l'accepte le service. */
export const FIL_MAX = 200;

/** Un identifiant de session du moteur recevable. */
export const estFil = (v: unknown): v is string => typeof v === 'string' && v !== '' && v.length <= FIL_MAX;

/**
 * Pourquoi une session d'un moteur qui ne se reprend que par son propre identifiant ne peut pas l'être : son `fil` n'est pas
 * encore connu (aucun hook reçu) ; `motif` dit pourquoi chez ce moteur. Null : le `fil` est connu.
 */
export function motifSansFil(session: Pick<Session, 'fil'>, motif: string): string | null {
	return estFil(session.fil) ? null : motif;
}
