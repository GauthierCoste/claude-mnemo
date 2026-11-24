/**
 * Navigation dans la vue Mémoire : onglet affiché (tenu par la navigation générale : Archiviste, Fichiers, Graph 3D), fiche
 * ouverte dans Fichiers, et demande de centrage du graphe sur une fiche (« Voir dans le graphe »). Une fiche en cours d'édition pose une garde : ouvrir une
 * autre fiche, d'où que vienne la demande (arbre, lien, graphe, Sessions), lui demande d'abord son avis.
 */
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigation, type OngletMemoire } from '../../navigation.tsx';

/**
 * Garde de la fiche ouverte : vraie si elle retient le départ (modifications non enregistrées) ; elle appellera `suite`
 * si l'utilisateur enregistre ou abandonne ses modifications.
 */
export type GardeFiche = (suite: () => void) => boolean;

export type NavigationMemoire = {
	onglet: OngletMemoire;
	choisirOnglet(onglet: OngletMemoire): void;
	/** Chemin de la fiche ouverte dans Fichiers. */
	fiche: string | null;
	/** Ouvre une fiche dans l'onglet Fichiers (après accord de la garde, s'il y en a une). */
	ouvrirFiche(chemin: string): void;
	/** Pose la garde de la fiche ouverte ; rend de quoi la retirer. */
	poserGarde(garde: GardeFiche): () => void;
	/** Dernière demande de centrage du graphe ; `numero` distingue deux demandes sur la même fiche. */
	centrage: { chemin: string; numero: number } | null;
	/** Passe au graphe et le centre sur la fiche. */
	voirDansLeGraphe(chemin: string): void;
};

const Contexte = createContext<NavigationMemoire | null>(null);

export function FournisseurMemoire(p: { children: ReactNode; ficheInitiale?: string }): ReactNode {
	const { ongletMemoire: onglet, choisirOngletMemoire: choisirOnglet } = useNavigation();
	const [fiche, setFiche] = useState<string | null>(p.ficheInitiale ?? null);
	const [centrage, setCentrage] = useState<NavigationMemoire['centrage']>(null);

	const garde = useRef<GardeFiche | null>(null);
	const ficheCourante = useRef(fiche);
	ficheCourante.current = fiche;

	const ouvrirFiche = useCallback((chemin: string) => {
		choisirOnglet('fichiers');
		if (chemin === ficheCourante.current) return;
		const aller = () => {
			ficheCourante.current = chemin;
			setFiche(chemin);
		};
		if (garde.current?.(aller)) return;
		aller();
	}, [choisirOnglet]);
	const poserGarde = useCallback((g: GardeFiche) => {
		garde.current = g;
		return () => {
			if (garde.current === g) garde.current = null;
		};
	}, []);
	const voirDansLeGraphe = useCallback((chemin: string) => {
		setCentrage((c) => ({ chemin, numero: (c?.numero ?? 0) + 1 }));
		choisirOnglet('graphe');
	}, [choisirOnglet]);

	const valeur = useMemo(
		() => ({ onglet, choisirOnglet, fiche, ouvrirFiche, poserGarde, centrage, voirDansLeGraphe }),
		[onglet, choisirOnglet, fiche, ouvrirFiche, poserGarde, centrage, voirDansLeGraphe],
	);
	return <Contexte.Provider value={valeur}>{p.children}</Contexte.Provider>;
}

export function useNavigationMemoire(): NavigationMemoire {
	const n = useContext(Contexte);
	if (!n) throw new Error('FournisseurMemoire absent');
	return n;
}
