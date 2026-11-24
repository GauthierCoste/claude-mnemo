/**
 * Icône de Mnemo : un « m » en deux arches et ses échos (n puis m, décalés et pâlis : « m n m »), à l'accent de l'interface sur son fond. Une seule
 * description géométrique donne le SVG source (`public/icone.svg`) et les PNG de l'application installable et du lanceur
 * macOS (`public/icones/`), dessinés ici sans dépendance (suréchantillonnage 4 × 4, PNG écrit à la main). Les couleurs sont
 * lues dans `src/styles/jetons.css`.
 *
 * Régénérer après un changement du dessin ou des jetons : `node packages/ui/outils/icone.ts` (un test vérifie que les
 * fichiers versionnés sont bien ceux-ci).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { crc32, deflateSync } from 'node:zlib';

/** `standard` : carré arrondi avec une marge (fenêtre, Dock) ; `masquable` : fond plein, le dessin dans la zone sûre (80 %). */
export type Variante = 'standard' | 'masquable';

/** Fichiers produits (dans `public/icones/`). 256, 512 et 1024 servent aussi à l'icône du lanceur macOS (`.icns`). */
export const ICONES: readonly { fichier: string; taille: number; variante: Variante }[] = [
	{ fichier: 'icone-192.png', taille: 192, variante: 'standard' },
	{ fichier: 'icone-256.png', taille: 256, variante: 'standard' },
	{ fichier: 'icone-512.png', taille: 512, variante: 'standard' },
	{ fichier: 'icone-1024.png', taille: 1024, variante: 'standard' },
	{ fichier: 'icone-masquable-512.png', taille: 512, variante: 'masquable' },
];

const UI = join(import.meta.dirname, '..');

/** Valeur `#rrggbb` d'un jeton de `jetons.css`. */
function couleur(nom: string): string {
	const css = readFileSync(join(UI, 'src', 'styles', 'jetons.css'), 'utf8');
	const valeur = new RegExp(`${nom}\\s*:\\s*(#[0-9a-fA-F]{6})\\s*;`).exec(css)?.[1];
	if (valeur === undefined) throw new Error(`Jeton ${nom} absent de jetons.css (ou pas en #rrggbb).`);
	return valeur.toLowerCase();
}

/** Repère 512 × 512. */
const COTE = 512;
const FOND = { marge: 40, rayon: 96 };
/** Le dessin est conçu pour une tuile pleine de 512 ; réduit autour du centre pour tenir dans le fond à marge. */
const REDUCTION = (COTE - 2 * FOND.marge) / COTE;
const TRAIT = 40;

/** Une arche : jambage gauche éventuel, demi-cercle de rayon 53 posé à y = 232, jambage droit jusqu'à y = 380. */
const HAUT = 232;
const BAS = 380;
const RAYON = 53;
type Lettre = readonly number[]; // abscisses gauches de ses arches
const M: Lettre = [150, 256];
const N: Lettre = [256];

/** Trois couches dans l'ordre m, n, m : le m devant, opaque ; le n puis le m en échos décalés de 20 vers le haut à droite. */
const PAS = 20;
/** Recentrage vertical : l'ensemble (échos compris) occupe 115 à 396, centré sur 256. */
const RECENTRAGE = -24;
const COUCHES: readonly { lettre: Lettre; dx: number; dy: number; opacite: number }[] = [
	{ lettre: M, dx: PAS, dy: -PAS + RECENTRAGE, opacite: 0.18 },
	{ lettre: N, dx: 0, dy: RECENTRAGE, opacite: 0.4 },
	{ lettre: M, dx: -PAS, dy: PAS + RECENTRAGE, opacite: 1 },
];

const couleurs = () => ({ fond: couleur('--s1'), trait: couleur('--ac') });

/** Chemin SVG d'une lettre (repère de la tuile pleine, avant décalage). */
function cheminLettre(lettre: Lettre): string {
	return lettre
		.map((x, i) => `${i === 0 ? `M${x} ${BAS} V${HAUT}` : `M${x} ${HAUT}`} A${RAYON} ${RAYON} 0 0 1 ${x + 2 * RAYON} ${HAUT} V${BAS}`)
		.join(' ');
}

