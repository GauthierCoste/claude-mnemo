import { PROFIL_ARCHIVISTE } from '@mnemo/commun';
import { describe, expect, it } from 'vitest';
import { abreger, appliquerMessage, attendReponse, estActive, libelleSession, sessionsActives } from '../../src/domaine/sessions.ts';
import { session } from '../aides/sessions.ts';

describe('liste des sessions tenue par les messages', () => {
	it('`sessions` remplace la liste ; `session` remplace la session de même id ou l’ajoute', () => {
		const a = session({ id: 'a' });
		const b = session({ id: 'b' });
		let liste = appliquerMessage(null, { type: 'sessions', sessions: [a] });
		expect(liste).toEqual([a]);
		const a2 = session({ id: 'a', etat: 'attend' });
		liste = appliquerMessage(liste, { type: 'session', session: a2 });
		expect(liste).toEqual([a2]);
		liste = appliquerMessage(liste, { type: 'session', session: b });
		expect(liste).toEqual([a2, b]);
		expect(appliquerMessage(liste, { type: 'sessions', sessions: [] })).toEqual([]);
	});

	it('avant la première liste, `session` n’en crée pas ; les autres messages ne changent rien', () => {
		expect(appliquerMessage(null, { type: 'session', session: session({ id: 'a' }) })).toBeNull();
		const liste = [session({ id: 'a' })];
		expect(appliquerMessage(liste, { type: 'memoire', modifieeMs: 5 })).toBe(liste);
		expect(appliquerMessage(liste, { type: 'sortie', session: 'a', donnees: 'x' })).toBe(liste);
	});
});

describe('qui attend une réponse, qui est active', () => {
	it('une session de travail qui attend attend une réponse ; l’archiviste seulement si un dialogue est ouvert', () => {
		expect(attendReponse(session({ id: 'a', etat: 'attend' }))).toBe(true);
		expect(attendReponse(session({ id: 'b', etat: 'attend', profil: PROFIL_ARCHIVISTE }))).toBe(false);
		expect(attendReponse(session({ id: 'c', etat: 'attend', profil: PROFIL_ARCHIVISTE, dialogueOuvert: true }))).toBe(true);
		expect(attendReponse(session({ id: 'd', etat: 'travaille' }))).toBe(false);
	});

	it('active : travaille ou attend une réponse ; ni en pause, ni à relire, ni terminée, ni l’archiviste à l’écoute', () => {
		expect(estActive(session({ id: 'a', etat: 'travaille' }))).toBe(true);
		expect(estActive(session({ id: 'b', etat: 'attend' }))).toBe(true);
		for (const etat of ['en_pause', 'a_relire', 'terminee'] as const) expect(estActive(session({ id: 'c', etat }))).toBe(false);
		expect(estActive(session({ id: 'd', etat: 'attend', profil: PROFIL_ARCHIVISTE }))).toBe(false);
	});

	it('les actives : celles qui attendent d’abord, puis les plus anciennes d’abord', () => {
		const liste = [
			session({ id: 't2', etat: 'travaille', creeeMs: 20 }),
			session({ id: 'a2', etat: 'attend', creeeMs: 30 }),
			session({ id: 'p', etat: 'en_pause', creeeMs: 1 }),
			session({ id: 't1', etat: 'travaille', creeeMs: 10 }),
			session({ id: 'a1', etat: 'attend', creeeMs: 40 }),
		];
		expect(sessionsActives(liste).map((s) => s.id)).toEqual(['a2', 'a1', 't1', 't2']);
	});
});

describe('nom d’une session', () => {
	it('l’archiviste par son nom ; sinon l’objectif (première ligne), le dossier, la racine ; abrégé', () => {
		expect(libelleSession(session({ id: 'a', objectif: 'Relire le devis\nen détail' }))).toBe('Relire le devis');
		expect(libelleSession(session({ id: 'b', objectif: null }))).toBe('clients/exemple');
		expect(libelleSession(session({ id: 'c', objectif: '  ', dossier: '' }))).toBe('Session à la racine');
		expect(libelleSession(session({ id: 'r', objectif: 'Traite les fiches à traiter.', dossier: '', profil: PROFIL_ARCHIVISTE }))).toBe('Archiviste');
		const long = libelleSession(session({ id: 'd', objectif: 'x'.repeat(200) }));
		expect([...long]).toHaveLength(60);
		expect(long.endsWith('…')).toBe(true);
	});

	it('abreger laisse un texte court tel quel et compte les caractères, pas les unités UTF-16', () => {
		expect(abreger('court', 10)).toBe('court');
		expect(abreger('😀😀😀😀', 3)).toBe('😀😀…');
	});
});
