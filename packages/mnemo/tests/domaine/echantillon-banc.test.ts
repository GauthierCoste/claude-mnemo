import { describe, expect, it } from 'vitest';
import { choisirMessages, cleDeMessage, entrelacer } from '../../src/domaine/echantillon-banc.ts';
import type { MessageDuJournal } from '../../src/domaine/echantillon-banc.ts';

const message = (session: string, groupe: string, rang: number, texte: string, horodatageMs = rang): MessageDuJournal => ({
	session,
	groupe,
	rang,
	horodatageMs,
	message: texte,
	position: groupe,
	precedent: null,
});

/** Deux projets : A (deux sessions de 5 messages), B (une session de 5 messages). */
const JOURNAL: MessageDuJournal[] = [
	...[1, 2, 3, 4, 5].map((r) => message('s1', 'A', r, `projet A session 1 message ${r}`, 100 + r)),
	...[1, 2, 3, 4, 5].map((r) => message('s2', 'A', r, `projet A session 2 message ${r}`, 200 + r)),
	...[1, 2, 3, 4, 5].map((r) => message('s3', 'B', r, `projet B session 3 message ${r}`, 300 + r)),
];

describe('entrelacer', () => {
	it('premiers messages et suites alternent, mêlés mais dans un ordre fixe', () => {
		const ordre = entrelacer(JOURNAL);
		expect(ordre).toHaveLength(JOURNAL.length);
		expect(ordre.slice(0, 6).map((m) => m.rang === 1)).toEqual([true, false, true, false, true, false]);
		expect(entrelacer([...JOURNAL].reverse())).toEqual(ordre);
		expect(ordre.filter((m) => m.rang > 1).map((m) => m.message)).not.toEqual(JOURNAL.filter((m) => m.rang > 1).map((m) => m.message));
	});
});

describe('choisirMessages', () => {
	it('alterne les projets, puis les sessions d’un projet ; chaque session donne d’abord son premier message', () => {
		const choisis = choisirMessages(JOURNAL, { nombre: 4, parSession: 10 });
		expect(choisis.map((m) => [m.session, m.rang])).toEqual([
			['s2', 1],
			['s3', 1],
			['s1', 1],
			expect.arrayContaining(['s3']),
		]);
	});

	it('au plus `parSession` messages par session ; le nombre est tenu', () => {
		const choisis = choisirMessages(JOURNAL, { nombre: 100, parSession: 2 });
		expect(choisis).toHaveLength(6);
		for (const s of ['s1', 's2', 's3']) expect(choisis.filter((m) => m.session === s)).toHaveLength(2);
		expect(choisirMessages(JOURNAL, { nombre: 3, parSession: 5 })).toHaveLength(3);
	});

	it('dédoublonne : même texte (casse et espaces mis à part) pris une seule fois, et jamais un message déjà connu', () => {
		const doublons = [message('s1', 'A', 1, 'Revoir la maquette'), message('s2', 'B', 1, '  revoir   la MAQUETTE '), message('s3', 'B', 1, 'déjà au banc')];
		const choisis = choisirMessages(doublons, { nombre: 10, parSession: 10, connus: new Set([cleDeMessage('Déjà au banc')]) });
		expect(choisis.map((m) => m.message)).toEqual(['Revoir la maquette']);
	});

	it('déterministe', () => {
		expect(choisirMessages(JOURNAL, { nombre: 9, parSession: 3 })).toEqual(choisirMessages([...JOURNAL].reverse(), { nombre: 9, parSession: 3 }));
	});
});
