/**
 * Un geste de la page Entraîner : le geste en cours (son bouton garde son libellé, avec le reflet) et le refus du service,
 * dit à côté de sa cause (`ou` : le bloc qui l'affiche), effacé au geste suivant.
 */
import { useCallback, useRef, useState } from 'react';
import { useTextes } from '../../../langue/langue.tsx';

export type Geste = {
	enCours: string | null;
	refus: { ou: string; message: string } | null;
	/**
	 * Lance `f` sous le nom `ou` ; rend vrai s'il a réussi. Un geste déjà en vol ignore les suivants (un double clic ne lance
	 * pas deux tâches, dont la seconde serait refusée par le service).
	 */
	agir(ou: string, f: () => Promise<unknown>): Promise<boolean>;
	effacer(): void;
};

export function useGeste(): Geste {
	const serviceMuet = useTextes().memoire.entrainer.serviceMuet;
	const [enCours, setEnCours] = useState<string | null>(null);
	const [refus, setRefus] = useState<Geste['refus']>(null);
	const enVol = useRef(false);
	const agir = useCallback(async (ou: string, f: () => Promise<unknown>) => {
		if (enVol.current) return false;
		enVol.current = true;
		setRefus(null);
		setEnCours(ou);
		try {
			await f();
			return true;
		} catch (e) {
			setRefus({ ou, message: e instanceof Error && e.message ? e.message : serviceMuet });
			return false;
		} finally {
			enVol.current = false;
			setEnCours(null);
		}
	}, [serviceMuet]);
	const effacer = useCallback(() => setRefus(null), []);
	return { enCours, refus, agir, effacer };
}
