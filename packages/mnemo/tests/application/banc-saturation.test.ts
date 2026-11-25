import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { lireQuestions } from '../../src/adaptateurs/cli/banc.ts';
import { correspond, doublonsDans10, echecUnSeulDe, egalitesEnTete, lancerBanc, poserQuestion, VARIANTES_DU_BANC } from '../../src/application/banc.ts';
import type { EntreeMesuree, Question } from '../../src/application/banc.ts';
import { expressionFts } from '../../src/domaine/requete.ts';
import { corpusIndexe, QUESTIONS_DU_BANC } from '../aides/corpus-banc.ts';

const entree = (id: string, chemin: string, texte: string, score = 0.5): EntreeMesuree => ({ id, chemin, texte, score });

describe('doublonsDans10', () => {
	it('compte les entrées qui partagent une fiche source ou un texte avec une entrée mieux classée', () => {
		const liste = [
			entree('sources/a.md', 'sources/a.md', 'Règle de pose'), // première : jamais un doublon
			entree('sources/a.md#p-1111', 'sources/a.md', 'Autre texte'), // même document que le rang 1
			entree('sources/b.md', 'sources/b.md', '  RÈGLE   de pose '), // même texte (casse, accents, espaces) que le rang 1
			entree('sources/c.md', 'sources/c.md', 'Différent'), // rien de commun
		];
		expect(doublonsDans10([liste])).toBe(2);
	});

	it('les faits d\'une même fiche ne partagent pas un document ; deux faits de même texte de fiches différentes, si', () => {
		const faits = [
			entree('f.md#^f-0001', 'f.md', 'Le four refroidit lentement'),
			entree('f.md#^f-0002', 'f.md', 'Le devis est signé'),
			entree('g.md#^f-0001', 'g.md', 'le devis est signé'),
		];
		expect(doublonsDans10([faits])).toBe(1);
	});

	it('deux faits de même texte dans une même fiche ne sont pas un doublon ; une consigne (genre) n\'est pas un document', () => {
		expect(doublonsDans10([[entree('f.md#^f-0001', 'f.md', 'Alpha'), entree('f.md#^f-0002', 'f.md', 'alpha')]])).toBe(0);
		const consignes = [{ ...entree('c.md', 'c.md', 'Une'), genre: 'consigne' as const }, { ...entree('c.md#2', 'c.md', 'Deux'), genre: 'consigne' as const }];
		expect(doublonsDans10([consignes])).toBe(0);
	});

	it('compte comme le dédoublonnage : un document montré par son passage est comparé sur le texte du passage', () => {
		const passage = { ...entree('a.md#p-1', 'a.md', 'Autre texte'), genre: 'passage' as const };
		// a.md est montré par son passage : une fiche qui ne répète que le titre de a.md n'est pas une copie de ce qui est montré
		expect(doublonsDans10([[entree('a.md', 'a.md', 'Règle de pose'), passage, entree('b.md', 'b.md', 'règle de pose')]])).toBe(1);
		expect(doublonsDans10([[entree('a.md', 'a.md', 'Règle de pose'), passage, entree('b.md', 'b.md', 'autre TEXTE')]])).toBe(2);
	});

	it('compte comme le dédoublonnage : un fait de même texte qu’un fait de sa fiche déjà regroupé reste une entrée', () => {
		// g.md#^f-0001 est un fait : le regroupement par contenu ne mêle pas un fait et une fiche (même genre seulement)
		const liste = [entree('f.md#^f-0001', 'f.md', 'Alpha'), entree('g.md#^f-0001', 'g.md', 'alpha'), entree('f.md#^f-0002', 'f.md', 'ALPHA')];
		expect(doublonsDans10([liste])).toBe(1);
	});

	it('somme sur les questions, et ne regarde que les 10 premiers', () => {
		const copies = [entree('a.md', 'a.md', 'x'), entree('a.md#p-1', 'a.md', 'y')];
		const dixSansDoublon = Array.from({ length: 10 }, (_, i) => entree(`d${i}.md`, `d${i}.md`, `texte ${i}`));
		const onzieme = [...dixSansDoublon, entree('d0.md#p-1', 'd0.md', 'autre')];
		expect(doublonsDans10([copies, copies, []])).toBe(2);
		expect(doublonsDans10([onzieme])).toBe(0);
	});
});

describe('echecUnSeulDe', () => {
	it('échec si plus d’un des chemins figure dans les 10 premiers ; jamais sans `unSeulDe`', () => {
		const q: Question = { question: 'x', attendus: ['r.md'], unSeulDe: ['s/a.md', 's/b.md', 's/c.md'] };
		const de = (...chemins: string[]) => chemins.map((chemin) => ({ chemin }));
		expect(echecUnSeulDe(q, de('r.md', 's/a.md', 's/a.md'))).toBe(false);
		expect(echecUnSeulDe(q, de('r.md', 's/a.md', 's/b.md'))).toBe(true);
		const dix = Array.from({ length: 10 }, (_, i) => `d${i}.md`);
		expect(echecUnSeulDe(q, de('s/a.md', ...dix.slice(1), 's/b.md'))).toBe(false);
		expect(echecUnSeulDe({ question: 'x', attendus: [] }, de('s/a.md', 's/b.md'))).toBe(false);
	});
});

describe('egalitesEnTete', () => {
	it('compte les questions dont les deux premiers scores sont égaux à 1e-9 près', () => {
		const liste = (...scores: number[]) => scores.map((score) => ({ score }));
		expect(egalitesEnTete([liste(1, 1, 0.8), liste(1, 0.76), liste(0.5, 0.5 + 1e-10), liste(0.5, 0.5 + 1e-6)])).toBe(2);
	});

	it('une liste de moins de deux résultats n\'a pas d\'égalité', () => {
		expect(egalitesEnTete([[], [{ score: 1 }]])).toBe(0);
	});
});

