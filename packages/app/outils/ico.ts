/**
 * Icône Windows (`.ico`) assemblée à partir de PNG, sans outil externe : un en-tête, une entrée de 16 octets par image,
 * puis les PNG tels quels (format admis depuis Windows Vista, pour toutes les tailles). Taille au plus 256 (dans
 * l'en-tête, 256 s'écrit 0).
 */

export type ImageIco = { readonly taille: number; readonly png: Buffer };

const SIGNATURE_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Largeur et hauteur d'un PNG (bloc IHDR), ou une erreur si ce n'est pas un PNG. */
function dimensionsPng(png: Buffer): { largeur: number; hauteur: number } {
	if (png.length < 24 || !png.subarray(0, 8).equals(SIGNATURE_PNG) || png.toString('latin1', 12, 16) !== 'IHDR') throw new Error('Image de l’icône : pas un PNG.');
	return { largeur: png.readUInt32BE(16), hauteur: png.readUInt32BE(20) };
}

/** Le fichier `.ico` des images (carrées, de la taille annoncée, 256 au plus), dans l'ordre donné. */
export function icoDepuisPng(images: readonly ImageIco[]): Buffer {
	if (images.length === 0) throw new Error('Icône sans image.');
	const entetes: Buffer[] = [];
	let decalage = 6 + 16 * images.length;
	for (const { taille, png } of images) {
		const { largeur, hauteur } = dimensionsPng(png);
		if (largeur !== taille || hauteur !== taille || taille < 1 || taille > 256) throw new Error(`Image de l’icône : ${largeur}×${hauteur} au lieu de ${taille}×${taille} (256 au plus).`);
		const entree = Buffer.alloc(16);
		entree.writeUInt8(taille === 256 ? 0 : taille, 0);
		entree.writeUInt8(taille === 256 ? 0 : taille, 1);
		entree.writeUInt8(0, 2); // pas de palette
		entree.writeUInt8(0, 3);
		entree.writeUInt16LE(1, 4); // plans
		entree.writeUInt16LE(32, 6); // bits par pixel
		entree.writeUInt32LE(png.length, 8);
		entree.writeUInt32LE(decalage, 12);
		entetes.push(entree);
		decalage += png.length;
	}
	const debut = Buffer.alloc(6);
	debut.writeUInt16LE(0, 0);
	debut.writeUInt16LE(1, 2); // type : icône
	debut.writeUInt16LE(images.length, 4);
	return Buffer.concat([debut, ...entetes, ...images.map((i) => i.png)]);
}
