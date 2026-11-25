/** Agent de code qui fait tourner une session : Claude Code, ou Codex (à venir). */
export type IdMoteur = 'claude-code' | 'codex';
export const IDS_MOTEURS: readonly IdMoteur[] = ['claude-code', 'codex'];
/** Moteur d'une session ou d'un profil qui n'en dit rien (état, profils et hooks d'avant les moteurs). */
export const MOTEUR_PAR_DEFAUT: IdMoteur = 'claude-code';

export const estIdMoteur = (v: unknown): v is IdMoteur => typeof v === 'string' && (IDS_MOTEURS as readonly string[]).includes(v);

/** Longueur maximale du nom d'un modèle choisi par un profil. */
export const MODELE_MAX = 100;

/**
 * Modèle d'un profil passé tel quel au moteur (`--model`, `-m`) : « » (le modèle par défaut du moteur), ou un texte de
 * `MODELE_MAX` caractères au plus, sans caractère de contrôle, sans espace au début ni à la fin, sans « - » au début (jamais
 * lu comme une option).
 */
export function estModele(v: unknown): v is string {
	if (typeof v !== 'string') return false;
	if (v === '') return true;
	return v.length <= MODELE_MAX && v === v.trim() && !v.startsWith('-') && !/\p{Cc}/u.test(v);
}
