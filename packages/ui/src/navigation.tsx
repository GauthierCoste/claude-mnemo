/**
 * Navigation sans routeur : vue affichée et onglet de la vue Mémoire, tiroir de l'archiviste (et son terminal en grand),
 * palette, et diffusion des actions du clavier aux vues (la grille des sessions zoome sur ⌥n, dézoome sur ⌥0 / Échap…), et
 * demandes d'ouvrir une fiche dans Mémoire › Fichiers ou une session dans Sessions depuis une autre vue.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { SessionVue } from '@mnemo/contrat';
import type { Projet } from './palette/resultats.ts';
import { destinationDeSession, type DestinationSession } from './sessions/groupes.ts';
import type { Action } from './raccourcis.ts';

export type Vue = 'sessions' | 'memoire' | 'reglages';

/** Onglets de la vue Mémoire, dans l'ordre de la barre : Archiviste (par défaut), Fichiers, Graph 3D, Entraîner. */
export type OngletMemoire = 'archiviste' | 'fichiers' | 'graphe' | 'entrainer';

export type Navigation = {
	vue: Vue;
	/** Change de vue ; retenu si la vue affichée a une garde de sortie qui refuse (modifications non enregistrées). */
	aller(vue: Vue): void;
	/**
	 * Garde de sortie de la vue affichée (Réglages : modifications non enregistrées) : `vrai` retient tout changement de vue,
	 * qui attend dans `sortieRetenue` jusqu'à `poursuivreSortie` (la faire) ou `annulerSortie` (rester). null : aucune garde.
	 */
	definirGardeSortie(garde: (() => boolean) | null): void;
	sortieRetenue: boolean;
	poursuivreSortie(): void;
	annulerSortie(): void;
	/** Onglet de la vue Mémoire (gardé quand on la quitte). */
	ongletMemoire: OngletMemoire;
	choisirOngletMemoire(onglet: OngletMemoire): void;
	/** Passe à Mémoire › Archiviste, tiroir fermé : le terminal de l'archiviste s'affiche dans la page. */
	ouvrirPageArchiviste(): void;
	tiroirOuvert: boolean;
	/** Fermer le tiroir le réduit aussi : rouvert, il revient à sa taille de tiroir. */
	ouvrirTiroir(ouvert?: boolean): void;
	/** Terminal de l'archiviste en grand (tiroir ouvert et agrandi). */
	archivisteGrand: boolean;
	/** Agrandit (en ouvrant le tiroir) ou réduit l'archiviste ; sans argument, bascule. */
	agrandirArchiviste(grand?: boolean): void;
	paletteOuverte: boolean;
	ouvrirPalette(ouverte?: boolean): void;
	/** Diffuse une action du clavier aux vues abonnées. */
	diffuser(a: Action): void;
	surAction(f: (a: Action) => void): () => void;
	/** Dernière fiche demandée depuis une autre vue ; `numero` distingue deux demandes de la même fiche. */
	ficheDemandee: { chemin: string; numero: number } | null;
	/** Passe à la vue Mémoire, onglet Fichiers, sur cette fiche. */
	ouvrirFiche(chemin: string): void;
	/** Dernière session demandée pour la grille ou le tiroir des terminées ; `zoom` : en grand dans la grille. */
	sessionDemandee: { id: string; destination: Exclude<DestinationSession, 'archiviste'>; numero: number; zoom: boolean } | null;
	/**
	 * Ouvre cette session là où `destinationDeSession` la range : la vue Sessions, sur sa carte (`zoom` : en grand) ou sur
	 * sa ligne du tiroir des terminées ; l'archiviste vivant, dans son tiroir. Les appelants passent par `useOuvrirSession`.
	 */
	ouvrirSession(session: SessionVue, o?: { zoom?: boolean }): void;
	/** Projet au premier plan (filtre « Ce projet » de la palette) : de la session choisie dans Sessions, de la fiche ouverte dans Mémoire › Fichiers ; null sans projet. */
	projetPremierPlan: Projet | null;
	definirProjetPremierPlan(p: Projet | null): void;
	/** Session choisie dans Sessions, tant que la vue est affichée (« cette session » du menu des modèles) ; null sinon. */
	sessionPremierPlan: string | null;
	definirSessionPremierPlan(id: string | null): void;
};

const ContexteNavigation = createContext<Navigation | null>(null);

