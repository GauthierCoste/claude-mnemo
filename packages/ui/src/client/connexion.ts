/**
 * Connexion WebSocket au service : reconnexion seule (0,5 s → 10 s, immédiate après une fermeture pour lenteur), arrêt
 * définitif si le jeton est refusé, abonnements aux terminaux comptés par session et renvoyés à chaque réouverture.
 */
import { CODE_FERMETURE_LENT, type MessageClient, type MessageServeur } from '@mnemo/contrat';

export type EtatConnexion = 'connexion' | 'ouverte' | 'reconnexion' | 'jeton_refuse';
export type FluxTerminal = Extract<MessageServeur, { type: 'sortie' | 'relecture' | 'retard' }>;

export type Connexion = {
	etat(): EtatConnexion;
	surEtat(f: (e: EtatConnexion) => void): () => void;
	surMessage(f: (m: MessageServeur) => void): () => void;
	/** Faux si la connexion n'est pas ouverte : rien n'est envoyé, à l'appelant de le signaler. */
	envoyer(m: MessageClient): boolean;
	abonner(session: string, f: (m: FluxTerminal) => void): () => void;
	fermer(): void;
};

type Minuterie = { poser(f: () => void, ms: number): unknown; annuler(t: unknown): void };

export const DELAIS_RECONNEXION_MS = [500, 1000, 2000, 5000, 10000];
const OUVERTE = 1;
/** Fermetures pour lenteur d'affilée au-delà desquelles on reprend les délais normaux (pas de boucle serrée). */
export const LENTS_AVANT_DELAI = 3;
/** Une connexion restée ouverte aussi longtemps remet à zéro le compte des fermetures pour lenteur. */
export const OUVERTURE_STABLE_MS = 10_000;

const minuterieParDefaut: Minuterie = {
	poser: (f, ms) => setTimeout(f, ms),
	annuler: (t) => clearTimeout(t as ReturnType<typeof setTimeout>),
};

function estFluxTerminal(m: MessageServeur): m is FluxTerminal {
	return m.type === 'sortie' || m.type === 'relecture' || m.type === 'retard';
}

