/**
 * Configuration de l'app (`config.json`, écrite par l'assistant ou `pnpm installer-dev`) : la racine du dossier Mnemo, le Node et le
 * `main.ts` qui lancent le service, le `PATH` à lui donner, et son port (`MNEMO_PORT`) s'il est fixé. L'app empaquetée
 * apporte son propre Node et son propre code de Mnemo : `node` et `main` viennent alors du paquet, et ceux du fichier, s'il
 * en a, sont ignorés.
 */

export type Configuration = { racine: string; node: string; main: string; path: string; port?: number };

/** Le Node et le `main.ts` qui lancent le service. */
export type Lancement = { node: string; main: string };

export type ResultatConfiguration = { ok: true; configuration: Configuration } | { ok: false; erreurs: string[] };

/** Chemin absolu : `/…` (macOS, Linux) ou `C:\…`, `C:/…` (Windows). */
export function estCheminAbsolu(chemin: string): boolean {
	return chemin.startsWith('/') || /^[A-Za-z]:[\\/]/u.test(chemin);
}

/**
 * Valide le contenu lu de `config.json` (JSON déjà analysé) : `racine` chemin absolu, `path` texte non vide, `port`
 * facultatif entier de 0 à 65535 ; `node` et `main` chemins absolus, sauf si `paquet` (le lancement de l'app empaquetée)
 * est donné : il les remplace. Les autres clés sont ignorées. Erreurs : une phrase par clé fautive.
 */
export function validerConfiguration(brut: unknown, paquet?: Lancement): ResultatConfiguration {
	if (typeof brut !== 'object' || brut === null || Array.isArray(brut)) return { ok: false, erreurs: ['La configuration doit être un objet JSON.'] };
	const objet = brut as Record<string, unknown>;
	const erreurs: string[] = [];
	for (const cle of paquet === undefined ? (['racine', 'node', 'main'] as const) : (['racine'] as const)) {
		const valeur = objet[cle];
		if (typeof valeur !== 'string' || valeur === '') erreurs.push(`« ${cle} » manque (chemin absolu attendu).`);
		else if (!estCheminAbsolu(valeur)) erreurs.push(`« ${cle} » doit être un chemin absolu : ${valeur}`);
	}
	if (typeof objet['path'] !== 'string' || objet['path'] === '') erreurs.push('« path » manque (le PATH du terminal).');
	const port = objet['port'];
	if (port !== undefined && (typeof port !== 'number' || !Number.isInteger(port) || port < 0 || port > 65_535)) erreurs.push('« port » doit être un entier de 0 à 65535.');
	if (erreurs.length > 0) return { ok: false, erreurs };
	const { node, main } = paquet ?? { node: objet['node'] as string, main: objet['main'] as string };
	const configuration: Configuration = { racine: objet['racine'] as string, node, main, path: objet['path'] as string };
	if (port !== undefined) configuration.port = port as number;
	return { ok: true, configuration };
}
