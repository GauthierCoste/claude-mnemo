import { describe, expect, it } from 'vitest';
import { apprendreModele, apprendreNote, choisirConfiguration, jeuDApprentissage, LAMBDAS, noterMessage, validationEmboitee } from '../../src/application/apprendre-note.ts';
import type { CandidateAJuger, CasContexte, Jugement } from '../../src/application/banc-contexte.ts';
import type { Signaux } from '../../src/application/banc-signaux.ts';
import { banc, GGUF_DE_TEST, SCENARIOS } from '../aides/banc-synthetique.ts';

const DATE = '2026-11-25';
const INSTALLES = { installes: GGUF_DE_TEST };

type Fiche = { pertinente: boolean | 'indecise' | null; signaux: Signaux; horsPile?: boolean; empreinte?: string };

function casDe(session: string | undefined, rang: number, fiches: readonly Fiche[]): CasContexte {
	const candidates: CandidateAJuger[] = fiches.map((f, i) => ({
		chemin: `notes/Atelier Vitrail ${session}-${rang}-${i}.md`,
		titre: `Fiche ${i}`,
		ligne: '',
		listes: [],
		signaux: { seule: f.signaux },
		...(f.horsPile ? { horsPile: true } : {}),
		...(f.empreinte === undefined ? {} : { empreinte: f.empreinte }),
	}));
	const jugements: Record<string, Jugement> = {};
	fiches.forEach((f, i) => {
		if (f.pertinente !== null) jugements[candidates[i]!.chemin] = f.pertinente === 'indecise' ? 'indecise' : f.pertinente ? 'pertinente' : 'non_pertinente';
	});
	return {
		nom: `${session ?? 'main'}#${rang}`,
		position: 'projets/Corvel',
		message: `message ${rang}`,
		premier: rang === 1,
		attendues: [],
		interdites: [],
		silence: false,
		...(session === undefined ? {} : { session, rang }),
		candidates,
		jugements,
		gguf: GGUF_DE_TEST,
	};
}

describe('jeuDApprentissage', () => {
	const s: Signaux = { logit: 1, cosinus: 0.8, cosinusRelatif: 0.1, bm25Relatif: 0.5 };

	it('indécises et fiches changées hors de l’apprentissage ; non jugées et hors pile gardées', () => {
		const cas = casDe('S1', 1, [
			{ pertinente: true, signaux: s, empreinte: 'e1' },
			{ pertinente: false, signaux: s, empreinte: 'ancienne' },
			{ pertinente: 'indecise', signaux: s },
			{ pertinente: null, signaux: s },
			{ pertinente: true, signaux: s, horsPile: true },
		]);
		const chemins = cas.candidates!.map((c) => c.chemin);
		const empreintes = new Map([
			[chemins[0]!, 'e1'],
			[chemins[1]!, 'nouvelle'],
		]);
		const jeu = jeuDApprentissage([cas], empreintes, INSTALLES);
		expect(jeu.messages[0]!.candidates.map((c) => c.statut)).toEqual(['pertinente', 'exclue', 'indecise', 'non_jugee', 'pertinente']);
		expect(jeu).toMatchObject({ indecises: 1, empreintesChangees: 1, jointe: false, identite: { manquante: 0, differente: 0 } });
		expect(jeuDApprentissage([cas], empreintes, { ...INSTALLES, empreintes: 'garder' }).messages[0]!.candidates[1]!.statut).toBe('non_pertinente');
	});

	it('cas sautés et sans jugement laissés ; cas étiquetés à la main dans la pseudo-session manuel', () => {
		const juge = casDe('S1', 1, [{ pertinente: true, signaux: s }]);
		const sansJugement = casDe('S1', 2, [{ pertinente: null, signaux: s }]);
		const aLaMain = casDe(undefined, 1, [{ pertinente: true, signaux: s }]);
		const jeu = jeuDApprentissage([juge, { ...juge, saute: true }, sansJugement, aLaMain], null, INSTALLES);
		expect(jeu.messages.map((m) => m.session)).toEqual(['S1', 'manuel']);
	});

	it('identité des modèles : un cas d’autres modèles est écarté, un cas sans identité est compté', () => {
		const autre = { ...casDe('S1', 1, [{ pertinente: true, signaux: s }]), gguf: { sens: 'bge-m3-q8_0.gguf@000000000000', reranker: GGUF_DE_TEST.reranker } };
		const { gguf: _gguf, ...sansIdentite } = casDe('S2', 1, [{ pertinente: true, signaux: s }]);
		const jeu = jeuDApprentissage([autre, sansIdentite], null, INSTALLES);
		expect(jeu.messages).toHaveLength(1);
		expect(jeu.identite).toEqual({ manquante: 1, differente: 1 });
	});

	it('approche le z-score du cosinus quand le banc ne l’a pas enregistré', () => {
		const cas = casDe('S1', 1, [
			{ pertinente: true, signaux: { ...s, cosinus: 0.9, cosinusRelatif: 0.2 } },
			{ pertinente: false, signaux: { ...s, cosinus: 0.7, cosinusRelatif: 0 } },
		]);
		const jeu = jeuDApprentissage([cas], null, INSTALLES);
		expect(jeu.zApproche).toBe(true);
		expect(jeu.messages[0]!.candidates[0]!.signaux.seule!.cosinusZ).toBeCloseTo(2);
	});

	it('lit le z-score du cosinus enregistré par le banc, null compris, sans l’approcher', () => {
		const cas = casDe('S1', 1, [
			{ pertinente: true, signaux: { ...s, cosinus: 0.9, cosinusRelatif: 0.2, cosinusZ: 1.5 } },
			{ pertinente: false, signaux: { ...s, cosinus: null, cosinusRelatif: null, cosinusZ: null } },
		]);
		const jeu = jeuDApprentissage([cas], null, INSTALLES);
		expect(jeu.zApproche).toBe(false);
		expect(jeu.messages[0]!.candidates.map((c) => c.signaux.seule!.cosinusZ)).toEqual([1.5, null]);
	});
});

