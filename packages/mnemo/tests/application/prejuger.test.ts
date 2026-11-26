import { describe, expect, it } from 'vitest';
import type { CasContexte, Prejugement } from '../../src/application/banc-contexte.ts';
import { ordreDePresentation } from '../../src/application/banc-juger.ts';
import { aPrejuger, fusionnerPrejugements, messagePourLeJuge, prejuger } from '../../src/application/prejuger.ts';
import type { Juge } from '../../src/application/prejuger.ts';
import type { MessageAJuger } from '../../src/domaine/consigne-juge.ts';

const cas = (nom: string, chemins: string[], extra: Partial<CasContexte> = {}): CasContexte => ({
	nom,
	position: 'p',
	message: `message ${nom}`,
	premier: false,
	attendues: [],
	interdites: [],
	silence: false,
	session: 's',
	rang: Number(nom.replace(/\D/gu, '') || 0),
	candidates: chemins.map((chemin) => ({ chemin, titre: `titre ${chemin}`, ligne: `ligne ${chemin}`, listes: ['sens'], signaux: {} })),
	jugements: {},
	...extra,
});
const PROPOSITION: Prejugement = { jugement: 'non_pertinente', confiance: 0.7, raison: 'autre sujet' };
/** Toutes les candidates jugées pas utiles. */
const toutesPasUtiles = (m: MessageAJuger): Record<string, Prejugement> => Object.fromEntries(m.candidates.map((c) => [c.chemin, PROPOSITION]));

/** Un enregistrement en mémoire : le « fichier » relu et fusionné à chaque écriture. */
function fichierEnMemoire(depart: CasContexte[]) {
	const etat = { cas: depart, ecritures: 0 };
	return {
		etat,
		enregistrer: async (cible: CasContexte, p: Record<string, Prejugement>) => {
			etat.cas = fusionnerPrejugements(etat.cas, cible, p);
			etat.ecritures++;
		},
	};
}

describe('messages à pré-juger', () => {
	it('à juger et sans proposition : ni validé, ni sauté, ni silence, ni tout jugé, ni étiqueté à la main', () => {
		expect(aPrejuger(cas('m1', ['a.md']))).toBe(true);
		expect(aPrejuger(cas('m1', ['a.md'], { prejugements: {} }))).toBe(true);
		expect(aPrejuger(cas('m1', ['a.md'], { prejugements: { 'a.md': PROPOSITION } }))).toBe(false);
		expect(aPrejuger(cas('m1', ['a.md'], { valideLe: '2026-11-26T00:00:00.000Z' }))).toBe(false);
		expect(aPrejuger(cas('m1', ['a.md'], { saute: true }))).toBe(false);
		expect(aPrejuger(cas('m1', ['a.md'], { silence: true }))).toBe(false);
		expect(aPrejuger(cas('m1', ['a.md'], { jugements: { 'a.md': 'pertinente' } }))).toBe(false);
		expect(aPrejuger(cas('m1', ['a.md', 'b.md'], { jugements: { 'a.md': 'pertinente' } }))).toBe(true);
		expect(aPrejuger(cas('m1', [], { candidates: undefined }))).toBe(false);
	});

	it('le juge voit le message, le message d\'avant et les candidates dans l\'ordre de présentation mêlé, avec leur synthèse', () => {
		const c = cas('m1', ['a.md', 'b.md', 'c.md', 'd.md'], { precedent: 'avant' });
		const m = messagePourLeJuge(c, (chemin) => `synthèse ${chemin}`);
		expect(m.message).toBe('message m1');
		expect(m.precedent).toBe('avant');
		expect(m.candidates.map((x) => x.chemin)).toEqual(ordreDePresentation(c).map((x) => x.chemin));
		expect(m.candidates.find((x) => x.chemin === 'b.md')).toEqual({ chemin: 'b.md', titre: 'titre b.md', ligne: 'ligne b.md', synthese: 'synthèse b.md' });
		expect(messagePourLeJuge(cas('m2', ['a.md']), () => '').precedent).toBeNull();
	});
});

