/**
 * Le menu ⋯ de l'en-tête de la note : un item, avec sa ligne de détail qui dit son effet (ou pourquoi il est indisponible).
 * Au clavier : le focus va sur l'item à l'ouverture ; Échap ou Tab referme (focus rendu au bouton) ; un clic ailleurs aussi.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import s from './Entrainer.module.css';

export function MenuNote(p: { libelle: string; detail: string; indisponible: boolean; surChoix(): void }): ReactNode {
	const [ouvert, setOuvert] = useState(false);
	const racine = useRef<HTMLDivElement>(null);
	const bouton = useRef<HTMLButtonElement>(null);
	const item = useRef<HTMLButtonElement>(null);
	const fermer = (rendreFocus: boolean) => {
		setOuvert(false);
		if (rendreFocus) bouton.current?.focus();
	};
	useEffect(() => {
		if (!ouvert) return;
		item.current?.focus();
		const ailleurs = (e: MouseEvent) => {
			if (!racine.current?.contains(e.target as Node | null)) setOuvert(false);
		};
		document.addEventListener('mousedown', ailleurs);
		return () => document.removeEventListener('mousedown', ailleurs);
	}, [ouvert]);
	return (
		<div ref={racine} className={s.menuNote}>
			<button
				ref={bouton}
				type="button"
				className={s.boutonMenu}
				aria-label="Autres actions sur la note"
				title="Autres actions sur la note"
				aria-haspopup="menu"
				aria-expanded={ouvert}
				onClick={() => setOuvert((o) => !o)}
			>
				⋯
			</button>
			{ouvert && (
				<div
					role="menu"
					aria-label="Autres actions sur la note"
					className={s.menu}
					onKeyDown={(e) => {
						if (e.key !== 'Escape' && e.key !== 'Tab') return;
						e.preventDefault();
						e.stopPropagation();
						fermer(true);
					}}
				>
					<button
						ref={item}
						type="button"
						role="menuitem"
						className={s.item}
						aria-disabled={p.indisponible || undefined}
						onClick={() => {
							if (p.indisponible) return;
							fermer(true);
							p.surChoix();
						}}
					>
						{p.libelle}
						<span className={s.detailItem}>{p.detail}</span>
					</button>
				</div>
			)}
		</div>
	);
}
