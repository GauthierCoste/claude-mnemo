import { describe, expect, it } from 'vitest';
import { suivreBlocsDeCode } from '../../src/domaine/blocs-de-code.ts';

const marquer = (lignes: string[]) => {
	const dansCode = suivreBlocsDeCode();
	return lignes.map((l) => dansCode(l));
};

describe('suivreBlocsDeCode', () => {
	it('ferme un bloc seulement avec le même caractère', () => {
		expect(marquer(['a', '~~~', '```', '## x', '~~~', '## y'])).toEqual([false, true, true, true, true, false]);
		expect(marquer(['```bash', '~~~', '## x', '```', 'b'])).toEqual([true, true, true, true, false]);
	});

	it('exige une clôture au moins aussi longue que l\'ouverture', () => {
		expect(marquer(['````', '```', '## x', '`````', '## y'])).toEqual([true, true, true, true, false]);
	});

	it('ne ferme pas sur une ligne qui porte du texte après la clôture', () => {
		expect(marquer(['```', '```js', '## x', '```', '## y'])).toEqual([true, true, true, true, false]);
	});

	it('n\'ouvre pas sur ``` suivi d\'un accent grave', () => {
		expect(marquer(['```a`b', '## x'])).toEqual([false, false]);
	});
});
