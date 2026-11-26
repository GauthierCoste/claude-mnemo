/**
 * Écran de jugement (provisoire) : ouvert par « Juger » ou « Relire (n) », dans la page, retour par « Retour » ou Échap. Il
 * montre le prochain message et ses fiches candidates, sans encore les faire juger : l'écran de jugement complet (D3 : Utile,
 * Pas utile, Je ne sais pas, clavier) le remplace.
 */
import { useEffect, type ReactNode } from 'react';
import { useMessageAJuger } from '../../../client/hooks.ts';
import { Bouton } from '../../commun/Bouton.tsx';
import s from './Entrainer.module.css';

export function JugerMessage(p: { surFermer(): void }): ReactNode {
	const lu = useMessageAJuger(true);
	const { surFermer } = p;
	useEffect(() => {
		const touche = (e: KeyboardEvent) => {
			if (e.key === 'Escape') surFermer();
		};
		document.addEventListener('keydown', touche);
		return () => document.removeEventListener('keydown', touche);
	}, [surFermer]);
	const m = lu.donnees?.message;
	return (
		<section className={s.section} aria-labelledby="titre-juger">
			<div className={s.teteSection}>
				<h3 id="titre-juger" className={s.titreSection}>
					Juger
				</h3>
				<Bouton petit className={s.cible} onClick={surFermer}>
					Retour
				</Bouton>
			</div>
			{lu.erreur !== null && (
				<p className={s.refus} role="alert">
					Message illisible : {lu.erreur}
				</p>
			)}
			{m === null && <p className={s.aide}>Plus aucun message à juger.</p>}
			{m && (
				<>
					<blockquote className={s.message}>{m.message}</blockquote>
					<ul className={s.criteres}>
						{m.candidates.map((c) => (
							<li key={c.chemin}>{c.titre}</li>
						))}
					</ul>
				</>
			)}
		</section>
	);
}
