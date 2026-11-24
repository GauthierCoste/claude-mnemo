import type { PDFDocumentProxy } from 'unpdf/pdfjs';
import { extractText, getDocumentProxy, getMeta } from 'unpdf';
import { lireEntier } from '../../application/contenu.ts';
import { ErreurExtraction } from '../../application/ports.ts';
import type { DocumentExtrait, Extracteur } from '../../application/ports.ts';
import { metadonnee } from './commun.ts';

export const PAGES_MAX = 2000;
export const DELAI_MAX_MS = 60_000;
/**
 * Taille maximale d'un PDF à extraire : pdf.js lit le fichier entier en mémoire (et en fait une copie), dans un fil limité à
 * `MEMOIRE_MAX_MO`. Au-delà, refus clair (le fichier reste dans le dossier, sans passages).
 */
export const TAILLE_MAX_PDF = 256 * 1024 * 1024;

const TROP_LONG = 'Extraction PDF impossible : document trop long.';

/**
 * PDF texte via unpdf (pdf.js). Les pages sans texte (scannées) sont comptées et signalées ; sans aucune couche texte :
 * markdown vide, format `pdf-sans-texte`.
 */
export function extracteurPdf(options: { delaiMs?: number; pagesMax?: number; tailleMax?: number } = {}): Extracteur {
	const delaiMs = options.delaiMs ?? DELAI_MAX_MS;
	const pagesMax = options.pagesMax ?? PAGES_MAX;
	const tailleMax = options.tailleMax ?? TAILLE_MAX_PDF;
	return {
		async extraire(_chemin, source): Promise<DocumentExtrait> {
			const contenu = await lireEntier(source, tailleMax, 'PDF');
			let minuteur: NodeJS.Timeout | undefined;
			const suivi: { pdf?: PDFDocumentProxy } = {};
			const limite = new Promise<never>((_, rejeter) => {
				minuteur = setTimeout(() => {
					void suivi.pdf?.loadingTask.destroy().catch(() => undefined);
					rejeter(new ErreurExtraction(TROP_LONG));
				}, delaiMs);
			});
			try {
				const debut = Date.now();
				const resultat = await Promise.race([lire(contenu, pagesMax, suivi), limite]);
				if (Date.now() - debut >= delaiMs) throw new ErreurExtraction(TROP_LONG);
				return resultat;
			} catch (e) {
				if (e instanceof ErreurExtraction) throw e;
				throw new ErreurExtraction(`Extraction PDF impossible : ${e instanceof Error ? e.message : String(e)}`);
			} finally {
				clearTimeout(minuteur);
			}
		},
	};
}

async function lire(contenu: Uint8Array, pagesMax: number, suivi: { pdf?: PDFDocumentProxy }): Promise<DocumentExtrait> {
	// pdf.js prend possession (détache) du tampon qu'on lui donne : celui-ci vient d'être lu pour lui (`lireEntier`), sans
	// copie. verbosity 0 : rien sur la sortie standard.
	const pdf = await getDocumentProxy(contenu, { verbosity: 0 });
	suivi.pdf = pdf;
	try {
		if (pdf.numPages > pagesMax) throw new ErreurExtraction(TROP_LONG);
		const { text } = await extractText(pdf, { mergePages: false });
		const meta = await getMeta(pdf).catch(() => null);
		const info = (meta?.info ?? {}) as Record<string, unknown>;
		const pages: number[] = [];
		let markdown = '';
		const textes = text.map((t) => t.trim());
		const avecTexte = textes.some((t) => t !== '');
		if (avecTexte) {
			textes.forEach((t, i) => {
				if (i > 0) markdown += '\n\n';
				pages.push(markdown.length);
				markdown += t;
			});
		}
		const sansTexte = textes.filter((t) => t === '').length;
		return {
			format: avecTexte ? 'pdf' : 'pdf-sans-texte',
			titre: metadonnee(info.Title),
			markdown,
			pages: avecTexte ? pages : null,
			date: dateIso(info.CreationDate),
			auteur: metadonnee(info.Author),
			pieces: [],
			...(sansTexte > 0 ? { avertissements: [pagesSansTexte(sansTexte, textes.length)] } : {}),
		};
	} finally {
		await pdf.loadingTask.destroy().catch(() => undefined);
	}
}

/** « 12 pages sur 31 sans texte (scannées ?) : non indexées… » : le texte d'une image n'est pas lu (pas d'OCR). */
function pagesSansTexte(sansTexte: number, total: number): string {
	const pluriel = sansTexte > 1;
	return `${sansTexte} page${pluriel ? 's' : ''} sur ${total} sans texte (scannée${pluriel ? 's' : ''} ?) : non indexée${pluriel ? 's' : ''}, la reconnaissance de caractères n'est pas faite`;
}

/** `D:20260115103000+01'00'` → `2026-01-15` ; null si illisible. */
function dateIso(brut: unknown): string | null {
	const m = typeof brut === 'string' ? /^D:(\d{4})(\d{2})?(\d{2})?/.exec(brut) : null;
	if (!m) return null;
	return `${m[1]}-${m[2] ?? '01'}-${m[3] ?? '01'}`;
}
