/** Un bloc du créateur d'agent : son titre, son sous-texte (ce qu'il règle), puis son contenu. */
import { useId, type ReactNode } from 'react';
import s from './Agents.module.css';

export function Bloc(p: { titre: string; sous: ReactNode; children: ReactNode }): ReactNode {
	const id = useId();
	return (
		<section className={s.bloc} aria-labelledby={id}>
			<h3 id={id} className={s.titreBloc}>
				{p.titre}
			</h3>
			<p className={s.sousBloc}>{p.sous}</p>
			{p.children}
		</section>
	);
}