describe('choix de la configuration', () => {
	it('l’a priori n’est essayé qu’avec assez de paires non nulles, venues d’assez de sessions ; z-score enregistré essayé', () => {
		const jeu = jeuDApprentissage(banc(SCENARIOS.favorable, 7, 60, 20), null, INSTALLES);
		const { lignes, retenue } = choisirConfiguration(jeu, jeu.messages, 'sens');
		expect(new Set(lignes.map((l) => l.lambda))).toEqual(new Set(LAMBDAS));
		expect(new Set(lignes.map((l) => l.methode))).toEqual(new Set(['mediane', 'zscore']));
		expect(lignes.some((l) => l.avecApriori)).toBe(true);
		expect(retenue).not.toBeNull();
		// sans a priori nulle part : jamais essayé
		const sansApriori = jeu.messages.map((m) => ({ ...m, candidates: m.candidates.map((c) => ({ ...c, signaux: { seule: { ...c.signaux.seule!, apriori: 0 } } })) }));
		expect(choisirConfiguration(jeu, sansApriori, 'sens').lignes.some((l) => l.avecApriori)).toBe(false);
	});
});

describe('notes comme au hook', () => {
	it('au niveau Complets, seules les 8 premières selon Sens seul sont notées par le reranker et injectables', () => {
		const jeu = jeuDApprentissage(banc(SCENARIOS.favorable, 3, 40, 12), null, INSTALLES);
		const conf = { requete: 'seule' as const, methode: 'mediane' as const, avecApriori: false, lambda: 0.001 };
		const sens = apprendreModele(jeu.messages, 'sens', conf);
		const complets = apprendreModele(jeu.messages, 'complets', conf);
		for (const m of jeu.messages) {
			const n = noterMessage(m, sens, complets)!;
			expect(n.candidates.filter((c) => c.injectable).length).toBeLessThanOrEqual(8);
			expect(noterMessage(m, sens)!.candidates.every((c) => c.injectable)).toBe(true);
		}
	});
});

describe('validation emboîtée', () => {
	it('aucun message n’est noté par un modèle appris sur sa propre session', () => {
		// la session s000 est la seule où le signal de session est non nul, et il y marque toutes les pertinentes : un modèle qui
		// l'aurait vue lui donnerait du poids ; appris sans elle, il ne peut pas
		const base = banc(SCENARIOS.favorable, 5, 50, 12).map((c) => ({ ...c, candidates: c.candidates!.map((x) => ({ ...x, signaux: { seule: { ...x.signaux.seule!, signalSession: 0 } } })) }));
		const marque = base.map((c) =>
			c.session !== 's000' ? c : { ...c, candidates: c.candidates!.map((x) => (c.jugements?.[x.chemin] === 'pertinente' ? { ...x, signaux: { seule: { ...x.signaux.seule!, signalSession: 1 } } } : x)) },
		);
		const notesDe = (cas: CasContexte[]) =>
			validationEmboitee(jeuDApprentissage(cas, null, INSTALLES), 'sens', 1, LAMBDAS)
				.notes.filter((n) => n.session === 's000')
				.flatMap((n) => n.candidates.map((c) => c.p));
		expect(notesDe(marque).length).toBeGreaterThan(0);
		expect(notesDe(marque)).toEqual(notesDe(base));
	});
});

