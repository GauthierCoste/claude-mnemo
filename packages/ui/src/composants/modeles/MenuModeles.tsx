/**
 * Bouton qui ouvre un petit menu (Échap, Tab ou clic ailleurs le referment ; flèches entre les items), comme `FermerSession`.
 */
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import s from './Modeles.module.css';

export function MenuModeles(p: { libelle: string; classeBouton: string; contenuBouton: ReactNode; titre?: string; alignement: 'droite' | 'gauche'; children: (fermer: () => void) => ReactNode }): ReactNode {
	const [ouvert, setOuvert] = useState(false);
	/** Position fixe sous le bouton, calée sur son bord : le menu sort d'un panneau qui coupe ce qui déborde. */
	const [place, setPlace] = useState<CSSProperties>({});
	const ouvrir = () => {
		const r = bouton.current?.getBoundingClientRect();
		if (r) setPlace(p.alignement === 'droite' ? { top: r.bottom + 4, right: window.innerWidth - r.right } : { top: r.bottom + 4, left: r.left });
		setOuvert(true);
	};
	const racine = useRef<HTMLDivElement>(null);
	const menu = useRef<HTMLDivElement>(null);
	const bouton = useRef<HTMLButtonElement>(null);
	const items = () => [...(menu.current?.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]:not(:disabled)') ?? [])];
	const fermer = (rendreFocus = true) => {
		setOuvert(false);
		if (rendreFocus) bouton.current?.focus();
	};
	useEffect(() => {
		if (!ouvert) return;
		(items().find((i) => i.getAttribute('aria-checked') === 'true') ?? items()[0])?.focus();
		const ailleurs = (e: MouseEvent) => {
			if (!racine.current?.contains(e.target as Node | null)) fermer(false);
		};
		document.addEventListener('mousedown', ailleurs);
		return () => document.removeEventListener('mousedown', ailleurs);
	}, [ouvert]);
	return (
		<div ref={racine} className={s.ancre}>
			<button ref={bouton} type="button" className={p.classeBouton} title={p.titre} aria-label={p.libelle} aria-haspopup="menu" aria-expanded={ouvert} onClick={() => (ouvert ? fermer(false) : ouvrir())}>
				{p.contenuBouton}
			</button>
			{ouvert && (
				<div
					ref={menu}
					role="menu"
					aria-label={p.libelle}
					className={s.menu}
					style={place}
					onKeyDown={(e) => {
						if (e.key === 'Escape' || e.key === 'Tab') {
							e.preventDefault();
							fermer();
							return;
						}
						const liste = items();
						const i = liste.indexOf(document.activeElement as HTMLButtonElement);
						const cible = ({ ArrowDown: (i + 1) % liste.length, ArrowUp: (i - 1 + liste.length) % liste.length, Home: 0, End: liste.length - 1 } as Record<string, number>)[e.key];
						if (cible === undefined) return;
						e.preventDefault();
						liste[cible]?.focus();
					}}
				>
					{p.children(fermer)}
				</div>
			)}
		</div>
	);
}

/** Choix exclusif d'un menu : coche, libellé, détail sur une seconde ligne. */
export function ChoixMenu(p: { coche: boolean; libelle: string; detail?: string; disabled?: boolean; title?: string; surChoix(): void }): ReactNode {
	return (
		<button type="button" role="menuitemradio" aria-checked={p.coche} className={s.item} disabled={p.disabled} title={p.title} onClick={p.surChoix}>
			<span className={s.coche} aria-hidden="true">
				{p.coche ? '●' : '○'}
			</span>
			<span className={s.texteItem}>
				<span>{p.libelle}</span>
				{p.detail && <span className={s.detail}>{p.detail}</span>}
			</span>
		</button>
	);
}
