/**
 * Bouton qui ouvre un petit panneau, comme `FermerSession` : un en-tête d'information (`entete`), le menu lui-même (`role="menu"` :
 * seulement des `menuitem*`, des `separator` et des `group`), puis une note (`pied`). Échap ou Tab le referment sans aller
 * plus loin (la grille ne se dézoome pas derrière lui), comme un clic ailleurs ; flèches, Début et Fin entre les items, un
 * item désactivé (`aria-disabled`) compris.
 */
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import s from './Modeles.module.css';

export function MenuModeles(p: {
	libelle: string;
	classeBouton: string;
	contenuBouton: ReactNode;
	titre?: string;
	alignement: 'droite' | 'gauche';
	entete?: ReactNode;
	pied?: ReactNode;
	children: (fermer: () => void) => ReactNode;
}): ReactNode {
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
	const items = () => [...(menu.current?.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]') ?? [])];
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
		<div ref={racine} className={s.ancre} onDoubleClick={(e) => e.stopPropagation()}>
			<button ref={bouton} type="button" className={p.classeBouton} title={p.titre} aria-label={p.libelle} aria-haspopup="menu" aria-expanded={ouvert} onClick={() => (ouvert ? fermer(false) : ouvrir())}>
				{p.contenuBouton}
			</button>
			{ouvert && (
				<div
					className={s.menu}
					style={place}
					onKeyDown={(e) => {
						if (e.key === 'Escape' || e.key === 'Tab') {
							// Échap referme le menu seulement
							e.preventDefault();
							e.stopPropagation();
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
					{p.entete}
					<div ref={menu} role="menu" aria-label={p.libelle} className={s.items}>
						{p.children(fermer)}
					</div>
					{p.pied}
				</div>
			)}
		</div>
	);
}

/**
 * Item d'un menu (`coche` donnée : choix exclusif) : libellé, et détail sur une seconde ligne (le motif d'un item désactivé,
 * lisible à pleine opacité). Désactivé : `aria-disabled`, atteignable aux flèches, le clic ne fait rien ; seul le libellé est
 * grisé.
 */
export function ItemMenu(p: { libelle: string; detail?: string | undefined; desactive?: boolean; coche?: boolean; surChoix(): void }): ReactNode {
	const radio = p.coche !== undefined;
	return (
		<button
			type="button"
			role={radio ? 'menuitemradio' : 'menuitem'}
			aria-checked={radio ? p.coche : undefined}
			aria-disabled={p.desactive ? true : undefined}
			className={s.item}
			onClick={() => {
				if (!p.desactive) p.surChoix();
			}}
		>
			<span className={s.coche} aria-hidden="true">
				{radio ? (p.coche ? '●' : '○') : ''}
			</span>
			<span className={s.texteItem}>
				<span className={s.libelleItem}>{p.libelle}</span>
				{p.detail && <span className={s.detail}>{p.detail}</span>}
			</span>
		</button>
	);
}

/** Groupe de choix d'un menu, nommé par son titre visible (masqué aux lecteurs d'écran, qui ont le nom du groupe). */
export function GroupeMenu(p: { titre: string; children: ReactNode }): ReactNode {
	return (
		<div role="group" aria-label={p.titre}>
			<div className={s.sousTitre} aria-hidden="true">
				{p.titre}
			</div>
			{p.children}
		</div>
	);
}
