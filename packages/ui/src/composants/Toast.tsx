import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useTextes } from '../langue/langue.tsx';
import { cx } from './commun/classes.ts';
import s from './Toast.module.css';

/** `information` : un message court ; `avertissement` : ce qui a échoué après une écriture faite (index en retard…). */
export type GenreMessage = 'information' | 'avertissement';

/** Durée d'affichage d'un message selon son genre, en ms ; null : jusqu'à ce que l'utilisateur le ferme. */
export function dureeAffichage(genre: GenreMessage): number | null {
	return genre === 'information' ? 1900 : null;
}

type Afficher = (message: string, genre?: GenreMessage) => void;
const ContexteToast = createContext<Afficher>(() => {});

/** Un avertissement affiché ; `nombre` : combien de fois il est arrivé depuis qu'il est affiché. */
type Persistant = { cle: number; message: string; nombre: number };

/**
 * Toast : un message en `role="status"`, effacé après `dureeAffichage`. Les messages sans durée
 * (avertissements) s'empilent au-dessus, le plus récent en haut, chacun gardé jusqu'à ce qu'on le ferme ; un avertissement
 * identique à un affiché remonte en haut avec son compteur (« ×3 ») au lieu de s'empiler.
 */
export function FournisseurToast(p: { children: ReactNode }): ReactNode {
	const [message, setMessage] = useState('');
	const [visible, setVisible] = useState(false);
	const [persistants, setPersistants] = useState<Persistant[]>([]);
	const minuteur = useRef<ReturnType<typeof setTimeout> | null>(null);
	const suivante = useRef(0);
	const t = useTextes().coquille.toast;

	const afficher = useCallback<Afficher>((m, genre = 'information') => {
		const duree = dureeAffichage(genre);
		if (duree === null) {
			const cle = suivante.current++;
			setPersistants((liste) => {
				const meme = liste.find((x) => x.message === m);
				const autres = liste.filter((x) => x !== meme);
				return [meme === undefined ? { cle, message: m, nombre: 1 } : { ...meme, nombre: meme.nombre + 1 }, ...autres];
			});
			return;
		}
		setMessage(m);
		setVisible(true);
		if (minuteur.current) clearTimeout(minuteur.current);
		minuteur.current = setTimeout(() => setVisible(false), duree);
	}, []);

	useEffect(() => () => {
		if (minuteur.current) clearTimeout(minuteur.current);
	}, []);

	const fermer = (cle: number) => setPersistants((liste) => liste.filter((x) => x.cle !== cle));

	return (
		<ContexteToast.Provider value={afficher}>
			{p.children}
			<ul className={s.pile} aria-label={t.avertissements} aria-live="polite">
				{persistants.map((x) => (
					<li key={x.cle} className={s.avertissement}>
						<span>{x.message}</span>
						{x.nombre > 1 && <span className={s.nombre}>{`×${x.nombre}`}</span>}
						<button type="button" className={s.fermer} aria-label={t.fermerAvertissement} onClick={() => fermer(x.cle)}>
							×
						</button>
					</li>
				))}
			</ul>
			<div role="status" aria-live="polite" className={cx(s.toast, visible && s.on)}>
				{message}
			</div>
		</ContexteToast.Provider>
	);
}

export function useToast(): Afficher {
	return useContext(ContexteToast);
}
