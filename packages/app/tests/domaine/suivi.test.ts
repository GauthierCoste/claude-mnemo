import type { SessionVue } from '@mnemo/contrat';
import { describe, expect, it } from 'vitest';
import type { NotificationSession } from '../../src/domaine/notifications.ts';
import { type EtatSuivi, type EvenementSuivi, evoluerSuivi, SUIVI_APP_INITIAL } from '../../src/domaine/suivi.ts';
import { session } from '../aides/sessions.ts';

/** Rejoue des événements ; rend l'état final, les actions et les notifications (ids des sessions). */
function rejouer(evenements: EvenementSuivi[], depart: EtatSuivi = SUIVI_APP_INITIAL): { etat: EtatSuivi; actions: (string | null)[]; notifiees: string[] } {
	let etat = depart;
	const actions: (string | null)[] = [];
	const notifiees: NotificationSession[] = [];
	for (const e of evenements) {
		const r = evoluerSuivi(etat, e);
		etat = r.etat;
		actions.push(r.action);
		notifiees.push(...r.notifications);
	}
	return { etat, actions, notifiees: notifiees.map((n) => n.session) };
}

const liste = (sessions: SessionVue[]): EvenementSuivi => ({ type: 'message', message: { type: 'sessions', sessions }, fenetreAuFocus: false });
const une = (s: SessionVue): EvenementSuivi => ({ type: 'message', message: { type: 'session', session: s }, fenetreAuFocus: false });
const VIVANT: EvenementSuivi = { type: 'vivant', maintenantMs: 0 };

describe('suivi du service (vie, sessions, notifications)', () => {
	it('le premier instantané : la liste, sans notification ; un passage à « attend » ensuite : une notification', () => {
		const r = rejouer([VIVANT, liste([session({ id: 'a', etat: 'attend' }), session({ id: 'b' })]), une(session({ id: 'b', etat: 'attend' }))]);
		expect(r.etat.sessions?.map((s) => s.id)).toEqual(['a', 'b']);
		expect(r.notifiees).toEqual(['b']);
	});

	it('une coupure du WebSocket ne vide pas la liste ; l’instantané de la reconnexion ne notifie pas de nouveau', () => {
		const attend = session({ id: 'a', etat: 'attend' });
		const r = rejouer([VIVANT, liste([session({ id: 'a' })]), une(attend), liste([attend, session({ id: 'n', etat: 'attend' })])]);
		// `a` notifiée une fois (son passage), pas à la reconnexion ; `n` attend depuis la coupure : c'est un passage
		expect(r.notifiees).toEqual(['a', 'n']);
	});

	it('la fenêtre au focus : rien n’est montré', () => {
		const r = rejouer([VIVANT, liste([]), { type: 'message', message: { type: 'session', session: session({ id: 'a', etat: 'attend' }) }, fenetreAuFocus: true }]);
		expect(r.notifiees).toEqual([]);
	});

	it('service perdu (chute, arrêt) : liste et suivi oubliés ; le premier instantané du service neuf est un état initial', () => {
		const attend = session({ id: 'a', etat: 'attend' });
		const tombe = rejouer([VIVANT, liste([]), une(attend), { type: 'tombe', maintenantMs: 1 }]);
		expect(tombe.actions.at(-1)).toBe('demarrer');
		expect(tombe.etat.sessions).toBeNull();
		const relance = rejouer([VIVANT, liste([attend, session({ id: 'b', etat: 'attend' })])], tombe.etat);
		expect(relance.notifiees).toEqual([]);
		expect(rejouer([VIVANT, liste([attend]), { type: 'arrete' }]).etat.sessions).toBeNull();
	});

	it('en arrêt, les sessions restent jusqu’à la mort confirmée ; les messages sont ignorés hors service vivant', () => {
		const enArret = rejouer([VIVANT, liste([session({ id: 'a' })]), { type: 'arretDemande' }]);
		expect(enArret.etat.vie.etat).toBe('arret');
		expect(enArret.etat.sessions).toHaveLength(1);
		const apres = rejouer([une(session({ id: 'b', etat: 'attend' })), { type: 'vivant', maintenantMs: 9 }], enArret.etat);
		expect(apres.etat.sessions?.map((s) => s.id)).toEqual(['a']);
		expect(apres.etat.vie.etat).toBe('arret');
		expect(rejouer([liste([session({ id: 'x' })])]).etat.sessions).toBeNull();
	});

	it('un message sans effet sur la liste rend le même état', () => {
		const vivant = rejouer([VIVANT, liste([])]).etat;
		expect(evoluerSuivi(vivant, { type: 'message', message: { type: 'memoire', modifieeMs: 1 }, fenetreAuFocus: false }).etat).toBe(vivant);
	});
});
