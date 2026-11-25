import { describe, expect, it } from 'vitest';
import { echelleDesSignaux, jsonDeCoefficients, lireCoefficients, modeleNonAppris } from '../../src/domaine/modele-de-note.ts';
import { REGLAGES_PAR_DEFAUT } from '../../src/domaine/reglages.ts';
import type { ModeleDeNote, SignauxDeNote } from '../../src/domaine/modele-de-note.ts';
import { COEFFICIENTS_NOTE } from '../../src/domaine/coefficients-note.ts';
import { classementCalibre, etatDuModele, modelesDeNote, noteApprise, noteDeConfiance, noterLaCandidate, ordonnerParNote, pCalibre } from '../../src/domaine/note-de-confiance.ts';
import { sigmoide } from '../../src/domaine/regression-logistique.ts';

const INSTALLES = { sens: 'sens.gguf@aaaaaaaaaaaa', reranker: 'reranker.gguf@bbbbbbbbbbbb' };
const ECHELLE = echelleDesSignaux(REGLAGES_PAR_DEFAUT.contexte);
const modele = (surcharge: Partial<ModeleDeNote> = {}): ModeleDeNote => ({
	...modeleNonAppris(),
	apprisLe: '2026-11-25',
	refus: [],
	accepte: true,
	gguf: INSTALLES,
	echelle: ECHELLE,
	poids: { cosinusRelatif: 1 },
	...surcharge,
});
const SENS = modele({ biais: -1, poids: { cosinusRelatif: 4, bm25Relatif: 2, signalSession: 1, apriori: 0.5 } });
const COMPLETS = modele({ biais: -2, poids: { logit: 0.8, cosinusRelatif: 2 } });
const s = (surcharge: Partial<SignauxDeNote> = {}): SignauxDeNote => ({ cosinusRelatif: 0.1, cosinusZ: 1.5, bm25Relatif: 0.5, signalSession: 0, apriori: 0, ...surcharge });

describe('noteDeConfiance', () => {
	it('p = σ(biais + Σ poids·variable)', () => {
		const n = noteDeConfiance(SENS, 'sens', s({ signalSession: 0.3, apriori: 0.4 }))!;
		const z = -1 + 4 * 0.1 + 2 * 0.5 + 0.3 + 0.5 * 0.4;
		expect(n.p).toBeCloseTo(sigmoide(z), 12);
		expect(n.pSansApriori).toBeCloseTo(sigmoide(z - 0.5 * 0.4), 12);
	});

	it('monotone en chaque variable (poids ≥ 0)', () => {
		const base = noteDeConfiance(SENS, 'sens', s())!.p;
		for (const plus of [{ cosinusRelatif: 0.2 }, { bm25Relatif: 0.9 }, { signalSession: 0.5 }, { apriori: 1 }]) expect(noteDeConfiance(SENS, 'sens', s(plus))!.p).toBeGreaterThan(base);
	});

	it('conventions de l’apprentissage : bm25 null = 0, signal et a priori absents = 0, cosinus null : pas de note', () => {
		expect(noteDeConfiance(SENS, 'sens', s({ bm25Relatif: null }))!.p).toBeCloseTo(noteDeConfiance(SENS, 'sens', s({ bm25Relatif: 0 }))!.p, 12);
		const { signalSession: _s, apriori: _a, ...sans } = s();
		expect(noteDeConfiance(SENS, 'sens', sans)!.p).toBeCloseTo(noteDeConfiance(SENS, 'sens', s())!.p, 12);
		expect(noteDeConfiance(SENS, 'sens', s({ cosinusRelatif: null }))).toBeNull();
		// sans a priori : p_sans_apriori = p
		const n = noteDeConfiance(SENS, 'sens', s())!;
		expect(n.pSansApriori).toBe(n.p);
	});

	it('méthode du cosinus : le z-score lu dans cosinusZ ; absent, pas de note', () => {
		const z = modele({ biais: 0, poids: { cosinusRelatif: 1 }, methodeCosinus: 'zscore' });
		expect(noteDeConfiance(z, 'sens', s())!.p).toBeCloseTo(sigmoide(1.5), 12);
		expect(noteDeConfiance(z, 'sens', s({ cosinusZ: null }))).toBeNull();
	});

	it('niveau Complets : le logit nécessaire', () => {
		expect(noteDeConfiance(COMPLETS, 'complets', s())).toBeNull();
		expect(noteDeConfiance(COMPLETS, 'complets', s({ logit: 2 }))!.p).toBeCloseTo(sigmoide(-2 + 1.6 + 0.2), 12);
	});
});

