const RE_TITRE = /^# /u;
const RE_PREFIXE_SYNTHESE = /^Synthèse :[ \t]*/u;
const RE_TYPE_ORIGINE = /^type_origine[ \t]*:/u;

/**
 * Texte d'une fiche à l'ancien format passé au format courant : le champ `type_origine` de l'en-tête retiré (avec ses
 * lignes de suite indentées), le préfixe « Synthèse : » retiré de la première ligne qui suit le titre. Tout le reste est
 * gardé octet pour octet (fins de ligne comprises). Texte inchangé s'il est déjà au format courant, donc idempotent.
 */
export function migrerTexteDeFiche(texte: string): string {
	const lignes = texte.split('\n');
	let debutCorps = 0;
	if (lignes[0]?.trimEnd() === '---') {
		const fin = lignes.findIndex((l, i) => i > 0 && l.trimEnd() === '---');
		if (fin > 0) {
			const gardees: string[] = [lignes[0]!];
			let enChamp = false;
			for (const ligne of lignes.slice(1, fin)) {
				if (RE_TYPE_ORIGINE.test(ligne)) enChamp = true;
				else if (enChamp && /^[ \t]/u.test(ligne)) continue;
				else enChamp = false;
				if (!enChamp) gardees.push(ligne);
			}
			lignes.splice(0, fin, ...gardees);
			debutCorps = gardees.length + 1;
		}
	}
	const titre = lignes.findIndex((l, i) => i >= debutCorps && l.trim() !== '');
	if (titre !== -1 && RE_TITRE.test(lignes[titre]!)) {
		const premiere = lignes.findIndex((l, i) => i > titre && l.trim() !== '');
		const ligne = premiere === -1 ? undefined : lignes[premiere];
		if (ligne !== undefined) {
			const reste = ligne.replace(RE_PREFIXE_SYNTHESE, '');
			if (reste !== ligne && reste.trim() !== '') lignes[premiere] = reste;
		}
	}
	return lignes.join('\n');
}
