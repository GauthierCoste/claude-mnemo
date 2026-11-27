/** Annonce d'une écriture faite, à chaque écriture de l'interface : son succès en information, chaque avertissement à part. */
import type { AvecAvertissements } from '@mnemo/commun';
import { useCallback } from 'react';
import { lignesAvertissements } from '../../client/avertissements.ts';
import { useTextes } from '../../langue/langue.tsx';
import { useToast } from '../Toast.tsx';

/** `succes` (null : rien à dire du succès) en information ; les avertissements de chaque réponse (`avertissementsDe`), gardés jusqu'à leur fermeture. */
export function useAnnonceEcriture(): (succes: string | null, ...avertissements: AvecAvertissements[]) => void {
	const toast = useToast();
	const t = useTextes().commun;
	return useCallback(
		(succes: string | null, ...avertissements: AvecAvertissements[]) => {
			if (succes !== null) toast(succes);
			for (const ligne of avertissements.flatMap((a) => lignesAvertissements(a, t))) toast(ligne, 'avertissement');
		},
		[toast, t],
	);
}
