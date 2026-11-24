/**
 * Ancrage du menu de la palette sous le champ de la barre de titre : même bord gauche, même largeur (360 px au moins,
 * sans sortir de la fenêtre), juste dessous ; suit le champ quand il bouge ou change de taille.
 */
import { useLayoutEffect, useState, type RefObject } from 'react';

export const LARGEUR_MIN_MENU = 360;
/** Marge gardée au bord droit de la fenêtre, et écart entre le champ et le menu. */
export const MARGE_FENETRE = 8;
export const ECART_MENU = 4;

export type Rect = { left: number; top: number; bottom: number; width: number; height: number };
export type Position = { left: number; top: number; width: number };

/** Le champ (`rect`) dans une fenêtre de `largeurFenetre` : place du champ recouvert et du menu dessous. */
export function positionMenu(rect: Rect, largeurFenetre: number): { champ: Position & { height: number }; menu: Position } {
	const width = Math.max(0, Math.min(Math.max(rect.width, LARGEUR_MIN_MENU), largeurFenetre - 2 * MARGE_FENETRE));
	// le bord gauche reste celui du champ ; sans place à droite, le menu recule juste assez
	const left = rect.left + width <= largeurFenetre - MARGE_FENETRE ? rect.left : Math.max(MARGE_FENETRE, largeurFenetre - MARGE_FENETRE - width);
	return {
		champ: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
		menu: { left, top: rect.bottom + ECART_MENU, width },
	};
}

const lire = (e: HTMLElement): Rect => {
	const r = e.getBoundingClientRect();
	return { left: r.left, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
};

const egaux = (a: Rect | null, b: Rect) => a !== null && a.left === b.left && a.top === b.top && a.bottom === b.bottom && a.width === b.width && a.height === b.height;

/**
 * Rectangle de l'élément ancre, relu quand il peut avoir bougé : la fenêtre change de taille, l'ancre ou un élément de
 * son parent change de taille (ResizeObserver), un voisin apparaît ou change de texte (MutationObserver : la racine lue
 * après coup), les polices finissent de charger. L'état ne change que si le rectangle change. Null sans ancre.
 */
export function useRectAncre(ancre: RefObject<HTMLElement | null> | undefined): Rect | null {
	const [rect, setRect] = useState<Rect | null>(null);
	useLayoutEffect(() => {
		const e = ancre?.current;
		if (!e) return;
		let actif = true;
		const maj = () => {
			if (!actif) return;
			const r = lire(e);
			setRect((avant) => (egaux(avant, r) ? avant : r));
		};
		const parent = e.parentElement;
		const tailles = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(maj);
		const observerTailles = () => {
			tailles?.disconnect();
			tailles?.observe(e);
			for (const voisin of parent?.children ?? []) tailles?.observe(voisin);
		};
		const mutations =
			parent === null || typeof MutationObserver === 'undefined'
				? null
				: new MutationObserver(() => {
						observerTailles();
						maj();
					});
		maj();
		observerTailles();
		mutations?.observe(parent!, { childList: true, subtree: true, characterData: true });
		window.addEventListener('resize', maj);
		void document.fonts?.ready.then(maj);
		return () => {
			actif = false;
			tailles?.disconnect();
			mutations?.disconnect();
			window.removeEventListener('resize', maj);
		};
	}, [ancre]);
	return rect;
}
