import type { Session } from '../session.ts';

/** Identifiant d'une session chez son moteur (`fil`) : borné comme l'accepte le service. */
export const FIL_MAX = 200;

/** Un identifiant de session du moteur recevable. */
export const estFil = (v: unknown): v is string => typeof v === 'string' && v !== '' && v.length <= FIL_MAX;

/**
 * Un `fil` sûr à mettre dans un chemin ou sur la ligne de commande du moteur (forme d'uuid de Codex et de Mistral Vibe) :
 * lettres, chiffres et tirets, sans tiret au début : rien qui sorte d'un nom de dossier ni ne se lise comme une option.
 */
export const RE_FIL_SUR = /^[A-Za-z0-9][A-Za-z0-9-]{0,199}$/u;

/**
 * Pourquoi une session d'un moteur qui ne se reprend que par son propre identifiant ne peut pas l'être : son `fil` n'est pas
 * encore connu (aucun hook reçu) ; `motif` dit pourquoi chez ce moteur. Null : le `fil` est connu.
 */
export function motifSansFil(session: Pick<Session, 'fil'>, motif: string): string | null {
	return estFil(session.fil) ? null : motif;
}
