/**
 * Suivi du service pour la couche Electron, sans Electron : traduit ce qu'il observe (rattachement, démarrage, sondage de la
 * santé toutes les 5 s, messages du WebSocket, arrêt) en événements du domaine (`evoluerSuivi`), exécute l'action rendue
 * (démarrer), et expose l'état courant et les notifications à montrer. Aucune décision ici : la relance, l'état des
 * sessions et les notifications sont ceux du domaine.
 *
 * - Ouverture : rattachement au service de `service.json` s'il répond avec son jeton, sinon démarrage par `ouvrir`.
 * - Sondage : le service courant répond (vivant) ; sinon un autre service de la racine qui répond (redémarré ailleurs) est
 *   rattaché ; sinon, processus mort ou `ECHECS_AVANT_CHUTE` sondages sans réponse, il est perdu : `service.json` retiré
 *   (arrêt propre, par `mnemo arreter` ou Ctrl-C) → `arrete` ; encore là → `tombe` (le domaine décide de la relance).
 *   En arrêt ou en démarrage, le sondage est suspendu ; un sondage en vol au moment d'un arrêt ou d'un démarrage est ignoré.
 * - Arrêt : `POST /api/arret`, puis attente de la mort du processus (pid de `service.json`), puis `arrete`. Une réponse
 *   tardive de `/api/sante` ne peut donc pas faire revivre le service ni provoquer une relance.
 * - Le WebSocket se reconnecte seul ; une coupure ne vide pas la liste des sessions (voir `domaine/suivi.ts`).
 */
import type { SessionVue } from '@mnemo/contrat';
import { TEXTES_FR, type TextesApp } from '../domaine/langue/textes.ts';
import type { NotificationSession } from '../domaine/notifications.ts';
import { type EtatSuivi, type EvenementSuivi, evoluerSuivi, SUIVI_APP_INITIAL } from '../domaine/suivi.ts';
import type { VieService } from '../domaine/vie-service.ts';
import type { AccesService } from './acces-service.ts';
import type { ResultatDemarrage } from './demarrage.ts';
import { memeService, type ServiceLocal } from './service-local.ts';

export const INTERVALLE_SONDAGE_MS = 5000;
/** Sondages d'affilée sans réponse d'un processus encore vivant avant de le tenir pour perdu (un service occupé peut tarder). */
export const ECHECS_AVANT_CHUTE = 2;
/** L'arrêt propre laisse aux sessions le temps de s'arrêter, comme `mnemo arreter`. */
export const ATTENTE_ARRET_MS = 65_000;
const PAS_ARRET_MS = 100;

export type InstantaneSuivi = {
	vie: VieService;
	/** null : aucune liste reçue du service courant. */
	sessions: readonly SessionVue[] | null;
	/** Le service rattaché (port et jeton de la fenêtre), ou null. */
	service: ServiceLocal | null;
};

/** `force` : sous Windows, le service n'a pu être arrêté que de force (sans arrêt propre de ses sessions). */
export type ResultatArret = { ok: true; force?: true } | { ok: false; raison: string };

/**
 * Sous Windows, un signal au processus est un arrêt brutal (le service ne ferme rien) : quand la demande d'arrêt ne peut pas
 * lui parvenir, on attend d'abord qu'il s'arrête seul, ce temps au plus, avant de le forcer.
 */
export const ATTENTE_AVANT_FORCE_MS = 10_000;

export type SuiviService = {
	instantane(): InstantaneSuivi;
	/** Appelé à chaque changement de l'état ou du service rattaché ; rend de quoi se désabonner. */
	surChangement(f: (i: InstantaneSuivi) => void): () => void;
	/** Appelé pour chaque notification à montrer (le domaine a décidé). */
	surNotification(f: (n: NotificationSession) => void): () => void;
	/**
	 * Ouverture de l'app : rattachement, sinon démarrage (`demarrer` faux : l'état reste `arrete`) ; lance le sondage. Résolue
	 * une fois le rattachement ou le démarrage fini.
	 */
	ouvrir(o?: { demarrer?: boolean }): Promise<void>;
	/** « Démarrer / Redémarrer le service » ; résolue une fois le démarrage fini (sans effet si le domaine le refuse). */
	demarrer(): Promise<void>;
	/** « Arrêter le service » : résolue après la mort confirmée du processus, ou l'échec. */
	arreter(): Promise<ResultatArret>;
	/** Cesse de suivre (sondage, WebSocket) ; le service, lui, continue. */
	fermer(): void;
};

