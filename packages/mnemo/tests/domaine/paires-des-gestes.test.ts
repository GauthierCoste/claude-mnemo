import { describe, expect, it } from 'vitest';
import { pairesDesGestes, propensionParRang } from '../../src/domaine/paires-des-gestes.ts';
import type { ClassementServi, GesteDuJournal, LigneServie } from '../../src/domaine/paires-des-gestes.ts';
import type { Geste } from '../../src/domaine/gestes.ts';
import type { Classe, GesteNote } from '../../src/application/ports.ts';

// les gestes du journal et les lignes des classements servis se lisent tels quels
type Lisible<A, B> = A extends B ? true : false;
const _gestes: Lisible<GesteNote, GesteDuJournal> = true;
const _lignes: Lisible<Classe, LigneServie> = true;
void _gestes;
void _lignes;

const signaux = (cosinusRelatif: number) => ({ cosinus: 0.8, cosinusRelatif, cosinusZ: 1.2, bm25Relatif: 0.3, signalSession: 0, apriori: 0 });

const ligne = (id: string, rang: number, extra: Partial<LigneServie> = {}): LigneServie => ({ id, rang, signaux: signaux(rang / 10), ...extra });

let ordre = 0;
function geste(g: Geste, session: string, fiche: string, rangMessage: number, rang: number | null, note?: Record<string, unknown> | null): GesteDuJournal {
	ordre += 1;
	return {
		rang: ordre,
		geste: g,
		session,
		fiche,
		rangMessage,
		note: note !== undefined ? note : rang === null ? null : { note: 0.5, rang, signaux: signaux(0.05 * rang) },
	};
}

/** Une session de `messages` messages, chacun classant les fiches a, b, c, d, e aux rangs 1 à 5. */
function session(nom: string, messages: number): ClassementServi[] {
	return Array.from({ length: messages }, (_, i) => ({
		session: nom,
		rangMessage: i + 1,
		lignes: ['a', 'b', 'c', 'd', 'e'].map((f, r) => ligne(`notes/${nom}-${f}.md`, r + 1)),
	}));
}

describe('propensionParRang', () => {
	it('part des lignes de chaque rang dont la fiche a reçu un geste ➤, ✗ ou lue dans la session ; plancher 0,05', () => {
		const classements = [...session('S1', 1), ...session('S2', 1)];
		const gestes = [geste('injectee_main', 'S1', 'notes/S1-a.md', 1, 1), geste('ecartee_ici', 'S2', 'notes/S2-b.md', 1, 2), geste('retablie', 'S2', 'notes/S2-c.md', 1, 3)];
		const p = propensionParRang(gestes, classements);
		expect(p.get(1)).toBeCloseTo(0.5);
		expect(p.get(2)).toBeCloseTo(0.5);
		// rétablir n'est pas un jugement ; aucun geste : le plancher
		expect(p.get(3)).toBe(0.05);
		expect(p.get(5)).toBe(0.05);
	});

	it('lignes déjà injectées, déjà lues ou injectées par Mnemo hors du compte ; un message répété compté une fois', () => {
		const classements: ClassementServi[] = [
			{ session: 'S1', rangMessage: 1, lignes: [ligne('notes/x.md', 1), ligne('notes/y.md', 2, { deja: 'injectee' }), ligne('notes/z.md', 3, { auto: true })] },
			{ session: 'S1', rangMessage: 1, lignes: [ligne('notes/x.md', 1), ligne('notes/y.md', 2, { deja: 'injectee' }), ligne('notes/z.md', 3, { auto: true })] },
			{ session: 'S1', rangMessage: 2, lignes: [ligne('notes/w.md', 1)] },
		];
		const p = propensionParRang([geste('injectee_main', 'S1', 'notes/x.md', 1, 1)], classements);
		expect(p.get(1)).toBeCloseTo(0.5);
		expect(p.has(2)).toBe(false);
		expect(p.has(3)).toBe(false);
	});
});

