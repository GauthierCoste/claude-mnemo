import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { memoireAuDessus, VARIABLES_NEUTRALISEES, verifierIsolement } from '../../../outils-tests/isolement.ts';

const dossiers: string[] = [];
afterEach(() => {
	for (const d of dossiers.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** Une fausse mémoire (`_mnemo/SCHEMA.md`) avec un sous-dossier profond. */
function fausseMemoire(): { racine: string; profond: string } {
	const racine = realpathSync(mkdtempSync(join(tmpdir(), 'mnemo-garde-')));
	dossiers.push(racine);
	mkdirSync(join(racine, '_mnemo'));
	writeFileSync(join(racine, '_mnemo', 'SCHEMA.md'), '# schéma\n');
	const profond = join(racine, 'a', 'b');
	mkdirSync(profond, { recursive: true });
	return { racine, profond };
}

describe('garde des tests (outils-tests/garde.ts)', () => {
	it('a placé HOME et le dossier courant dans un dossier temporaire sans mémoire au-dessus, et vidé les variables', () => {
		expect(process.cwd().startsWith(realpathSync(tmpdir()))).toBe(true);
		expect(homedir()).toBe(process.cwd());
		expect(memoireAuDessus(process.cwd())).toBeNull();
		expect(memoireAuDessus(homedir())).toBeNull();
		for (const nom of VARIABLES_NEUTRALISEES) expect(process.env[nom]).toBeUndefined();
	});

	it('memoireAuDessus trouve une mémoire en remontant', () => {
		const { racine, profond } = fausseMemoire();
		expect(memoireAuDessus(profond)).toBe(racine);
		expect(memoireAuDessus(racine)).toBe(racine);
	});

	it('verifierIsolement lève pour une mémoire au-dessus du dossier courant ou de HOME, ou une variable posée', () => {
		const { profond } = fausseMemoire();
		const libre = realpathSync(mkdtempSync(join(tmpdir(), 'mnemo-garde-libre-')));
		dossiers.push(libre);
		expect(() => verifierIsolement(libre, libre, {})).not.toThrow();
		expect(() => verifierIsolement(profond, libre, {})).toThrow(/dossier courant/u);
		expect(() => verifierIsolement(libre, profond, {})).toThrow(/HOME/u);
		expect(() => verifierIsolement(libre, libre, { MNEMO_RACINE: '/x' })).toThrow(/MNEMO_RACINE/u);
		expect(() => verifierIsolement(libre, libre, { CLAUDE_PROJECT_DIR: '' })).not.toThrow();
	});
});
