/**
 * Images « template » de la barre des menus (noir sur transparent ; macOS les teinte selon le thème) : le « m » en deux
 * arches de l'icône de Mnemo (`packages/ui/outils/icone.ts`), épaissi pour rester lisible à 16 px, et ce qui marque
 * chaque état. Une image par nom de `toutesLesImages()` (domaine), en deux tailles : `<nom>.png` (16 px) et
 * `<nom>@2x.png` (32 px), dans `ressources/images/` (copié dans `dist/images/` par la construction). Dessinées ici sans
 * dépendance (suréchantillonnage 4 × 4, PNG écrit à la main).
 *
 * - repos : le m ;
 * - arrêté : le m pâli (contour vide de l'état : rien ne tourne) ;
 * - erreur : le m barré ;
 * - attend : le m et une pastille pleine en haut à droite ;
 * - travaille (aussi démarrage et arrêt), deux images en alternance : le m et son écho (un n décalé vers le haut à droite,
 *   comme dans l'icône), qui pulse.
 *
 * Régénérer après un changement du dessin : `node app/outils/images-barre.ts` (un test vérifie que les fichiers
 * versionnés sont bien ceux-ci).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { crc32, deflateSync } from 'node:zlib';
import { toutesLesImages } from '../src/domaine/icone.ts';

/** `ressources/` est le `publicDir` de Vite : copié tel quel dans `dist/`, à côté de `main.js`. */
export const DOSSIER_IMAGES = join(import.meta.dirname, '..', 'ressources', 'images');

/** Tailles produites : suffixe du fichier et côté en pixels. */
export const TAILLES: readonly { suffixe: string; cote: number }[] = [
	{ suffixe: '', cote: 16 },
	{ suffixe: '@2x', cote: 32 },
];

/**
 * Repère 32 × 32 (l'image @2x, pixel pour pixel). Trait de 4 et jambages sur des abscisses paires : nets aussi à 16 px
 * (2 px de trait, centrés entre deux pixels).
 */
const COTE = 32;
const TRAIT = 4;
/** Une arche : demi-cercle de rayon `RAYON` posé à y = `HAUT`, jambages jusqu'à y = `BAS`. */
const RAYON = 4;
const HAUT = 15;
const BAS = 26;
/** Abscisses gauches des arches : le m, décalé vers le bas à gauche pour laisser place à la pastille et à l'écho. */
const GAUCHE = 4;
const M: readonly number[] = [GAUCHE, GAUCHE + 2 * RAYON];
const N: readonly number[] = [GAUCHE + 2 * RAYON];

/** Une forme : distance signée (négative dedans) d'un point du repère, et son opacité. */
type Couche = { distance: (x: number, y: number) => number; opacite: number; detoure?: number };

/** Distance au tracé d'une lettre (jambages et demi-cercles du haut), moins la demi-épaisseur du trait. */
function lettre(arches: readonly number[], dx = 0, dy = 0): (x: number, y: number) => number {
	return (x0, y0) => {
		const x = x0 - dx;
		const y = y0 - dy;
		let d = Number.POSITIVE_INFINITY;
		for (const [i, gauche] of arches.entries()) {
			const cx = gauche + RAYON;
			const arc = y <= HAUT ? Math.abs(Math.hypot(x - cx, y - HAUT) - RAYON) : Math.min(Math.hypot(x - gauche, y - HAUT), Math.hypot(x - cx - RAYON, y - HAUT));
			d = Math.min(d, arc);
			const jambages = i === 0 ? [gauche, gauche + 2 * RAYON] : [gauche + 2 * RAYON];
			for (const jx of jambages) d = Math.min(d, Math.hypot(x - jx, y - Math.max(HAUT, Math.min(BAS, y))));
		}
		return d - TRAIT / 2;
	};
}

const disque = (cx: number, cy: number, r: number) => (x: number, y: number) => Math.hypot(x - cx, y - cy) - r;

/** Segment de (ax, ay) à (bx, by), d'épaisseur `e`. */
function segment(ax: number, ay: number, bx: number, by: number, e: number): (x: number, y: number) => number {
	return (x, y) => {
		const vx = bx - ax;
		const vy = by - ay;
		const t = Math.max(0, Math.min(1, ((x - ax) * vx + (y - ay) * vy) / (vx * vx + vy * vy)));
		return Math.hypot(x - ax - t * vx, y - ay - t * vy) - e / 2;
	};
}

