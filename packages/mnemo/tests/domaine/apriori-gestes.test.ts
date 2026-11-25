import { describe, expect, it } from 'vitest';
import {
	ALPHA_0,
	APRIORI_MAX,
	BETA_0,
	JOUR_MS,
	POIDS_LIEU_AILLEURS,
	POIDS_LUE_APRES_CARTE,
	RESSEMBLANCE_INCONNUE,
	aprioris,
	decroissance,
	ressemblance,
	sansEcarteesToujours,
	suggestionsEcarteeToujours,
	voixParFiche,
} from '../../src/domaine/apriori-gestes.ts';
import type { ContexteApriori, GesteDApriori, VecteurDApriori } from '../../src/domaine/apriori-gestes.ts';
import type { Geste } from '../../src/domaine/gestes.ts';

const MAINTENANT = Date.UTC(2026, 10, 25, 12);
const FICHE = 'projets/vitrail/devis.md';

const vecteur = (valeurs: number[], modele = 'bge-m3@a1'): VecteurDApriori => ({ modele, valeurs: Float32Array.from(valeurs) });

let rang = 0;
function geste(g: Geste, session: string, champs: Partial<GesteDApriori> = {}): GesteDApriori {
	rang++;
	return { geste: g, session, horodatageMs: MAINTENANT - 1000 + rang, dossier: 'atelier-vitrail', position: 'projets/vitrail', fiche: FICHE, vecteur: null, ...champs };
}

const contexte = (champs: Partial<ContexteApriori> = {}): ContexteApriori => ({
	maintenantMs: MAINTENANT,
	sessionCourante: 'courante',
	dossier: 'atelier-vitrail',
	position: 'projets/vitrail',
	vecteur: null,
	...champs,
});

const apriori = (gestes: GesteDApriori[], c: ContexteApriori = contexte()): number => aprioris(voixParFiche(gestes), c).get(FICHE) ?? 0;
/** log(a / b) attendu pour ces sommes de poids. */
const logit = (positifs: number, negatifs: number): number => Math.log((ALPHA_0 + positifs) / (BETA_0 + negatifs));

