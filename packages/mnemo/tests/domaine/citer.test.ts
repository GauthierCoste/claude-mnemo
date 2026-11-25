import { describe, expect, it } from 'vitest';
import { citerPosix, citerPowerShell } from '../../src/domaine/citer.ts';

describe('citer', () => {
	it('POSIX : entre apostrophes, une apostrophe devient \'\\\'\'', () => {
		expect(citerPosix("/a/l'outil/b c")).toBe("'/a/l'\\''outil/b c'");
	});

	it('PowerShell : apostrophes doublées, typographiques comprises (’ ‘ ‚ ‛, lues comme \')', () => {
		expect(citerPowerShell("C:\\l'outil")).toBe("'C:\\l''outil'");
		expect(citerPowerShell('C:\\l’outil ‘a‚b‛')).toBe("'C:\\l’’outil ‘‘a‚‚b‛‛'");
		expect(citerPowerShell('$env:X `y` "z"')).toBe('\'$env:X `y` "z"\'');
	});
});
