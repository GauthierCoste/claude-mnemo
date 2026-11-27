/** Gestes sur une session (pause, reprise, bilan, abandon) : un appel au service ; un refus est dit en toast. */
import { ROUTES } from '@mnemo/contrat';
import { useState } from 'react';
import { ErreurApi } from '../../client/api.ts';
import { useClient } from '../../client/contexte.tsx';
import { avecId } from '../../client/hooks.ts';
import { useToast } from '../Toast.tsx';
import { useTextes } from '../../langue/langue.tsx';

export type ActionSession = 'pause' | 'reprise' | 'bilan' | 'abandon';

export function useActionSession(): { enCours: boolean; agir(id: string, action: ActionSession): Promise<void> } {
	const { api } = useClient();
	const toast = useToast();
	const t = useTextes().sessions;
	const [enCours, setEnCours] = useState(false);
	return {
		enCours,
		async agir(id, action) {
			setEnCours(true);
			try {
				await api.envoyer(avecId(ROUTES[action], id), undefined);
			} catch (e) {
				toast(e instanceof ErreurApi ? e.message : t.actionImpossible);
			} finally {
				setEnCours(false);
			}
		},
	};
}
