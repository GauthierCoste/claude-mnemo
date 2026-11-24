import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { lireQuestions } from '../../src/adaptateurs/cli/banc.ts';
import { correspond, lancerBanc, NOM_REFERENCE, referenceSansMoteur, VARIANTES_DU_BANC } from '../../src/application/banc.ts';
import type { Question } from '../../src/application/banc.ts';
import type { OptionsModele, Reranker, Sens } from '../../src/application/ports.ts';
import { anomalieDe, lireConsigne } from '../../src/domaine/consigne.ts';
import { contenuAmorce } from '../../src/domaine/source.ts';
import { lireFiche } from '../../src/domaine/fiche.ts';
import { expressionFts, motsDe } from '../../src/domaine/requete.ts';
import { corpusIndexe, fichiersDuCorpus, QUESTIONS_DU_BANC } from '../aides/corpus-banc.ts';
import { fauxPorts } from '../aides/faux-ports.ts';

const entete = (type = 'sujet') => `---\nid: 01ABC\ntype: ${type}\nupdated: 2026-11-01\n---\n`;
const ligne = (texte: string, n: number) => `- ${texte} | declare | src: utilisateur oral | appris 2026-11-20 | confiance 100 % ^f-000${n}`;

/** Faux sens « thématique » : un texte qui parle de paiement pointe vers un axe, l'introuvable vers un autre, le reste vers un troisième. */
function sensThematique(nom: string | null = 'theme@1'): Sens & { appels: OptionsModele[] } {
	const appels: OptionsModele[] = [];
	const theme = (t: string) => /paie|factur|r[eè]glement/iu.test(t);
	return {
		appels,
		modele: () => nom,
		async vecteurs(textes, options) {
			appels.push(options);
			if (nom === null) return null;
			return textes.map((t) => Float32Array.from({ length: 8 }, (_, i) => (i === (theme(t) ? 0 : t.includes('zzz') ? 1 : 2) ? 1 : 0)));
		},
	};
}

function fauxReranker(): Reranker & { appels: OptionsModele[] } {
	const appels: OptionsModele[] = [];
	return {
		appels,
		async noter(_requete, textes, options) {
			appels.push(options);
			return textes.map(() => 0);
		},
	};
}

async function petiteMemoire() {
	const dep = fauxPorts();
	await dep.coffre.ecrire('clients/acme.md', `${entete('entite')}# Acme\n\nUn client.\n\n## Faits\n${ligne('Acme paie ses factures à soixante jours', 1)}\n${ligne("L'inventaire des machines est mensuel", 2)}\n`);
	await dep.coffre.ecrire('projets/zeta.md', `${entete()}# Zeta\n\nUn projet.\n\n## Faits\n${ligne('Le dépôt est sur GitLab', 1)}\n`);
	return dep;
}

const QUESTIONS: Question[] = [
	{ question: 'inventaire des machines', attendus: ['clients/acme.md#^f-0002'], genre: 'mots' },
	{ question: 'zzzintrouvable', attendus: ['projets/zeta.md#^f-0001'], genre: 'mots' },
	{ question: 'GitLab', attendus: ['projets/zeta.md'], genre: 'mots' },
	{ question: 'délai de règlement', attendus: ['clients/acme.md#^f-0001'], genre: 'paraphrase' },
];

describe('banc : correspondance', () => {
	it('id exact, élément de la fiche attendue, ou la fiche elle-même', () => {
		expect(correspond('a/b.md#^f-0001', { id: 'a/b.md#^f-0001', chemin: 'a/b.md' })).toBe(true);
		expect(correspond('a/b.md', { id: 'a/b.md#^f-0003', chemin: 'a/b.md' })).toBe(true);
		expect(correspond('sources/d.md', { id: 'sources/d.md#p-1234abcd', chemin: 'sources/d.md' })).toBe(true);
		expect(correspond('a/b.md', { id: 'a/b.md', chemin: 'a/b.md' })).toBe(true);
		expect(correspond('a/b.md#^f-0001', { id: 'a/b.md#^f-0002', chemin: 'a/b.md' })).toBe(false);
		expect(correspond('a/b', { id: 'a/bc.md', chemin: 'a/bc.md' })).toBe(false);
	});
});