describe('pairesDesGestes', () => {
	it('➤ et lue : utiles ; ✗ ici et toujours : pas utiles ; poids 1 / propension, plafonné à 5 ; injectee_auto ignorée', () => {
		const classements = [...session('S1', 1), ...session('S2', 1), ...session('S3', 1), ...session('S4', 1)];
		const gestes = [
			geste('injectee_main', 'S1', 'notes/S1-a.md', 1, 1),
			geste('lue_apres_carte', 'S2', 'notes/S2-a.md', 1, 1),
			geste('ecartee_ici', 'S3', 'notes/S3-e.md', 1, 5),
			geste('ecartee_toujours', 'S4', 'notes/S4-d.md', 1, 4),
			geste('injectee_auto', 'S4', 'notes/S4-a.md', 1, 1),
		];
		const { paires, ecartees } = pairesDesGestes(gestes, classements);
		expect(ecartees).toBe(0);
		const explicites = paires.filter((p) => p.origine !== 'sans_geste');
		expect(explicites.map((p) => [p.origine, p.y, p.poids])).toEqual([
			// rang 1 : 2 gestes sur 4 lignes ; rangs 4 et 5 : 1 sur 4
			['injectee_main', true, 2],
			['lue_apres_carte', true, 2],
			['ecartee_ici', false, 4],
			['ecartee_toujours', false, 4],
		]);
		expect(explicites[0]).toMatchObject({ session: 'S1', fiche: 'notes/S1-a.md', rangMessage: 1, rang: 1, signaux: { cosinusRelatif: 0.05, cosinusZ: 1.2, bm25Relatif: 0.3 } });
		expect(paires.some((p) => p.fiche === 'notes/S4-a.md')).toBe(false);
	});

	it('plafond à 5 : propension au plancher', () => {
		const classements = session('S1', 30);
		const { paires } = pairesDesGestes([geste('ecartee_ici', 'S1', 'notes/S1-e.md', 3, 5)], classements);
		// la fiche e a reçu un geste dans la session : ses 30 lignes comptent, propension 1
		expect(paires.find((p) => p.origine === 'ecartee_ici')!.poids).toBe(1);
		const rare = pairesDesGestes([geste('ecartee_ici', 'S9', 'notes/autre.md', 1, 4)], [...session('S1', 30), { session: 'S9', rangMessage: 1, lignes: [] }]);
		// rang 4 : 0 sur 30, plancher 0,05 : 1 / 0,05 = 20, plafonné à 5
		expect(rare.paires.find((p) => p.origine === 'ecartee_ici')!.poids).toBe(5);
	});

	it('top 3 sans geste ni lecture dans la session : pas utile faible (0,3 × min(5, 1 / propension)) ; rangs 4 et suivants laissés', () => {
		const classements = session('S1', 2);
		const { paires } = pairesDesGestes([geste('injectee_main', 'S1', 'notes/S1-a.md', 1, 1)], classements);
		const faibles = paires.filter((p) => p.origine === 'sans_geste');
		expect(faibles.map((p) => `${p.fiche}#${p.rangMessage}`).sort()).toEqual(['notes/S1-b.md#1', 'notes/S1-b.md#2', 'notes/S1-c.md#1', 'notes/S1-c.md#2']);
		for (const p of faibles) {
			expect(p.y).toBe(false);
			// rangs 2 et 3 : aucun geste, propension au plancher : 1 / 0,05 = 20 plafonné à 5, × 0,3 : 1,5 (jamais plus qu'un geste)
			expect(p.poids).toBeCloseTo(1.5, 12);
		}
		expect(faibles[0]!.signaux.cosinusRelatif).toBeCloseTo(0.2);
	});

	it('pas utile faible sous le plafond : 0,3 / propension', () => {
		// rang 2 : la fiche b reçoit un ✗ dans S1, pas dans S2 ni S3 ni S4 : propension 1 / 4, poids 0,3 × 4 = 1,2
		const classements = [...session('S1', 1), ...session('S2', 1), ...session('S3', 1), ...session('S4', 1)];
		const { paires } = pairesDesGestes([geste('ecartee_ici', 'S1', 'notes/S1-b.md', 1, 2)], classements);
		const faibleB = paires.filter((p) => p.origine === 'sans_geste' && p.rang === 2);
		expect(faibleB).toHaveLength(3);
		for (const p of faibleB) expect(p.poids).toBeCloseTo(1.2, 12);
		expect(paires.find((p) => p.origine === 'ecartee_ici')!.poids).toBeCloseTo(4, 12);
	});

	it('pas utile faible : jamais pour une fiche lue, injectée, ou touchée par un geste quelconque dans la session', () => {
		const classements: ClassementServi[] = [
			{ session: 'S1', rangMessage: 1, lignes: [ligne('notes/lue.md', 1), ligne('notes/auto.md', 2, { auto: true }), ligne('notes/retablie.md', 3)] },
			{ session: 'S1', rangMessage: 2, lignes: [ligne('notes/lue.md', 1, { deja: 'lue' }), ligne('notes/auto.md', 2, { deja: 'injectee' }), ligne('notes/libre.md', 3)] },
		];
		const { paires } = pairesDesGestes([geste('retablie', 'S1', 'notes/retablie.md', 1, 3)], classements);
		expect(paires.map((p) => p.fiche)).toEqual(['notes/libre.md']);
	});

	it('une fiche, une session : le dernier jugement explicite ; rétablir annule ; l’explicite prime sur le faible', () => {
		const classements = session('S1', 3);
		const gestes = [
			geste('injectee_main', 'S1', 'notes/S1-a.md', 1, 1),
			geste('ecartee_ici', 'S1', 'notes/S1-a.md', 2, 1),
			geste('ecartee_ici', 'S1', 'notes/S1-b.md', 1, 2),
			geste('retablie', 'S1', 'notes/S1-b.md', 1, 2),
			geste('lue_apres_carte', 'S1', 'notes/S1-c.md', 1, 3),
			geste('lue_apres_carte', 'S1', 'notes/S1-c.md', 2, 3),
		];
		const { paires } = pairesDesGestes(gestes, classements);
		expect(paires.map((p) => [p.fiche, p.origine, p.rangMessage])).toEqual([
			['notes/S1-a.md', 'ecartee_ici', 2],
			['notes/S1-c.md', 'lue_apres_carte', 2],
		]);
	});

	it('gestes sans signaux ou sans rang écartés et comptés ; gestes hors session ou sans fiche ignorés', () => {
		const gestes = [
			geste('injectee_main', 'S1', 'notes/a.md', 1, null),
			geste('injectee_main', 'S1', 'notes/b.md', 1, 1, { note: 0.4 }),
			geste('ecartee_ici', 'S1', 'notes/c.md', 1, null, { rang: 2, signaux: { cosinusRelatif: 'x' } }),
			geste('injection_reactivee', '', '', 0, null),
			geste('ecartee_toujours', '', 'notes/d.md', 0, 1),
		];
		const r = pairesDesGestes(gestes, []);
		expect(r.paires).toEqual([]);
		expect(r.ecartees).toBe(3);
	});

	it('signaux lus : logit gardé s’il est un nombre, cosinusZ absent laissé absent', () => {
		const note = { rang: 1, signaux: { cosinus: 0.7, cosinusRelatif: 0.1, bm25Relatif: null, signalSession: 0.2, logit: 2.5 } };
		const { paires } = pairesDesGestes([geste('injectee_main', 'S1', 'notes/a.md', 1, 1, note)], []);
		expect(paires[0]!.signaux).toEqual({ cosinusRelatif: 0.1, bm25Relatif: null, signalSession: 0.2, logit: 2.5 });
		// aucune exposition connue : pas de correction
		expect(paires[0]!.poids).toBe(1);
	});
});
