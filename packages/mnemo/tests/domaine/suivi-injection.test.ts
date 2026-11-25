import { describe, expect, it } from 'vitest';
import { avecLesCoupures, coupureDuNiveau, coupuresDesNiveaux, FENETRE_SUIVI, instantDApprentissage } from '../../src/domaine/suivi-injection.ts';
import type { GesteDuSuivi } from '../../src/domaine/suivi-injection.ts';
import { noteDInjection, noterLaCandidate } from '../../src/domaine/note-de-confiance.ts';
import type { ModelesDeNote } from '../../src/domaine/note-de-confiance.ts';
import { modeleNonAppris } from '../../src/domaine/modele-de-note.ts';
import type { Geste } from '../../src/domaine/gestes.ts';
import type { NiveauDeNote } from '../../src/domaine/modele-de-note.ts';

let rang = 0;
const g = (geste: Geste, horodatageMs: number, fiche: string, session = 's1', niveau: NiveauDeNote | null = 'sens'): GesteDuSuivi => ({ rang: ++rang, horodatageMs, geste, session, fiche, niveau });

/** `n` injections automatiques (fiches f0…), à partir de `t0`, dont les `ecartees` premières sont écartées juste après. */
function serie(n: number, ecartees: number, t0 = 1000, niveau: NiveauDeNote = 'sens'): GesteDuSuivi[] {
	const gestes: GesteDuSuivi[] = [];
	for (let i = 0; i < n; i++) {
		gestes.push(g('injectee_auto', t0 + i * 10, `f${i}.md`, 's1', niveau));
		if (i < ecartees) gestes.push(g('ecartee_ici', t0 + i * 10 + 5, `f${i}.md`, 's1', null));
	}
	return gestes;
}

