/**
 * Icône de la page (`<link rel="icon">`) redessinée à la couleur principale : le dessin de `logo.ts` peint sur un canevas
 * (sans image chargée : les chemins SVG passent par `Path2D`), posé en PNG `data:`. L'onglet du navigateur la montre ;
 * dans l'app de bureau, le processus principal la reçoit (`page-favicon-updated`) et en fait l'icône du Dock.
 * Sans canevas (tests, navigateur ancien), l'icône d'origine reste.
 */
import { COTE, COUCHES, FOND, REDUCTION, TRAIT, cheminLettre } from './logo.ts';

/** Taille du PNG : celle d'une icône du Dock sur écran Retina. */
export const TAILLE_ICONE_PAGE = 512;

/** PNG `data:` du logo à ces couleurs (`#rrggbb`), ou null sans canevas 2D. */
export function dessinerIcone(couleurs: { fond: string; trait: string }, taille = TAILLE_ICONE_PAGE): string | null {
	if (typeof document === 'undefined' || typeof Path2D === 'undefined') return null;
	const canevas = document.createElement('canvas');
	canevas.width = taille;
	canevas.height = taille;
	let ctx: CanvasRenderingContext2D | null = null;
	try {
		ctx = canevas.getContext('2d');
	} catch {
		return null;
	}
	if (ctx === null) return null;
	ctx.scale(taille / COTE, taille / COTE);
	ctx.fillStyle = couleurs.fond;
	ctx.beginPath();
	ctx.roundRect(FOND.marge, FOND.marge, COTE - 2 * FOND.marge, COTE - 2 * FOND.marge, FOND.rayon);
	ctx.fill();
	ctx.translate(COTE / 2, COTE / 2);
	ctx.scale(REDUCTION, REDUCTION);
	ctx.translate(-COTE / 2, -COTE / 2);
	ctx.strokeStyle = couleurs.trait;
	ctx.lineWidth = TRAIT;
	ctx.lineCap = 'round';
	ctx.lineJoin = 'round';
	for (const k of COUCHES) {
		ctx.save();
		ctx.translate(k.dx, k.dy);
		ctx.globalAlpha = k.opacite;
		ctx.stroke(new Path2D(cheminLettre(k.lettre)));
		ctx.restore();
	}
	try {
		return canevas.toDataURL('image/png');
	} catch {
		return null;
	}
}

/** Pose l'icône de la page dessinée à ces couleurs ; ne fait rien sans canevas ou si elle est déjà posée. */
export function poserIconePage(couleurs: { fond: string; trait: string }): void {
	const lien = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
	if (lien === null) return;
	const cle = `${couleurs.fond} ${couleurs.trait}`;
	if (lien.dataset['couleurs'] === cle) return;
	const url = dessinerIcone(couleurs);
	if (url === null) return;
	lien.type = 'image/png';
	lien.href = url;
	lien.dataset['couleurs'] = cle;
}