describe('état des modèles et note d’une candidate', () => {
	it('jamais appris (ou sans poids), refusé, d’autres GGUF, accepté', () => {
		expect(etatDuModele(modeleNonAppris(), 'sens', INSTALLES, ECHELLE)).toBe('non_appris');
		expect(etatDuModele(modele({ poids: {}, accepte: false, refus: ['aucune paire'] }), 'sens', INSTALLES, ECHELLE)).toBe('non_appris');
		expect(etatDuModele(modele({ accepte: false }), 'sens', INSTALLES, ECHELLE)).toBe('refuse');
		expect(etatDuModele(modele(), 'complets', { ...INSTALLES, reranker: 'reranker.gguf@cccccccccccc' }, ECHELLE)).toBe('refuse');
		expect(etatDuModele(modele(), 'sens', { ...INSTALLES, sens: 'sens.gguf@cccccccccccc' }, ECHELLE)).toBe('refuse');
		expect(etatDuModele(modele(), 'sens', INSTALLES, ECHELLE)).toBe('accepte');
		// un modèle installé inconnu ne compte pas comme différent
		expect(etatDuModele(modele(), 'complets', { sens: null, reranker: null }, ECHELLE)).toBe('accepte');
	});

	it('Sens seul : seul le GGUF du sens compte (un autre reranker ne le refuse pas)', () => {
		const autreReranker = { ...INSTALLES, reranker: 'reranker.gguf@cccccccccccc' };
		expect(etatDuModele(modele(), 'sens', autreReranker, ECHELLE)).toBe('accepte');
		expect(etatDuModele(modele(), 'complets', autreReranker, ECHELLE)).toBe('refuse');
	});

	it('échelle des signaux : un modèle appris avec d’autres réglages du signal de session, ou sans échelle, est refusé', () => {
		const autre = echelleDesSignaux({ ...REGLAGES_PAR_DEFAUT.contexte, poidsInjection: REGLAGES_PAR_DEFAUT.contexte.poidsInjection + 0.1 });
		expect(etatDuModele(modele(), 'sens', INSTALLES, autre)).toBe('refuse');
		expect(etatDuModele(modele(), 'sens', INSTALLES, echelleDesSignaux({ ...REGLAGES_PAR_DEFAUT.contexte, demiVieInjection: 99 }))).toBe('refuse');
		expect(etatDuModele(modele({ echelle: null }), 'sens', INSTALLES, ECHELLE)).toBe('refuse');
		expect(etatDuModele(modele({ echelle: { ...ECHELLE, apriori: 'autre' } }), 'sens', INSTALLES, ECHELLE)).toBe('refuse');
	});

	it('garde-fou : un Complets d’une autre variante de requête que le Sens seul est refusé', () => {
		const m = modelesDeNote({ complets: { ...COMPLETS, requete: 'jointe' }, sens: SENS }, INSTALLES, ECHELLE);
		expect(m.complets.etat).toBe('refuse');
		expect(m.sens.etat).toBe('accepte');
		expect(modelesDeNote({ complets: COMPLETS, sens: SENS }, INSTALLES, ECHELLE).complets.etat).toBe('accepte');
	});

	it('module livré : aucun modèle appris', () => {
		expect(noteApprise(modelesDeNote(COEFFICIENTS_NOTE, INSTALLES, ECHELLE))).toBe(false);
	});

	it('Complets pour une candidate notée par le reranker, Sens seul sinon ; accepté ou non ; null sans modèle qui la note', () => {
		const m = modelesDeNote({ complets: COMPLETS, sens: SENS }, INSTALLES, ECHELLE);
		expect(noterLaCandidate(m, s({ logit: 2 }))).toMatchObject({ niveau: 'complets', accepte: true });
		expect(noterLaCandidate(m, s())).toMatchObject({ niveau: 'sens', accepte: true });
		expect(noterLaCandidate(m, s({ logit: null }))).toMatchObject({ niveau: 'sens' });
		expect(noterLaCandidate(m, s({ cosinusRelatif: null, logit: 2 }))).toBeNull();
		const refuses = modelesDeNote({ complets: COMPLETS, sens: modele({ ...SENS, accepte: false, refus: ['x'] }) }, INSTALLES, ECHELLE);
		const n = noterLaCandidate(refuses, s())!;
		expect(n.accepte).toBe(false);
		expect(pCalibre(n)).toBeNull();
		// Complets jamais appris : le Sens seul note aussi les rerankées
		const sensSeul = modelesDeNote({ complets: modeleNonAppris(), sens: SENS }, INSTALLES, ECHELLE);
		expect(noterLaCandidate(sensSeul, s({ logit: 2 }))).toMatchObject({ niveau: 'sens' });
	});

	it('un Complets refusé ne remplace pas un Sens seul accepté (le logit est journalisé seulement) ; tous deux refusés : le Complets note', () => {
		const completsRefuse = modele({ ...COMPLETS, accepte: false, refus: ['x'] });
		const mixte = modelesDeNote({ complets: completsRefuse, sens: SENS }, INSTALLES, ECHELLE);
		expect(noterLaCandidate(mixte, s({ logit: 2 }))).toMatchObject({ niveau: 'sens', accepte: true });
		const refuses = modelesDeNote({ complets: completsRefuse, sens: modele({ ...SENS, accepte: false, refus: ['x'] }) }, INSTALLES, ECHELLE);
		expect(noterLaCandidate(refuses, s({ logit: 2 }))).toMatchObject({ niveau: 'complets', accepte: false });
		// Complets accepté, Sens seul refusé : le Complets note les rerankées
		const completsSeul = modelesDeNote({ complets: COMPLETS, sens: modele({ ...SENS, accepte: false, refus: ['x'] }) }, INSTALLES, ECHELLE);
		expect(noterLaCandidate(completsSeul, s({ logit: 2 }))).toMatchObject({ niveau: 'complets', accepte: true });
	});

	it('a priori inconnu (hook sans service) : une note qui le pèse n’est pas calibrée ; sans poids sur l’a priori, si', () => {
		const m = modelesDeNote({ complets: COMPLETS, sens: SENS }, INSTALLES, ECHELLE);
		expect(noterLaCandidate(m, s(), { aprioriConnu: false })).toMatchObject({ niveau: 'sens', accepte: false });
		expect(noterLaCandidate(m, s(), { aprioriConnu: true })).toMatchObject({ accepte: true });
		// le Complets ne pèse pas l'a priori
		expect(noterLaCandidate(m, s({ logit: 1 }), { aprioriConnu: false })).toMatchObject({ niveau: 'complets', accepte: true });
	});

	it('ordre par la note : décroissant, sans note ensuite, l’ordre donné à égalité', () => {
		const notes: Record<string, number | null> = { a: 0.2, b: null, c: 0.9, d: 0.2, e: null };
		expect(ordonnerParNote(['a', 'b', 'c', 'd', 'e'], (x) => notes[x]!)).toEqual(['c', 'a', 'd', 'b', 'e']);
	});

	it('calibré : au moins une note, toutes de modèles acceptés', () => {
		const n = (accepte: boolean) => ({ p: 0.5, pSansApriori: 0.5, niveau: 'sens' as const, accepte });
		expect(classementCalibre([n(true), null])).toBe(true);
		expect(classementCalibre([n(true), n(false)])).toBe(false);
		expect(classementCalibre([null])).toBe(false);
	});
});