/** Marque d'état en haut à droite (pastille pleine, point barré). */
const PASTILLE = { x: 26, y: 6, rayon: 5 };

/** Point barré : un cercle (anneau) traversé d'une barre en diagonale. */
function pointBarre(cx: number, cy: number, r: number): (x: number, y: number) => number {
	const e = 1.9;
	const anneau = (x: number, y: number) => Math.abs(Math.hypot(x - cx, y - cy) - (r - e / 2)) - e / 2;
	const k = (r - e / 2) * Math.SQRT1_2;
	const barre = segment(cx - k, cy - k, cx + k, cy + k, e);
	return (x, y) => Math.min(anneau(x, y), barre(x, y));
}

/** Écart (en unités du repère) détouré autour d'une marque posée sur le m, pour qu'elle s'en détache. */
const DETOURAGE = 2;

const m = (opacite = 1): Couche => ({ distance: lettre(M), opacite });
const echo = (pas: number, opacite: number): Couche => ({ distance: lettre(N, pas, -pas), opacite });

/** Couches de chaque image, de l'arrière vers l'avant ; une couche `detoure` efface d'abord ce qui l'entoure. */
const DESSINS: Record<string, readonly Couche[]> = {
	'etat-reposTemplate': [m()],
	'etat-arreteTemplate': [m(0.4)],
	'etat-erreurTemplate': [m(), { distance: pointBarre(PASTILLE.x, PASTILLE.y, PASTILLE.rayon), opacite: 1, detoure: DETOURAGE }],
	'etat-attendTemplate': [m(), { distance: disque(PASTILLE.x, PASTILLE.y, PASTILLE.rayon), opacite: 1, detoure: DETOURAGE }],
	'etat-travaille-1Template': [echo(8, 0.6), m()],
	'etat-travaille-2Template': [echo(8, 0.25), m()],
};

/** Opacité (0 à 1) d'un point : les couches dans l'ordre, chacune détourant d'abord son voisinage si demandé. */
function opacitePoint(couches: readonly Couche[], x: number, y: number): number {
	let a = 0;
	for (const c of couches) {
		const d = c.distance(x, y);
		if (c.detoure !== undefined && d <= c.detoure) a = 0;
		if (d <= 0) a = a + c.opacite * (1 - a);
	}
	return a;
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

/** Le PNG (RVBA 8 bits, noir, l'opacité seule varie) de l'image `nom`, de côté `cote`. */
export function pngImage(nom: string, cote: number): Buffer {
	const couches = DESSINS[nom];
	if (couches === undefined) throw new Error(`Image de la barre des menus sans dessin : ${nom}`);
	const echelle = COTE / cote;
	const ligne = 1 + cote * 4;
	const pixels = Buffer.alloc(ligne * cote);
	for (let py = 0; py < cote; py++) {
		pixels[py * ligne] = 0; // filtre « aucun »
		for (let px = 0; px < cote; px++) {
			let somme = 0;
			for (let sy = 0; sy < ECHANTILLONS; sy++) {
				for (let sx = 0; sx < ECHANTILLONS; sx++) {
					somme += opacitePoint(couches, (px + (sx + 0.5) / ECHANTILLONS) * echelle, (py + (sy + 0.5) / ECHANTILLONS) * echelle);
				}
			}
			pixels[py * ligne + 1 + px * 4 + 3] = Math.round((255 * somme) / (ECHANTILLONS * ECHANTILLONS));
		}
	}
	const entete = Buffer.alloc(13);
	entete.writeUInt32BE(cote, 0);
	entete.writeUInt32BE(cote, 4);
	entete[8] = 8; // 8 bits par canal
	entete[9] = 6; // RVBA
	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		bloc('IHDR', entete),
		bloc('IDAT', deflateSync(pixels, { level: 9 })),
		bloc('IEND', Buffer.alloc(0)),
	]);
}

/** Fichiers à produire : nom de fichier, nom de l'image, côté. */
export function fichiersImages(): { fichier: string; nom: string; cote: number }[] {
	return toutesLesImages().flatMap((nom) => TAILLES.map((t) => ({ fichier: `${nom}${t.suffixe}.png`, nom, cote: t.cote })));
}

if (process.argv[1] === import.meta.filename) {
	mkdirSync(DOSSIER_IMAGES, { recursive: true });
	for (const f of fichiersImages()) writeFileSync(join(DOSSIER_IMAGES, f.fichier), pngImage(f.nom, f.cote));
	console.log(`Images de la barre des menus écrites dans ${DOSSIER_IMAGES}.`);
}
