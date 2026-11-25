/** Agent de code qui fait tourner une session : Claude Code ou Codex. */
export type IdMoteur = 'claude-code' | 'codex';
export const IDS_MOTEURS: readonly IdMoteur[] = ['claude-code', 'codex'];
/** Moteur d'une session ou d'un profil qui n'en dit rien (état, profils et hooks d'avant les moteurs). */
export const MOTEUR_PAR_DEFAUT: IdMoteur = 'claude-code';

export const estIdMoteur = (v: unknown): v is IdMoteur => typeof v === 'string' && (IDS_MOTEURS as readonly string[]).includes(v);

/** Longueur maximale du nom d'un modèle choisi par un profil. */
export const MODELE_MAX = 100;

/**
 * Modèle d'un profil passé tel quel au moteur (`--model`, `-m`) et écrit dans la ligne à coller : « » (le modèle par défaut
 * du moteur), ou un nom ASCII de `MODELE_MAX` caractères au plus, lettres, chiffres et `. _ : / @ + [ ] -`, commençant par une
 * lettre ou un chiffre (jamais lu comme une option ; ni espace, ni apostrophe, ni caractère de contrôle ou de mise en forme).
 */
const RE_MODELE = /^[A-Za-z0-9][A-Za-z0-9._:/@+[\]-]*$/u;

export function estModele(v: unknown): v is string {
	if (typeof v !== 'string') return false;
	return v === '' || (v.length <= MODELE_MAX && RE_MODELE.test(v));
}