describe('coupureDuNiveau', () => {
	it('fenêtre pleine : 16 écartées sur 100 ne coupent pas (Wilson ≥ 0,75), 17 coupent, avec le motif chiffré', () => {
		expect(coupureDuNiveau(serie(100, 16), 'sens', null)).toBeNull();
		const c = coupureDuNiveau(serie(100, 17), 'sens', null)!;
		expect(c).toMatchObject({ niveau: 'sens', injections: 100, ecartees: 17, motif: '17 des 100 dernières fiches injectées par Mnemo ont été écartées' });
		expect(c.depuisMs).toBe(1000 + 16 * 10 + 5);
	});

	it('fenêtre glissante : seules les 100 dernières comptent', () => {
		// 30 écartées d'abord, puis 100 justes : la fenêtre n'a plus d'écart
		const gestes = [...serie(30, 30, 0), ...serie(100, 0, 10_000).map((x) => ({ ...x, fiche: `n-${x.fiche}` }))];
		expect(coupureDuNiveau(gestes, 'sens', null)).toBeNull();
		// les 30 écartées sont les plus anciennes : hors de la fenêtre
		expect(coupureDuNiveau(serie(130, 30), 'sens', null)).toBeNull();
		// 100 justes, puis 17 écartées : la fenêtre (les 100 dernières) en garde 17
		const recentes = [...serie(100, 0, 0), ...serie(17, 17, 10_000).map((x) => ({ ...x, fiche: `n-${x.fiche}` }))];
		expect(coupureDuNiveau(recentes, 'sens', null)).toMatchObject({ injections: FENETRE_SUIVI, ecartees: 17 });
	});

	it('fenêtre incomplète : quelques injections parfaites ne coupent pas ; une série d’écarts coupe sans attendre la centième', () => {
		expect(coupureDuNiveau(serie(10, 0), 'sens', null)).toBeNull();
		expect(coupureDuNiveau(serie(20, 16), 'sens', null)).toBeNull();
		expect(coupureDuNiveau(serie(20, 17), 'sens', null)).toMatchObject({ injections: 20, ecartees: 17, motif: '17 des 20 dernières fiches injectées par Mnemo ont été écartées' });
	});

	it('fausse : écartée (ici ou toujours) dans la même session après l’injection, non rétablie ; sinon juste', () => {
		const base = serie(17, 0);
		// écart dans une autre session, avant l'injection, ou rétabli : juste
		const autres = base.flatMap((x, i) =>
			i % 3 === 0
				? [g('ecartee_ici', x.horodatageMs + 1, x.fiche, 's2', null)]
				: i % 3 === 1
					? [g('ecartee_ici', x.horodatageMs - 1, x.fiche, 's1', null)]
					: [g('ecartee_toujours', x.horodatageMs + 1, x.fiche, 's1', null), g('retablie', x.horodatageMs + 2, x.fiche, 's1', null)],
		);
		expect(coupureDuNiveau([...base, ...autres], 'sens', null)).toBeNull();
		const toujours = base.map((x) => g('ecartee_toujours', x.horodatageMs + 1, x.fiche, 's1', null));
		expect(coupureDuNiveau([...base, ...toujours], 'sens', null)).toMatchObject({ ecartees: 17 });
	});

	it('un écart compte pour la dernière injection automatique de la fiche qui le précède, pas pour les plus anciennes', () => {
		const gestes = [g('injectee_auto', 1, 'a.md'), g('injectee_auto', 2, 'a.md'), g('ecartee_ici', 3, 'a.md', 's1', null)];
		const n = coupureDuNiveau([...gestes, ...serie(16, 16, 100)], 'sens', null);
		expect(n).toMatchObject({ ecartees: 17, injections: 18 });
	});

	it('par niveau : les injections d’un autre niveau ne comptent pas', () => {
		expect(coupureDuNiveau(serie(30, 30, 0, 'complets'), 'sens', null)).toBeNull();
		expect(coupureDuNiveau(serie(30, 30, 0, 'complets'), 'complets', null)).not.toBeNull();
	});

	it('réactivation : par l’utilisateur (geste noté, pour ce niveau ou tous), ou par un apprentissage plus récent que la coupure', () => {
		const coupee = serie(20, 20, 0);
		expect(coupureDuNiveau(coupee, 'sens', null)).not.toBeNull();
		expect(coupureDuNiveau([...coupee, g('injection_reactivee', 500, '', 's1', 'sens')], 'sens', null)).toBeNull();
		expect(coupureDuNiveau([...coupee, g('injection_reactivee', 500, '', 's1', null)], 'sens', null)).toBeNull();
		expect(coupureDuNiveau([...coupee, g('injection_reactivee', 500, '', 's1', 'complets')], 'sens', null)).not.toBeNull();
		expect(coupureDuNiveau(coupee, 'sens', 500)).toBeNull();
		// apprentissage plus ancien que les écarts : la coupure tient
		expect(coupureDuNiveau(coupee, 'sens', -1)).not.toBeNull();
		// après la réactivation, une nouvelle série d'écarts coupe de nouveau
		const encore = [...coupee, g('injection_reactivee', 500, '', 's1', 'sens'), ...serie(17, 17, 1000).map((x) => ({ ...x, fiche: `n-${x.fiche}` }))];
		expect(coupureDuNiveau(encore, 'sens', null)).toMatchObject({ injections: 17, ecartees: 17 });
	});
});

