/**
 * Client réel : API et connexion WebSocket vers l'origine qui a servi l'interface, avec le jeton : `Authorization: Bearer`
 * pour l'API, sous-protocole `mnemo.jeton.<jeton>` pour le WebSocket (jamais dans une adresse).
 */
import { PREFIXE_JETON_WS, PROTOCOLE_WS, ROUTES } from '@mnemo/contrat';
import { creerApi } from './api.ts';
import { creerConnexion } from './connexion.ts';
import type { Client } from './contexte.tsx';
import { oublierJeton } from './jeton.ts';

export function creerClientReel(o: {
	jeton: string;
	origine: string;
	fetch: typeof fetch;
	WebSocket: typeof WebSocket;
	/** Stockage du jeton (`localStorage`) : le jeton refusé y est effacé. */
	stockage: Pick<Storage, 'removeItem'> | null;
	minuterie?: { poser(f: () => void, ms: number): unknown; annuler(t: unknown): void };
}): Client {
	const refus = new Set<() => void>();
	let refuse = false;
	const signalerRefus = () => {
		if (refuse) return;
		refuse = true;
		oublierJeton(o.stockage);
		connexion.fermer();
		for (const f of [...refus]) f();
	};

	const api = creerApi({ base: '', jeton: o.jeton, fetch: o.fetch, surJetonRefuse: signalerRefus });
	const ws = new URL(ROUTES.ws, o.origine);
	ws.protocol = ws.protocol === 'https:' ? 'wss:' : 'ws:';

	const connexion = creerConnexion({
		url: ws.toString(),
		protocoles: [PROTOCOLE_WS, `${PREFIXE_JETON_WS}${o.jeton}`],
		WebSocket: o.WebSocket,
		// Service absent → fetch lève : la connexion continue d'essayer ; 401 → jeton refusé, plus aucune tentative.
		verifierJeton: async () => (await o.fetch(ROUTES.sante, { headers: { Authorization: `Bearer ${o.jeton}` } })).status !== 401,
		...(o.minuterie ? { minuterie: o.minuterie } : {}),
	});
	connexion.surEtat((e) => {
		if (e === 'jeton_refuse') signalerRefus();
	});

	return {
		api,
		connexion,
		fictif: false,
		surJetonRefuse(f) {
			// Abonné après le refus : prévenu tout de suite.
			if (refuse) {
				f();
				return () => {};
			}
			refus.add(f);
			return () => void refus.delete(f);
		},
	};
}
