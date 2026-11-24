import type { Extracteur, Extracteurs } from '../../application/ports.ts';
import { extracteurEmail } from './email.ts';
import { EXTENSIONS_EXTRAITES, extensionDe } from '../../domaine/source.ts';
import { extracteurPdf } from './pdf.ts';
import { extracteurTexte } from './texte.ts';
import { extracteurWord } from './word.ts';

/**
 * Extracteur dédié d'un format (`EXTENSIONS_EXTRAITES`, extension en minuscules), sinon celui du texte, qui lit tout
 * fichier texte et refuse un binaire. Point d'extension : ajouter une entrée ici, et son extension à `EXTENSIONS_EXTRAITES`
 * (`.mbox` : `extraireTout` rend un document par fil).
 */
export function extracteursReels(): Extracteurs {
	const texte = extracteurTexte();
	const dedies: Record<(typeof EXTENSIONS_EXTRAITES)[number], Extracteur> = {
		'.pdf': extracteurPdf(),
		'.docx': extracteurWord(),
		'.eml': extracteurEmail('eml'),
		'.mbox': extracteurEmail('mbox'),
	};
	const parExtension = new Map<string, Extracteur>(Object.entries(dedies));
	return { pour: (chemin) => parExtension.get(extensionDe(chemin) ?? '') ?? texte };
}
