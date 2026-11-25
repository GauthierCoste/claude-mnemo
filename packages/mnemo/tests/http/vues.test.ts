import { describe, expect, it } from 'vitest';
import { PROFIL_ARCHIVISTE } from '@mnemo/commun';
import { vueSession } from '../../src/adaptateurs/http/vues.ts';
import type { Session } from '../../src/domaine/session.ts';

const archiviste = (surcharge: Partial<Session>): Session => ({
	id: 'a',
	profil: PROFIL_ARCHIVISTE,
	dossier: '',
	position: '',
	projet: '',
	objectif: null,
	etat: 'attend',
	creeeMs: 1,
	majMs: 1,
	arretAttendu: null,
	bilanDemandeMs: null,
	commitDebut: null,
	branche: null,
	pid: null,
	...surcharge,
});

describe('vueSession', () => {
	it('dialogueOuvert : vrai seulement si la dernière chose vue est une notification ; au repos après un arrêt, faux', () => {
		expect(vueSession(archiviste({ dernierArret: 'stop' }), true).dialogueOuvert).toBe(false);
		expect(vueSession(archiviste({ dernierArret: null }), true).dialogueOuvert).toBe(false);
		expect(vueSession(archiviste({ dernierArret: 'notification' }), true).dialogueOuvert).toBe(true);
		expect(vueSession(archiviste({ etat: 'travaille', dernierArret: 'notification' }), true).dialogueOuvert).toBe(false);
		// un dialogue d'avant le dernier lancement est fermé avec son processus
		expect(vueSession(archiviste({ dernierArret: 'notification', majMs: 10, lanceMs: 20 }), true).dialogueOuvert).toBe(false);
		expect(vueSession(archiviste({ dernierArret: 'notification', majMs: 30, lanceMs: 20 }), true).dialogueOuvert).toBe(true);
	});

	it('niveauModeles : celui de la session, null si elle suit le niveau de la machine', () => {
		expect(vueSession(archiviste({}), false).niveauModeles).toBeNull();
		expect(vueSession(archiviste({ niveauModeles: 'sens' }), false).niveauModeles).toBe('sens');
		expect(vueSession(archiviste({ niveauModeles: 'coupes' }), false).niveauModeles).toBe('coupes');
	});

	it('moteur, modèle et sansReprise : seulement s’ils sont connus ; jamais sansReprise pour une session terminée', () => {
		const avant = vueSession(archiviste({}), false);
		expect(avant).not.toHaveProperty('moteur');
		expect(avant).not.toHaveProperty('modele');
		expect(avant).not.toHaveProperty('sansReprise');
		expect(vueSession(archiviste({ moteur: 'claude-code', modele: '' }), false)).not.toHaveProperty('modele');
		expect(vueSession(archiviste({ moteur: 'codex', modele: 'gpt-a' }), false, 'fil inconnu')).toMatchObject({ moteur: 'codex', modele: 'gpt-a', sansReprise: 'fil inconnu' });
		expect(vueSession(archiviste({ etat: 'terminee', moteur: 'codex' }), false, 'fil inconnu')).not.toHaveProperty('sansReprise');
	});
});
