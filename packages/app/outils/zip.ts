/**
 * Lecture de quelques fichiers d'une archive zip (celle du Node officiel pour Windows), sans outil externe : JSZip, déjà
 * une dépendance du dépôt (le service s'en sert pour les documents Office), en JavaScript pur, qui lit le répertoire
 * central, le zip64 et la compression « deflate ».
 */
import JSZip from 'jszip';
import { ErreurConstruction } from './erreur.ts';

/** Type de fichier Unix (bits `S_IFMT` du mode) d'un lien symbolique. */
const LIEN_UNIX = 0o120000;
const TYPE_UNIX = 0o170000;

/**
 * Contenu des fichiers `noms` (chemins dans l'archive, en `/`) de l'archive `donnees`. Chacun doit être présent et un fichier
 * ordinaire : un dossier ou un lien symbolique (mode Unix de l'entrée) arrête la construction.
 */
export async function fichiersDuZip(donnees: Buffer, noms: readonly string[]): Promise<Map<string, Buffer>> {
	let zip: JSZip;
	try {
		zip = await JSZip.loadAsync(donnees, { checkCRC32: true });
	} catch (e) {
		throw new ErreurConstruction(`Archive zip illisible (${e instanceof Error ? e.message : String(e)}).`);
	}
	const lus = new Map<string, Buffer>();
	for (const nom of noms) {
		const entree = zip.files[nom];
		if (entree === undefined || entree.dir) throw new ErreurConstruction(`${nom} absent de l’archive zip (ou pas un fichier).`);
		const mode = typeof entree.unixPermissions === 'number' ? entree.unixPermissions : 0;
		if ((mode & TYPE_UNIX) === LIEN_UNIX) throw new ErreurConstruction(`${nom} est un lien dans l’archive zip : refusé.`);
		lus.set(nom, await entree.async('nodebuffer'));
	}
	return lus;
}
