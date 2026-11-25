import { describe, expect, it } from 'vitest';
import type { EntreeServie } from '../../src/application/ports.ts';
import { CLASSEMENT_VU_MAX, vueServie } from '../../src/adaptateurs/http/vues.ts';

const entree = (classement: EntreeServie['classement'], extra: Partial<EntreeServie> = {}): EntreeServie => ({
	session: 's1',
	moment: 'message',
	horodatageMs: 1,
	ids: [],
	texte: '',
	ms: 1,
	sens: true,
	demande: null,
	classement,
	muet: null,
	cartes: [],
	position: null,
	...extra,
});
const signaux = { cosinus: 0.8, cosinusRelatif: 0.1, bm25Relatif: 0, signalSession: 0 };

describe('vueServie : classement', () => {
	it('classement vivant sans `p` : pas de note (ordre seul) ; avec `p`, la note est `p` ; titre relu dans l’index', () => {
		const vue = vueServie(
			entree([
				{ id: 'a.md', note: 0.8, servi: false, rang: 1, signaux },
				{ id: 'b.md', note: 0.7, servi: true, rang: 2, signaux, p: 0.93 },
			]),
			new Map([['a.md', 'Avoirs']]),
		);
		expect(vue.classement).toEqual([
			{ id: 'a.md', titre: 'Avoirs', note: null, servi: false, rang: 1 },
			{ id: 'b.md', titre: 'b', note: 0.93, servi: true, rang: 2 },
		]);
	});

	it('entrée ancienne : sa note (reranker) et son titre gardés', () => {
		expect(vueServie(entree([{ id: 'a.md#^f-1', titre: 'A', note: 0.4, servi: true, rang: 1 }])).classement).toEqual([{ id: 'a.md#^f-1', titre: 'A', note: 0.4, servi: true, rang: 1 }]);
	});

	it(`au plus ${CLASSEMENT_VU_MAX} lignes ; l’état d’affinage suit`, () => {
		const lignes = Array.from({ length: CLASSEMENT_VU_MAX + 5 }, (_, i) => ({ id: `f${i}.md`, note: null, servi: false, rang: i + 1, signaux }));
		const vue = vueServie(entree(lignes, { affinage: 'en_cours' }));
		expect(vue.classement).toHaveLength(CLASSEMENT_VU_MAX);
		expect(vue.affinage).toBe('en_cours');
	});
});
