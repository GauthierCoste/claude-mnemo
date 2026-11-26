import { describe, expect, it } from 'vitest';
import { BOUTONS_QUITTER, questionQuitter, reponseQuitter, suiteQuitter } from '../../src/domaine/quitter.ts';
import { VIE_INITIALE } from '../../src/domaine/vie-service.ts';
import { vueApp } from '../../src/domaine/vue.ts';
import { session } from '../aides/sessions.ts';

describe('quitter Mnemo', () => {
	it('sans service vivant : quitter, sans question', () => {
		for (const vie of ['arrete', 'demarrage', 'arret', 'erreur'] as const) {
			for (const choix of ['demander', 'arreter', 'laisser'] as const) expect(suiteQuitter(choix, vie)).toBe('quitter');
		}
	});

	it('service vivant : la question, sauf choix retenu', () => {
		expect(suiteQuitter('demander', 'vivant')).toBe('demander');
		expect(suiteQuitter('arreter', 'vivant')).toBe('arreterPuisQuitter');
		expect(suiteQuitter('laisser', 'vivant')).toBe('quitter');
	});

	it('réponse de la boîte : « Ne plus demander » retient le choix, jamais l’annulation', () => {
		expect(BOUTONS_QUITTER).toEqual(['Arrêter le service et ses sessions', 'Laisser tourner', 'Annuler']);
		expect(reponseQuitter(0, false)).toEqual({ suite: 'arreterPuisQuitter', retenir: null });
		expect(reponseQuitter(0, true)).toEqual({ suite: 'arreterPuisQuitter', retenir: 'arreter' });
		expect(reponseQuitter(1, true)).toEqual({ suite: 'quitter', retenir: 'laisser' });
		expect(reponseQuitter(2, true)).toEqual({ suite: 'annuler', retenir: null });
		// Échap ou fermeture de la boîte
		expect(reponseQuitter(-1, true)).toEqual({ suite: 'annuler', retenir: null });
	});

	it('la question dit combien de sessions actives s’arrêteraient', () => {
		expect(questionQuitter([]).detail).toMatch(/^Aucune session n’est active\./u);
		expect(questionQuitter([session({ id: 'a' }), session({ id: 'p', etat: 'en_pause' })]).detail).toMatch(/^Une session est active/u);
		expect(questionQuitter([session({ id: 'a' }), session({ id: 'b', etat: 'attend' })]).detail).toMatch(/^2 sessions sont actives/u);
	});
});

const REGLAGES = { ouvertureSession: false, version: '1.5.0', nouvelleVersion: null, chercherVersions: true };

describe('vue de l’app', () => {
	it('service vivant : état, infobulle, menu et pastille tirés des mêmes sessions', () => {
		const vie = { ...VIE_INITIALE, etat: 'vivant' as const };
		const v = vueApp(vie, [session({ id: 'a', etat: 'attend' }), session({ id: 'b' })], { ...REGLAGES, ouvertureSession: true });
		expect(v.etat).toBe('attend');
		expect(v.infobulle).toBe('Mnemo — 1 session attend ta réponse');
		expect(v.pastille).toBe('1');
		expect(v.menu.find((e) => e.type === 'case')).toMatchObject({ coche: true });
		expect(v.menu.filter((e) => e.type === 'action' && e.action.type === 'ouvrirSession')).toHaveLength(2);
	});

	it('aucune liste reçue : aucune session ; en erreur, la raison', () => {
		const v = vueApp({ ...VIE_INITIALE, etat: 'erreur', raison: 'Le service ne démarre pas.' }, null, REGLAGES);
		expect(v.etat).toBe('erreur');
		expect(v.infobulle).toBe('Mnemo — Le service ne démarre pas.');
		expect(v.pastille).toBe('');
	});
});