describe('lancerBanc', () => {
	it('compte les réussites dans les 5 premiers et le rang réciproque moyen, par variante et par genre', async () => {
		const dep = await petiteMemoire();
		dep.sens = sensThematique();
		dep.reranker = fauxReranker();
		const [mots, sens] = await lancerBanc(dep, QUESTIONS, VARIANTES_DU_BANC.slice(0, 2));
		expect(mots).toMatchObject({ variante: 'mots', presentsDans5: 2, total: 4, mrr: 0.5, modelesAbsents: [] });
		expect(mots!.parGenre).toMatchObject({ mots: { presentsDans5: 2, total: 3, mrr: 0.667 }, paraphrase: { presentsDans5: 0, total: 1, mrr: 0 } });
		// le sens trouve la paraphrase, sans mot commun
		expect(sens).toMatchObject({ variante: '+ sens', presentsDans5: 3, total: 4, modelesAbsents: [] });
		expect(sens!.parGenre['paraphrase']).toMatchObject({ presentsDans5: 1, total: 1 });
		expect(Number.isInteger(mots!.msMoyen)).toBe(true);
	});

	it('un budget large pour chaque étape (le banc mesure la qualité), et des vecteurs calculés avant la première question', async () => {
		const dep = await petiteMemoire();
		const sens = sensThematique();
		const reranker = fauxReranker();
		dep.sens = sens;
		dep.reranker = reranker;
		await lancerBanc(dep, QUESTIONS.slice(0, 1), [VARIANTES_DU_BANC[2]!]);
		// lots de vectorisation (démarrage permis), puis l'essai, puis la question
		expect(sens.appels.every((o) => o.demarrer)).toBe(true);
		expect(sens.appels.at(-1)!.budgetMs).toBeGreaterThan(5000);
		expect(reranker.appels.length).toBe(2);
		expect(reranker.appels.at(-1)!.budgetMs).toBeGreaterThan(10_000);
		expect(await dep.index.nombreAVectoriser('theme@1')).toBe(0);
	});

	it('modèles absents : les variantes sont mesurées par les mots seuls et le disent', async () => {
		const dep = await petiteMemoire();
		dep.sens = sensThematique(null);
		const resultats = await lancerBanc(dep, QUESTIONS, VARIANTES_DU_BANC);
		expect(resultats.map((r) => r.variante)).toEqual(['mots', '+ sens', '+ reranker', '+ graphe', '+ position']);
		expect(resultats.map((r) => r.modelesAbsents)).toEqual([[], ['sens'], ['sens', 'reranker'], ['sens', 'reranker'], ['sens', 'reranker']]);
		expect(resultats[1]!.presentsDans5).toBe(resultats[0]!.presentsDans5);
	});
});

describe('referenceSansMoteur', () => {
	it('classe les fiches par nombre de mots de la question (sans accents ni casse, mots vides et mots courts exclus)', () => {
		const fichiers = new Map([
			['a.md', '# A\n\nLa réunion de lancement. Réunion encore.'],
			['b.md', '# B\n\nREUNION de suivi.'],
			['c.md', '# C\n\nRien à voir, de la la la pour pour.'],
		]);
		const r = referenceSansMoteur(fichiers, [
			{ question: 'Quand a lieu la reunion ?', attendus: ['b.md'] },
			{ question: 'réunion', attendus: ['a.md#^f-0001'] },
			{ question: 'pour la de', attendus: ['c.md'] },
		]);
		// q1 : a (2), b (1) → rang 2 ; q2 : rang 1 (fiche de l'élément attendu) ; q3 : aucun mot utile → rien
		expect(r).toMatchObject({ variante: NOM_REFERENCE, presentsDans5: 2, total: 3, mrr: 0.5, modelesAbsents: [] });
	});

	it('au-delà des 5 premiers : pas réussie, mais comptée dans le rang réciproque jusqu\'au 10e', () => {
		const fichiers = new Map<string, string>();
		for (let i = 0; i < 12; i++) fichiers.set(`f${String(i).padStart(2, '0')}.md`, 'stock '.repeat(12 - i));
		const r = referenceSansMoteur(fichiers, [
			{ question: 'stock', attendus: ['f05.md'] },
			{ question: 'stock', attendus: ['f11.md'] },
		]);
		expect(r).toMatchObject({ presentsDans5: 0, total: 2, mrr: Math.round((1 / 6 / 2) * 1000) / 1000 });
	});
});

