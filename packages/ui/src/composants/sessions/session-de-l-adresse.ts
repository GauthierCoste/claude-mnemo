/**
 * Session demandée par le fragment de l'adresse (`#session=<id>`, `fragment.ts`) : au chargement (`initiale`, lue par
 * `main.tsx` avant d'effacer le fragment) et à chaque `hashchange` (fragment lu puis effacé). Elle est ouverte comme par un
 * clic sur sa carte (`ouvrirSession` : la vue Sessions, choisie ; l'archiviste, dans son tiroir). Pas encore dans la liste :
 * attendue jusqu'à la réception de la liste du WebSocket, puis quelques secondes (le message de sa création peut suivre) ;
 * toujours absente, oubliée sans erreur. Une demande nouvelle remplace la précédente.
 */
import { useEffect, useState } from 'react';
import { lireSessionDuFragment } from '../../client/fragment.ts';
import { useSessions, useSessionsRecues } from '../../client/hooks.ts';
import { effacerJetonDeLAdresse } from '../../client/jeton.ts';
import { useNavigation } from '../../navigation.tsx';

/** Attente d'une session absente de la liste reçue. */
export const ATTENTE_SESSION_MS = 5_000;

type Demande = { id: string; numero: number };

export function useSessionDeLAdresse(initiale: string | null): void {
	const { ouvrirSession } = useNavigation();
	const sessions = useSessions();
	const recues = useSessionsRecues();
	const [demande, setDemande] = useState<Demande | null>(() => (initiale === null ? null : { id: initiale, numero: 0 }));

	useEffect(() => {
		const surChangement = () => {
			if (!location.hash) return;
			const id = lireSessionDuFragment(location.hash);
			effacerJetonDeLAdresse(history, location.href);
			if (id !== null) setDemande((d) => ({ id, numero: (d?.numero ?? 0) + 1 }));
		};
		window.addEventListener('hashchange', surChangement);
		return () => window.removeEventListener('hashchange', surChangement);
	}, []);

	const trouvee = demande ? (sessions.find((x) => x.id === demande.id) ?? null) : null;
	useEffect(() => {
		if (!demande || !trouvee) return;
		setDemande((d) => (d === demande ? null : d));
		ouvrirSession(trouvee);
	}, [demande, trouvee, ouvrirSession]);

	// Liste reçue sans elle : le délai court une fois par demande (les messages suivants ne le relancent pas).
	useEffect(() => {
		if (!demande || !recues) return;
		const t = setTimeout(() => setDemande((d) => (d === demande ? null : d)), ATTENTE_SESSION_MS);
		return () => clearTimeout(t);
	}, [demande, recues]);
}