describe('lireCoefficients', () => {
	it('relit ce que l’apprentissage écrit ; refuse une forme invalide', () => {
		const c = { complets: COMPLETS, sens: SENS };
		expect(lireCoefficients(JSON.parse(jsonDeCoefficients(c)))).toEqual(c);
		expect(lireCoefficients(JSON.parse(jsonDeCoefficients(COEFFICIENTS_NOTE)))).toEqual(COEFFICIENTS_NOTE);
		expect(lireCoefficients(null)).toBeNull();
		expect(lireCoefficients({ sens: SENS })).toBeNull();
		expect(lireCoefficients({ complets: COMPLETS, sens: { ...SENS, poids: { cosinusRelatif: -1 } } })).toBeNull();
		// une variable hors du niveau
		expect(lireCoefficients({ complets: COMPLETS, sens: { ...SENS, poids: { logit: 1 } } })).toBeNull();
		expect(lireCoefficients({ complets: COMPLETS, sens: { ...SENS, methodeCosinus: 'autre' } })).toBeNull();
		// poids au-delà de leur maximum (a priori ≤ 1, signal de session ≤ 1,5)
		expect(lireCoefficients({ complets: COMPLETS, sens: { ...SENS, poids: { cosinusRelatif: 1, apriori: 1.2 } } })).toBeNull();
		expect(lireCoefficients({ complets: COMPLETS, sens: { ...SENS, poids: { cosinusRelatif: 1, signalSession: 2 } } })).toBeNull();
		expect(lireCoefficients({ complets: COMPLETS, sens: { ...SENS, poids: { cosinusRelatif: 1, signalSession: 1.5 } } })).not.toBeNull();
		// accepte incohérent avec refus
		expect(lireCoefficients({ complets: COMPLETS, sens: { ...SENS, refus: ['trop peu d’injections'] } })).toBeNull();
		expect(lireCoefficients({ complets: COMPLETS, sens: { ...SENS, accepte: false } })).toBeNull();
		expect(lireCoefficients({ complets: COMPLETS, sens: { ...SENS, apprisLe: null } })).toBeNull();
		// l'échelle relue
		expect(lireCoefficients(JSON.parse(jsonDeCoefficients({ complets: COMPLETS, sens: SENS })))!.sens.echelle).toEqual(ECHELLE);
	});
});
