import { lireTexte, texteCoupe } from '../../application/contenu.ts';
import { TEXTE_MAX_DOCUMENT } from '../../application/ports.ts';
import type { DocumentExtrait, Extracteur } from '../../application/ports.ts';
import { suivreBlocsDeCode } from '../../domaine/blocs-de-code.ts';
import { extensionDe, EXTENSIONS_MARKDOWN } from '../../domaine/source.ts';
import { metadonnee, nomDuFichier } from './commun.ts';

/**
 * Tout fichier texte (Markdown, texte brut, CSV, YAML…) : décodé en flux par `lireTexte` (marque d'ordre des octets, UTF-8,
 * sinon Windows-1252, signalé), arrêté à `texteMax` caractères (`TEXTE_MAX_DOCUMENT`) : le reste du fichier n'est jamais
 * lu, et l'extraction le signale. Un fichier binaire est refusé (« ne sera pas cherchable »).
 */
export function extracteurTexte(options: { texteMax?: number } = {}): Extracteur {
	const texteMax = options.texteMax ?? TEXTE_MAX_DOCUMENT;
	return {
		async extraire(chemin, contenu): Promise<DocumentExtrait> {
			const { texte: markdown, coupe, avertissements } = await lireTexte(chemin, contenu, texteMax);
			const tous = coupe ? [...avertissements, texteCoupe(texteMax)] : avertissements;
			const titre = premierTitre(markdown);
			return {
				format: EXTENSIONS_MARKDOWN.includes(extensionDe(chemin) ?? '') ? 'markdown' : 'texte',
				titre: metadonnee(titre) ?? metadonnee(nomDuFichier(chemin)),
				markdown,
				pages: null,
				date: null,
				auteur: null,
				pieces: [],
				...(tous.length > 0 ? { avertissements: tous } : {}),
			};
		},
	};
}

/** Premier « # titre » hors bloc de code ; une suite de « # » finale n'est retirée que précédée d'une espace. */
function premierTitre(markdown: string): string | undefined {
	const dansBloc = suivreBlocsDeCode();
	for (const ligne of markdown.split(/\r?\n/)) {
		if (dansBloc(ligne)) continue;
		const m = /^# +(.+?)\s*$/.exec(ligne);
		if (m) return m[1]!.replace(/\s+#+$/, '');
	}
	return undefined;
}
