// Suivi du service avec un faux accès (aucun processus, aucun réseau) : rattachement, démarrage, chute et relance, arrêt
// propre venu d'ailleurs, et surtout l'arrêt demandé par l'app, qu'une réponse tardive de la santé ne contredit pas.
import type { MessageServeur } from '@mnemo/contrat';
import { afterEach, describe, expect, it } from 'vitest';
import type { NotificationSession } from '../../src/domaine/notifications.ts';
import type { AccesService } from '../../src/infra/acces-service.ts';
import type { Sante, SuiteArret } from '../../src/infra/api-service.ts';
import type { ResultatDemarrage } from '../../src/infra/demarrage.ts';
import type { ServiceLocal } from '../../src/infra/service-local.ts';
import { creerSuivi, type InstantaneSuivi, type SuiviService } from '../../src/infra/suivi-service.ts';
import { session } from '../aides/sessions.ts';

const INTERVALLE = 20;
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function jusqua(condition: () => boolean, delaiMs = 3000): Promise<boolean> {
	const fin = Date.now() + delaiMs;
	while (Date.now() < fin) {
		if (condition()) return true;
		await pause(5);
	}
	return condition();
}

const service = (pid: number, port = 4000 + pid): ServiceLocal => ({ pid, port, jeton: 'a'.repeat(64), demarre: pid });

type Flux = { service: ServiceLocal; surMessage: (m: MessageServeur) => void; ferme: boolean };

/** Faux monde : `fichier` (service.json), processus vivants, santé par pid (une fonction peut la faire attendre). */
function fauxMonde() {
	const monde = {
		fichier: null as ServiceLocal | null,
		vivants: new Set<number>(),
		sante: new Map<number, () => Promise<Sante>>(),
		demarrages: 0,
		prochains: [] as ResultatDemarrage[],
		arrets: 0,
		suiteArret: 'accepte' as SuiteArret,
		signaux: [] as number[],
		flux: [] as Flux[],
		/** Un service vivant, répondant, inscrit dans service.json. */
		lancer(s: ServiceLocal) {
			monde.vivants.add(s.pid);
			monde.sante.set(s.pid, async () => 'ok');
			monde.fichier = s;
		},
		fluxOuverts: () => monde.flux.filter((f) => !f.ferme),
	};
	const acces: AccesService = {
		lireService: () => monde.fichier,
		sante: (s) => (monde.vivants.has(s.pid) ? (monde.sante.get(s.pid)?.() ?? Promise.resolve('absent')) : Promise.resolve('absent')),
		processusVivant: (pid) => monde.vivants.has(pid),
		async demarrer() {
			monde.demarrages++;
			const r = monde.prochains.shift() ?? { ok: false, raison: 'aucun démarrage prévu' };
			if (r.ok) monde.lancer(r.service);
			return r;
		},
		async demanderArret() {
			monde.arrets++;
			return monde.suiteArret;
		},
		signalerArret: (pid) => void monde.signaux.push(pid),
		ouvrirFlux(s, surMessage) {
			const f: Flux = { service: s, surMessage, ferme: false };
			monde.flux.push(f);
			return { fermer: () => void (f.ferme = true) };
		},
	};
	return { monde, acces };
}

const suivis: SuiviService[] = [];
function suivre(acces: AccesService, focus = false, plateforme: NodeJS.Platform = 'darwin'): { suivi: SuiviService; vies: string[]; notifications: NotificationSession[]; dernier: () => InstantaneSuivi | null } {
	const suivi = creerSuivi({ acces, fenetreAuFocus: () => focus, intervalleSondageMs: INTERVALLE, attenteArretMs: 2000, plateforme, attenteAvantForceMs: 300 });
	suivis.push(suivi);
	const vies: string[] = [];
	const notifications: NotificationSession[] = [];
	let dernier: InstantaneSuivi | null = null;
	suivi.surChangement((i) => {
		dernier = i;
		if (vies.at(-1) !== i.vie.etat) vies.push(i.vie.etat);
	});
	suivi.surNotification((n) => void notifications.push(n));
	return { suivi, vies, notifications, dernier: () => dernier };
}

afterEach(() => {
	for (const s of suivis.splice(0)) s.fermer();
});