describe('fusionnerPrejugements', () => {
	it('n\'ajoute que les propositions du message, pour ses candidates : un jugement fait entre-temps reste', () => {
		const cible = cas('m1', ['a.md', 'b.md']);
		// entre-temps : le message a été jugé et validé à la main, un autre message ajouté devant
		const relus = [cas('m0', ['z.md']), { ...cible, jugements: { 'a.md': 'pertinente' as const }, valideLe: 'v' }];
		const apres = fusionnerPrejugements(relus, cible, { 'a.md': PROPOSITION, 'b.md': PROPOSITION, 'inconnue.md': PROPOSITION });
		expect(apres[0]).toBe(relus[0]);
		expect(apres[1]).toEqual({ ...relus[1], prejugements: { 'a.md': PROPOSITION, 'b.md': PROPOSITION } });
		expect(apres[1]!.jugements).toEqual({ 'a.md': 'pertinente' });
		// message disparu : rien ne change
		expect(fusionnerPrejugements([cas('m0', ['z.md'])], cible, { 'a.md': PROPOSITION })).toEqual([cas('m0', ['z.md'])]);
	});
});

describe('prejuger', () => {
	it('juge les messages à pré-juger seulement, enregistre après chacun, rend le bilan et l\'avancement', async () => {
		const depart = [cas('m1', ['a.md']), cas('m2', ['b.md'], { valideLe: 'v' }), cas('m3', ['c.md'], { saute: true }), cas('m4', ['d.md'], { prejugements: { 'd.md': PROPOSITION } }), cas('m5', ['e.md', 'f.md'])];
		const vus: string[] = [];
		const juge: Juge = { juger: async (m) => (vus.push(m.message), toutesPasUtiles(m)) };
		const f = fichierEnMemoire(depart);
		const avancement: [number, number][] = [];
		const bilan = await prejuger(depart, { juge, enregistrer: f.enregistrer, avancement: (a, b) => avancement.push([a, b]) });
		expect(bilan).toEqual({ juges: 2, echecs: 0, restants: 0, motifs: [] });
		expect(vus.sort()).toEqual(['message m1', 'message m5']);
		expect(f.etat.ecritures).toBe(2);
		expect(f.etat.cas[0]!.prejugements).toEqual({ 'a.md': PROPOSITION });
		expect(f.etat.cas[4]!.prejugements).toEqual({ 'e.md': PROPOSITION, 'f.md': PROPOSITION });
		expect(f.etat.cas[1]).toEqual(depart[1]);
		expect(avancement).toEqual([[0, 2], [1, 2], [2, 2]]);
	});

	it('deux appels au juge à la fois au plus ; --nombre limite les messages', async () => {
		const depart = Array.from({ length: 7 }, (_, i) => cas(`m${i + 1}`, [`f${i}.md`]));
		let enCours = 0;
		let maximum = 0;
		const juge: Juge = {
			juger: async (m) => {
				enCours++;
				maximum = Math.max(maximum, enCours);
				await new Promise((r) => setTimeout(r, 5));
				enCours--;
				return toutesPasUtiles(m);
			},
		};
		const f = fichierEnMemoire(depart);
		expect(await prejuger(depart, { juge, enregistrer: f.enregistrer })).toMatchObject({ juges: 7 });
		expect(maximum).toBe(2);
		const g = fichierEnMemoire(depart);
		expect(await prejuger(depart, { juge, enregistrer: g.enregistrer, nombre: 3, concurrence: 3 })).toMatchObject({ juges: 3, restants: 0 });
		expect(g.etat.cas.filter((c) => c.prejugements !== undefined).map((c) => c.nom)).toEqual(['m1', 'm2', 'm3']);
	});

	it('les écritures se font une à la fois, même quand deux messages finissent ensemble', async () => {
		const depart = Array.from({ length: 4 }, (_, i) => cas(`m${i + 1}`, [`f${i}.md`]));
		let ecrituresEnCours = 0;
		let maximum = 0;
		const juge: Juge = { juger: async (m) => toutesPasUtiles(m) };
		const etat = { cas: depart };
		const enregistrer = async (cible: CasContexte, p: Record<string, Prejugement>) => {
			ecrituresEnCours++;
			maximum = Math.max(maximum, ecrituresEnCours);
			const relus = etat.cas;
			await new Promise((r) => setTimeout(r, 5));
			etat.cas = fusionnerPrejugements(relus, cible, p);
			ecrituresEnCours--;
		};
		await prejuger(depart, { juge, enregistrer });
		expect(maximum).toBe(1);
		// aucune écriture n'en a perdu une autre
		expect(etat.cas.every((c) => c.prejugements !== undefined)).toBe(true);
	});

	it('un échec (juge, réponse vide ou écriture) est compté et n\'arrête pas les autres', async () => {
		const depart = [cas('m1', ['a.md']), cas('m2', ['b.md']), cas('m3', ['c.md']), cas('m4', ['d.md']), cas('m5', ['e.md'])];
		const juge: Juge = {
			juger: async (m) => {
				if (m.message === 'message m2') throw new Error('claude -p a échoué (code 1) : quota');
				if (m.message === 'message m3') return {};
				return toutesPasUtiles(m);
			},
		};
		const f = fichierEnMemoire(depart);
		const enregistrer = async (cible: CasContexte, p: Record<string, Prejugement>) => {
			if (cible.nom === 'm4') throw new Error('disque plein');
			await f.enregistrer(cible, p);
		};
		const bilan = await prejuger(depart, { juge, enregistrer });
		expect(bilan.juges).toBe(2);
		expect(bilan.echecs).toBe(3);
		expect(bilan.restants).toBe(0);
		expect(bilan.motifs.sort()).toEqual(['claude -p a échoué (code 1) : quota', 'disque plein', "le juge n'a rien proposé."]);
		expect(f.etat.cas.filter((c) => c.prejugements !== undefined).map((c) => c.nom)).toEqual(['m1', 'm5']);
	});

	it('arrêt : plus aucun message lancé, ceux en cours abandonnés et restants, ce qui est enregistré le reste', async () => {
		const depart = Array.from({ length: 6 }, (_, i) => cas(`m${i + 1}`, [`f${i}.md`]));
		const controleur = new AbortController();
		const lances: string[] = [];
		const juge: Juge = {
			juger: (m, signal) => {
				lances.push(m.message);
				// les deux premiers répondent ; le troisième et le quatrième attendent, et l'arrêt les abandonne
				if (lances.length <= 2) return Promise.resolve(toutesPasUtiles(m));
				if (lances.length === 4) setTimeout(() => controleur.abort(), 5);
				return new Promise((_r, rejeter) => signal?.addEventListener('abort', () => rejeter(Object.assign(new Error('interrompu'), { name: 'AbortError' }))));
			},
		};
		const f = fichierEnMemoire(depart);
		const bilan = await prejuger(depart, { juge, enregistrer: f.enregistrer, signal: controleur.signal });
		expect(bilan).toEqual({ juges: 2, echecs: 0, restants: 4, motifs: [] });
		expect(lances).toHaveLength(4);
		expect(f.etat.cas.filter((c) => c.prejugements !== undefined)).toHaveLength(2);
		// déjà arrêté : rien n'est lancé
		lances.length = 0;
		expect(await prejuger(depart, { juge, enregistrer: f.enregistrer, signal: controleur.signal })).toEqual({ juges: 0, echecs: 0, restants: 6, motifs: [] });
		expect(lances).toEqual([]);
	});

	it('rien à pré-juger : bilan nul, juge jamais appelé', async () => {
		const juge: Juge = { juger: async () => expect.unreachable() };
		const avancement: number[] = [];
		expect(await prejuger([cas('m1', ['a.md'], { valideLe: 'v' })], { juge, enregistrer: async () => {}, avancement: (a) => avancement.push(a) })).toEqual({ juges: 0, echecs: 0, restants: 0, motifs: [] });
		expect(avancement).toEqual([]);
	});
});
