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
