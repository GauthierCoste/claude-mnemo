/**
 * Bouton × « Fermer la session » d'une carte (petite ou agrandie) : un petit menu « Terminer avec bilan » (ou « Faire le
 * bilan » d'une session à relire) / « Abandonner », l'abandon confirmé dans le menu même. Jamais de fermeture en un clic.
 * Au clavier : flèches haut / bas (et Début / Fin) entre les items ; à la confirmation, le focus va sur « Annuler ». Le menu
 * se referme sur Échap, Tab, « Annuler » ou une fois le geste envoyé (focus rendu au ×), ou sur un clic ailleurs.
 */
import type { SessionVue } from '@mnemo/contrat';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { bilanPermis } from '../../sessions/etats.ts';
import { cx } from '../commun/classes.ts';
import { useActionSession, type ActionSession } from './actions-session.ts';
import s from './FermerSession.module.css';

export function FermerSession(p: { session: SessionVue }): ReactNode {
	const x = p.session;
	const [ouvert, setOuvert] = useState(false);
	const [confirmer, setConfirmer] = useState(false);
	const action = useActionSession();
	const racine = useRef<HTMLDivElement>(null);
	const menu = useRef<HTMLDivElement>(null);
	const bouton = useRef<HTMLButtonElement>(null);

	/** `rendreFocus` : au × (fermeture au clavier ou par un item) ; pas après un clic ailleurs. */
	const fermer = (rendreFocus: boolean) => {
		setOuvert(false);
		setConfirmer(false);
		if (rendreFocus) bouton.current?.focus();
	};
	const items = () => [...(menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? [])];
	useEffect(() => {
		if (!ouvert) return;
		// confirmation : le focus sur « Annuler », jamais sur l'action destructive
		(confirmer ? items().at(-1) : items()[0])?.focus();
		const ailleurs = (e: MouseEvent) => {
			if (!racine.current?.contains(e.target as Node | null)) fermer(false);
		};
		document.addEventListener('mousedown', ailleurs);
		return () => document.removeEventListener('mousedown', ailleurs);
	}, [ouvert, confirmer]);

	const agir = (a: ActionSession) => {
		fermer(true);
		void action.agir(x.id, a);
	};
	const item = (libelle: string, surClic: () => void, o: { danger?: boolean; disabled?: boolean; title?: string } = {}) => (
		<button type="button" role="menuitem" className={cx(s.item, o.danger && s.danger)} disabled={action.enCours || o.disabled} title={o.title} onClick={surClic}>
			{libelle}
		</button>
	);

	return (
		<div ref={racine} className={s.fermer} onDoubleClick={(e) => e.stopPropagation()}>
			<button
				ref={bouton}
				type="button"
				className={s.bouton}
				title="Fermer la session"
				aria-label="Fermer la session"
				aria-haspopup="menu"
				aria-expanded={ouvert}
				onClick={(e) => {
					e.stopPropagation();
					if (ouvert) fermer(false);
					else setOuvert(true);
				}}
			>
				×
			</button>
			{ouvert && (
				<div
					ref={menu}
					role="menu"
					aria-label="Fermer la session"
					className={s.menu}
					onKeyDown={(e) => {
						if (e.key === 'Escape' || e.key === 'Tab') {
							// Échap referme le menu seulement (la grille ne se dézoome pas derrière lui)
							e.preventDefault();
							e.stopPropagation();
							fermer(true);
							return;
						}
						const liste = items();
						const i = liste.indexOf(document.activeElement as HTMLButtonElement);
						const cibles: Record<string, number> = { ArrowDown: (i + 1) % liste.length, ArrowUp: (i - 1 + liste.length) % liste.length, Home: 0, End: liste.length - 1 };
						const cible = cibles[e.key];
						if (cible === undefined) return;
						e.preventDefault();
						liste[cible]?.focus();
					}}
				>
					{confirmer ? (
						<>
							{item('Confirmer l’abandon', () => agir('abandon'), { danger: true })}
							{item('Annuler', () => fermer(true))}
						</>
					) : (
						<>
							{bilanPermis(x.etat) && item('Terminer avec bilan', () => agir('bilan'), x.bilanDemandeMs !== null ? { disabled: true, title: 'Bilan demandé' } : {})}
							{x.etat === 'a_relire' && item('Faire le bilan', () => agir('bilan'))}
							{item('Abandonner', () => setConfirmer(true))}
						</>
					)}
				</div>
			)}
		</div>
	);
}
