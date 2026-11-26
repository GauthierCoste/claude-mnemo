import { describe, expect, it } from 'vitest';
import { calculsEnCours, compte } from '../../src/adaptateurs/http/calculs-en-cours.ts';

describe('calculs en cours (hooks, affinages)', () => {
	it('comptés tant qu’ils tournent ; l’instant du dernier, au début puis à la fin ; une fin comptée une fois', () => {
		let ms = 100;
		const c = calculsEnCours(() => ms);
		expect(c.enCours()).toBe(0);
		expect(c.dernierMs()).toBe(-Infinity);
		const fin1 = c.commencer();
		ms = 200;
		const fin2 = c.commencer();
		expect(c.enCours()).toBe(2);
		expect(c.dernierMs()).toBe(200);
		ms = 300;
		fin1();
		fin1();
		expect(c.enCours()).toBe(1);
		ms = 400;
		fin2();
		expect(c.enCours()).toBe(0);
		expect(c.dernierMs()).toBe(400);
	});

	it('compte : l’action comptée pendant qu’elle tourne, même en échec ; sans compteur, telle quelle', async () => {
		const c = calculsEnCours();
		let pendant = -1;
		const action = compte(c, async (x: number) => {
			pendant = c.enCours();
			if (x < 0) throw new Error('négatif');
			return x * 2;
		});
		expect(await action(2)).toBe(4);
		expect(pendant).toBe(1);
		await expect(action(-1)).rejects.toThrow('négatif');
		expect(c.enCours()).toBe(0);
		const seule = async () => 1;
		expect(compte(undefined, seule)).toBe(seule);
	});
});
