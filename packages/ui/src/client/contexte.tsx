/**
 * Contexte du client : l'API, la connexion, le signal « jeton refusé », le cache des ressources et la version de la
 * mémoire (incrémentée à chaque message `memoire` et à chaque réouverture après une coupure).
 */
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Api } from './api.ts';
import { CacheBorne, TAILLE_CACHE_RESSOURCES } from './cache-borne.ts';
import type { Connexion, EtatConnexion } from './connexion.ts';

export type Client = {
	api: Api;
	connexion: Connexion;
	/** Vrai pour le client de démonstration : données fictives, aucun service. */
	fictif: boolean;
	/** Prévenu quand le service refuse le jeton (401). */
	surJetonRefuse(f: () => void): () => void;
};

type ValeurContexte = { client: Client; version: number; cache: CacheBorne };

const ContexteClient = createContext<ValeurContexte | null>(null);

export function FournisseurClient(p: { client: Client; children: ReactNode }): ReactNode {
	const { client } = p;
	const [version, setVersion] = useState(0);
	const cache = useMemo(() => new CacheBorne(TAILLE_CACHE_RESSOURCES), [client]);

	useEffect(() => {
		let precedent: EtatConnexion = client.connexion.etat();
		const finEtat = client.connexion.surEtat((e) => {
			if (e === 'ouverte' && precedent === 'reconnexion') setVersion((v) => v + 1);
			precedent = e;
		});
		const finMessage = client.connexion.surMessage((m) => {
			if (m.type === 'memoire') setVersion((v) => v + 1);
		});
		return () => {
			finEtat();
			finMessage();
		};
	}, [client]);

	const valeur = useMemo(() => ({ client, version, cache }), [client, version, cache]);
	return <ContexteClient.Provider value={valeur}>{p.children}</ContexteClient.Provider>;
}

function useValeur(): ValeurContexte {
	const v = useContext(ContexteClient);
	if (!v) throw new Error('FournisseurClient absent');
	return v;
}

export function useClient(): Client {
	return useValeur().client;
}

export function useVersionMemoire(): number {
	return useValeur().version;
}

/** Dernières données de chaque ressource, par clé : une vue qui revient retrouve ses données sans attendre. */
export function useCacheRessources(): CacheBorne {
	return useValeur().cache;
}
