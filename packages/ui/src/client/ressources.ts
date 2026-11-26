/**
 * Cache minimal des ressources, sans bibliothèque : une clé, une fonction de chargement ; les ressources `memoire`
 * se rechargent quand la mémoire change, en gardant leurs anciennes données jusqu'aux nouvelles (pas de clignotement).
 * Les lecteurs d'une même clé partagent la lecture en cours et `recharger` : une seule requête pour tous.
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ErreurApi, estAbandon } from './api.ts';
import type { CacheBorne } from './cache-borne.ts';
import { useCacheRessources, useVersionMemoire } from './contexte.tsx';

/** Une lecture en cours, partagée par ses lecteurs ; abandonnée quand le dernier s'en va avant la réponse. */
type Lecture = { promesse: Promise<unknown>; controleur: AbortController; lecteurs: number };

/**
 * Par cache (donc par client) : les lectures en cours, le nombre de demandes `recharger` de chaque clé, le nombre de données
 * publiées sans lecture (`publierRessource`), avec leurs écouteurs.
 */
type Partage = { lectures: Map<string, Lecture>; demandes: Map<string, number>; publiees: Map<string, number>; ecouteurs: Map<string, Set<() => void>> };
const partages = new WeakMap<CacheBorne, Partage>();

function partageDe(cache: CacheBorne): Partage {
	let p = partages.get(cache);
	if (p === undefined) {
		p = { lectures: new Map(), demandes: new Map(), publiees: new Map(), ecouteurs: new Map() };
		partages.set(cache, p);
	}
	return p;
}

const SEPARATEUR = '\u0000';
const idLecture = (cle: string, version: number, demandes: number): string => [cle, version, demandes].join(SEPARATEUR);

/** Retire l'entrée de `cle` quand elle n'a plus de lecteur ni de lecture en cours : la table ne garde que les clés lues. */
function nettoyer(p: Partage, cle: string): void {
	if ((p.ecouteurs.get(cle)?.size ?? 0) > 0) return;
	if ([...p.lectures.keys()].some((id) => id.startsWith(`${cle}${SEPARATEUR}`))) return;
	p.ecouteurs.delete(cle);
	p.demandes.delete(cle);
	p.publiees.delete(cle);
}

/**
 * Données de `cle` rendues par une écriture (la vue relue qu'elle renvoie) : elles remplacent celles du cache et de tous ses
 * lecteurs montés, sans nouvelle lecture.
 */
export function publierRessource(cache: CacheBorne, cle: string, donnees: unknown): void {
	const p = partageDe(cache);
	cache.set(cle, donnees);
	p.publiees.set(cle, (p.publiees.get(cle) ?? 0) + 1);
	for (const f of [...(p.ecouteurs.get(cle) ?? [])]) f();
}

/** Ce que le partage d'un cache suit : clés écoutées, clés rechargées, lectures en cours (pour l'observer). */
export function etatPartage(cache: CacheBorne): { ecouteurs: number; demandes: number; lectures: number } {
	const p = partageDe(cache);
	return { ecouteurs: p.ecouteurs.size, demandes: p.demandes.size, lectures: p.lectures.size };
}

/** Rejoint la lecture en cours de `id`, ou la commence ; `quitter` la rend, et l'abandonne si plus personne ne l'attend. */
function rejoindre(p: Partage, cle: string, id: string, charger: (signal: AbortSignal) => Promise<unknown>): { promesse: Promise<unknown>; quitter(): void } {
	let lecture = p.lectures.get(id);
	if (lecture === undefined) {
		const controleur = new AbortController();
		const promesse = charger(controleur.signal);
		const nouvelle: Lecture = { promesse, controleur, lecteurs: 0 };
		const finir = () => {
			if (p.lectures.get(id) === nouvelle) p.lectures.delete(id);
			nettoyer(p, cle);
		};
		promesse.then(finir, finir);
		p.lectures.set(id, nouvelle);
		lecture = nouvelle;
	}
	const courante = lecture;
	courante.lecteurs++;
	let parti = false;
	return {
		promesse: courante.promesse,
		quitter() {
			if (parti) return;
			parti = true;
			courante.lecteurs--;
			if (courante.lecteurs === 0 && p.lectures.get(id) === courante) {
				p.lectures.delete(id);
				courante.controleur.abort();
			}
			nettoyer(p, cle);
		},
	};
}

