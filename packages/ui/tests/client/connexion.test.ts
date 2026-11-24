import { CODE_FERMETURE_LENT } from '@mnemo/contrat';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { creerConnexion, LENTS_AVANT_DELAI, type EtatConnexion } from '../../src/client/connexion.ts';
import { FauxWebSocket, FauxWebSocketType } from '../aides/faux-websocket.ts';
import { laisserPasser, minuterieSimulee } from '../aides/installer.ts';

function connecter(verifierJeton: () => Promise<boolean> = async () => true) {
	const minuterie = minuterieSimulee();
	const etats: EtatConnexion[] = [];
	const connexion = creerConnexion({ url: 'ws://127.0.0.1:4100/ws?jeton=x', WebSocket: FauxWebSocketType, verifierJeton, minuterie });
	connexion.surEtat((e) => etats.push(e));
	return { connexion, minuterie, etats };
}

beforeEach(() => FauxWebSocket.reinitialiser());

describe('connexion', () => {
	it('ouvre la socket et passe en « ouverte »', () => {
		const { connexion, etats } = connecter();
		expect(connexion.etat()).toBe('connexion');
		FauxWebSocket.derniere().ouvrir();
		expect(connexion.etat()).toBe('ouverte');
		expect(etats).toEqual(['ouverte']);
		expect(FauxWebSocket.derniere().url).toBe('ws://127.0.0.1:4100/ws?jeton=x');
	});

	it('délais successifs 0,5 s → 10 s, puis 10 s', async () => {
		const { minuterie, connexion } = connecter();
		FauxWebSocket.derniere().ouvrir();
		for (let i = 0; i < 7; i++) {
			FauxWebSocket.derniere().fermerDepuisServeur(1006);
			await laisserPasser();
			expect(connexion.etat()).toBe('reconnexion');
			expect(minuterie.avancer()).toBe(true);
		}
		expect(minuterie.delais).toEqual([500, 1000, 2000, 5000, 10000, 10000, 10000]);
		expect(FauxWebSocket.instances).toHaveLength(8);
	});

	it('une ouverture réussie remet les délais à zéro', async () => {
		const { minuterie } = connecter();
		FauxWebSocket.derniere().fermerDepuisServeur();
		await laisserPasser();
		minuterie.avancer();
		FauxWebSocket.derniere().ouvrir();
		FauxWebSocket.derniere().fermerDepuisServeur();
		await laisserPasser();
		expect(minuterie.delais).toEqual([500, 500]);
	});

	it(`${CODE_FERMETURE_LENT} → reconnexion immédiate`, () => {
		const { minuterie } = connecter();
		FauxWebSocket.derniere().ouvrir();
		FauxWebSocket.derniere().fermerDepuisServeur(CODE_FERMETURE_LENT);
		expect(minuterie.delais).toEqual([]);
		expect(FauxWebSocket.instances).toHaveLength(2);
	});

	it('deux échecs de suite + jeton refusé → « jeton_refuse », plus aucun essai', async () => {
		const verifierJeton = vi.fn(async () => false);
		const { connexion, minuterie, etats } = connecter(verifierJeton);
		FauxWebSocket.derniere().fermerDepuisServeur();
		await laisserPasser();
		expect(verifierJeton).not.toHaveBeenCalled();
		minuterie.avancer();
		FauxWebSocket.derniere().fermerDepuisServeur();
		await laisserPasser();
		expect(verifierJeton).toHaveBeenCalledOnce();
		expect(connexion.etat()).toBe('jeton_refuse');
		expect(etats.at(-1)).toBe('jeton_refuse');
		expect(minuterie.enAttente()).toBe(0);
		expect(FauxWebSocket.instances).toHaveLength(2);
	});

	it('vérification du jeton impossible (service absent) → on continue', async () => {
		const { connexion, minuterie } = connecter(async () => {
			throw new Error('réseau');
		});
		FauxWebSocket.derniere().fermerDepuisServeur();
		await laisserPasser();
		minuterie.avancer();
		FauxWebSocket.derniere().fermerDepuisServeur();
		await laisserPasser();
		expect(connexion.etat()).toBe('reconnexion');
		expect(minuterie.enAttente()).toBe(1);
	});

	it('réabonnement après réouverture', async () => {
		const { connexion, minuterie } = connecter();
		connexion.abonner('s1', () => {});
		connexion.abonner('s2', () => {});
		FauxWebSocket.derniere().ouvrir();
		expect(FauxWebSocket.derniere().envoyesDeType('abonner')).toEqual([
			{ type: 'abonner', session: 's1' },
			{ type: 'abonner', session: 's2' },
		]);
		FauxWebSocket.derniere().fermerDepuisServeur();
		await laisserPasser();
		minuterie.avancer();
		FauxWebSocket.derniere().ouvrir();
		expect(FauxWebSocket.derniere().envoyesDeType('abonner')).toHaveLength(2);
	});

	it("deux abonnés d'une session : le second redemande la relecture (desabonner, abonner) ; un seul desabonner au dernier départ", () => {
		const { connexion } = connecter();
		FauxWebSocket.derniere().ouvrir();
		const a = vi.fn();
		const b = vi.fn();
		const finA = connexion.abonner('s1', a);
		const socket = FauxWebSocket.derniere();
		expect(socket.envoyes).toEqual([{ type: 'abonner', session: 's1' }]);
		const finB = connexion.abonner('s1', b);
		expect(socket.envoyes).toEqual([
			{ type: 'abonner', session: 's1' },
			{ type: 'desabonner', session: 's1' },
			{ type: 'abonner', session: 's1' },
		]);
		socket.envoyes = [];
		socket.recevoir({ type: 'sortie', session: 's1', donnees: 'x' });
		socket.recevoir({ type: 'sortie', session: 's2', donnees: 'y' });
		expect(a).toHaveBeenCalledWith({ type: 'sortie', session: 's1', donnees: 'x' });
		expect(b).toHaveBeenCalledOnce();
		finA();
		finA();
		expect(socket.envoyesDeType('desabonner')).toHaveLength(0);
		finB();
		expect(socket.envoyesDeType('desabonner')).toEqual([{ type: 'desabonner', session: 's1' }]);
	});

	it('retard → desabonner puis abonner (nouvelle relecture)', () => {
		const { connexion } = connecter();
		const f = vi.fn();
		connexion.abonner('s1', f);
		const socket = FauxWebSocket.derniere();
		socket.ouvrir();
		socket.envoyes = [];
		socket.recevoir({ type: 'retard', session: 's1' });
		expect(socket.envoyes).toEqual([
			{ type: 'desabonner', session: 's1' },
			{ type: 'abonner', session: 's1' },
		]);
		expect(f).toHaveBeenCalledWith({ type: 'retard', session: 's1' });
	});

	it('envoyer sur une connexion fermée → false', () => {
		const { connexion } = connecter();
		const entree = { type: 'entree', session: 's1', donnees: 'a' } as const;
		expect(connexion.envoyer(entree)).toBe(false);
		FauxWebSocket.derniere().ouvrir();
		expect(connexion.envoyer(entree)).toBe(true);
		FauxWebSocket.derniere().fermerDepuisServeur();
		expect(connexion.envoyer(entree)).toBe(false);
	});

	it('messages diffusés aux écouteurs ; fermer() arrête tout', () => {
		const { connexion, minuterie } = connecter();
		const f = vi.fn();
		const fin = connexion.surMessage(f);
		FauxWebSocket.derniere().ouvrir();
		FauxWebSocket.derniere().recevoir({ type: 'memoire', modifieeMs: 3 });
		expect(f).toHaveBeenCalledWith({ type: 'memoire', modifieeMs: 3 });
		fin();
		FauxWebSocket.derniere().recevoir({ type: 'memoire', modifieeMs: 4 });
		expect(f).toHaveBeenCalledOnce();
		connexion.fermer();
		expect(minuterie.enAttente()).toBe(0);
		expect(FauxWebSocket.instances).toHaveLength(1);
	});

	it('message illisible ignoré', () => {
		const { connexion } = connecter();
		const f = vi.fn();
		connexion.surMessage(f);
		FauxWebSocket.derniere().ouvrir();
		FauxWebSocket.derniere().onmessage?.({ data: '{pas du json' } as MessageEvent);
		expect(f).not.toHaveBeenCalled();
	});

	it(`${CODE_FERMETURE_LENT} répétés → délais normaux au-delà de ${LENTS_AVANT_DELAI} d'affilée, compte remis par une autre fermeture`, async () => {
		const { minuterie } = connecter();
		for (let i = 1; i < LENTS_AVANT_DELAI; i++) {
			FauxWebSocket.derniere().ouvrir();
			FauxWebSocket.derniere().fermerDepuisServeur(CODE_FERMETURE_LENT);
		}
		expect(minuterie.delais).toEqual([]);
		expect(FauxWebSocket.instances).toHaveLength(LENTS_AVANT_DELAI);
		FauxWebSocket.derniere().ouvrir();
		FauxWebSocket.derniere().fermerDepuisServeur(CODE_FERMETURE_LENT);
		expect(minuterie.delais).toEqual([500]);
		expect(FauxWebSocket.instances).toHaveLength(LENTS_AVANT_DELAI);
		minuterie.avancer();
		FauxWebSocket.derniere().ouvrir();
		FauxWebSocket.derniere().fermerDepuisServeur(1006);
		await laisserPasser();
		minuterie.avancer();
		FauxWebSocket.derniere().ouvrir();
		const avant = FauxWebSocket.instances.length;
		FauxWebSocket.derniere().fermerDepuisServeur(CODE_FERMETURE_LENT);
		expect(FauxWebSocket.instances).toHaveLength(avant + 1);
	});

	it('un écouteur qui s’abonne à l’ouverture n’envoie qu’un abonner', () => {
		const { connexion } = connecter();
		connexion.surEtat((e) => {
			if (e === 'ouverte') connexion.abonner('s3', () => {});
		});
		FauxWebSocket.derniere().ouvrir();
		expect(FauxWebSocket.derniere().envoyesDeType('abonner')).toEqual([{ type: 'abonner', session: 's3' }]);
	});

	it('fermer() pendant une attente de reconnexion → minuteur annulé, aucune socket', async () => {
		const { connexion, minuterie } = connecter();
		FauxWebSocket.derniere().fermerDepuisServeur();
		await laisserPasser();
		expect(minuterie.enAttente()).toBe(1);
		connexion.fermer();
		expect(minuterie.enAttente()).toBe(0);
		expect(FauxWebSocket.instances).toHaveLength(1);
	});

	it('fermer() pendant verifierJeton → jamais jeton_refuse, aucun minuteur', async () => {
		let repondre!: (v: boolean) => void;
		const { connexion, minuterie } = connecter(() => new Promise<boolean>((r) => (repondre = r)));
		FauxWebSocket.derniere().fermerDepuisServeur();
		await laisserPasser();
		minuterie.avancer();
		FauxWebSocket.derniere().fermerDepuisServeur();
		await laisserPasser();
		connexion.fermer();
		repondre(false);
		await laisserPasser();
		expect(connexion.etat()).not.toBe('jeton_refuse');
		expect(minuterie.enAttente()).toBe(0);
		expect(FauxWebSocket.instances).toHaveLength(2);
	});

	it('message reçu après fermer() → ignoré', () => {
		const { connexion } = connecter();
		const f = vi.fn();
		connexion.surMessage(f);
		const socket = FauxWebSocket.derniere();
		socket.ouvrir();
		connexion.fermer();
		socket.recevoir({ type: 'memoire', modifieeMs: 1 });
		expect(f).not.toHaveBeenCalled();
	});
});