describe('apprendreNote', { timeout: 60_000 }, () => {
	it('accepte le scénario favorable de la contre-expertise (140 messages, 28 sessions)', () => {
		const rapport = apprendreNote(jeuDApprentissage(banc(SCENARIOS.favorable, 1000, 140, 28), null, INSTALLES), { date: DATE });
		const complets = rapport.niveaux.find((n) => n.niveau === 'complets')!;
		expect(complets.modele.refus).toEqual([]);
		expect(complets.modele.accepte).toBe(true);
		expect(complets.tirages).toHaveLength(3);
		expect(complets.grille).toHaveLength(9);
		expect(complets.stabilite.reduce((s, x) => s + x.fois, 0)).toBe(15);
		expect(complets.modele.poids.logit).toBeGreaterThan(0);
		expect(complets.modele.poids.apriori ?? 0).toBeLessThanOrEqual(1);
		expect(complets.modele.poids.signalSession ?? 0).toBeLessThanOrEqual(1.5);
		for (const w of Object.values(complets.modele.poids)) expect(w).toBeGreaterThanOrEqual(0);
		expect(complets.modele).toMatchObject({ apprisLe: DATE, gguf: GGUF_DE_TEST, converge: true });
		expect(rapport.coefficients.complets).toBe(complets.modele);
	});

	it('le Complets prend la variante de requête du Sens seul (validation emboîtée et modèle final) ; échelle des signaux enregistrée', () => {
		// requête seule : seuls les mots disent quelque chose ; jointe : seul le logit. Libre, le Complets prendrait la jointe.
		const bruit = (chemin: string, k: number) => ((chemin.length * 7919 + k * 104729 + [...chemin].reduce((a, c) => a + c.charCodeAt(0), 0)) % 1000) / 1000 - 0.5;
		const cas = banc(SCENARIOS.favorable, 1000, 80, 16).map((c) => ({
			...c,
			candidates: c.candidates!.map((x) => {
				const seule = x.signaux.seule!;
				return {
					...x,
					signaux: {
						seule: { ...seule, logit: seule.logit === null ? null : bruit(x.chemin, 1) * 6, cosinusRelatif: 0, cosinusZ: 0 },
						jointe: { ...seule, cosinusRelatif: 0, cosinusZ: 0, bm25Relatif: 0, signalSession: 0, apriori: 0 },
					},
				};
			}),
		}));
		const jeu = jeuDApprentissage(cas, null, INSTALLES);
		expect(jeu.jointe).toBe(true);
		expect(choisirConfiguration(jeu, jeu.messages, 'complets').retenue!.requete).toBe('jointe');
		expect(choisirConfiguration(jeu, jeu.messages, 'complets', { requete: 'seule' }).lignes.every((l) => l.requete === 'seule')).toBe(true);
		const echelle = { poidsInjection: 0.3, demiVieInjection: 4, apriori: 'signature' };
		const rapport = apprendreNote(jeu, { date: DATE, graines: [1], echelle });
		expect(rapport.coefficients.sens.requete).toBe('seule');
		expect(rapport.coefficients.complets.requete).toBe('seule');
		const complets = rapport.niveaux.find((n) => n.niveau === 'complets')!;
		expect(complets.stabilite.every((x) => x.configuration.startsWith('requête seule'))).toBe(true);
		expect(rapport.coefficients.sens.echelle).toEqual(echelle);
		expect(rapport.coefficients.complets.echelle).toEqual(echelle);
	});

	it('refuse le scénario au hasard', () => {
		const rapport = apprendreNote(jeuDApprentissage(banc(SCENARIOS.auHasard, 1000, 140, 28), null, INSTALLES), { date: DATE, graines: [1] });
		for (const n of rapport.niveaux) expect(n.modele.accepte).toBe(false);
	});

	it('refuse sans identité des modèles, et sous 10 sessions réelles', () => {
		const sansIdentite = banc(SCENARIOS.favorable, 1000, 140, 28).map(({ gguf: _gguf, ...c }) => c);
		const rapport = apprendreNote(jeuDApprentissage(sansIdentite, null, INSTALLES), { date: DATE, graines: [1] });
		expect(rapport.coefficients.complets.refus).toContain('identité des modèles absente sur 140 cas (--completer la recalcule)');
		const peu = apprendreNote(jeuDApprentissage(banc(SCENARIOS.favorable, 1000, 40, 6), null, INSTALLES), { date: DATE, graines: [1] });
		expect(peu.coefficients.complets.accepte).toBe(false);
		expect(peu.coefficients.complets.refus.some((r) => r.includes('sessions réelles servies'))).toBe(true);
	});

	it('un niveau sans aucune paire notée reste non appris', () => {
		const cas = banc(SCENARIOS.favorable, 2, 20, 6).map((c) => ({ ...c, candidates: c.candidates!.map((x) => ({ ...x, signaux: { seule: { ...x.signaux.seule!, logit: null } } })) }));
		const rapport = apprendreNote(jeuDApprentissage(cas, null, INSTALLES), { date: DATE, graines: [1] });
		expect(rapport.coefficients.complets).toMatchObject({ accepte: false, refus: ['aucune paire jugée pour ce niveau'], poids: {} });
		expect(rapport.coefficients.sens.paires).toBeGreaterThan(0);
	});
});
