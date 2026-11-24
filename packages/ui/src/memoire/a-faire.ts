/**
 * Ce qui attend l'utilisateur dans Mémoire › Archiviste (« À faire ») : les propositions du fil du jour et les lots
 * d'informations proposés par l'archiviste, à arbitrer ; les fiches sources « à traiter » et les dossiers non rattachés.
 * Le service n'expose pas de contradictions : aucun groupe pour elles. Le total fait la pastille de Mémoire, le compteur
 * de l'onglet Archiviste et le « N à faire » du tiroir.
 */
import type { DocumentVue, DossierNonRattacheVue, LotVue } from '@mnemo/contrat';
import { useMemo } from 'react';
import { useAujourdhui, useDocuments, useFil, useLots } from '../client/hooks.ts';
import { propositionsDuFil, type Proposition } from '../archiviste/propositions.ts';

/**
 * `aTraiter` : la liste du service (bornée) ; `totalATraiter` : toutes les fiches à traiter, listées ou non ; `dossiers` :
 * les dossiers non rattachés ; `avertissements` : ce que le service n'a pas pu lire.
 */
export type AFaire = {
	propositions: readonly Proposition[];
	/** Lots d'informations proposés par l'archiviste (fusions, suppressions, confirmations), à valider ou rejeter. */
	lots: readonly LotVue[];
	/** Relit les lots (après une décision : le service diffuse aussi `lots`). */
	rechargerLots(): void;
	aTraiter: readonly DocumentVue[];
	totalATraiter: number;
	dossiers: readonly DossierNonRattacheVue[];
	avertissements: readonly string[];
	total: number;
};

export function useAFaire(): AFaire {
	const fil = useFil(useAujourdhui());
	const documents = useDocuments(false);
	const lotsLus = useLots();
	const rechargerLots = lotsLus.recharger;
	return useMemo(() => {
		const lots = lotsLus.donnees ?? [];
		const propositions = fil.donnees ? propositionsDuFil(fil.donnees) : [];
		const aTraiter = documents.donnees?.aTraiter ?? [];
		const totalATraiter = documents.donnees?.totalATraiter ?? 0;
		const dossiers = documents.donnees?.dossiersNonRattaches ?? [];
		const avertissements = documents.donnees?.avertissements ?? [];
		return { propositions, lots, rechargerLots, aTraiter, totalATraiter, dossiers, avertissements, total: propositions.length + lots.length + totalATraiter + dossiers.length };
	}, [fil.donnees, documents.donnees, lotsLus.donnees, rechargerLots]);
}
