/**
 * Recherche de la palette en deux temps : `ATTENTE_RAPIDE_MS` après la dernière frappe, les mots seuls (`rapide=1`, sans
 * modèle) ; puis, quand la frappe s'est posée (`ATTENTE_COMPLETE_MS` sans frappe), l'appel complet (sens, graphe,
 * reranker s'ils tournent), qui la remplace. Rien sous deux caractères. Toute requête en cours est abandonnée quand le
 * texte, le dossier ou le genre change (AbortController : le service, qui voit la connexion se fermer, s'arrête aussi).
 * Partagée avec la recherche de fiche du panneau Contexte (`RechercheFiche`), sous sa propre clé de remplacement.
 */
import { ROUTES, type ReponseRecherche, type TrouveRechercheVue } from '@mnemo/contrat';
import { useEffect, useState } from 'react';
import { estAbandon } from '../client/api.ts';
import { useClient } from '../client/contexte.tsx';

export const ATTENTE_RAPIDE_MS = 120;
export const ATTENTE_COMPLETE_MS = 350;
export const LONGUEUR_MIN_RECHERCHE = 2;
/** Résultats demandés au moteur (les fiches d'une même fiche se regroupent ensuite). */
export const LIMITE_MOTEUR = 20;

export type GenreMoteur = 'fiche' | 'document';

export type RechercheMoteur = {
	/** Dernière réponse du moteur pour ce texte (mots seuls, puis complète) ; null tant qu'il n'a pas répondu. */
	trouves: TrouveRechercheVue[] | null;
	/** Vrai quand la réponse affichée est celle de l'appel complet. */
	complet: boolean;
	/** Vrai tant qu'un appel est attendu ou en cours. */
	enCours: boolean;
	erreur: string | null;
};

type Etat = { cle: string | null; trouves: TrouveRechercheVue[] | null; complet: boolean; erreur: string | null };

export function useRechercheMoteur(q: string, o: { dossier: string | null; genre: GenreMoteur | null; actif: boolean; remplacement?: string }): RechercheMoteur {
	const { api } = useClient();
	const texte = q.trim();
	const cle = o.actif && texte.length >= LONGUEUR_MIN_RECHERCHE ? JSON.stringify([texte, o.dossier, o.genre]) : null;
	const remplacement = o.remplacement ?? 'palette';
	const [etat, setEtat] = useState<Etat>({ cle: null, trouves: null, complet: false, erreur: null });

	useEffect(() => {
		if (cle === null) return;
		const [texteCle, dossier, genre] = JSON.parse(cle) as [string, string | null, GenreMoteur | null];
		const controleur = new AbortController();
		const params: Record<string, string> = { q: texteCle, limite: String(LIMITE_MOTEUR), ...(dossier ? { dossier } : {}), ...(genre ? { genre } : {}) };
		// clé de remplacement `palette` par défaut (la recherche complète seule) : sa recherche complète précédente est abandonnée
		// par le service, jamais celle d'un autre consommateur (graphe 3D : `graphe` ; panneau Contexte : `fiche`)
		const appeler = (extra: Record<string, string>) =>
			api.lire<ReponseRecherche>(ROUTES.recherche, { ...params, ...extra }, { signal: controleur.signal, ...(extra['rapide'] ? {} : { remplacement }) });
		let complet = false;
		const echec = (e: unknown) => {
			// abandonnée ou remplacée : rien à afficher ; un échec des mots seuls après la réponse complète ne l'efface pas
			if (controleur.signal.aborted || estAbandon(e) || complet) return;
			// un échec laisse la réponse déjà affichée
			const erreur = e instanceof Error ? e.message : String(e);
			setEtat((avant) => ({ cle, trouves: avant.cle === cle ? avant.trouves : null, complet: false, erreur }));
		};
		const rapide = setTimeout(() => {
			appeler({ rapide: '1' }).then((r) => {
				// la réponse complète, arrivée la première, reste
				if (!controleur.signal.aborted && !complet) setEtat({ cle, trouves: r.trouves, complet: false, erreur: null });
			}, echec);
		}, ATTENTE_RAPIDE_MS);
		const entier = setTimeout(() => {
			appeler({}).then((r) => {
				if (controleur.signal.aborted) return;
				complet = true;
				setEtat({ cle, trouves: r.trouves, complet: true, erreur: null });
			}, echec);
		}, ATTENTE_COMPLETE_MS);
		return () => {
			clearTimeout(rapide);
			clearTimeout(entier);
			controleur.abort();
		};
	}, [cle, api, remplacement]);

	const courant = cle !== null && etat.cle === cle ? etat : null;
	return {
		trouves: courant?.trouves ?? null,
		complet: courant?.complet ?? false,
		enCours: cle !== null && !courant?.complet && !courant?.erreur,
		erreur: courant?.erreur ?? null,
	};
}
