import { describe, expect, it } from 'vitest';
import { DELAIS_RENOMMAGE, reessayer } from '../../src/infra/reessayer.ts';

const erreur = (code: string) => Object.assign(new Error(code), { code });

describe('reessayer', () => {
	it('réessaie les codes transitoires, puis réussit', async () => {
		let n = 0;
		const r = await reessayer(async () => {
			if (n++ < 3) throw erreur('EBUSY');
			return 'ok';
		}, [0, 0, 0, 0]);
		expect(r).toBe('ok');
		expect(n).toBe(4);
	});

	it('ne réessaie pas une autre erreur', async () => {
		let n = 0;
		await expect(reessayer(async () => {
			n++;
			throw erreur('ENOENT');
		}, [0, 0])).rejects.toThrow('ENOENT');
		expect(n).toBe(1);
	});

	it('rend la dernière erreur après tous les essais', async () => {
		let n = 0;
		await expect(reessayer(async () => {
			n++;
			throw erreur('EACCES');
		}, [0, 0])).rejects.toThrow('EACCES');
		expect(n).toBe(3);
	});

	it('par défaut : 5 essais, de 50 à 800 ms', () => {
		expect(DELAIS_RENOMMAGE).toEqual([50, 100, 200, 400, 800]);
	});
});