export type OptionsSuivi = {
	acces: AccesService;
	/** La fenêtre de l'app a le focus (pas de notification alors). */
	fenetreAuFocus: () => boolean;
	maintenant?: () => number;
	intervalleSondageMs?: number;
	attenteArretMs?: number;
	/** Par défaut celle du processus. */
	plateforme?: NodeJS.Platform;
	attenteAvantForceMs?: number;
	/** La langue courante des notifications et des raisons d'échec ; par défaut le français. */
	textes?: () => TextesApp;
};

const pause = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function creerSuivi(o: OptionsSuivi): SuiviService {
	const { acces } = o;
	const maintenant = o.maintenant ?? Date.now;
	const intervalle = o.intervalleSondageMs ?? INTERVALLE_SONDAGE_MS;
	const attenteArret = o.attenteArretMs ?? ATTENTE_ARRET_MS;
	const windows = (o.plateforme ?? process.platform) === 'win32';
	const attenteAvantForce = o.attenteAvantForceMs ?? ATTENTE_AVANT_FORCE_MS;
	const textes = (): TextesApp => o.textes?.() ?? TEXTES_FR;
	const surChangements = new Set<(i: InstantaneSuivi) => void>();
	const surNotifications = new Set<(n: NotificationSession) => void>();

	let etat: EtatSuivi = SUIVI_APP_INITIAL;
	let service: ServiceLocal | null = null;
	let flux: { fermer(): void } | null = null;
	/** Change à chaque rattachement, perte, démarrage ou arrêt : un sondage commencé avant est ignoré. */
	let generation = 0;
	let echecsSante = 0;
	let demarrage: Promise<void> | null = null;
	let arret: Promise<ResultatArret> | null = null;
	let minuteur: ReturnType<typeof setTimeout> | null = null;
	let ouvert = false;
	let ferme = false;

	const instantane = (): InstantaneSuivi => ({ vie: etat.vie, sessions: etat.sessions, service });

	function emettre(): void {
		const i = instantane();
		for (const f of [...surChangements]) f(i);
	}

	/** Applique un événement du domaine ; vrai si l'état a changé (déjà annoncé). */
	function appliquer(evenement: EvenementSuivi): boolean {
		if (ferme) return false;
		const r = evoluerSuivi(etat, evenement, textes());
		const change = r.etat !== etat;
		etat = r.etat;
		for (const n of r.notifications) for (const f of [...surNotifications]) f(n);
		if (change) emettre();
		if (r.action === 'demarrer') void lancerDemarrage();
		return change;
	}

	function fermerFlux(): void {
		flux?.fermer();
		flux = null;
	}

	function attacher(s: ServiceLocal): void {
		generation++;
		fermerFlux();
		const autre = service === null || !memeService(service, s);
		service = s;
		echecsSante = 0;
		if (!appliquer({ type: 'vivant', maintenantMs: maintenant() }) && autre) emettre();
		flux = acces.ouvrirFlux(s, (message) => void appliquer({ type: 'message', message, fenetreAuFocus: o.fenetreAuFocus() }));
	}

	/** Le service courant est perdu : arrêté proprement (son `service.json` retiré) ou tombé. */
	function perdre(courant: ServiceLocal, lu: ServiceLocal | null): void {
		generation++;
		fermerFlux();
		service = null;
		echecsSante = 0;
		const proprement = lu === null || !memeService(lu, courant);
		if (!appliquer(proprement ? { type: 'arrete' } : { type: 'tombe', maintenantMs: maintenant() })) emettre();
	}

	function lancerDemarrage(): Promise<void> {
		if (demarrage !== null) return demarrage;
		generation++;
		fermerFlux();
		service = null;
		demarrage = (async () => {
			// un accès qui lève ne laisse ni l'état en « demarrage » ni une promesse rejetée que personne n'attend
			const r = await acces.demarrer().catch((e: unknown): ResultatDemarrage => ({ ok: false, raison: textes().service.pasDemarre(e instanceof Error ? e.message : String(e)) }));
			if (ferme) return;
			if (r.ok) attacher(r.service);
			else appliquer({ type: 'echecDemarrage', raison: r.raison });
		})().finally(() => {
			demarrage = null;
		});
		return demarrage;
	}

	async function serviceQuiRepond(s: ServiceLocal | null): Promise<boolean> {
		return s !== null && acces.processusVivant(s.pid) && (await acces.sante(s)) === 'ok';
	}

	async function sonder(): Promise<void> {
		if (ferme || demarrage !== null || arret !== null) return;
		const gen = generation;
		const perime = () => gen !== generation || ferme || arret !== null || demarrage !== null;
		const courant = service;
		if (courant !== null) {
			const sante = await acces.sante(courant);
			if (perime()) return;
			if (sante === 'ok') {
				echecsSante = 0;
				appliquer({ type: 'vivant', maintenantMs: maintenant() });
				return;
			}
		}
		const lu = acces.lireService();
		if (lu !== null && (courant === null || !memeService(lu, courant)) && (await serviceQuiRepond(lu))) {
			if (!perime()) attacher(lu);
			return;
		}
		if (perime() || courant === null) return;
		echecsSante++;
		if (acces.processusVivant(courant.pid) && echecsSante < ECHECS_AVANT_CHUTE) return;
		perdre(courant, lu);
	}

	function planifier(): void {
		if (ferme) return;
		minuteur = setTimeout(() => {
			minuteur = null;
			void sonder()
				.catch(() => {})
				.finally(planifier);
		}, intervalle);
	}

	async function arreterService(s: ServiceLocal): Promise<ResultatArret> {
		const echec = (raison: string): ResultatArret => {
			appliquer({ type: 'arretEchoue' });
			return { ok: false, raison };
		};
		generation++;
		appliquer({ type: 'arretDemande' });
		const suite = await acces.demanderArret(s);
		if (typeof suite === 'object') return echec(suite.refus);
		let force = false;
		if (suite === 'signal' && windows) {
			// Windows : le signal tue sans rien fermer ; en dernier recours seulement
			const limite = maintenant() + attenteAvantForce;
			while (!ferme && acces.processusVivant(s.pid) && maintenant() < limite) await pause(PAS_ARRET_MS);
			if (!ferme && acces.processusVivant(s.pid)) {
				acces.signalerArret(s.pid);
				force = true;
			}
		} else if (suite === 'signal') acces.signalerArret(s.pid);
		const fin = maintenant() + attenteArret;
		// suivi fermé pendant l'attente : plus rien ne la retient (le service, lui, continue de s'arrêter)
		while (!ferme && acces.processusVivant(s.pid) && maintenant() < fin) await pause(PAS_ARRET_MS);
		if (ferme) return { ok: false, raison: textes().service.suiviFerme };
		if (acces.processusVivant(s.pid)) return echec(textes().service.pasArrete(s.pid, Math.round(attenteArret / 1000)));
		generation++;
		fermerFlux();
		if (service !== null && memeService(service, s)) service = null;
		if (!appliquer({ type: 'arrete' })) emettre();
		return force ? { ok: true, force: true } : { ok: true };
	}

	return {
		instantane,
		surChangement(f) {
			surChangements.add(f);
			return () => void surChangements.delete(f);
		},
		surNotification(f) {
			surNotifications.add(f);
			return () => void surNotifications.delete(f);
		},
		async ouvrir(options = {}) {
			if (ouvert || ferme) return;
			ouvert = true;
			const lu = acces.lireService();
			const repond = await serviceQuiRepond(lu);
			// fermé pendant la vérification : aucun flux ouvert, aucun sondage lancé
			if (ferme) return;
			if (repond) attacher(lu!);
			else if (options.demarrer ?? true) appliquer({ type: 'demarrageDemande' });
			else appliquer({ type: 'arrete' });
			planifier();
			if (demarrage !== null) await demarrage;
		},
		async demarrer() {
			appliquer({ type: 'demarrageDemande' });
			if (demarrage !== null) await demarrage;
		},
		arreter() {
			if (arret !== null) return arret;
			const s = service;
			if (s === null || etat.vie.etat !== 'vivant') return Promise.resolve({ ok: false, raison: textes().service.aucunVivant });
			arret = arreterService(s).finally(() => {
				arret = null;
			});
			return arret;
		},
		fermer() {
			if (ferme) return;
			ferme = true;
			if (minuteur !== null) clearTimeout(minuteur);
			minuteur = null;
			fermerFlux();
		},
	};
}
