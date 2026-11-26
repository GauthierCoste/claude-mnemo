/**
 * Client WebSocket du service (module `ws`), comme celui de l'interface (`packages/ui/src/client/connexion.ts`) : jeton en
 * sous-protocole (`PROTOCOLE_WS` et `PREFIXE_JETON_WS` + jeton, jamais dans l'adresse), aucun en-tête `Origin` (le service
 * l'accepte absent), reconnexion seule avec une attente croissante, remise à zéro à chaque ouverture. Ne décide rien : il
 * remet chaque message analysé à `surMessage`.
 */
import { type MessageServeur, PREFIXE_JETON_WS, PROTOCOLE_WS, ROUTES } from '@mnemo/contrat';
import WebSocket from 'ws';

/** Attentes avant chaque nouvelle tentative, la dernière répétée ; comme l'interface. */
export const DELAIS_RECONNEXION_MS = [500, 1000, 2000, 5000, 10_000];
/** Délai de la poignée de main. */
const DELAI_OUVERTURE_MS = 5000;

export type ClientWs = { ouvert(): boolean; fermer(): void };

export function ouvrirClientWs(o: {
	port: number;
	jeton: string;
	surMessage: (m: MessageServeur) => void;
	surEtat?: (ouvert: boolean) => void;
	delaisMs?: readonly number[];
}): ClientWs {
	const delais = o.delaisMs ?? DELAIS_RECONNEXION_MS;
	let socket: WebSocket | null = null;
	let attente: ReturnType<typeof setTimeout> | null = null;
	let essai = 0;
	let ouvert = false;
	let ferme = false;

	function changer(e: boolean): void {
		if (ouvert === e) return;
		ouvert = e;
		o.surEtat?.(e);
	}

	function ouvrir(): void {
		attente = null;
		if (ferme) return;
		const s = new WebSocket(`ws://127.0.0.1:${o.port}${ROUTES.ws}`, [PROTOCOLE_WS, `${PREFIXE_JETON_WS}${o.jeton}`], { handshakeTimeout: DELAI_OUVERTURE_MS });
		socket = s;
		s.on('open', () => {
			if (socket !== s || ferme) return;
			essai = 0;
			changer(true);
		});
		s.on('message', (donnees, binaire) => {
			if (socket !== s || ferme || binaire) return;
			let m: MessageServeur;
			try {
				m = JSON.parse(String(donnees)) as MessageServeur;
			} catch {
				return;
			}
			if (m && typeof m === 'object' && typeof m.type === 'string') o.surMessage(m);
		});
		// une erreur (refus, 401, délai) est suivie de `close` : la reconnexion s'y décide
		s.on('error', () => {});
		s.on('close', () => {
			if (socket !== s) return;
			socket = null;
			changer(false);
			if (ferme) return;
			const delai = delais[Math.min(essai, delais.length - 1)] ?? 10_000;
			essai++;
			attente = setTimeout(ouvrir, delai);
		});
	}

	ouvrir();

	return {
		ouvert: () => ouvert,
		fermer() {
			if (ferme) return;
			ferme = true;
			if (attente !== null) clearTimeout(attente);
			attente = null;
			const s = socket;
			socket = null;
			changer(false);
			if (s !== null) {
				if (s.readyState === WebSocket.CONNECTING) s.terminate();
				else s.close();
			}
		},
	};
}
