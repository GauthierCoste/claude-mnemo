import { describe, expect, it } from 'vitest';
import { PORTEURS_GARDES, porteursRecents, vecteurDuPorteur, noteDuPorteur, notesDuClassement } from '../../src/application/porteurs-recents.ts';

describe('porteursRecents', () => {
	it('garde le dernier message porteur de chaque session, les plus anciennes oubliées au-delà de la borne', () => {
		const p = porteursRecents();
		const vecteur = { modele: 'm@1', valeurs: Float32Array.from([1, 0]) };
		p.noter('s1', { rang: 1, position: 'a', vecteur: null });
		p.noter('s1', { rang: 2, position: 'a', vecteur });
		expect(p.lire('s1')).toEqual({ rang: 2, position: 'a', vecteur });
		expect(p.lire('inconnue')).toBeNull();
		for (let i = 0; i < PORTEURS_GARDES; i++) p.noter(`autre${i}`, { rang: 1, position: '', vecteur: null });
		expect(p.lire('s1')).toBeNull();
		expect(p.lire(`autre${PORTEURS_GARDES - 1}`)).not.toBeNull();
	});

	it('vecteur à joindre à un geste : avec le rang de son message ; rien sans vecteur', () => {
		const vecteur = { modele: 'm@1', valeurs: Float32Array.from([1]) };
		expect(vecteurDuPorteur({ rang: 3, position: '', vecteur })).toEqual({ rang: 3, vecteur });
		expect(vecteurDuPorteur({ rang: 3, position: '', vecteur: null })).toBeNull();
		expect(vecteurDuPorteur(null)).toBeNull();
	});
});

describe('noteDuPorteur', () => {
	it('la ligne de la fiche au dernier classement (sans id ni titre) ; absente, ou geste d’un autre message : undefined', () => {
		const classement = notesDuClassement([{ id: 'a.md', titre: 'A', note: 0.8, servi: false, rang: 1, piste: true }]);
		const porteur = { rang: 3, position: 'p', vecteur: null, classement };
		expect(noteDuPorteur(porteur, 'a.md')).toEqual({ note: 0.8, servi: false, rang: 1, piste: true });
		expect(noteDuPorteur(porteur, 'a.md', 3)).toEqual({ note: 0.8, servi: false, rang: 1, piste: true });
		expect(noteDuPorteur(porteur, 'a.md', 2)).toBeUndefined();
		expect(noteDuPorteur(porteur, 'b.md')).toBeUndefined();
		expect(noteDuPorteur(null, 'a.md')).toBeUndefined();
	});
});