/** Le SVG source. */
export function svgIcone(variante: Variante): string {
	const c = couleurs();
	const fond =
		variante === 'standard'
			? `<rect x="${FOND.marge}" y="${FOND.marge}" width="${COTE - 2 * FOND.marge}" height="${COTE - 2 * FOND.marge}" rx="${FOND.rayon}" fill="${c.fond}"/>`
			: `<rect width="${COTE}" height="${COTE}" fill="${c.fond}"/>`;
	const couches = COUCHES.map(
		(k) =>
			`<path d="${cheminLettre(k.lettre)}" transform="translate(${k.dx} ${k.dy})"${k.opacite < 1 ? ` opacity="${k.opacite}"` : ''}/>`,
	).join('\n    ');
	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${COTE} ${COTE}">
  <title>Mnemo</title>
  ${fond}
  <g transform="translate(${COTE / 2} ${COTE / 2}) scale(${REDUCTION}) translate(${-COTE / 2} ${-COTE / 2})" fill="none" stroke="${c.trait}" stroke-width="${TRAIT}" stroke-linecap="round" stroke-linejoin="round">
    ${couches}
  </g>
</svg>
`;
}

type Rvb = [number, number, number];
const rvb = (hex: string): Rvb => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)) as Rvb;

/** Distance signée au carré arrondi (négative dedans). */
function carreArrondi(x: number, y: number, marge: number, rayon: number): number {
	const demi = COTE / 2 - marge - rayon;
	const qx = Math.abs(x - COTE / 2) - demi;
	const qy = Math.abs(y - COTE / 2) - demi;
	return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - rayon;
}

/** Distance (repère de la tuile pleine) au tracé d'une lettre : jambages verticaux et demi-cercles du haut. */
function distanceLettre(x: number, y: number, lettre: Lettre): number {
	let d = Number.POSITIVE_INFINITY;
	for (const [i, gauche] of lettre.entries()) {
		const cx = gauche + RAYON;
		const arc = y <= HAUT ? Math.abs(Math.hypot(x - cx, y - HAUT) - RAYON) : Math.min(Math.hypot(x - gauche, y - HAUT), Math.hypot(x - cx - RAYON, y - HAUT));
		d = Math.min(d, arc);
		const jambages = i === 0 ? [gauche, gauche + 2 * RAYON] : [gauche + 2 * RAYON];
		for (const jx of jambages) d = Math.min(d, Math.hypot(x - jx, y - Math.max(HAUT, Math.min(BAS, y))));
	}
	return d;
}

const melange = (dessous: Rvb, dessus: Rvb, alpha: number): Rvb =>
	[0, 1, 2].map((i) => dessous[i]! * (1 - alpha) + dessus[i]! * alpha) as Rvb;

/** Couleur (ou transparent : null) d'un point du repère 512 : les couches, de l'arrière vers l'avant, sur le fond. */
function point(x: number, y: number, variante: Variante, c: { fond: Rvb; trait: Rvb }): Rvb | null {
	if (variante === 'standard' && carreArrondi(x, y, FOND.marge, FOND.rayon) > 0) return null;
	// Retour au repère de la tuile pleine dans lequel le dessin est décrit.
	const px = COTE / 2 + (x - COTE / 2) / REDUCTION;
	const py = COTE / 2 + (y - COTE / 2) / REDUCTION;
	let teinte = c.fond;
	for (const k of COUCHES) if (distanceLettre(px - k.dx, py - k.dy, k.lettre) <= TRAIT / 2) teinte = melange(teinte, c.trait, k.opacite);
	return teinte;
}

/** Bloc PNG : longueur, type, données, CRC32 (type + données). */
function bloc(type: string, donnees: Buffer): Buffer {
	const tete = Buffer.alloc(8);
	tete.writeUInt32BE(donnees.length, 0);
	tete.write(type, 4, 'latin1');
	const fin = Buffer.alloc(4);
	fin.writeUInt32BE(crc32(Buffer.concat([tete.subarray(4), donnees])), 0);
	return Buffer.concat([tete, donnees, fin]);
}

const ECHANTILLONS = 4;

/** Le PNG (RVBA 8 bits) de cette taille. */
export function pngIcone(taille: number, variante: Variante): Buffer {
	const c = couleurs();
	const teintes = { fond: rvb(c.fond), trait: rvb(c.trait) };
	const echelle = COTE / taille;
	const ligne = 1 + taille * 4;
	const pixels = Buffer.alloc(ligne * taille);
	for (let py = 0; py < taille; py++) {
		pixels[py * ligne] = 0; // filtre « aucun »
		for (let px = 0; px < taille; px++) {
			let r = 0;
			let v = 0;
			let b = 0;
			let couverts = 0;
			for (let sy = 0; sy < ECHANTILLONS; sy++) {
				for (let sx = 0; sx < ECHANTILLONS; sx++) {
					const teinte = point((px + (sx + 0.5) / ECHANTILLONS) * echelle, (py + (sy + 0.5) / ECHANTILLONS) * echelle, variante, teintes);
					if (teinte === null) continue;
					r += teinte[0];
					v += teinte[1];
					b += teinte[2];
					couverts++;
				}
			}
			const o = py * ligne + 1 + px * 4;
			if (couverts > 0) {
				pixels[o] = Math.round(r / couverts);
				pixels[o + 1] = Math.round(v / couverts);
				pixels[o + 2] = Math.round(b / couverts);
			}
			pixels[o + 3] = Math.round((255 * couverts) / (ECHANTILLONS * ECHANTILLONS));
		}
	}
	const entete = Buffer.alloc(13);
	entete.writeUInt32BE(taille, 0);
	entete.writeUInt32BE(taille, 4);
	entete[8] = 8; // 8 bits par canal
	entete[9] = 6; // RVBA
	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		bloc('IHDR', entete),
		bloc('IDAT', deflateSync(pixels, { level: 9 })),
		bloc('IEND', Buffer.alloc(0)),
	]);
}

if (process.argv[1] === import.meta.filename) {
	const PUBLIC = join(UI, 'public');
	writeFileSync(join(PUBLIC, 'icone.svg'), svgIcone('standard'));
	for (const i of ICONES) writeFileSync(join(PUBLIC, 'icones', i.fichier), pngIcone(i.taille, i.variante));
	console.log(`Icônes écrites dans ${PUBLIC}.`);
}