describe('corpus du banc', () => {
	it('se charge et s\'indexe sans anomalie : fiches lisibles, faits et relations bien formés, liens résolus, consignes valides', async () => {
		const { dep, bilan } = await corpusIndexe();
		expect(bilan.illisibles).toEqual([]);
		expect(bilan.avis ?? {}).toEqual({});
		const fichiers = fichiersDuCorpus();
		const contenu = [...fichiers.keys()].filter((c) => c !== 'SCHEMA.md' && !/^(\w+)\/\1\.md$/u.test(c) && !c.startsWith('profils/'));
		expect(contenu.length).toBeGreaterThanOrEqual(28);
		for (const [chemin, texte] of fichiers) {
			if (chemin === 'SCHEMA.md') continue;
			const fiche = lireFiche(chemin, texte);
			expect(fiche.id, chemin).not.toBe('');
			for (const l of fiche.faits) expect('fait' in l, `${chemin} : ${JSON.stringify(l)}`).toBe(true);
			for (const r of fiche.relations) expect('cible' in r, `${chemin} : ${JSON.stringify(r)}`).toBe(true);
			if (fiche.type === 'consigne') expect(anomalieDe(lireConsigne(fiche)), chemin).toBeNull();
			const { sortants } = await dep.index.liens(chemin);
			for (const lien of sortants) expect(fichiers.has(lien.vers), `${chemin} → ${lien.vers}`).toBe(true);
		}
		const sources = await dep.index.sources();
		expect(sources).toHaveLength(10);
		for (const s of sources) expect(s, s.fiche).toMatchObject({ etat: 'indexee', secrets: 0 });
		for (const s of sources) expect(s.passages, s.fiche).toBeGreaterThan(0);
	});

	it('questions.yaml : une cinquantaine de questions (dont les cas de saturation et de doublons), au moins 15 paraphrases, des questions de graphe et de position, des attendus qui existent', async () => {
		const questions = lireQuestions(readFileSync(QUESTIONS_DU_BANC, 'utf8'));
		expect(questions.length).toBeGreaterThanOrEqual(35);
		expect(questions.length).toBeLessThanOrEqual(55);
		const genre = (g: string) => questions.filter((q) => q.genre === g).length;
		expect(genre('paraphrase')).toBeGreaterThanOrEqual(15);
		expect(genre('mots')).toBeGreaterThanOrEqual(8);
		expect(genre('graphe')).toBeGreaterThanOrEqual(4);
		expect(questions.filter((q) => q.position !== undefined).length).toBeGreaterThanOrEqual(3);
		const { dep } = await corpusIndexe();
		for (const q of questions) {
			// élément, passage de fiche ou passage de document
			for (const attendu of q.attendus) expect(await dep.index.elementsParId([attendu]), `${q.question} → ${attendu}`).toHaveLength(1);
		}
	});

	it('texte libre : au moins 3 questions dont la réponse n\'est que dans le texte libre d\'une fiche, trouvées par les mots seuls', async () => {
		const questions = lireQuestions(readFileSync(QUESTIONS_DU_BANC, 'utf8')).filter((q) => q.genre === 'texte-libre');
		expect(questions.length).toBeGreaterThanOrEqual(3);
		const { dep } = await corpusIndexe();
		for (const q of questions) {
			for (const attendu of q.attendus) {
				// un passage de fiche (`fiche.md#section`), pas une information ni la fiche entière
				expect(attendu, q.question).toMatch(/\.md#[a-z0-9-]+(~\d+)?$/u);
				expect((await dep.index.element(attendu))?.genre, attendu).toBe('passage');
			}
		}
		const [mots] = await lancerBanc(dep, questions, VARIANTES_DU_BANC.slice(0, 1));
		expect(mots!.presentsDans5).toBe(questions.length);
	});

	it('long texte, flexion, contexte : 2 questions de chaque, dont la réponse est un passage précis, trouvées par les mots seuls', async () => {
		const questions = lireQuestions(readFileSync(QUESTIONS_DU_BANC, 'utf8'));
		const { dep } = await corpusIndexe();
		for (const genre of ['long-texte', 'flexion', 'contexte']) {
			const duGenre = questions.filter((q) => q.genre === genre);
			expect(duGenre.length, genre).toBeGreaterThanOrEqual(2);
			for (const q of duGenre) for (const attendu of q.attendus) expect((await dep.index.elementsParId([attendu]))[0]?.genre, attendu).toBe('passage');
			const [mots] = await lancerBanc(dep, duGenre, VARIANTES_DU_BANC.slice(0, 1));
			expect(mots!.presentsDans5, genre).toBe(duGenre.length);
		}
		// le texte long l'est vraiment : plus de 20 000 caractères
		const manuel = fichiersDuCorpus().get('sources/manuel-exploitation-tournees.md')!;
		expect(contenuAmorce(manuel.slice(manuel.indexOf('## Contenu') + '## Contenu'.length)).length).toBeGreaterThan(20_000);
		// flexion : la question n'a pas le mot de la réponse, seulement une autre forme (« déployer » / « déploiement »)
		for (const q of questions.filter((x) => x.genre === 'flexion')) {
			const reponse = (await dep.index.elementsParId(q.attendus))[0]!;
			const fleches = motsDe(q.question).filter((m) => /^(deploy|configur)/u.test(m));
			expect(fleches.length, q.question).toBe(1);
			expect(motsDe(reponse.texte), q.question).not.toContain(fleches[0]);
		}
	});

	it('une paraphrase ne partage aucun mot cherché (normalisation plein texte, préfixes, alias) avec sa réponse ni le titre de sa fiche', async () => {
		const questions = lireQuestions(readFileSync(QUESTIONS_DU_BANC, 'utf8')).filter((q) => q.genre === 'paraphrase');
		const { dep } = await corpusIndexe();
		const alias = await dep.index.alias();
		const fautes: string[] = [];
		for (const q of questions) {
			const expression = expressionFts(q.question, alias);
			expect(expression, q.question).not.toBeNull();
			// termes de l'expression : « "mot"* » (préfixe) ou « "mot" » (exact), alias compris
			const termes = [...expression!.une.matchAll(/"([^"]+)"(\*?)/gu)].flatMap(([, phrase, etoile]) =>
				phrase!.split(' ').map((mot) => ({ mot, prefixe: etoile === '*' })),
			);
			for (const attendu of q.attendus) {
				const element = (await dep.index.element(attendu))!;
				const titre = (await dep.index.element(element.chemin))!.texte.split('\n')[0]!;
				const mots = motsDe(`${element.texte} ${element.contexte} ${titre}`);
				for (const { mot, prefixe } of termes) {
					const commun = mots.find((m) => (prefixe ? m.startsWith(mot) : m === mot));
					if (commun !== undefined) fautes.push(`« ${q.question} » : « ${mot} » trouve « ${commun} » dans ${attendu}`);
				}
				// et la recherche plein texte elle-même ne rend rien de l'attendu (passages d'un document compris)
				const fiche = attendu.split('#')[0]!;
				for (const trouve of await dep.index.chercher(expression!.une, { chemins: [fiche] }, 500)) {
					if (correspond(attendu, trouve)) fautes.push(`« ${q.question} » : la recherche plein texte trouve ${trouve.id}`);
				}
			}
		}
		expect(fautes).toEqual([]);
	});
});
