/**
 * Geste « Lier à Mnemo » d'un moteur, le même partout (Réglages › Branchements, Nouvelle session) : la route
 * `moteurLier` (`useLierMoteur`, qui publie la vue relue des moteurs), un toast quand le moteur est lié, et ce que la
 * liaison laisse à dire : les étapes laissées (déclaration de l'utilisateur) ou en échec, ou le refus du service.
 */
import type { IdMoteur } from '@mnemo/commun';
import type { EtapeLiaisonVue, LiaisonMoteurVue } from '@mnemo/contrat';
import { useCallback, useState } from 'react';
import { ErreurApi } from '../../client/api.ts';
import { useLierMoteur } from '../../client/hooks.ts';
import { useToast } from '../Toast.tsx';

/** Ce que la dernière liaison a laissé à dire ; `alerte` : un échec (à montrer en `role="alert"`). */
type RetourLiaison = { alerte: boolean; messages: string[] };

function retourDe(l: LiaisonMoteurVue): RetourLiaison | null {
	const etapes = [l.mcp, l.hooks].filter((e): e is EtapeLiaisonVue => e !== undefined && (e.resultat === 'laisse' || e.resultat === 'echec'));
	if (l.lie && etapes.length === 0) return null;
	return { alerte: !l.ok, messages: etapes.length > 0 ? etapes.map((e) => e.message) : ['Liaison incomplète.'] };
}

/** `moteur` : son nom, pour le toast et le motif d'un échec sans réponse du service. */
export function useLiaisonMoteur(id: IdMoteur, moteur: string): { enCours: boolean; retour: RetourLiaison | null; lier(): Promise<void>; effacer(): void } {
	const toast = useToast();
	const lierMoteur = useLierMoteur();
	const [enCours, setEnCours] = useState(false);
	const [retour, setRetour] = useState<RetourLiaison | null>(null);
	const lier = useCallback(async () => {
		setEnCours(true);
		setRetour(null);
		try {
			const l = await lierMoteur(id);
			if (l.lie) toast(`${moteur} lié à Mnemo.`);
			setRetour(retourDe(l));
		} catch (e) {
			setRetour({ alerte: true, messages: [e instanceof ErreurApi ? e.message : `Liaison de ${moteur} impossible.`] });
		} finally {
			setEnCours(false);
		}
	}, [id, moteur, lierMoteur, toast]);
	const effacer = useCallback(() => setRetour(null), []);
	return { enCours, retour, lier, effacer };
}
