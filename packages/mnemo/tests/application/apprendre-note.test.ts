import { describe, expect, it } from 'vitest';
import { apprendreNote, jeuDApprentissage, validerConfiguration } from '../../src/application/apprendre-note.ts';
import type { CandidateAJuger, CasContexte, Jugement } from '../../src/application/banc-contexte.ts';
import type { Signaux } from '../../src/application/banc-signaux.ts';
import { plisParSession } from '../../src/domaine/mesures-banc.ts';

/** Générateur pseudo-aléatoire déterministe (mulberry32). */
function hasard(graine: number): () => number {
	let a = graine >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

const OPTIONS = { date: '2026-11-25', gguf: { sens: 'bge-m3-q8_0.gguf@aa473d51f451', reranker: 'bge-reranker-v2-m3-Q8_0.gguf@a43c7c9b11a4' } };

type Fiche = { pertinente: boolean | 'indecise' | null; signaux: Signaux; horsPile?: boolean; empreinte?: string };

function casDe(session: string, rang: number, fiches: readonly Fiche[], silence = false): CasContexte {
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
	return { nom: `${session}#${rang}`, position: 'projets/Corvel', message: `message ${rang}`, premier: rang === 1, attendues: [], interdites: [], silence, session, rang, candidates, jugements };
}

/**
 * Jeu synthétique : `sessions` sessions de 5 messages, 12 candidates par message. Un message sur trois a une pertinente.
 * `separe` : les pertinentes ont des signaux nettement plus forts ; sinon, signaux et jugements sont indépendants.
 */
function jeuSynthetique(sessions: number, separe: boolean, graine = 11): CasContexte[] {
	const u = hasard(graine);
	const bruit = (e: number) => (u() * 2 - 1) * e;
	const cas: CasContexte[] = [];
	for (let s = 0; s < sessions; s++) {
		for (let rang = 1; rang <= 5; rang++) {
			const avecPertinente = u() < 0.36;
			const fiches: Fiche[] = Array.from({ length: 12 }, (_, i) => {
				const pertinente = separe ? avecPertinente && i === 0 : u() < 0.1;
				const fort = separe && pertinente;
				const cosinus = 0.62 + (fort ? 0.25 : 0.05) + bruit(0.03);
				return {
					pertinente,
					signaux: {
						logit: (fort ? 6 : -4) + bruit(1.5),
						cosinus,
						cosinusRelatif: cosinus - 0.65,
						bm25Relatif: fort ? 0.9 + bruit(0.1) : u() * 0.4,
						signalSession: 0,
						apriori: 0,
					},
				};
			});
			cas.push(casDe(`S${String(s).padStart(2, '0')}`, rang, fiches, separe && !avecPertinente && rang % 2 === 0));
		}
	}
	return cas;
}

describe('jeuDApprentissage', () => {
	const s: Signaux = { logit: 1, cosinus: 0.8, cosinusRelatif: 0.1, bm25Relatif: 0.5 };

	it('exclut les indécises et les fiches changées depuis l’extraction ; garde les non jugées et les hors pile', () => {
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
		const jeu = jeuDApprentissage([cas], empreintes);
		expect(jeu.messages[0]!.candidates.map((c) => c.statut)).toEqual(['pertinente', 'exclue', 'exclue', 'non_jugee', 'pertinente']);
		expect(jeu.messages[0]!.candidates[4]!.horsPile).toBe(true);
		expect(jeu).toMatchObject({ indecises: 1, empreintesChangees: 1, jointe: false });
		expect(jeuDApprentissage([cas], empreintes, 'garder').messages[0]!.candidates[1]!.statut).toBe('non_pertinente');
	});

	it('laisse les messages sautés et les messages sans jugement', () => {
		const juge = casDe('S1', 1, [{ pertinente: true, signaux: s }]);
		const sansJugement = casDe('S1', 2, [{ pertinente: null, signaux: s }]);
		expect(jeuDApprentissage([juge, { ...juge, saute: true }, sansJugement], null).messages).toHaveLength(1);
	});

	it('approche le z-score du cosinus quand le banc ne l’a pas enregistré', () => {
		const cas = casDe('S1', 1, [
			{ pertinente: true, signaux: { ...s, cosinus: 0.9, cosinusRelatif: 0.2 } },
			{ pertinente: false, signaux: { ...s, cosinus: 0.7, cosinusRelatif: 0 } },
		]);
		const jeu = jeuDApprentissage([cas], null);
		expect(jeu.zApproche).toBe(true);
		expect(jeu.messages[0]!.candidates[0]!.signaux.seule!.cosinusZ).toBeCloseTo(2);
	});
});

describe('validation croisée groupée', () => {
	it('aucun message n’est noté par un modèle appris sur sa propre session', () => {
		// la session S00 est la seule où le signal de session est non nul, et il y marque toutes les pertinentes : un modèle
		// qui l'aurait vue lui donnerait du poids ; appris sans elle, il ne peut pas
		const cas = jeuSynthetique(12, true).map((c) => {
			if (c.session !== 'S00') return c;
			return { ...c, candidates: c.candidates!.map((x) => (c.jugements?.[x.chemin] === 'pertinente' ? { ...x, signaux: { seule: { ...x.signaux.seule!, signalSession: 1 } } } : x)) };
		});
		const jeu = jeuDApprentissage(cas, null);
		const plis = plisParSession(jeu.messages, 5);
		const conf = { niveau: 'complets' as const, requete: 'seule' as const, methode: 'mediane' as const, avecApriori: true, lambda: 0.01 };
		const avecSignal = validerConfiguration(jeu, plis, 5, conf);
		const sansSignal = validerConfiguration(jeuDApprentissage(jeuSynthetique(12, true), null), plis, 5, conf);
		const notesDe = (e: typeof avecSignal) => e.notes.filter((n) => n.session === 'S00').flatMap((n) => n.candidates.map((c) => c.p));
		expect(notesDe(avecSignal).length).toBeGreaterThan(0);
		expect(notesDe(avecSignal)).toEqual(notesDe(sansSignal));
	});
});

describe('apprendreNote', () => {
	it('accepte un jeu bien séparé, en assez de sessions', () => {
		const rapport = apprendreNote(jeuDApprentissage(jeuSynthetique(40, true), null), OPTIONS);
		const complets = rapport.niveaux.find((n) => n.niveau === 'complets')!;
		expect(complets.modele.refus).toEqual([]);
		expect(complets.modele.accepte).toBe(true);
		expect(complets.modele.mesures!.injections).toBeGreaterThanOrEqual(50);
		expect(complets.modele.mesures!.sessions).toBeGreaterThanOrEqual(20);
		expect(complets.modele.poids.logit).toBeGreaterThan(0);
		for (const w of Object.values(complets.modele.poids)) expect(w).toBeGreaterThanOrEqual(0);
		expect(complets.modele).toMatchObject({ methodeCosinus: 'mediane', requete: 'seule', apprisLe: '2026-11-25', gguf: OPTIONS.gguf });
		expect(complets.courbe.map((c) => c.seuil)).toEqual([0.8, 0.85, 0.9, 0.95]);
		// médiane et z-score, avec et sans a priori : comparés ; le z-score approché n'est jamais retenu
		expect(complets.configurations.map((c) => `${c.methode}/${c.avecApriori}`)).toEqual(['mediane/true', 'mediane/false', 'zscore/true', 'zscore/false']);
		expect(complets.configurations.filter((c) => c.methode === 'zscore').every((c) => !c.selectionnable)).toBe(true);
		expect(rapport.coefficients.complets).toBe(complets.modele);
	});

	it('refuse un jeu au hasard', () => {
		const rapport = apprendreNote(jeuDApprentissage(jeuSynthetique(40, false), null), OPTIONS);
		for (const n of rapport.niveaux) expect(n.modele.accepte).toBe(false);
	});

	it('refuse sous 20 sessions, même bien séparé', () => {
		const rapport = apprendreNote(jeuDApprentissage(jeuSynthetique(12, true), null), OPTIONS);
		const complets = rapport.coefficients.complets;
		expect(complets.accepte).toBe(false);
		expect(complets.refus.some((r) => r.includes('sessions servies'))).toBe(true);
		expect(complets.refus.some((r) => r.includes('injections simulées'))).toBe(true);
	});

	it('compare la requête seule et la requête jointe quand le banc a les deux', () => {
		const cas = jeuSynthetique(10, true).map((c) => ({ ...c, candidates: c.candidates!.map((x) => ({ ...x, signaux: { seule: x.signaux.seule!, jointe: x.signaux.seule! } })) }));
		const rapport = apprendreNote(jeuDApprentissage(cas, null), OPTIONS);
		expect(rapport.niveaux[0]!.configurations.map((c) => c.requete)).toEqual(['seule', 'seule', 'seule', 'seule', 'jointe', 'jointe', 'jointe', 'jointe']);
		// à égalité, la plus simple : la requête seule
		expect(rapport.coefficients.complets.requete).toBe('seule');
	});

	it('un niveau sans aucune paire notée reste non appris', () => {
		const cas = jeuSynthetique(5, true).map((c) => ({ ...c, candidates: c.candidates!.map((x) => ({ ...x, signaux: { seule: { ...x.signaux.seule!, logit: null } } })) }));
		const rapport = apprendreNote(jeuDApprentissage(cas, null), OPTIONS);
		expect(rapport.coefficients.complets).toMatchObject({ accepte: false, refus: ['aucune paire jugée pour ce niveau'], poids: {} });
		expect(rapport.coefficients.sens.paires).toBeGreaterThan(0);
	});
});
