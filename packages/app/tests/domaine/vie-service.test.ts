import { describe, expect, it } from 'vitest';
import { DUREE_STABLE_MS, type EvenementService, evoluerVie, RAISON_TOMBE, VIE_INITIALE, type VieService } from '../../src/domaine/vie-service.ts';

/** Rejoue des événements depuis l'état initial ; rend l'état final et les actions demandées. */
function rejouer(evenements: EvenementService[], depart: VieService = VIE_INITIALE): { vie: VieService; actions: (string | null)[] } {
	let vie = depart;
	const actions: (string | null)[] = [];
	for (const e of evenements) {
		const r = evoluerVie(vie, e);
		vie = r.vie;
		actions.push(r.action);
	}
	return { vie, actions };
}

describe('vie du service et relance', () => {
	it('démarrage demandé : lancer ; le service répond : vivant', () => {
		const r = rejouer([{ type: 'demarrageDemande' }, { type: 'vivant', maintenantMs: 0 }]);
		expect(r.actions).toEqual(['demarrer', null]);
		expect(r.vie.etat).toBe('vivant');
	});

	it('une demande pendant le démarrage ou service vivant ne relance pas', () => {
		expect(rejouer([{ type: 'demarrageDemande' }, { type: 'demarrageDemande' }]).actions).toEqual(['demarrer', null]);
		expect(rejouer([{ type: 'vivant', maintenantMs: 0 }, { type: 'demarrageDemande' }]).actions).toEqual([null, null]);
	});

	it('une chute : une relance automatique ; une seconde chute peu après : l’erreur, sans relance', () => {
		const r = rejouer([
			{ type: 'vivant', maintenantMs: 0 },
			{ type: 'tombe', maintenantMs: 1000 },
			{ type: 'vivant', maintenantMs: 2000 },
			{ type: 'tombe', maintenantMs: 3000 },
		]);
		expect(r.actions).toEqual([null, 'demarrer', null, null]);
		expect(r.vie).toMatchObject({ etat: 'erreur', raison: RAISON_TOMBE });
		// le service en erreur ne retombe pas
		expect(evoluerVie(r.vie, { type: 'tombe', maintenantMs: 4000 }).action).toBeNull();
	});

	it('la relance échoue : l’erreur, avec sa raison', () => {
		const r = rejouer([{ type: 'vivant', maintenantMs: 0 }, { type: 'tombe', maintenantMs: 1 }, { type: 'echecDemarrage', raison: 'Pas de réponse en 30 s.' }]);
		expect(r.vie).toMatchObject({ etat: 'erreur', raison: 'Pas de réponse en 30 s.' });
	});

	it('après une longue vie depuis la relance, une nouvelle chute est relancée de nouveau', () => {
		const r = rejouer([
			{ type: 'vivant', maintenantMs: 0 },
			{ type: 'tombe', maintenantMs: 1000 },
			{ type: 'vivant', maintenantMs: 2000 },
			{ type: 'tombe', maintenantMs: 2000 + DUREE_STABLE_MS },
		]);
		expect(r.actions.at(-1)).toBe('demarrer');
		expect(r.vie.etat).toBe('demarrage');
	});

	it('« Redémarrer le service » depuis l’erreur relance et remet le compte à zéro', () => {
		const erreur = rejouer([{ type: 'vivant', maintenantMs: 0 }, { type: 'tombe', maintenantMs: 1 }, { type: 'vivant', maintenantMs: 2 }, { type: 'tombe', maintenantMs: 3 }]).vie;
		const r = rejouer([{ type: 'demarrageDemande' }, { type: 'vivant', maintenantMs: 10 }, { type: 'tombe', maintenantMs: 11 }], erreur);
		expect(r.actions).toEqual(['demarrer', null, 'demarrer']);
	});

	it('arrêté : plus de relance à la chute ; un service revenu de lui-même redevient vivant', () => {
		const arrete = rejouer([{ type: 'vivant', maintenantMs: 0 }, { type: 'arrete' }]);
		expect(arrete.vie.etat).toBe('arrete');
		expect(evoluerVie(arrete.vie, { type: 'tombe', maintenantMs: 5 }).action).toBeNull();
		expect(evoluerVie(arrete.vie, { type: 'vivant', maintenantMs: 5 }).vie.etat).toBe('vivant');
	});

	it('arrêt demandé : en arrêt ; ni réponse tardive, ni chute, ni démarrage ne changent rien ; la mort confirmée : arrêté', () => {
		const enArret = rejouer([{ type: 'vivant', maintenantMs: 0 }, { type: 'arretDemande' }]);
		expect(enArret.vie.etat).toBe('arret');
		const r = rejouer(
			[{ type: 'vivant', maintenantMs: 1 }, { type: 'tombe', maintenantMs: 2 }, { type: 'demarrageDemande' }, { type: 'arrete' }],
			enArret.vie,
		);
		expect(r.actions).toEqual([null, null, null, null]);
		expect(r.vie.etat).toBe('arrete');
	});

	it('arrêt échoué : de nouveau vivant, avec ses droits à la relance ; hors arrêt, sans effet', () => {
		const r = rejouer([{ type: 'vivant', maintenantMs: 0 }, { type: 'arretDemande' }, { type: 'arretEchoue' }, { type: 'tombe', maintenantMs: 5 }]);
		expect(r.actions).toEqual([null, null, null, 'demarrer']);
		expect(rejouer([{ type: 'arretDemande' }, { type: 'arretEchoue' }]).vie.etat).toBe('arrete');
	});
});
