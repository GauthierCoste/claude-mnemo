import { PROFIL_ARCHIVISTE } from '@mnemo/commun';
import type { SessionVue } from '@mnemo/contrat';
import { describe, expect, it } from 'vitest';
import { type NotificationSession, notificationsAEmettre, SUIVI_INITIAL, type SuiviNotifications } from '../../src/domaine/notifications.ts';
import { session } from '../aides/sessions.ts';

/** Rejoue une suite d'instantanés (sessions, fenêtre au focus) ; rend les notifications de chacun. */
function rejouer(instantanes: [SessionVue[], boolean][]): NotificationSession[][] {
	let suivi: SuiviNotifications = SUIVI_INITIAL;
	return instantanes.map(([sessions, focus]) => {
		const r = notificationsAEmettre(suivi, sessions, focus);
		suivi = r.suivi;
		return r.notifications;
	});
}

const a = (etat: SessionVue['etat']) => session({ id: 'a', objectif: 'Relire le contrat', etat });

describe('notifications', () => {
	it('aucune au premier instantané, même si une session attend déjà', () => {
		expect(rejouer([[[a('attend')], false]])).toEqual([[]]);
	});

	it('une au passage à « attend », fenêtre sans le focus ; jamais répétée tant que l’état ne change pas', () => {
		const r = rejouer([
			[[a('travaille')], false],
			[[a('attend')], false],
			[[a('attend')], false],
			[[a('travaille')], false],
			[[a('attend')], false],
		]);
		const une = [{ session: 'a', titre: 'Mnemo', corps: 'Relire le contrat attend ta réponse' }];
		expect(r).toEqual([[], une, [], [], une]);
	});

	it('fenêtre au focus : rien, ni sur le moment ni après', () => {
		expect(rejouer([
			[[a('travaille')], false],
			[[a('attend')], true],
			[[a('attend')], false],
		])).toEqual([[], [], []]);
	});

	it('une nouvelle session qui attend notifie ; l’archiviste seulement quand un dialogue s’ouvre', () => {
		const archiviste = (dialogueOuvert: boolean) => session({ id: 'r', objectif: 'Traite les fiches à traiter.', dossier: '', profil: PROFIL_ARCHIVISTE, etat: 'attend', dialogueOuvert });
		const r = rejouer([
			[[], false],
			[[archiviste(false)], false],
			[[archiviste(true), session({ id: 'b', etat: 'attend', objectif: 'Préparer le devis' })], false],
		]);
		expect(r[1]).toEqual([]);
		expect(r[2]?.map((n) => n.corps)).toEqual(['Archiviste attend ta réponse', 'Préparer le devis attend ta réponse']);
	});
});