/** `tiroirInitial`, `paletteInitiale` : mode démo (`&archiviste=1`, `&palette=…`), pour les captures d'écran. */
export function FournisseurNavigation(p: {
	children: ReactNode;
	vueInitiale?: Vue;
	ongletMemoireInitial?: OngletMemoire;
	tiroirInitial?: boolean;
	paletteInitiale?: boolean;
}): ReactNode {
	const [vue, setVue] = useState<Vue>(p.vueInitiale ?? 'sessions');
	const [ongletMemoire, choisirOngletMemoire] = useState<OngletMemoire>(p.ongletMemoireInitial ?? 'archiviste');
	const [tiroir, setTiroir] = useState({ ouvert: p.tiroirInitial ?? false, grand: false });
	const [paletteOuverte, setPalette] = useState(p.paletteInitiale ?? false);
	const [ficheDemandee, setFicheDemandee] = useState<Navigation['ficheDemandee']>(null);
	const [sessionDemandee, setSessionDemandee] = useState<Navigation['sessionDemandee']>(null);
	const [projetPremierPlan, setProjetPremierPlan] = useState<Projet | null>(null);
	const definirProjetPremierPlan = useCallback(
		(p: Projet | null) => setProjetPremierPlan((avant) => (avant?.projet === p?.projet && avant?.position === p?.position ? avant : p)),
		[],
	);
	const [sessionPremierPlan, definirSessionPremierPlan] = useState<string | null>(null);
	const abonnes = useRef(new Set<(a: Action) => void>());
	const garde = useRef<(() => boolean) | null>(null);
	const [sortie, setSortie] = useState<{ effet: () => void } | null>(null);
	/** Quitte la vue affichée par `effet`, sauf si sa garde le retient : il attend alors une réponse dans la page. */
	const quitter = useCallback((effet: () => void) => {
		if (garde.current?.() === true) setSortie({ effet });
		else effet();
	}, []);
	const definirGardeSortie = useCallback((g: (() => boolean) | null) => {
		garde.current = g;
		if (g === null) setSortie(null);
	}, []);
	const sortieCourante = useRef(sortie);
	sortieCourante.current = sortie;
	const poursuivreSortie = useCallback(() => {
		const retenue = sortieCourante.current;
		setSortie(null);
		retenue?.effet();
	}, []);
	const annulerSortie = useCallback(() => setSortie(null), []);
	const vueCourante = useRef(vue);
	vueCourante.current = vue;
	const aller = useCallback((v: Vue) => (v === vueCourante.current ? setVue(v) : quitter(() => setVue(v))), [quitter]);

	const ouvrirTiroir = useCallback(
		(o?: boolean) =>
			setTiroir((t) => {
				const ouvert = o ?? !t.ouvert;
				return { ouvert, grand: ouvert && t.grand };
			}),
		[],
	);
	const agrandirArchiviste = useCallback(
		(g?: boolean) =>
			setTiroir((t) => {
				const grand = g ?? !(t.ouvert && t.grand);
				return { ouvert: t.ouvert || grand, grand };
			}),
		[],
	);
	const tiroirOuvert = tiroir.ouvert;
	const archivisteGrand = tiroir.ouvert && tiroir.grand;
	const ouvrirPalette = useCallback((o?: boolean) => setPalette((t) => o ?? !t), []);
	const diffuser = useCallback((a: Action) => {
		for (const f of [...abonnes.current]) f(a);
	}, []);
	const surAction = useCallback((f: (a: Action) => void) => {
		abonnes.current.add(f);
		return () => void abonnes.current.delete(f);
	}, []);

	const ouvrirFiche = useCallback(
		(chemin: string) =>
			quitter(() => {
				setFicheDemandee((f) => ({ chemin, numero: (f?.numero ?? 0) + 1 }));
				setVue('memoire');
			}),
		[quitter],
	);
	const ouvrirPageArchiviste = useCallback(
		() =>
			quitter(() => {
				setTiroir({ ouvert: false, grand: false });
				choisirOngletMemoire('archiviste');
				setVue('memoire');
			}),
		[quitter],
	);
	const ouvrirSession = useCallback(
		(session: SessionVue, o?: { zoom?: boolean }) => {
			const destination = destinationDeSession(session);
			if (destination === 'archiviste') {
				ouvrirTiroir(true);
				return;
			}
			quitter(() => {
				setSessionDemandee((x) => ({ id: session.id, destination, numero: (x?.numero ?? 0) + 1, zoom: o?.zoom ?? false }));
				setVue('sessions');
			});
		},
		[quitter, ouvrirTiroir],
	);

	const valeur = useMemo(
		() => ({
			vue,
			aller,
			definirGardeSortie,
			sortieRetenue: sortie !== null,
			poursuivreSortie,
			annulerSortie,
			ongletMemoire,
			choisirOngletMemoire,
			ouvrirPageArchiviste,
			tiroirOuvert,
			ouvrirTiroir,
			archivisteGrand,
			agrandirArchiviste,
			paletteOuverte,
			ouvrirPalette,
			diffuser,
			surAction,
			ficheDemandee,
			ouvrirFiche,
			sessionDemandee,
			ouvrirSession,
			projetPremierPlan,
			definirProjetPremierPlan,
			sessionPremierPlan,
			definirSessionPremierPlan,
		}),
		[
			vue,
			aller,
			definirGardeSortie,
			sortie,
			poursuivreSortie,
			annulerSortie,
			ongletMemoire,
			ouvrirPageArchiviste,
			tiroirOuvert,
			ouvrirTiroir,
			archivisteGrand,
			agrandirArchiviste,
			paletteOuverte,
			ouvrirPalette,
			diffuser,
			surAction,
			ficheDemandee,
			ouvrirFiche,
			sessionDemandee,
			ouvrirSession,
			projetPremierPlan,
			definirProjetPremierPlan,
			sessionPremierPlan,
			definirSessionPremierPlan,
		],
	);
	return <ContexteNavigation.Provider value={valeur}>{p.children}</ContexteNavigation.Provider>;
}

export function useNavigation(): Navigation {
	const n = useContext(ContexteNavigation);
	if (!n) throw new Error('FournisseurNavigation absent');
	return n;
}

/** Abonne une vue aux actions du clavier tant qu'elle est montée. */
export function useSurAction(f: (a: Action) => void): void {
	const { surAction } = useNavigation();
	const courant = useRef(f);
	courant.current = f;
	useEffect(() => surAction((a) => courant.current(a)), [surAction]);
}
