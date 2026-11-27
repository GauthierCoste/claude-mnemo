/**
 * Pendant un glissement, `body` porte la classe `drag` : les terminaux attendent la fin pour se réajuster, et la grille coupe
 * ses transitions. Un glissement finit toujours : relâché, annulé, capture du pointeur perdue (bouton relâché hors de la
 * fenêtre de l'app) ou fenêtre qui perd le focus. Sinon `drag` resterait posée : plus d'animation entre les sessions.
 */
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { CLASSE_GLISSEMENT } from '../../terminal/useTerminal.ts';

/** Pas d'une flèche du clavier (px) ; Maj : grand pas. */
export const PAS_CLAVIER_PX = 20;
export const PAS_LARGE_PX = 80;

/** Geste du clavier : un pas signé (px, positif vers la droite ou le bas), ou une borne. */
export type GesteClavier = { pas: number } | { borne: 'debut' | 'fin' };

export type GestesSeparateur = {
	onPointerDown(e: PointerEvent<HTMLElement>): void;
	onPointerMove(e: PointerEvent<HTMLElement>): void;
	onPointerUp(e: PointerEvent<HTMLElement>): void;
	onPointerCancel(e: PointerEvent<HTMLElement>): void;
	onLostPointerCapture(e: PointerEvent<HTMLElement>): void;
	onKeyDown(e: KeyboardEvent<HTMLElement>): void;
};

export function useGestesSeparateur(o: {
	/** `vertical` : trait vertical, il bouge en largeur. */
	vertical: boolean;
	/** Début d'un glissement ; faux le refuse (grille zoomée, voisine repliée). */
	surDebut(separateur: HTMLElement): boolean;
	/** Écart du pointeur depuis le début du glissement (px, positif vers la droite ou le bas). */
	surGlisser(ecart: number): void;
	surFin(): void;
	surClavier(geste: GesteClavier, separateur: HTMLElement): void;
}): { glisse: boolean; gestes: GestesSeparateur } {
	const [glisse, setGlisse] = useState(false);
	const depart = useRef<number | null>(null);

	const terminer = () => {
		if (depart.current === null) return;
		depart.current = null;
		setGlisse(false);
		o.surFin();
	};
	const terminerRef = useRef(terminer);
	terminerRef.current = terminer;

	useEffect(() => {
		if (!glisse) return;
		document.body.classList.add(CLASSE_GLISSEMENT);
		const perdu = () => terminerRef.current();
		window.addEventListener('blur', perdu);
		return () => {
			window.removeEventListener('blur', perdu);
			document.body.classList.remove(CLASSE_GLISSEMENT);
		};
	}, [glisse]);

	const position = (e: PointerEvent<HTMLElement>) => (o.vertical ? e.clientX : e.clientY);
	const finir = (e: PointerEvent<HTMLElement>) => {
		if (depart.current === null) return;
		if (e.currentTarget.hasPointerCapture?.(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
		terminer();
	};

	return {
		glisse,
		gestes: {
			onPointerDown(e) {
				if (e.button !== 0 || !o.surDebut(e.currentTarget)) return;
				e.preventDefault();
				e.currentTarget.setPointerCapture?.(e.pointerId);
				depart.current = position(e);
				setGlisse(true);
			},
			onPointerMove(e) {
				if (depart.current === null) return;
				o.surGlisser(position(e) - depart.current);
			},
			onPointerUp: finir,
			onPointerCancel: finir,
			onLostPointerCapture: () => terminer(),
			onKeyDown(e) {
				const pas = e.shiftKey ? PAS_LARGE_PX : PAS_CLAVIER_PX;
				const [moins, plus] = o.vertical ? ['ArrowLeft', 'ArrowRight'] : ['ArrowUp', 'ArrowDown'];
				let geste: GesteClavier;
				if (e.key === moins) geste = { pas: -pas };
				else if (e.key === plus) geste = { pas };
				else if (e.key === 'Home') geste = { borne: 'debut' };
				else if (e.key === 'End') geste = { borne: 'fin' };
				else return;
				e.preventDefault();
				o.surClavier(geste, e.currentTarget);
			},
		},
	};
}