export function creerConnexion(o: {
	url: string;
	/** Sous-protocoles demandés (le jeton y passe, jamais dans l'adresse). */
	protocoles?: string[];
	WebSocket: typeof WebSocket;
	/** `GET /api/sante` avec le jeton : faux si le service refuse le jeton ; une erreur (service absent) laisse réessayer. */
	verifierJeton: () => Promise<boolean>;
	delaisMs?: number[];
	minuterie?: Minuterie;
}): Connexion {
	const delais = o.delaisMs ?? DELAIS_RECONNEXION_MS;
	const minuterie = o.minuterie ?? minuterieParDefaut;
	const surEtats = new Set<(e: EtatConnexion) => void>();
	const surMessages = new Set<(m: MessageServeur) => void>();
	const abonnes = new Map<string, Set<(m: FluxTerminal) => void>>();

	let etat: EtatConnexion = 'connexion';
	let socket: WebSocket | null = null;
	let attente: unknown = null;
	let essai = 0;
	let echecs = 0;
	let lents = 0;
	let ouvertureMs = 0;
	let ferme = false;

	function changer(e: EtatConnexion): void {
		if (etat === e) return;
		etat = e;
		for (const f of [...surEtats]) f(e);
	}

	function envoyerBrut(m: MessageClient): boolean {
		if (!socket || socket.readyState !== OUVERTE) return false;
		try {
			socket.send(JSON.stringify(m));
			return true;
		} catch {
			return false;
		}
	}

	function ouvrir(): void {
		attente = null;
		if (ferme) return;
		let ouverte = false;
		const s = o.protocoles === undefined ? new o.WebSocket(o.url) : new o.WebSocket(o.url, o.protocoles);
		socket = s;
		s.onopen = () => {
			if (socket !== s || ferme) return;
			ouverte = true;
			ouvertureMs = Date.now();
			essai = 0;
			echecs = 0;
			// Réabonnements d'abord : un écouteur qui s'abonne en apprenant l'ouverture n'envoie pas deux `abonner`.
			for (const session of abonnes.keys()) envoyerBrut({ type: 'abonner', session });
			changer('ouverte');
		};
		s.onmessage = (e: MessageEvent) => {
			if (socket !== s || ferme) return;
			recevoir(e.data);
		};
		s.onclose = (e: CloseEvent) => {
			if (socket !== s) return;
			socket = null;
			if (ferme) return;
			if (e.code === CODE_FERMETURE_LENT) {
				// Client lent : le service a coupé, l'écran revient par la relecture du tampon. Reconnexion immédiate,
				// sauf après plusieurs coupures d'affilée sur des connexions brèves : délais normaux.
				if (ouverte && Date.now() - ouvertureMs >= OUVERTURE_STABLE_MS) lents = 0;
				lents++;
				changer('reconnexion');
				if (lents < LENTS_AVANT_DELAI) ouvrir();
				else planifier();
				return;
			}
			lents = 0;
			changer('reconnexion');
			if (ouverte) {
				planifier();
				return;
			}
			echecs++;
			if (echecs < 2) {
				planifier();
				return;
			}
			o.verifierJeton().then(
				(valide) => {
					if (ferme) return;
					if (valide) planifier();
					else changer('jeton_refuse');
				},
				() => {
					if (!ferme) planifier();
				},
			);
		};
	}

	function planifier(): void {
		const delai = delais[Math.min(essai, delais.length - 1)] ?? 10_000;
		essai++;
		attente = minuterie.poser(ouvrir, delai);
	}

	function recevoir(donnees: unknown): void {
		let m: MessageServeur;
		try {
			m = JSON.parse(String(donnees)) as MessageServeur;
		} catch {
			return;
		}
		if (!m || typeof m !== 'object' || typeof m.type !== 'string') return;
		for (const f of [...surMessages]) f(m);
		if (!estFluxTerminal(m)) return;
		const ensemble = abonnes.get(m.session);
		if (!ensemble) return;
		if (m.type === 'retard') {
			// Sortie perdue pour ce client : on redemande l'écran entier.
			envoyerBrut({ type: 'desabonner', session: m.session });
			envoyerBrut({ type: 'abonner', session: m.session });
		}
		for (const f of [...ensemble]) f(m);
	}

	ouvrir();

	return {
		etat: () => etat,
		surEtat(f) {
			surEtats.add(f);
			return () => void surEtats.delete(f);
		},
		surMessage(f) {
			surMessages.add(f);
			return () => void surMessages.delete(f);
		},
		envoyer: envoyerBrut,
		abonner(session, f) {
			let ensemble = abonnes.get(session);
			if (!ensemble) {
				ensemble = new Set();
				abonnes.set(session, ensemble);
				envoyerBrut({ type: 'abonner', session });
			} else {
				// Une vue de plus sur une session déjà suivie : elle a besoin de l'écran entier. Comme pour `retard`, on
				// redemande la relecture, que toutes les vues reçoivent (chacune remet son écran à zéro avant de l'écrire).
				envoyerBrut({ type: 'desabonner', session });
				envoyerBrut({ type: 'abonner', session });
			}
			const ecouteur = (m: FluxTerminal) => f(m);
			ensemble.add(ecouteur);
			let actif = true;
			return () => {
				if (!actif) return;
				actif = false;
				const courant = abonnes.get(session);
				if (!courant) return;
				courant.delete(ecouteur);
				if (courant.size === 0) {
					abonnes.delete(session);
					envoyerBrut({ type: 'desabonner', session });
				}
			};
		},
		fermer() {
			ferme = true;
			if (attente !== null) minuterie.annuler(attente);
			attente = null;
			const s = socket;
			socket = null;
			s?.close();
		},
	};
}