describe('a priori des gestes', () => {
	it('0 sans geste ; une fiche sans voix est absente', () => {
		expect(aprioris(new Map(), contexte()).size).toBe(0);
		expect(apriori([])).toBe(0);
	});

	it('un geste positif récent, même lieu, sans vecteur : g = 0,75 (ressemblance inconnue)', () => {
		expect(apriori([geste('injectee_main', 's1')])).toBeCloseTo(logit(RESSEMBLANCE_INCONNUE, 0), 3);
		expect(apriori([geste('ecartee_ici', 's1')])).toBeCloseTo(logit(0, RESSEMBLANCE_INCONNUE), 3);
	});

	it('décroissance : demi-vie de 60 jours', () => {
		expect(decroissance(0)).toBe(1);
		expect(decroissance(60 * JOUR_MS)).toBeCloseTo(0.5, 6);
		expect(decroissance(120 * JOUR_MS)).toBeCloseTo(0.25, 6);
		const vieux = apriori([geste('injectee_main', 's1', { horodatageMs: MAINTENANT - 60 * JOUR_MS })]);
		expect(vieux).toBeCloseTo(logit(0.5 * RESSEMBLANCE_INCONNUE, 0), 3);
		expect(vieux).toBeLessThan(apriori([geste('injectee_main', 's1')]));
	});

	it('lieu : 1 même position ou même dossier, 0,5 ailleurs ; une position vide ne compte pas', () => {
		const ailleurs = { dossier: 'corvel', position: 'projets/corvel' };
		expect(apriori([geste('injectee_main', 's1', ailleurs)])).toBeCloseTo(logit(POIDS_LIEU_AILLEURS * RESSEMBLANCE_INCONNUE, 0), 3);
		expect(apriori([geste('injectee_main', 's1', { dossier: 'corvel' })])).toBeCloseTo(logit(RESSEMBLANCE_INCONNUE, 0), 3);
		expect(apriori([geste('injectee_main', 's1', { position: 'projets/corvel' })])).toBeCloseTo(logit(RESSEMBLANCE_INCONNUE, 0), 3);
		expect(apriori([geste('injectee_main', 's1', { dossier: 'corvel', position: '' })], contexte({ position: '' }))).toBeCloseTo(logit(POIDS_LIEU_AILLEURS * RESSEMBLANCE_INCONNUE, 0), 3);
	});

	it('ressemblance : relative à la médiane, ramenée dans [0,5 ; 1] ; 0,75 sans vecteur ou d’un autre modèle', () => {
		const courant = vecteur([1, 0]);
		expect(ressemblance(null, courant, 0.8)).toBe(RESSEMBLANCE_INCONNUE);
		expect(ressemblance(vecteur([1, 0]), null, 0.8)).toBe(RESSEMBLANCE_INCONNUE);
		expect(ressemblance(vecteur([1, 0], 'autre@b2'), courant, 0.8)).toBe(RESSEMBLANCE_INCONNUE);
		expect(ressemblance(vecteur([1, 0, 0]), courant, 0.8)).toBe(RESSEMBLANCE_INCONNUE);
		expect(ressemblance(vecteur([1, 0]), courant, 1)).toBeCloseTo(0.75, 6);
		expect(ressemblance(vecteur([1, 0]), courant, 0.5)).toBe(1);
		expect(ressemblance(vecteur([0, 1]), courant, 0.5)).toBe(0.5);
		// deux sessions : la proche du message courant pèse plus que la lointaine, autour de la médiane
		const proche = geste('injectee_main', 'proche', { vecteur: vecteur([1, 0.1]) });
		const loin = geste('ecartee_ici', 'loin', { vecteur: vecteur([0.2, 1]) });
		const a = apriori([proche, loin], contexte({ vecteur: courant }));
		expect(a).toBeGreaterThan(0);
		expect(a).toBeCloseTo(logit(1, 0.5), 3);
	});

	it('une voix par session, fiche et sens : le plus fort g, pas la somme', () => {
		const trois = [geste('injectee_main', 's1'), geste('injectee_main', 's1'), geste('injectee_main', 's1', { dossier: 'corvel', position: null })];
		expect(apriori(trois)).toBeCloseTo(logit(RESSEMBLANCE_INCONNUE, 0), 3);
		expect(apriori([...trois, geste('injectee_main', 's2')])).toBeCloseTo(logit(2 * RESSEMBLANCE_INCONNUE, 0), 3);
		// les deux sens d'une même session comptent chacun
		expect(apriori([geste('injectee_main', 's1'), geste('ecartee_ici', 's1')])).toBeCloseTo(0, 6);
	});

	it('la session courante est exclue', () => {
		expect(apriori([geste('injectee_main', 'courante'), geste('ecartee_ici', 'courante')])).toBe(0);
	});

	it('bornes : ±1 logit, quel que soit le nombre de sessions', () => {
		const positifs = Array.from({ length: 40 }, (_, i) => geste('injectee_main', `s${i}`));
		const negatifs = Array.from({ length: 40 }, (_, i) => geste('ecartee_ici', `s${i}`));
		expect(apriori(positifs)).toBe(APRIORI_MAX);
		expect(apriori(negatifs)).toBe(-APRIORI_MAX);
	});

	it('injectee_auto ne compte jamais comme positive ; un écart qui la suit est négatif', () => {
		expect(apriori([geste('injectee_auto', 's1'), geste('injectee_auto', 's2')])).toBe(0);
		expect(apriori([geste('injectee_auto', 's1'), geste('ecartee_ici', 's1')])).toBeCloseTo(logit(0, RESSEMBLANCE_INCONNUE), 3);
	});

	it('lue_apres_carte : positive, au poids réduit', () => {
		expect(apriori([geste('lue_apres_carte', 's1')])).toBeCloseTo(logit(POIDS_LUE_APRES_CARTE * RESSEMBLANCE_INCONNUE, 0), 3);
	});

	it('retablie annule l’écart de sa session (pas celui d’une autre ; un écart d’après compte à nouveau)', () => {
		expect(apriori([geste('ecartee_ici', 's1'), geste('retablie', 's1')])).toBe(0);
		expect(apriori([geste('ecartee_toujours', 's1'), geste('retablie', 's1')])).toBe(0);
		expect(apriori([geste('ecartee_ici', 's1'), geste('retablie', 's2')])).toBeCloseTo(logit(0, RESSEMBLANCE_INCONNUE), 3);
		expect(apriori([geste('ecartee_ici', 's1'), geste('retablie', 's1'), geste('ecartee_ici', 's1')])).toBeCloseTo(logit(0, RESSEMBLANCE_INCONNUE), 3);
		// le positif de la session reste
		expect(apriori([geste('injectee_main', 's1'), geste('ecartee_ici', 's1'), geste('retablie', 's1')])).toBeCloseTo(logit(RESSEMBLANCE_INCONNUE, 0), 3);
	});
});

