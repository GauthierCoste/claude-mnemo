import mammoth from 'mammoth';
import { lireEntier } from '../../application/contenu.ts';
import { ErreurExtraction } from '../../application/ports.ts';
import type { DocumentExtrait, Extracteur } from '../../application/ports.ts';
import type { LimitesZip } from './proprietes-word.ts';
import { htmlVersMarkdown, metadonnee, nomDuFichier } from './commun.ts';
import { LIMITES_WORD, lireProprietesWord, verifierZip } from './proprietes-word.ts';

/**
 * Taille maximale d'un fichier Word à extraire : mammoth lit l'archive entière en mémoire (et la décompresse, 200 Mo au plus,
 * `LIMITES_WORD`). Au-delà, refus clair.
 */
export const TAILLE_MAX_WORD = 100 * 1024 * 1024;

/** Word (.docx) : mammoth → HTML (images ignorées, avertissements ignorés) → Markdown via turndown. */
export function extracteurWord(limites: LimitesZip = LIMITES_WORD, tailleMax = TAILLE_MAX_WORD): Extracteur {
	return {
		async extraire(chemin, source): Promise<DocumentExtrait> {
			const contenu = await lireEntier(source, tailleMax, 'Document Word');
			const verdict = verifierZip(contenu, limites);
			if (verdict === 'illisible') throw new ErreurExtraction('Extraction Word impossible : document Word non pris en charge (archive Zip64 ou illisible).');
			if (verdict === 'volumineux') throw new ErreurExtraction('Extraction Word impossible : document trop volumineux une fois décompressé.');
			try {
				const tampon = Buffer.from(contenu);
				const { value: html } = await mammoth.convertToHtml({ buffer: tampon }, { convertImage: mammoth.images.imgElement(async () => ({ src: '' })) });
				const markdown = htmlVersMarkdown(html);
				const proprietes = await lireProprietesWord(tampon);
				return {
					format: 'docx',
					titre: metadonnee(/^#{1,6} +(.+)$/m.exec(markdown)?.[1]) ?? metadonnee(proprietes.titre) ?? metadonnee(nomDuFichier(chemin)),
					markdown,
					pages: null,
					date: metadonnee(proprietes.date),
					auteur: metadonnee(proprietes.auteur),
					pieces: [],
				};
			} catch (e) {
				throw new ErreurExtraction(`Extraction Word impossible : ${e instanceof Error ? e.message : String(e)}`);
			}
		},
	};
}
