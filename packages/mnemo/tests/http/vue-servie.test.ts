import { describe, expect, it } from 'vitest';
import type { EntreeServie } from '../../src/application/ports.ts';
import { CLASSEMENT_VU_MAX, vueInjection, vueServie } from '../../src/adaptateurs/http/vues.ts';

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
	it('classement vivant sans `p` : pas de note calibrée (ordre seul), la note provisoire à part ; avec `p`, la note est `p` ; titre relu dans l’index', () => {
		const vue = vueServie(
			entree([
				{ id: 'a.md', note: 0.8, servi: false, rang: 1, signaux },
				{ id: 'b.md', note: 0.7, servi: true, rang: 2, signaux, p: 0.93 },
				{ id: 'c.md', note: null, servi: false, rang: 3, signaux },
			]),
			new Map([['a.md', 'Avoirs']]),
		);
		expect(vue.classement).toEqual([
			{ id: 'a.md', titre: 'Avoirs', note: null, servi: false, rang: 1, p: null, noteProvisoire: 0.8, signaux },
			{ id: 'b.md', titre: 'b', note: 0.93, servi: true, rang: 2, p: 0.93, signaux },
			{ id: 'c.md', titre: 'c', note: null, servi: false, rang: 3, p: null, signaux },
		]);
	});

	it('modèle appris mais refusé : sa note en `pNonCalibree` (jamais `p`), à la place de la note provisoire', () => {
		const vue = vueServie(entree([{ id: 'a.md', note: 0.8, servi: false, rang: 1, signaux, pNonCalibree: 0.92 }], { calibree: false }));
		expect(vue.classement[0]).toMatchObject({ note: null, p: null, pNonCalibree: 0.92 });
		expect(vue.classement[0]!.depart).toBeUndefined();
		// d'un modèle de départ : marquée comme telle
		const depart = vueServie(entree([{ id: 'a.md', note: 0.8, servi: false, rang: 1, signaux, pNonCalibree: 0.92, depart: true }], { calibree: false }));
		expect(depart.classement[0]).toMatchObject({ note: null, p: null, pNonCalibree: 0.92, depart: true });
		expect(vue.classement[0]).not.toHaveProperty('noteProvisoire');
		expect(vue.mesure).toBe('ordre');
	});

	it('champs du classement vivant : injectée par Mnemo, piste, raison, logit ; calibrée et mesure de l’entrée', () => {
		const vue = vueServie(
			entree(
				[
					{ id: 'a.md', note: 0.8, servi: true, rang: 1, signaux: { ...signaux, logit: 2.5, apriori: 0.1, cosinusZ: 1.2 }, p: 0.94, pSansApriori: 0.93, auto: true, raison: 'proche' },
					{ id: 'b.md', note: 0.7, servi: false, rang: 2, signaux, p: 0.4, piste: true, raison: 'perimetre', deja: 'proposee', rangHook: 3 },
				],
				{ calibree: true },
			),
		);
		expect(vue.calibree).toBe(true);
		expect(vue.mesure).toBe('complets');
		expect(vue.classement[0]).toEqual({ id: 'a.md', titre: 'a', note: 0.94, servi: true, rang: 1, p: 0.94, signaux: { ...signaux, logit: 2.5, apriori: 0.1, cosinusZ: 1.2 }, auto: true, raison: 'proche' });
		// ni `pSansApriori`, ni `deja`, ni `rangHook` : internes au service
		expect(vue.classement[1]).toEqual({ id: 'b.md', titre: 'b', note: 0.4, servi: false, rang: 2, p: 0.4, signaux, piste: true, raison: 'perimetre' });
		expect(vueServie(entree([{ id: 'a.md', note: 0.8, servi: false, rang: 1, signaux, p: 0.9 }], { calibree: true })).mesure).toBe('sens');
		expect(vueServie(entree([{ id: 'a.md', note: 0.8, servi: false, rang: 1, signaux }], { calibree: false })).mesure).toBe('ordre');
		// entrée ancienne : ni calibrée ni mesure
		expect(vueServie(entree([])).calibree).toBeUndefined();
		expect(vueServie(entree([])).mesure).toBeUndefined();
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

describe('vueInjection', () => {
	const geste = (g: 'injectee_main' | 'injectee_auto', note: Record<string, unknown> | null) => ({ rang: 1, horodatageMs: 5, geste: g, origine: 'utilisateur' as const, session: 's1', dossier: '', position: null, fiche: 'a.md', empreinte: null, message: null, rangMessage: 1, note, vecteur: null });
	it('à la main sans %, par Mnemo avec son p', () => {
		expect(vueInjection(geste('injectee_main', { note: 0.5, p: 0.6 }))).toEqual({ chemin: 'a.md', mode: 'main', horodatageMs: 5 });
		expect(vueInjection(geste('injectee_auto', { p: 0.94, niveau: 'sens' }))).toEqual({ chemin: 'a.md', mode: 'auto', horodatageMs: 5, p: 0.94 });
		expect(vueInjection(geste('injectee_auto', null))).toEqual({ chemin: 'a.md', mode: 'auto', horodatageMs: 5 });
	});
});