describe('règle des 3 sessions (suggestion « écartée toujours »)', () => {
	const jour = (n: number) => MAINTENANT - n * JOUR_MS;

	it('3 sessions distinctes sur 2 jours : suggérée ; jamais pour une fiche déjà écartée toujours', () => {
		const gestes = [geste('ecartee_ici', 'a', { horodatageMs: jour(2) }), geste('ecartee_ici', 'b', { horodatageMs: jour(2) + 1 }), geste('ecartee_ici', 'c', { horodatageMs: jour(0) })];
		expect(suggestionsEcarteeToujours(gestes, new Set())).toEqual([{ fiche: FICHE, sessions: ['a', 'b', 'c'], jours: 2, dernierEcartMs: jour(0) }]);
		expect(suggestionsEcarteeToujours(gestes, new Set([FICHE]))).toEqual([]);
	});

	it('pas de suggestion : 2 sessions seulement, un seul jour, ou un geste positif entre-temps', () => {
		expect(suggestionsEcarteeToujours([geste('ecartee_ici', 'a', { horodatageMs: jour(3) }), geste('ecartee_ici', 'a', { horodatageMs: jour(2) }), geste('ecartee_ici', 'b', { horodatageMs: jour(0) })], new Set())).toEqual([]);
		expect(suggestionsEcarteeToujours([geste('ecartee_ici', 'a'), geste('ecartee_ici', 'b'), geste('ecartee_ici', 'c')], new Set())).toEqual([]);
		const avecPositif = [geste('ecartee_ici', 'a', { horodatageMs: jour(3) }), geste('ecartee_ici', 'b', { horodatageMs: jour(2) }), geste('injectee_main', 'x', { horodatageMs: jour(1) }), geste('ecartee_ici', 'c', { horodatageMs: jour(0) })];
		expect(suggestionsEcarteeToujours(avecPositif, new Set())).toEqual([]);
	});

	it('un écart rétabli dans sa session ne compte pas', () => {
		const gestes = [
			geste('ecartee_ici', 'a', { horodatageMs: jour(3) }),
			geste('ecartee_ici', 'b', { horodatageMs: jour(2) }),
			geste('ecartee_ici', 'c', { horodatageMs: jour(0) }),
			geste('retablie', 'c', { horodatageMs: jour(0) + 1 }),
		];
		expect(suggestionsEcarteeToujours(gestes, new Set())).toEqual([]);
	});
});

describe('écartées toujours hors des candidates', () => {
	it('retire les candidates de la fiche, éléments compris', () => {
		const candidates = [{ id: FICHE }, { id: `${FICHE}#^f-0001` }, { id: 'projets/corvel/plan.md' }];
		expect(sansEcarteesToujours(candidates, new Set([FICHE]), (c) => c.id)).toEqual([{ id: 'projets/corvel/plan.md' }]);
		expect(sansEcarteesToujours(candidates, new Set(), (c) => c.id)).toEqual(candidates);
	});
});
