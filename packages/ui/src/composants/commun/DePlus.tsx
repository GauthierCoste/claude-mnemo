/** Sous une liste coupée : « N de plus » et « Tout voir », qui demande la liste entière. Rien quand rien n'est caché. */
import { useState, type ReactNode } from 'react';
import { Bouton } from './Bouton.tsx';
import s from './DePlus.module.css';

export function DePlus(p: { nombre: number; surToutVoir(): void }): ReactNode {
	if (p.nombre <= 0) return null;
	return (
		<p className={s.dePlus}>
			<span>{p.nombre} de plus</span>
			<Bouton petit onClick={p.surToutVoir}>
				Tout voir
			</Bouton>
		</p>
	);
}

/** « Tout voir » vaut pour `cle` (la fiche choisie, le texte cherché…) : une autre clé repart de la borne. */
export function useToutPour<T>(cle: T): { tout: boolean; toutVoir(): void } {
	const [toutPour, setToutPour] = useState<{ cle: T } | null>(null);
	return { tout: toutPour !== null && Object.is(toutPour.cle, cle), toutVoir: () => setToutPour({ cle }) };
}
