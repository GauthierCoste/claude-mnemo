/**
 * Règles du poste partagées par le service et l'app de bureau, sans `node:` : variables d'environnement (sous Windows, les
 * noms ne tiennent pas compte de la casse : `Path` et `PATH` sont la même variable) et dossiers de données des apps (celui
 * de Mnemo, celui de l'app Claude). La plateforme est celle de `process.platform`, passée par l'appelant.
 */

type Env = Readonly<Record<string, string | undefined>>;

const memeNom = (a: string, b: string): boolean => a.toUpperCase() === b.toUpperCase();

/** Valeur d'une variable d'environnement : sous Windows sans tenir compte de la casse ; ailleurs, nom exact. */
export function variable(env: Env, nom: string, plateforme: string): string | undefined {
	if (plateforme !== 'win32') return env[nom];
	const cle = Object.keys(env).find((k) => memeNom(k, nom));
	return cle === undefined ? undefined : env[cle];
}

/**
 * Copie de `env` où la variable `nom` vaut `valeur`. Sous Windows, une seule clé reste pour elle, quelle que soit sa casse
 * (celle déjà présente, `Path` par exemple, est gardée) : deux clés `Path` et `PATH` passées à un processus enfant, et l'une
 * des deux est prise au hasard.
 */
export function avecVariable(env: Env, nom: string, valeur: string, plateforme: string): Record<string, string | undefined> {
	if (plateforme !== 'win32') return { ...env, [nom]: valeur };
	const copie: Record<string, string | undefined> = {};
	let cle = nom;
	for (const [k, v] of Object.entries(env)) {
		if (memeNom(k, nom)) cle = k;
		else copie[k] = v;
	}
	copie[cle] = valeur;
	return copie;
}

/** `base` et `parties` joints par le séparateur de la plateforme (Windows : `\`, les `/` de `base` convertis). */
function joindre(plateforme: string, base: string, ...parties: string[]): string {
	const sep = plateforme === 'win32' ? '\\' : '/';
	const b = (plateforme === 'win32' ? base.replaceAll('/', '\\') : base).replace(/[\\/]+$/u, '');
	return [b, ...parties].join(sep);
}

/**
 * Dossier de données d'une app de bureau nommée `nom` : macOS `~/Library/Application Support/<nom>`, Windows
 * `%APPDATA%\<nom>` (à défaut `~\AppData\Roaming\<nom>`), ailleurs `$XDG_CONFIG_HOME/<nom>` (à défaut
 * `~/.config/<nom>`). `maison` : le dossier personnel (`os.homedir()`, ou un dossier de travail dans les essais).
 */
export function dossierDonneesApp(plateforme: string, maison: string, env: Env, nom: string): string {
	if (plateforme === 'win32') return joindre(plateforme, variable(env, 'APPDATA', plateforme) || joindre(plateforme, maison, 'AppData', 'Roaming'), nom);
	if (plateforme === 'darwin') return joindre(plateforme, maison, 'Library', 'Application Support', nom);
	return joindre(plateforme, env['XDG_CONFIG_HOME'] || joindre(plateforme, maison, '.config'), nom);
}

export const NOM_FICHIER_CLAUDE_DESKTOP = 'claude_desktop_config.json';

/** Fichier de configuration de l'app Claude (Claude Desktop) : `claude_desktop_config.json` de son dossier de données. */
export function fichierConfigClaudeDesktop(plateforme: string, maison: string, env: Env): string {
	return joindre(plateforme, dossierDonneesApp(plateforme, maison, env, 'Claude'), NOM_FICHIER_CLAUDE_DESKTOP);
}
