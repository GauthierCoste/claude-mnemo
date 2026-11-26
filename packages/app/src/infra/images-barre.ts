/**
 * Images de la barre des menus, lues de `images/` à côté de `main.js` (copiées dans `dist/` par la construction) : les
 * octets des deux tailles de chaque image. Lues par `node:fs`, qui sait lire dans `app.asar` (le chargement d'image par
 * chemin d'Electron ne cherche pas toujours le `@2x` dans une archive).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export type OctetsImage = { x1: Buffer; x2: Buffer };

/** Dossier des images, à côté du `main.js` construit (`dossierMain` : `import.meta.dirname` de celui-ci). */
export function dossierImages(dossierMain: string): string {
	return join(dossierMain, 'images');
}

/** Les octets de chaque image ; une image absente ou vide : une erreur qui la nomme. */
export function lireImagesBarre(dossier: string, noms: readonly string[]): Map<string, OctetsImage> {
	const images = new Map<string, OctetsImage>();
	for (const nom of noms) {
		const lire = (fichier: string): Buffer => {
			const octets = readFileSync(join(dossier, fichier));
			if (octets.length === 0) throw new Error(`Image vide : ${fichier}`);
			return octets;
		};
		images.set(nom, { x1: lire(`${nom}.png`), x2: lire(`${nom}@2x.png`) });
	}
	return images;
}
