import { describe, expect, it } from 'vitest';
import { ETATS_RELANCES, etatApres, objectifDe } from '../../src/domaine/session.ts';
import type { ArretAttendu, EtatSession, EvenementHook } from '../../src/domaine/session.ts';

const ETATS: EtatSession[] = ['travaille', 'attend', 'a_relire', 'en_pause'];
const ARRETS: ArretAttendu[] = [null, 'pause', 'bilan', 'abandon', 'service'];

describe('etatApres', () => {
	it.each(ETATS.flatMap((etat) => ARRETS.map((arretAttendu) => ({ etat, arretAttendu }))))(
		'debut, message, outil, arret ne dépendent pas de l\'arrêt attendu ($etat, $arretAttendu)',
		(s) => {
			expect(etatApres(s, 'debut')).toBe('attend');
			expect(etatApres(s, 'message')).toBe('travaille');
			expect(etatApres(s, 'outil')).toBe('travaille');
			expect(etatApres(s, 'arret')).toBe('attend');
		},
	);

	it.each([
		[null, 'a_relire'],
		['pause', 'en_pause'],
		['bilan', 'terminee'],
		['abandon', 'terminee'],
	] as const)('fin avec arrêt attendu %s : %s', (arretAttendu, attendu) => {
		for (const etat of ETATS) expect(etatApres({ etat, arretAttendu }, 'fin')).toBe(attendu);
	});

	it('fin avec arrêt « service » laisse l\'état inchangé', () => {
		for (const etat of ETATS) expect(etatApres({ etat, arretAttendu: 'service' }, 'fin')).toBe(etat);
	});

	it('terminee ne bouge plus', () => {
		const evenements: EvenementHook[] = ['debut', 'message', 'outil', 'arret', 'fin'];
		for (const e of evenements) for (const arretAttendu of ARRETS) expect(etatApres({ etat: 'terminee', arretAttendu }, e)).toBe('terminee');
	});
});

describe('objectifDe', () => {
	it('rend null pour un prompt vide ou blanc', () => {
		expect(objectifDe('')).toBeNull();
		expect(objectifDe(' \n\t\n  ')).toBeNull();
	});

	it('prend la première ligne non vide, espaces réduits', () => {
		expect(objectifDe('\n\n  Corriger   le\tbug  \nsuite\nencore')).toBe('Corriger le bug');
	});

	it('coupe à 200 caractères', () => {
		expect(objectifDe('x'.repeat(500))).toBe('x'.repeat(200));
	});
});

describe('ETATS_RELANCES', () => {
	it('liste les états relancés', () => {
		expect(ETATS_RELANCES).toEqual(['travaille', 'attend', 'a_relire']);
	});
});
