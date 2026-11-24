import type { ReactNode } from 'react';
import { Bouton } from './Bouton.tsx';
import { cx } from './classes.ts';
import { Separateur } from './Separateur.tsx';
import { useTailleGardee, type TailleGardee } from './taille-gardee.ts';
import s from './Tiroir.module.css';

/** Part de la fenêtre que le tiroir ne dépasse jamais. */
export const PART_MAX_FENETRE = 0.9;

function largeurMax(min: number): number {
	return Math.max(min, Math.floor(window.innerWidth * PART_MAX_FENETRE));
}

type Props = {
	ouvert: boolean;
	titre: string;
	puce?: ReactNode;
	/** Largeur réglable par une poignée sur le bord gauche, gardée par visiteur. */
	redimension?: TailleGardee;
	/** Agrandi : il couvre toute la zone sous la barre de titre, sans poignée. */
	agrandi?: boolean;
	/** Boutons de l'en-tête, avant « Fermer ». */
	actions?: ReactNode;
	surFermer(): void;
	children?: ReactNode;
};

/**
 * Tiroir qui glisse depuis la droite : en-tête avec pouls, titre, puce, actions, « Fermer ».
 * Avec `redimension`, une poignée (`Separateur`) sur le bord gauche règle sa largeur, entre `min` et 90 % de la fenêtre :
 * glisser, flèches (Maj : grand pas), Début/Fin, double-clic pour la largeur par défaut.
 */
export function Tiroir(p: Props): ReactNode {
	return p.redimension ? <TiroirReglable {...p} redimension={p.redimension} /> : <Coque {...p} largeur={null} poignee={null} />;
}

function TiroirReglable(p: Props & { redimension: TailleGardee }): ReactNode {
	const r = p.redimension;
	const max = largeurMax(r.min);
	const largeur = useTailleGardee(r, max);
	const poignee = p.agrandi ? null : (
		<Separateur
			className={s.poignee}
			orientation="vertical"
			label={`Largeur du panneau ${p.titre}`}
			valeur={largeur.valeur}
			min={r.min}
			max={max}
			// la poignée est à gauche : aller vers la gauche élargit
			sens={-1}
			surChanger={largeur.regler}
			surDefaut={largeur.reinitialiser}
		/>
	);
	return <Coque {...p} largeur={largeur.valeur} poignee={poignee} />;
}

function Coque(p: Props & { largeur: number | null; poignee: ReactNode }): ReactNode {
	return (
		<aside
			className={cx(s.tiroir, p.ouvert && s.on, p.agrandi && s.agrandi)}
			style={p.largeur !== null && !p.agrandi ? { width: p.largeur } : undefined}
			aria-label={p.titre}
			aria-hidden={!p.ouvert}
			inert={!p.ouvert}
			data-ouvert={String(p.ouvert)}
			data-agrandi={String(p.agrandi ?? false)}
		>
			{p.poignee}
			<div className={s.entete}>
				<span className={s.pouls} aria-hidden="true" />
				<b>{p.titre}</b>
				{p.puce}
				<span className={s.espace} />
				{p.actions}
				<Bouton genre="icone" onClick={p.surFermer} aria-keyshortcuts="Escape">
					Fermer
				</Bouton>
			</div>
			{p.children}
		</aside>
	);
}
