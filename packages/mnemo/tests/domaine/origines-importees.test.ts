import { describe, expect, it } from 'vitest';
import { lireFiche } from '../../src/domaine/fiche.ts';
import type { Fiche } from '../../src/domaine/fiche.ts';
import { originesImportees, retirerOrigine, verserOrigines } from '../../src/domaine/origines-importees.ts';

const A = 'claude-code/alpha/memory/a.md';
const B = 'claude-code/beta/memory/a.md';
const C = 'claude-code/alpha/memory/c.md';
const fiche = (donnees: string): Fiche => lireFiche('x.md', `---\nid: 01X\ntype: source\n${donnees}updated: 2026-11-01\n---\n# X\n`);

describe('originesImportees', () => {
	it('sa propre origine, ses origines regroupées (même empreinte) et les empreintes notées ; une instruction de projet ne compte pas', () => {
		const f = fiche(`origine: ${A}\nempreinte_origine: h1\norigines: [${A}, ${B}, ${C}]\nempreintes_origines:\n  ${C}: h2\n`);
		expect([...originesImportees(f)]).toEqual([
			[A, 'h1'],
			[B, 'h1'],
			[C, 'h2'],
		]);
		expect(originesImportees(fiche('origine: claude-code/instructions\nempreinte_origine: h\n')).size).toBe(0);
		expect(originesImportees(fiche('')).size).toBe(0);
	});
});

describe('verserOrigines et retirerOrigine', () => {
	it('verse les origines absentes, la propre origine en tête ; retirer la dernière versée rend la fiche comme avant', () => {
		const f = fiche(`origine: ${A}\nempreinte_origine: h1\n`);
		expect(verserOrigines(f, new Map([[A, 'h1'], [C, 'h2']]))).toEqual([C]);
		expect(f.donnees['origines']).toEqual([A, C]);
		expect(f.donnees['empreintes_origines']).toEqual({ [C]: 'h2' });
		expect(verserOrigines(f, new Map([[C, 'h3']]))).toEqual([]);
		expect(retirerOrigine(f, C)).toBe(true);
		expect(f.donnees['origines']).toBeUndefined();
		expect(f.donnees['empreintes_origines']).toBeUndefined();
		expect(retirerOrigine(f, C)).toBe(false);
	});

	it('une fiche sans origine propre garde une seule origine versée', () => {
		const f = lireFiche('s.md', '---\nid: 01S\ntype: sujet\nupdated: 2026-11-01\n---\n# S\n');
		verserOrigines(f, new Map([[A, 'h1'], [C, 'h2']]));
		expect(retirerOrigine(f, A)).toBe(true);
		expect(f.donnees['origines']).toEqual([C]);
		expect(f.donnees['empreintes_origines']).toEqual({ [C]: 'h2' });
	});
});
