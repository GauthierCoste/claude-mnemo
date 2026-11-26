import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import { expect, it } from 'vitest';
import { DOSSIER_IMAGES, fichiersImages, pngImage } from '../../outils/images-barre.ts';
import { toutesLesImages } from '../../src/domaine/icone.ts';

const dimensions = (png: Buffer) => ({ largeur: png.readUInt32BE(16), hauteur: png.readUInt32BE(20) });

/**
 * En-tête (IHDR) et pixels décompressés : la compression elle-même peut varier d'une machine à l'autre (le zlib de Node
 * choisit son code selon le processeur), les pixels non.
 */
function contenu(png: Buffer): { entete: string; pixels: Buffer } {
	let entete = '';
	const idat: Buffer[] = [];
	for (let i = 8; i < png.length; ) {
		const longueur = png.readUInt32BE(i);
		const type = png.toString('latin1', i + 4, i + 8);
		const donnees = png.subarray(i + 8, i + 8 + longueur);
		if (type === 'IHDR') entete = donnees.toString('hex');
		if (type === 'IDAT') idat.push(donnees);
		i += 12 + longueur;
	}
	return { entete, pixels: inflateSync(Buffer.concat(idat)) };
}

it('images versionnées = celles que dessine outils/images-barre.ts, deux tailles par image du domaine, « …Template » (macOS), « …-clair » et « …-sombre » (Windows)', () => {
	const fichiers = fichiersImages();
	expect(fichiers).toHaveLength(toutesLesImages().length * 2);
	for (const f of fichiers) {
		expect(f.fichier).toMatch(/(Template|-clair|-sombre)(@2x)?\.png$/u);
		const versionne = readFileSync(join(DOSSIER_IMAGES, f.fichier));
		expect(dimensions(versionne)).toEqual({ largeur: f.cote, hauteur: f.cote });
		expect(contenu(versionne)).toEqual(contenu(pngImage(f.nom, f.cote)));
	}
});

it('Windows : même dessin que l’image « template », en blanc (-clair) ou en noir (-sombre)', () => {
	const pixels = (nom: string) => contenu(pngImage(nom, 32)).pixels;
	const template = pixels('etat-reposTemplate');
	const clair = pixels('etat-repos-clair');
	expect(pixels('etat-repos-sombre')).toEqual(template);
	// filtre puis RVBA : l'opacité identique, la couleur blanche là où le dessin est visible
	for (let i = 0; i < template.length; i++) {
		if ((i % (1 + 32 * 4)) === 0) continue;
		const canal = ((i % (1 + 32 * 4)) - 1) % 4;
		if (canal === 3) expect(clair[i]).toBe(template[i]);
		else expect(clair[i]).toBe(255);
	}
});