describe('suivi du service', () => {
	it('ouverture : rattachement au service qui répond, sans démarrage ; le flux est ouvert sur lui', async () => {
		const { monde, acces } = fauxMonde();
		monde.lancer(service(1));
		const { suivi } = suivre(acces);
		await suivi.ouvrir();
		expect(suivi.instantane()).toMatchObject({ vie: { etat: 'vivant' }, service: service(1), sessions: null });
		expect(monde.demarrages).toBe(0);
		expect(monde.fluxOuverts().map((f) => f.service.pid)).toEqual([1]);
	});

	it('ouverture sans service : démarrage par `ouvrir`, puis vivant ; un échec : l’erreur et sa raison', async () => {
		const { monde, acces } = fauxMonde();
		monde.prochains.push({ ok: true, service: service(2) });
		const a = suivre(acces);
		await a.suivi.ouvrir();
		expect(a.vies).toEqual(['demarrage', 'vivant']);
		expect(a.suivi.instantane().service).toEqual(service(2));

		const autre = fauxMonde();
		const b = suivre(autre.acces);
		await b.suivi.ouvrir();
		expect(b.suivi.instantane().vie).toMatchObject({ etat: 'erreur', raison: 'aucun démarrage prévu' });
		// `demarrer: false` : l'état reste « arrêté »
		const c = suivre(fauxMonde().acces);
		await c.suivi.ouvrir({ demarrer: false });
		expect(c.suivi.instantane().vie.etat).toBe('arrete');
	});

	it('les messages du flux tiennent la liste des sessions et donnent les notifications du domaine', async () => {
		const { monde, acces } = fauxMonde();
		monde.lancer(service(1));
		const { suivi, notifications } = suivre(acces);
		await suivi.ouvrir();
		const flux = monde.fluxOuverts()[0]!;
		flux.surMessage({ type: 'sessions', sessions: [session({ id: 's' })] });
		flux.surMessage({ type: 'session', session: session({ id: 's', etat: 'attend', objectif: 'Relire le devis' }) });
		expect(suivi.instantane().sessions?.map((s) => s.etat)).toEqual(['attend']);
		expect(notifications).toEqual([{ session: 's', titre: 'Mnemo', corps: 'Relire le devis attend ta réponse' }]);
	});

	it('arrêt demandé : une réponse tardive de la santé ne fait ni revivre ni relancer ; arrêté à la mort du processus', async () => {
		const { monde, acces } = fauxMonde();
		monde.lancer(service(1));
		const { suivi, vies } = suivre(acces);
		await suivi.ouvrir();
		// un sondage en vol, dont la réponse « ok » arrive après la demande d'arrêt
		let repondre: (s: Sante) => void = () => {};
		let enVol = false;
		monde.sante.set(1, () => {
			enVol = true;
			return new Promise<Sante>((r) => (repondre = r));
		});
		expect(await jusqua(() => enVol)).toBe(true);
		const arret = suivi.arreter();
		expect(suivi.instantane().vie.etat).toBe('arret');
		repondre('ok');
		monde.sante.set(1, async () => 'ok');
		await pause(INTERVALLE * 6);
		expect(suivi.instantane().vie.etat).toBe('arret');
		// le processus meurt (le service retire son service.json en s'arrêtant proprement)
		monde.vivants.delete(1);
		monde.fichier = null;
		expect(await arret).toEqual({ ok: true });
		await pause(INTERVALLE * 6);
		expect(vies).toEqual(['vivant', 'arret', 'arrete']);
		expect(monde.demarrages).toBe(0);
		expect(monde.arrets).toBe(1);
		expect(monde.fluxOuverts()).toEqual([]);
		expect(suivi.instantane().service).toBeNull();
	});

	it('arrêt : connexion refusée → SIGTERM ; refus du service → de nouveau vivant, avec la raison', async () => {
		const { monde, acces } = fauxMonde();
		monde.lancer(service(1));
		const { suivi } = suivre(acces);
		await suivi.ouvrir();
		monde.suiteArret = { refus: 'Le service a refusé l’arrêt (statut 500).' };
		expect(await suivi.arreter()).toEqual({ ok: false, raison: 'Le service a refusé l’arrêt (statut 500).' });
		expect(suivi.instantane().vie.etat).toBe('vivant');

		monde.suiteArret = 'signal';
		const arret = suivi.arreter();
		expect(await jusqua(() => monde.signaux.length === 1)).toBe(true);
		monde.vivants.delete(1);
		expect(await arret).toEqual({ ok: true });
		expect(monde.signaux).toEqual([1]);
	});

	it('Windows, connexion refusée : le processus a le temps de s’arrêter seul ; forcé en dernier recours, et dit', async () => {
		const { monde, acces } = fauxMonde();
		monde.lancer(service(1));
		const { suivi } = suivre(acces, false, 'win32');
		await suivi.ouvrir();
		monde.suiteArret = 'signal';
		const seul = suivi.arreter();
		await pause(50);
		monde.vivants.delete(1);
		expect(await seul).toEqual({ ok: true });
		expect(monde.signaux).toEqual([]);

		monde.lancer(service(2));
		monde.prochains.push({ ok: true, service: service(2) });
		await suivi.demarrer();
		const force = suivi.arreter();
		expect(await jusqua(() => monde.signaux.length === 1)).toBe(true);
		monde.vivants.delete(2);
		expect(await force).toEqual({ ok: true, force: true });
		expect(monde.signaux).toEqual([2]);
	});

	it('fermé pendant l’ouverture : aucun flux ouvert ; fermé pendant l’attente d’un arrêt : la promesse se résout', async () => {
		const { monde, acces } = fauxMonde();
		monde.lancer(service(1));
		let repondre: (s: Sante) => void = () => {};
		monde.sante.set(1, () => new Promise<Sante>((r) => (repondre = r)));
		const { suivi } = suivre(acces);
		const ouverture = suivi.ouvrir();
		suivi.fermer();
		repondre('ok');
		await ouverture;
		expect(monde.flux).toEqual([]);

		const autre = fauxMonde();
		autre.monde.lancer(service(2));
		const b = suivre(autre.acces).suivi;
		await b.ouvrir();
		const arret = b.arreter();
		await pause(INTERVALLE);
		b.fermer();
		expect(await arret).toMatchObject({ ok: false });
	});

	it('un démarrage qui lève : l’erreur, avec sa raison, sans rester en démarrage', async () => {
		const { acces } = fauxMonde();
		const { suivi } = suivre({ ...acces, demarrer: () => Promise.reject(new Error('spawn impossible')) });
		await suivi.ouvrir();
		expect(suivi.instantane().vie).toMatchObject({ etat: 'erreur', raison: 'Le service n’a pas démarré : spawn impossible' });
	});

	it('chute (processus mort, service.json resté) : une relance, puis l’erreur à la seconde chute rapprochée', async () => {
		const { monde, acces } = fauxMonde();
		monde.lancer(service(1));
		monde.prochains.push({ ok: true, service: service(2) });
		const { suivi, vies } = suivre(acces);
		await suivi.ouvrir();
		monde.vivants.delete(1);
		expect(await jusqua(() => suivi.instantane().service?.pid === 2)).toBe(true);
		monde.vivants.delete(2);
		expect(await jusqua(() => suivi.instantane().vie.etat === 'erreur')).toBe(true);
		expect(vies).toEqual(['vivant', 'demarrage', 'vivant', 'erreur']);
		expect(monde.demarrages).toBe(1);
		expect(monde.fluxOuverts()).toEqual([]);
	});

	it('processus vivant mais muet : perdu au second sondage sans réponse seulement', async () => {
		const { monde, acces } = fauxMonde();
		monde.lancer(service(1));
		let sondages = 0;
		const { suivi } = suivre(acces);
		await suivi.ouvrir();
		monde.sante.set(1, async () => {
			sondages++;
			return 'absent';
		});
		expect(await jusqua(() => sondages >= 1)).toBe(true);
		expect(suivi.instantane().vie.etat).toBe('vivant');
		expect(await jusqua(() => suivi.instantane().vie.etat !== 'vivant')).toBe(true);
		expect(sondages).toBeGreaterThanOrEqual(2);
	});

	it('arrêt propre venu d’ailleurs (service.json retiré) : arrêté, sans relance ; un service redémarré ailleurs est rattaché', async () => {
		const { monde, acces } = fauxMonde();
		monde.lancer(service(1));
		const { suivi, dernier } = suivre(acces);
		await suivi.ouvrir();
		monde.vivants.delete(1);
		monde.fichier = null;
		expect(await jusqua(() => suivi.instantane().vie.etat === 'arrete')).toBe(true);
		await pause(INTERVALLE * 4);
		expect(monde.demarrages).toBe(0);
		monde.lancer(service(3));
		expect(await jusqua(() => suivi.instantane().vie.etat === 'vivant')).toBe(true);
		expect(dernier()?.service).toEqual(service(3));
		expect(monde.fluxOuverts().map((f) => f.service.pid)).toEqual([3]);
	});

	it('vivant, un autre service de la racine répond (redémarré ailleurs sur un autre port) : rattaché, changement annoncé', async () => {
		const { monde, acces } = fauxMonde();
		monde.lancer(service(1));
		const { suivi, dernier } = suivre(acces);
		await suivi.ouvrir();
		monde.vivants.delete(1);
		monde.lancer(service(4, 5555));
		expect(await jusqua(() => dernier()?.service?.port === 5555)).toBe(true);
		expect(suivi.instantane().vie.etat).toBe('vivant');
		expect(monde.demarrages).toBe(0);
	});
});
