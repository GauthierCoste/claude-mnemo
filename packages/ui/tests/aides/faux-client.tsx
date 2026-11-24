/** Faux client pour les tests de composants : une API à réponses fixées et une connexion pilotée à la main. */
import { demandeTout as demandeToutCommun } from '@mnemo/commun';
import type { MessageClient, MessageServeur } from '@mnemo/contrat';
import { act, render, type RenderResult } from '@testing-library/react';
import type { ReactElement } from 'react';
import { vi } from 'vitest';
import { ErreurApi, type Api } from '../../src/client/api.ts';
import type { Connexion, EtatConnexion, FluxTerminal } from '../../src/client/connexion.ts';
import { FournisseurClient, type Client } from '../../src/client/contexte.tsx';

/** Vrai si une fausse route reçoit les paramètres qui demandent la liste entière. */
export const demandeTout = (params: Record<string, string> | undefined): boolean => demandeToutCommun((cle) => params?.[cle]);

export type FausseConnexion = Connexion & {
	envoyes: MessageClient[];
	emettre(m: MessageServeur): void;
	passerA(e: EtatConnexion): void;
};

export function fausseConnexion(etatInitial: EtatConnexion = 'ouverte'): FausseConnexion {
	let etat = etatInitial;
	const surEtats = new Set<(e: EtatConnexion) => void>();
	const surMessages = new Set<(m: MessageServeur) => void>();
	const abonnes = new Map<string, Set<(m: FluxTerminal) => void>>();
	const envoyes: MessageClient[] = [];
	return {
		envoyes,
		etat: () => etat,
		surEtat(f) {
			surEtats.add(f);
			return () => void surEtats.delete(f);
		},
		surMessage(f) {
			surMessages.add(f);
			return () => void surMessages.delete(f);
		},
		envoyer(m) {
			if (etat !== 'ouverte') return false;
			envoyes.push(m);
			return true;
		},
		abonner(session, f) {
			const ensemble = abonnes.get(session) ?? new Set();
			abonnes.set(session, ensemble);
			ensemble.add(f);
			return () => void ensemble.delete(f);
		},
		fermer() {},
		emettre(m) {
			for (const f of [...surMessages]) f(m);
			if (m.type === 'sortie' || m.type === 'relecture' || m.type === 'retard') for (const f of abonnes.get(m.session) ?? []) f(m);
		},
		passerA(e) {
			etat = e;
			for (const f of [...surEtats]) f(e);
		},
	};
}

type Reponse = unknown | ((params: Record<string, string> | undefined, corps: unknown) => unknown);

export type FauxClient = {
	client: Client;
	connexion: FausseConnexion;
	api: { lire: ReturnType<typeof vi.fn>; envoyer: ReturnType<typeof vi.fn>; remplacer: ReturnType<typeof vi.fn>; supprimer: ReturnType<typeof vi.fn>; deposer: ReturnType<typeof vi.fn> };
	refuserJeton(): void;
};

/** `reponses` : par chemin d'API (`DELETE <chemin>` pour `supprimer`, `PUT <chemin>` pour `remplacer`), une valeur ou une fonction ; chemin absent → ErreurApi 404. */
export function creerFauxClient(reponses: Record<string, Reponse> = {}, etat: EtatConnexion = 'ouverte'): FauxClient {
	const connexion = fausseConnexion(etat);
	const refus = new Set<() => void>();
	const repondre = async (chemin: string, params: Record<string, string> | undefined, corps: unknown) => {
		if (!(chemin in reponses)) throw new ErreurApi(`Route inconnue : ${chemin}`, 404);
		const r = reponses[chemin];
		return typeof r === 'function' ? (r as (p: unknown, c: unknown) => unknown)(params, corps) : structuredClone(r);
	};
	const api = {
		lire: vi.fn((chemin: string, params?: Record<string, string>) => repondre(chemin, params, undefined)),
		envoyer: vi.fn((chemin: string, corps?: unknown) => repondre(chemin, undefined, corps)),
		remplacer: vi.fn((chemin: string, corps: unknown) => repondre(`PUT ${chemin}`, undefined, corps)),
		supprimer: vi.fn((chemin: string, params?: Record<string, string>) => repondre(`DELETE ${chemin}`, params, undefined)),
		deposer: vi.fn(async (vers: string) => ({ chemin: vers })),
	};
	const client: Client = {
		api: api as unknown as Api,
		connexion,
		fictif: false,
		surJetonRefuse(f) {
			refus.add(f);
			return () => void refus.delete(f);
		},
	};
	return { client, connexion, api, refuserJeton: () => [...refus].forEach((f) => f()) };
}

export function rendreAvecClient(ui: ReactElement, client: Client): RenderResult {
	return render(<FournisseurClient client={client}>{ui}</FournisseurClient>);
}

/** Attend l'élément, puis le clique sous `act` : chercher à l'intérieur de `act` ne verrait pas les rendus qu'il retient. */
export async function cliquerQuandAffiche(element: Promise<HTMLElement>): Promise<void> {
	const cible = await element;
	await act(async () => cible.click());
}
