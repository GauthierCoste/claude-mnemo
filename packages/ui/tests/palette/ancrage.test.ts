import { describe, expect, it } from 'vitest';
import { ECART_MENU, LARGEUR_MIN_MENU, MARGE_FENETRE, positionMenu } from '../../src/palette/ancrage.ts';

const rect = (left: number, width: number) => ({ left, width, top: 8, bottom: 36, height: 28 });

describe('palette : ancrage du menu sous le champ', () => {
	it('même bord gauche et même largeur que le champ, juste dessous ; le champ de la palette le recouvre', () => {
		expect(positionMenu(rect(300, 420), 1400)).toEqual({ champ: { left: 300, top: 8, width: 420, height: 28 }, menu: { left: 300, top: 36 + ECART_MENU, width: 420 } });
	});

	it('champ étroit : largeur minimale, bord gauche gardé ; sans place à droite, le menu recule juste assez', () => {
		expect(positionMenu(rect(200, 220), 1000).menu).toMatchObject({ left: 200, width: LARGEUR_MIN_MENU });
		expect(positionMenu(rect(500, 220), 800).menu).toMatchObject({ left: 800 - MARGE_FENETRE - LARGEUR_MIN_MENU, width: LARGEUR_MIN_MENU });
		expect(positionMenu(rect(100, 220), 300).menu).toMatchObject({ left: MARGE_FENETRE, width: 300 - 2 * MARGE_FENETRE });
	});
});
