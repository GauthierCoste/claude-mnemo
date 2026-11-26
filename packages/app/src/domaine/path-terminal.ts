/**
 * Le `PATH` du terminal, lu dans le shell de connexion de l'utilisateur (`infra/path-terminal.ts`) : quel shell lancer, la
 * commande qui affiche le `PATH` entre deux marqueurs, et la lecture de sa sortie. Les fichiers d'initialisation du shell
 * peuvent écrire n'importe quoi autour : seul le texte entre les marqueurs compte, et il doit être un `PATH` (au moins un
 * chemin absolu). Ouverte depuis le Finder, l'app n'a que le `PATH` minimal de macOS ; les sessions Claude Code lancées par
 * Mnemo reçoivent celui-ci (nvm, `node`, `pnpm`, tout ce que le shell ajoute).
 */

/** Shell lancé si `$SHELL` manque ou n'est pas un chemin absolu. */
export const SHELL_PAR_DEFAUT = '/bin/zsh';

/** Séparateur des dossiers d'un `PATH` POSIX (le shell de connexion n'est lu que sous macOS et Linux). */
const SEPARATEUR = ':';

/** Le shell de connexion : `$SHELL` s'il est un chemin absolu sans caractère de contrôle, sinon `/bin/zsh`. */
export function shellDeConnexion(valeur: string | undefined): string {
	return valeur !== undefined && valeur.startsWith('/') && !/[\0-\x1f]/u.test(valeur) ? valeur : SHELL_PAR_DEFAUT;
}

export type Marqueurs = { debut: string; fin: string };

/** Deux marqueurs propres à une lecture (`jeton` : hexadécimal aléatoire), qu'aucun fichier d'initialisation n'écrit. */
export function marqueurs(jeton: string): Marqueurs {
	return { debut: `__MNEMO_PATH_DEBUT_${jeton}__`, fin: `__MNEMO_PATH_FIN_${jeton}__` };
}

/**
 * Arguments du shell : connexion et interactif (`-ilc`, pour lire les mêmes fichiers d'initialisation que le terminal), et
 * une commande qui affiche le `PATH` entre les marqueurs (`printf`, compris par zsh, bash et fish).
 */
export function argumentsShell(m: Marqueurs): string[] {
	return ['-ilc', `printf '%s%s%s' '${m.debut}' "$PATH" '${m.fin}'`];
}

/** Le texte entre le dernier marqueur de début et le marqueur de fin qui le suit ; null s'ils manquent. */
export function extrairePath(sortie: string, m: Marqueurs): string | null {
	const debut = sortie.lastIndexOf(m.debut);
	if (debut < 0) return null;
	const apres = debut + m.debut.length;
	const fin = sortie.indexOf(m.fin, apres);
	return fin < 0 ? null : sortie.slice(apres, fin);
}

/**
 * Un `PATH` utilisable : ses dossiers absolus, dans l'ordre, sans doublon ni entrée vide ou relative ; null s'il n'en a
 * aucun, ou s'il contient un caractère de contrôle (sortie mêlée, pas un `PATH`).
 */
export function validerPath(texte: string): string | null {
	if (/[\0-\x1f]/u.test(texte)) return null;
	const dossiers = texte.split(SEPARATEUR).filter((d) => d.startsWith('/'));
	return dossiers.length === 0 ? null : [...new Set(dossiers)].join(SEPARATEUR);
}

/** La sortie du shell lue : le `PATH` validé, ou pourquoi il n'y en a pas. */
export function lirePathDeSortie(sortie: string, m: Marqueurs): { ok: true; path: string } | { ok: false; raison: string } {
	const brut = extrairePath(sortie, m);
	if (brut === null) return { ok: false, raison: 'marqueurs absents de la sortie du shell.' };
	const path = validerPath(brut);
	return path === null ? { ok: false, raison: `PATH invalide (aucun chemin absolu) : « ${brut.slice(0, 200)} ».` } : { ok: true, path };
}
