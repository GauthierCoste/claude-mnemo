/** Ouvrir une session par son id, depuis tout point d'entrée (fiche, commit, palette) : relue au service, puis `ouvrirSession`. */
import { ROUTES, type SessionVue } from '@mnemo/contrat';
import { useCallback } from 'react';
import { ErreurApi } from '../../client/api.ts';
import { useClient } from '../../client/contexte.tsx';
import { avecId } from '../../client/hooks.ts';
import { useNavigation } from '../../navigation.tsx';
import { useToast } from '../Toast.tsx';

/** La session est lue au service (terminée comprise) ; introuvable ou illisible : le motif en toast, rien d'autre n'est ouvert. */
export function useOuvrirSession(): (id: string, o?: { zoom?: boolean }) => void {
	const { api } = useClient();
	const { ouvrirSession } = useNavigation();
	const toast = useToast();
	return useCallback(
		(id: string, o?: { zoom?: boolean }) => {
			api.lire<{ session: SessionVue }>(avecId(ROUTES.session, id)).then(
				(r) => ouvrirSession(r.session, o),
				(e: unknown) => toast(e instanceof ErreurApi ? e.message : 'Session illisible.'),
			);
		},
		[api, ouvrirSession, toast],
	);
}