/** Les mots seuls (aucun modèle), puis la chaîne complète sans modèle : la position et le périmètre jouent, le sens ne répond pas. */
const SANS_MODELE = { sens: false, reranker: false };
const VARIANTES = [VARIANTES_DU_BANC[0]!, VARIANTES_DU_BANC[4]!];

const questions = (): Question[] => lireQuestions(readFileSync(QUESTIONS_DU_BANC, 'utf8'));
const duGenre = (genre: string): Question[] => questions().filter((q) => q.genre === genre);

describe('banc : saturation (cas A)', () => {
	it('deux questions : la même, avec la position, puis avec la position et un périmètre', () => {
		const a = duGenre('saturation');
		expect(a).toHaveLength(2);
		expect(a.every((q) => q.position === 'projets/atelier-vitrail/atelier-vitrail.md')).toBe(true);
		expect(a.map((q) => q.perimetre)).toEqual([undefined, 'projets']);
	});

	it('le cas reproduit la saturation : aucun élément ne porte tous les mots (liste « toutes » vide), et les trois faits à 100 % sont dans les 16 premiers de la liste « une » par le seul contexte de leur fiche', async () => {
		const { dep } = await corpusIndexe();
		const [q] = duGenre('saturation');
		const expression = expressionFts(q!.question, await dep.index.alias())!;
		expect(await dep.index.chercher(expression.toutes, {}, 50)).toEqual([]);
		const ids = (await dep.index.chercher(expression.une, {}, 16)).map((e) => e.id);
		for (const n of ['0001', '0002', '0003']) expect(ids, n).toContain(`projets/atelier-vitrail/atelier-vitrail.md#^f-${n}`);
		expect(ids).toContain('projets/atelier-vitrail/atelier-vitrail.md#^f-0006');
	});

	it('le bon fait (observé à 51 %, mots exacts) est au rang 1, devant trois faits déclarés à 100 % sans rapport', async () => {
		const { dep } = await corpusIndexe();
		for (const q of duGenre('saturation')) {
			for (const [nom, variante] of VARIANTES) {
				const trouves = await poserQuestion(dep, q, variante, SANS_MODELE);
				const lecture = trouves.map((t) => `${t.id} ${t.score.toFixed(3)}`);
				expect(trouves.length, `${nom} ${q.perimetre ?? ''}`).toBeGreaterThan(0);
				expect(q.attendus.some((a) => correspond(a, trouves[0]!)), `${nom}, périmètre ${q.perimetre ?? 'aucun'} : ${lecture.join(' | ')}`).toBe(true);
			}
		}
	});
});

describe('banc : doublons (cas B)', () => {
	it('trois copies d\'une même note, un fait de règle qui la cite : la règle dans les 3 premiers, une seule copie dans les 10', async () => {
		const [q] = duGenre('doublons');
		expect(q!.unSeulDe).toHaveLength(3);
		const { dep } = await corpusIndexe();
		for (const [nom, variante] of VARIANTES) {
			const trouves = await poserQuestion(dep, q!, variante, SANS_MODELE);
			const lecture = trouves.map((t) => `${t.id} ${t.score.toFixed(3)}`).join(' | ');
			const rang = trouves.findIndex((t) => q!.attendus.some((a) => correspond(a, t)));
			expect(rang, `${nom} : la règle manque ou est au-delà du 3e rang : ${lecture}`).toBeGreaterThanOrEqual(0);
			expect(rang, `${nom} : ${lecture}`).toBeLessThan(3);
			const copies = new Set(trouves.map((t) => t.chemin).filter((c) => q!.unSeulDe!.includes(c)));
			expect(copies.size, `${nom} : ${[...copies].join(', ')}`).toBeLessThanOrEqual(1);
		}
	});
});

describe('banc : confiance (cas C)', () => {
	it('deux faits contradictoires de même texte au nombre près : le déclaré à 100 % passe devant l\'inféré à 35 %', async () => {
		const c = duGenre('confiance');
		expect(c).toHaveLength(2);
		const { dep } = await corpusIndexe();
		for (const q of c) {
			for (const [nom, variante] of VARIANTES) {
				const trouves = await poserQuestion(dep, q, variante, SANS_MODELE);
				const lecture = trouves.map((t) => `${t.id} ${t.score.toFixed(3)}`).join(' | ');
				expect(trouves.length, `${nom} : ${q.question}`).toBeGreaterThan(0);
				expect(q.attendus.some((a) => correspond(a, trouves[0]!)), `${nom}, ${q.question} : ${lecture}`).toBe(true);
			}
		}
	});
});

describe('banc : mesures sur les cas A et B', () => {
	it('doublons comptés sur les résultats bruts (le dédoublonnage les retire) ; aucune copie en trop ni égalité en tête', async () => {
		const { dep } = await corpusIndexe();
		const cas = [...duGenre('saturation'), ...duGenre('doublons')];
		expect(cas).toHaveLength(3);
		for (const variante of VARIANTES) {
			const [mesure] = await lancerBanc(dep, cas, [variante]);
			// les trois copies (fiche et passages) sont dans les résultats bruts : la mesure n'est pas nulle par construction
			expect(mesure!.parGenre['doublons']!.doublonsDans10, variante[0]).toBeGreaterThan(0);
			expect(mesure!.echecsUnSeulDe, variante[0]).toBe(0);
			expect(mesure!.egalitesEnTete, variante[0]).toBe(0);
		}
	});
});
