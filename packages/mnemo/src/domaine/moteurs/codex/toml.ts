/** Échappements courts d'une chaîne de base TOML. */
const COURTS: Readonly<Record<string, string>> = { '"': '\\"', '\\': '\\\\', '\b': '\\b', '\t': '\\t', '\n': '\\n', '\f': '\\f', '\r': '\\r' };

/**
 * Chaîne de base TOML (`"…"`) : guillemets, barres obliques inverses et caractères de contrôle échappés (U+0000 à U+001F
 * et U+007F, que TOML interdit tels quels) ; une moitié de paire de substitution isolée, qu'aucun échappement TOML ne
 * représente, devient U+FFFD. Valeur d'un `-c clé=valeur` de Codex, lue comme TOML.
 */
export function chaineToml(texte: string): string {
	let sortie = '"';
	for (const c of texte.toWellFormed()) {
		const court = COURTS[c];
		if (court !== undefined) sortie += court;
		else {
			const code = c.codePointAt(0)!;
			sortie += code < 0x20 || code === 0x7f ? `\\u${code.toString(16).padStart(4, '0').toUpperCase()}` : c;
		}
	}
	return `${sortie}"`;
}

/** Liste TOML de chaînes : `["a", "b"]`. */
export function listeToml(valeurs: readonly string[]): string {
	return `[${valeurs.map(chaineToml).join(', ')}]`;
}

/**
 * Chaîne TOML la plus simple à passer en argument, sans échappement ni guillemet double (que PowerShell 5.1 transmet mal aux
 * programmes) quand c'est possible : littérale (`'…'`) sans apostrophe ni caractère de contrôle (tabulation exceptée) ;
 * littérale multiligne (`'''…'''`) pour un texte à apostrophes ou à sauts de ligne `\n`, sans `'''` ni autre contrôle, qui ne
 * commence pas par un saut de ligne (TOML l'ôterait) et ne finit pas par une apostrophe ; sinon chaîne de base (`chaineToml`).
 */
export function valeurToml(texte: string): string {
	if (!texte.isWellFormed()) return chaineToml(texte);
	if (/^[^'\u0000-\u0008\u000A-\u001F\u007F]*$/u.test(texte)) return `'${texte}'`;
	const multiligne = /^[^\u0000-\u0008\u000B-\u001F\u007F]*$/u.test(texte) && !texte.includes("'''") && !texte.startsWith('\n') && !texte.endsWith("'");
	return multiligne ? `'''${texte}'''` : chaineToml(texte);
}

/** Liste TOML de chaînes, chacune par `valeurToml`. */
export function listeValeursToml(valeurs: readonly string[]): string {
	return `[${valeurs.map(valeurToml).join(', ')}]`;
}