/** `statut` : celui de la réponse HTTP en erreur (`ErreurApi`), sinon null (pas d'erreur, ou erreur hors du service). */
export type Ressource<T> = { donnees: T | undefined; erreur: string | null; statut: number | null; chargement: boolean; recharger(): void };

type Etat<T> = { cle: string | null; donnees: T | undefined; erreur: string | null; statut: number | null; chargement: boolean };

/** `charger` reçoit un signal abandonné quand sa réponse devient caduque (clé changée, rechargement, démontage). */
export function useRessource<T>(cle: string | null, charger: (signal: AbortSignal) => Promise<T>, o?: { memoire?: boolean }): Ressource<T> {
	const cache = useCacheRessources();
	const versionMemoire = useVersionMemoire();
	const version = o?.memoire ? versionMemoire : 0;
	const partage = partageDe(cache);
	const cleDemandes = cle ?? '';
	const ecouter = useCallback(
		(f: () => void) => {
			const ensemble = partage.ecouteurs.get(cleDemandes) ?? new Set<() => void>();
			partage.ecouteurs.set(cleDemandes, ensemble);
			ensemble.add(f);
			return () => {
				ensemble.delete(f);
				nettoyer(partage, cleDemandes);
			};
		},
		[partage, cleDemandes],
	);
	const demandes = useSyncExternalStore(ecouter, () => partage.demandes.get(cleDemandes) ?? 0);
	const publiees = useSyncExternalStore(ecouter, () => partage.publiees.get(cleDemandes) ?? 0);
	const chargerCourant = useRef(charger);
	chargerCourant.current = charger;
	const sequence = useRef(0);

	const initial = (c: string | null): Etat<T> => ({ cle: c, donnees: c === null ? undefined : (cache.get(c) as T | undefined), erreur: null, statut: null, chargement: c !== null });
	const [etat, setEtat] = useState<Etat<T>>(() => initial(cle));

	// Clé changée : les données de l'ancienne clé ne sont jamais montrées pour la nouvelle.
	let courant = etat;
	if (etat.cle !== cle) {
		courant = initial(cle);
		setEtat(courant);
	}

	useEffect(() => {
		if (cle === null) return;
		const numero = ++sequence.current;
		const lecture = rejoindre(partage, cle, idLecture(cle, version, demandes), (signal) => chargerCourant.current(signal));
		setEtat((e) => (e.cle === cle && e.chargement && e.erreur === null ? e : { ...e, cle, chargement: true, erreur: null, statut: null }));
		lecture.promesse.then(
			(brut) => {
				if (numero !== sequence.current) return;
				const donnees = brut as T;
				cache.set(cle, donnees);
				setEtat({ cle, donnees, erreur: null, statut: null, chargement: false });
			},
			(erreur: unknown) => {
				if (numero !== sequence.current) return;
				// abandonnée (remplacée par une plus récente) : pas une erreur, les données affichées restent
				if (estAbandon(erreur)) {
					setEtat((e) => ({ ...e, cle, chargement: false }));
					return;
				}
				setEtat((e) => ({
					...e,
					cle,
					erreur: erreur instanceof Error ? erreur.message : String(erreur),
					statut: erreur instanceof ErreurApi ? erreur.statut : null,
					chargement: false,
				}));
			},
		);
		// Une demande plus récente (ou le démontage) rend la réponse en cours caduque pour ce lecteur.
		return () => {
			sequence.current++;
			lecture.quitter();
		};
	}, [cle, version, demandes, cache, partage]);

	// données publiées par une écriture : prises dans le cache, sans lecture ni erreur
	useEffect(() => {
		if (cle === null || publiees === 0) return;
		setEtat((e) => ({ ...e, cle, donnees: cache.get(cle) as T, erreur: null, statut: null }));
	}, [cle, publiees, cache]);

	const recharger = useCallback(() => {
		partage.demandes.set(cleDemandes, (partage.demandes.get(cleDemandes) ?? 0) + 1);
		for (const f of [...(partage.ecouteurs.get(cleDemandes) ?? [])]) f();
	}, [partage, cleDemandes]);
	return { donnees: courant.donnees, erreur: courant.erreur, statut: courant.statut, chargement: courant.chargement, recharger };
}
