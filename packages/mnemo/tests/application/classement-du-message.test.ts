import { describe, expect, it } from 'vitest';
import { arrondi, CLASSEMENT_MAX, classementDuJournal } from '../../src/application/classement-du-message.ts';
import type { LigneDeClassement } from '../../src/application/classement-du-message.ts';
import { couperClassement } from '../../src/domaine/couper-classement.ts';

const ligne = (i: number, surcharge: Partial<LigneDeClassement> = {}): LigneDeClassement => ({
	chemin: `f/${i}.md`,
	titre: `F${i}`,
	note: 0.812345678 - i / 1000,
	p: null,
	signaux: { cosinus: 0.812345678, cosinusRelatif: 0.1234567, cosinusZ: 1.23456789, bm25Relatif: null, signalSession: 0, apriori: 0 },
	logit: null,
	deja: i === 1 ? 'injectee' : null,
	raison: i === 0 ? 'perimetre' : null,
	piste: i === 0,
	...surcharge,
});

describe('classementDuJournal', () => {
	it('léger : sans titre, note et signaux à 4 décimales, p omis tant qu’il est null ; rangs à partir de 1, servi pour une fiche injectée', () => {
		const [premiere, seconde] = classementDuJournal([ligne(0), ligne(1, { p: 0.912345 })]);
		expect(premiere).toEqual({
			id: 'f/0.md',
			note: 0.8123,
			servi: false,
			rang: 1,
			signaux: { cosinus: 0.8123, cosinusRelatif: 0.1235, cosinusZ: 1.2346, bm25Relatif: null, signalSession: 0, apriori: 0 },
			piste: true,
			raison: 'perimetre',
		});
		expect(seconde).toMatchObject({ id: 'f/1.md', servi: true, rang: 2, deja: 'injectee', p: 0.9123 });
		expect(seconde).not.toHaveProperty('titre');
		expect(seconde).not.toHaveProperty('piste');
		expect(seconde).not.toHaveProperty('coupees');
	});

	it('le logit brut du reranker, s’il a noté la candidate au hook ; omis sinon', () => {
		const [notee, absente] = classementDuJournal([ligne(0, { logit: -2.345678 }), ligne(1)]);
		expect(notee!.signaux).toMatchObject({ logit: -2.3457 });
		expect(absente!.signaux).not.toHaveProperty('logit');
	});

	it(`au plus ${CLASSEMENT_MAX} lignes, les mieux classées ; la dernière gardée compte les coupées`, () => {
		const journal = classementDuJournal(Array.from({ length: CLASSEMENT_MAX + 7 }, (_, i) => ligne(i)));
		expect(journal).toHaveLength(CLASSEMENT_MAX);
		expect(journal.at(-1)).toMatchObject({ rang: CLASSEMENT_MAX, coupees: 7 });
		expect(journal.filter((l) => l.coupees !== undefined)).toHaveLength(1);
	});

	it('arrondi : quatre décimales, null gardé', () => {
		expect(arrondi(0.123456)).toBe(0.1235);
		expect(arrondi(null)).toBeNull();
	});
});

describe('couperClassement', () => {
	it('garde les premières lignes ; la dernière gardée cumule les coupées', () => {
		const lignes = Array.from({ length: 10 }, (_, i) => ({ id: `${i}`, ...(i === 9 ? { coupees: 5 } : {}) }));
		const coupe = couperClassement(lignes, 3);
		expect(coupe).toEqual([{ id: '0' }, { id: '1' }, { id: '2', coupees: 12 }]);
		expect(couperClassement(lignes.slice(0, 3), 3)).toEqual(lignes.slice(0, 3));
	});
});