describe('coupuresDesNiveaux et avecLesCoupures', () => {
	const modele = (apprisLe: string) => ({ ...modeleNonAppris(), accepte: true, refus: [], apprisLe, biais: 3, poids: { cosinusRelatif: 0 } });
	const modeles = (): ModelesDeNote => ({
		complets: { modele: modele('1970-01-01T00:00:00.000Z'), etat: 'refuse' },
		sens: { modele: modele('1970-01-01T00:00:00.000Z'), etat: 'accepte' },
	});

	it('instant d’apprentissage : instant ISO ou date ; illisible : null', () => {
		expect(instantDApprentissage('2026-11-25T10:00:00.000Z')).toBe(Date.UTC(2026, 10, 25, 10));
		expect(instantDApprentissage('2026-11-25')).toBe(Date.UTC(2026, 10, 25));
		expect(instantDApprentissage('hier')).toBeNull();
		expect(instantDApprentissage(null)).toBeNull();
	});

	it('seul un niveau accepté est suivi ; coupé, son modèle passe à « coupe » : ses % restent, il n’injecte plus', () => {
		const gestes = [...serie(20, 20), ...serie(20, 20, 5000, 'complets')];
		const c = coupuresDesNiveaux(gestes, modeles());
		expect(c.complets).toBeNull();
		expect(c.sens).not.toBeNull();
		const suivis = avecLesCoupures(modeles(), c);
		expect(suivis.sens.etat).toBe('coupe');
		expect(suivis.complets.etat).toBe('refuse');
		const signaux = { cosinus: 0.5, cosinusRelatif: 0.1, cosinusZ: 0.1, bm25Relatif: 1, signalSession: 0, apriori: 0 };
		expect(noterLaCandidate(modeles(), signaux)).toMatchObject({ accepte: true, niveau: 'sens' });
		const coupee = noterLaCandidate(suivis, signaux)!;
		expect(coupee).toMatchObject({ accepte: true, coupee: true, niveau: 'sens' });
		expect(coupee.p).toBe(noterLaCandidate(modeles(), signaux)!.p);
		expect(noterLaCandidate(modeles(), signaux)).not.toHaveProperty('coupee');
		// rien de coupé : inchangés
		expect(avecLesCoupures(modeles(), { complets: null, sens: null })).toEqual(modeles());
	});

	it('Complets coupé, Sens seul accepté : la note affichée reste celle de Complets, son relais Sens décide de l’injection', () => {
		const tous = (): ModelesDeNote => ({
			complets: { modele: { ...modele('1970-01-01T00:00:00.000Z'), biais: -1, poids: { logit: 1 } }, etat: 'accepte' },
			sens: { modele: modele('1970-01-01T00:00:00.000Z'), etat: 'accepte' },
		});
		const coupure = { niveau: 'complets' as const, injections: 20, ecartees: 17, depuisMs: 1, motif: 'm' };
		const signaux = { cosinus: 0.5, cosinusRelatif: 0.1, cosinusZ: 0.1, bm25Relatif: 1, signalSession: 0, apriori: 0, logit: 4 };
		const libre = noterLaCandidate(tous(), signaux)!;
		expect(libre.niveau).toBe('complets');
		expect(noteDInjection(libre)).toBe(libre);
		const n = noterLaCandidate(avecLesCoupures(tous(), { complets: coupure, sens: null }), signaux)!;
		expect(n).toMatchObject({ niveau: 'complets', coupee: true, p: libre.p });
		expect(noteDInjection(n)).toMatchObject({ niveau: 'sens', accepte: true });
		expect(noteDInjection(n)).not.toHaveProperty('coupee');
		// Sens coupé aussi, ou refusé : aucun relais
		expect(noteDInjection(noterLaCandidate(avecLesCoupures(tous(), { complets: coupure, sens: { ...coupure, niveau: 'sens' } }), signaux))).toBeNull();
		const sensRefuse: ModelesDeNote = { ...tous(), sens: { ...tous().sens, etat: 'refuse' } };
		expect(noteDInjection(noterLaCandidate(avecLesCoupures(sensRefuse, { complets: coupure, sens: null }), signaux))).toBeNull();
	});
});

describe('coût du calcul', () => {
	it('linéaire : 30 000 gestes de 3 000 sessions se comptent vite', () => {
		const gestes: GesteDuSuivi[] = [];
		for (let i = 0; i < 15_000; i++) {
			const session = `s${i % 3000}`;
			gestes.push(g('injectee_auto', i * 10, `f${i % 50}.md`, session));
			gestes.push(g(i % 7 === 0 ? 'ecartee_ici' : 'retablie', i * 10 + 5, `f${i % 50}.md`, session, null));
		}
		const debut = performance.now();
		coupureDuNiveau(gestes, 'sens', null);
		expect(performance.now() - debut).toBeLessThan(500);
	});
});
