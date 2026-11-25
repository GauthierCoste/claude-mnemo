import { afterEach, describe, expect, it, vi } from 'vitest';
import * as moduleCartes from '../../src/application/cartes.ts';
import type { Carte, CartesCalculees } from '../../src/application/cartes.ts';
import { rendreServi, servir, TITRE_INJECTEES_PAR_MNEMO } from '../../src/application/servir.ts';
import type { DemandeServir, Servi } from '../../src/application/servir.ts';
import type { Dependances, Sens } from '../../src/application/ports.ts';
import { dureeDuReranker } from '../../src/application/duree-reranker.ts';
import { modelesActifs } from '../../src/application/note-du-classement.ts';
import { avecLesCoupures } from '../../src/domaine/suivi-injection.ts';
import { SANS_EXTRACTION, synchroniser } from '../../src/application/synchroniser.ts';
import { vectoriser } from '../../src/application/vectoriser.ts';
import { echelleDesSignaux, modeleNonAppris } from '../../src/domaine/modele-de-note.ts';
import type { CoefficientsNote, ModeleDeNote } from '../../src/domaine/modele-de-note.ts';
import { AVERTISSEMENT } from '../../src/domaine/contexte.ts';
import { REGLAGES_PAR_DEFAUT } from '../../src/domaine/reglages.ts';
import { fauxPorts } from '../aides/faux-ports.ts';
import { servirQuestion } from '../aides/servir.ts';

// `calculerCartes` observable (et détournable le temps d'un test) ; par défaut, le vrai
vi.mock('../../src/application/cartes.ts', async (original) => {
	const m = await original<typeof import('../../src/application/cartes.ts')>();
	return { ...m, calculerCartes: vi.fn(m.calculerCartes) };
});

const entete = (type = 'sujet', extra = '') => `---\nid: 01ABC\ntype: ${type}\n${extra}updated: 2026-11-01\n---\n`;
const consigne = (texte: string, portee: string, niveau: string) => `${entete('consigne', `portee: ${portee}\nniveau: ${niveau}\n`)}# C\n\n${texte}\n`;

async function memoire() {
	const dep = fauxPorts();
	await dep.coffre.ecrire('consignes/fr.md', consigne('Réponds en français.', 'globale', 'toujours'));
	await dep.coffre.ecrire('consignes/rappel.md', consigne('Relis la spec avant de coder.', 'globale', 'rappelee'));
	return dep;
}

const carte = (chemin: string, titre: string, surcharge: Partial<Carte> = {}): Carte => ({ chemin, titre, ligne: `Ligne de ${titre}.`, typeFiche: 'sujet', raison: 'perimetre', depuis: null, note: null, encadree: false, empreinte: 'e', ...surcharge });
const calcul = (surcharge: Partial<CartesCalculees> = {}): CartesCalculees => ({ position: null, positionFiche: null, injectees: [], cartes: [], mesure: 'aucune', classement: [], calibree: false, ...surcharge });
const TITRE_PISTES = '## Pistes de Mnemo (lis avec `lire` celles qui servent ta tâche)';

describe('rendreServi', () => {
	it('consignes, fiche de position entière, puis une ligne par carte avec sa raison', () => {
		const texte = rendreServi(
			'## Consignes\n- Réponds en français.',
			calcul({
				position: { chemin: 'projets/vela/vela.md', titre: 'Vela', texte: '# Vela\n\nLe projet Vela.\n', empreinte: 'e1', encadree: false },
				cartes: [carte('projets/vela/avoirs.md', 'Avoirs'), carte('projets/vela/reporting.md', 'Reporting', { typeFiche: 'procedure', raison: 'nommee' })],
			}),
		);
		expect(texte).toBe(
			[
				'## Consignes\n- Réponds en français.',
				'### Vela (projets/vela/vela.md)\n# Vela\n\nLe projet Vela.',
				`${TITRE_PISTES}\n- Avoirs — projets/vela/avoirs.md — Ligne de Avoirs. (sujet, du périmètre)\n- Reporting — projets/vela/reporting.md — Ligne de Reporting. (procedure, nommée)`,
			].join('\n\n'),
		);
		expect(texte).not.toContain('## Fiches servies par Mnemo');
		expect(texte).not.toContain('## Fiches suivantes');
	});

	it('la raison d’une carte de la question est « question »', () => {
		expect(rendreServi('', calcul({ cartes: [carte('a.md', 'A', { raison: 'question' })] }))).toContain('(sujet, question)');
	});

	it('la raison d’une voisine d’une fiche injectée à la main est « liée à <titre> »', () => {
		const texte = rendreServi('', calcul({ cartes: [carte('a.md', 'A', { raison: 'liee', depuis: { chemin: 'p/avoirs.md', titre: 'Avoirs' } })] }));
		expect(texte).toContain('- A — a.md — Ligne de A. (sujet, liée à Avoirs)');
	});

	it('une carte encadrée est dans un bloc <donnees>, précédé une fois de l’avertissement', () => {
		const texte = rendreServi('', calcul({ cartes: [carte('sources/mail.md', 'Mail', { encadree: true }), carte('sources/note.md', 'Note', { encadree: true }), carte('a.md', 'A')] }));
		expect(texte.startsWith(AVERTISSEMENT)).toBe(true);
		expect(texte.split(AVERTISSEMENT)).toHaveLength(2);
		expect(texte).toContain('<donnees source="sources/mail.md">\n- Mail — sources/mail.md — Ligne de Mail. (sujet, du périmètre)\n</donnees>');
		expect(texte).toContain('<donnees source="sources/note.md">');
		expect(texte).not.toContain('<donnees source="a.md">');
	});

	it('les fiches demandées par l’utilisateur, entières, après la fiche de position et avant les cartes ; encadrées si elles citent des documents', () => {
		const texte = rendreServi(
			'',
			calcul({ position: { chemin: 'p.md', titre: 'P', texte: 'Position.', empreinte: 'e0', encadree: false }, cartes: [carte('a.md', 'A')] }),
			[
				{ chemin: 'd.md', titre: 'D', texte: 'Demandée.\n', empreinte: 'e1', encadree: false },
				{ chemin: 'sources/m.md', titre: 'M', texte: 'Mail.', empreinte: 'e2', encadree: true },
			],
		);
		expect(texte.startsWith(AVERTISSEMENT)).toBe(true);
		const [position, demandees, pistes] = ['### P (p.md)', '## Fiches injectées à la demande de l’utilisateur', TITRE_PISTES].map((t) => texte.indexOf(t)) as [number, number, number];
		expect(position).toBeGreaterThan(-1);
		expect(demandees).toBeGreaterThan(position);
		expect(pistes).toBeGreaterThan(demandees);
		expect(texte).toContain('### D (d.md)\nDemandée.');
		expect(texte).toContain('<donnees source="sources/m.md">\n### M (sources/m.md)\nMail.\n</donnees>');
	});

	it('rien à servir et aucune consigne : texte vide', () => {
		expect(rendreServi('', calcul())).toBe('');
	});
});

describe('servir', () => {
	it('les consignes rappelées ne viennent qu’au premier contexte de la session', async () => {
		const dep = await memoire();
		expect((await servirQuestion(dep, '', 'avoirs', true)).texte).toContain('Relis la spec avant de coder.');
		expect((await servirQuestion(dep, '', 'avoirs', false)).texte).not.toContain('Relis la spec avant de coder.');
	});

	it('un message muet en milieu de session ne sert que les consignes', async () => {
		const dep = await memoire();
		const servi = await servir(dep, {
			position: '',
			message: 'merci',
			dejaServies: new Map(),
			dejaLues: new Map(),
			proposees: new Map(),
			ecartes: [],
			moment: 'message',
			muet: 'sans_contenu',
			premier: false,
			fin: Date.now() + 5000,
			rappels: false,
		});
		expect(servi.texte).toBe(servi.consignes);
		expect(servi.texte).toContain('Réponds en français.');
		expect(servi.calcul.cartes).toEqual([]);
		expect(servi.calcul.position).toBeNull();
	});

	it('une fiche demandée est injectée entière, même sur un message muet ; une fiche inconnue de l’index est ignorée', async () => {
		const dep = await memoire();
		await dep.coffre.ecrire('projets/vela/avoirs.md', `${entete()}# Avoirs\n\nLes avoirs du projet Vela.\n`);
		const servi = await servir(dep, {
			position: '',
			message: 'ok',
			dejaServies: new Map(),
			dejaLues: new Map(),
			proposees: new Map(),
			ecartes: ['projets/vela/avoirs.md'],
			moment: 'message',
			muet: 'sans_contenu',
			premier: false,
			fin: Date.now() + 5000,
			rappels: false,
			demandees: ['projets/vela/avoirs.md', 'inconnue.md'],
		});
		expect(servi.demandees.map((f) => f.chemin)).toEqual(['projets/vela/avoirs.md']);
		expect(servi.demandees[0]!.empreinte).not.toBe('');
		expect(servi.texte).toContain('## Fiches injectées à la demande de l’utilisateur');
		expect(servi.texte).toContain('(projets/vela/avoirs.md)\n');
		expect(servi.texte).toContain('Les avoirs du projet Vela.');
		expect(servi.calcul.cartes).toEqual([]);
	});

	it('une fiche demandée est écartée des cartes avant le plafond : elle ne prend la place d’aucune carte', async () => {
		const dep = await memoire();
		const fiche = (titre: string, updated: string, extra = '', corps = '') => `---\nid: 01ABC\ntype: entite\n${extra}updated: ${updated}\n---\n# ${titre}\n\nFiche ${titre}.\n${corps}`;
		await dep.coffre.ecrire('projets/Vela.md', fiche('Vela', '2026-11-01', 'portee: client:Vela\n', '\n## Relations\n- concerne [[Avoirs]]\n- concerne [[Factures]]\n'));
		await dep.coffre.ecrire('projets/Vela/Avoirs.md', fiche('Avoirs', '2026-11-05'));
		await dep.coffre.ecrire('projets/Vela/Factures.md', fiche('Factures', '2026-11-03'));
		dep.reglages = () => ({ ...REGLAGES_PAR_DEFAUT, contexte: { ...REGLAGES_PAR_DEFAUT.contexte, pistesParMessage: 1 } });
		const demande = {
			position: 'projets/Vela',
			message: 'on reprend les écritures',
			dejaServies: new Map(),
			dejaLues: new Map(),
			proposees: new Map(),
			ecartes: [],
			moment: 'message' as const,
			muet: null,
			premier: true,
			fin: Date.now() + 5000,
			rappels: false,
		};
		// sans demande, la plus récente (Avoirs) occupe la seule place
		expect((await servir(dep, demande)).calcul.cartes.map((c) => c.chemin)).toEqual(['projets/Vela/Avoirs.md']);
		const servi = await servir(dep, { ...demande, demandees: ['projets/Vela/Avoirs.md'] });
		expect(servi.demandees.map((f) => f.chemin)).toEqual(['projets/Vela/Avoirs.md']);
		expect(servi.calcul.cartes.map((c) => c.chemin)).toEqual(['projets/Vela/Factures.md']);
	});

	it('la fiche de position et les fiches demandées sont injectées sans leurs faits barrés', async () => {
		const dep = await memoire();
		const corps = (t: string) => `${entete()}# ${t}\n\nSynthèse ${t}.\n\n## Informations\n- [montant] Budget de 10 k€ | src: utilisateur dit ^f-0001\n- [montant] ~~Budget de 8 k€~~ | invalidé 2026-11-02 par ^f-0001 | src: utilisateur dit ^f-0002\n  > « huit »\n`;
		await dep.coffre.ecrire('projets/Vela.md', corps('Vela'));
		await dep.coffre.ecrire('projets/Avoirs.md', corps('Avoirs'));
		const servi = await servir(dep, {
			position: 'projets/Vela',
			message: 'on reprend',
			dejaServies: new Map(),
			dejaLues: new Map(),
			proposees: new Map(),
			ecartes: [],
			moment: 'message',
			muet: null,
			premier: true,
			fin: Date.now() + 5000,
			rappels: false,
			demandees: ['projets/Avoirs.md'],
		});
		expect(servi.calcul.position?.texte).toContain('Budget de 10 k€');
		expect(servi.demandees[0]!.texte).toContain('Budget de 10 k€');
		expect(servi.texte).not.toContain('8 k€');
		expect(servi.texte).not.toContain('« huit »');
	});

	it('rien à servir : texte vide', async () => {
		expect((await servirQuestion(fauxPorts(), '', 'zzz')).texte).toBe('');
	});
});

describe('servir : injection automatique (note de confiance acceptée)', () => {
	const VELA = 'projets/Vela.md';
	const AVOIRS = 'projets/Vela/Avoirs.md';
	const FACTURES = 'projets/Vela/Factures.md';
	const REMISES = 'projets/Vela/Remises.md';
	const INSTALLES = { sens: null, reranker: null };
	const fiche = (titre: string, synthese: string, extra = '', corps = '') => `---\nid: 01ABC\ntype: entite\n${extra}updated: 2026-11-01\n---\n# ${titre}\n\n${synthese}\n${corps}`;
	const MOTS = ['avoir', 'facture', 'remise'];
	const sensParMots: Sens = {
		modele: () => 'mots@1',
		vecteurs: async (textes) => textes.map((t) => Float32Array.from([...MOTS.map((m) => t.toLowerCase().split(m).length - 1), 0.01])),
	};
	async function memoireNotee(syntheseAvoirs = 'Un avoir annule une facture.') {
		const dep = await memoire();
		const e = dep.coffre.ecrire;
		await e(VELA, fiche('Vela', 'Le client Vela.', 'portee: client:Vela\n', '\n## Relations\n- concerne [[Avoirs]]\n- concerne [[Factures]]\n- concerne [[Remises]]\n'));
		await e(AVOIRS, fiche('Avoirs', syntheseAvoirs));
		await e(FACTURES, fiche('Factures', 'Les factures du client.'));
		await e(REMISES, fiche('Remises', 'Une remise baisse le prix.'));
		await synchroniser(dep, SANS_EXTRACTION);
		dep.sens = sensParMots;
		await vectoriser(dep, { budgetMs: 60_000, demarrer: true });
		return dep;
	}
	const modele = (surcharge: Partial<ModeleDeNote> = {}): ModeleDeNote => ({
		...modeleNonAppris(),
		apprisLe: '2026-11-25T10:00:00.000Z',
		refus: [],
		accepte: true,
		gguf: INSTALLES,
		echelle: echelleDesSignaux(REGLAGES_PAR_DEFAUT.contexte),
		// les mots du message font la note : la fiche que tous les mots trouvent passe le seuil, les autres non
		biais: -3,
		poids: { bm25Relatif: 6, cosinusRelatif: 0.5 },
		...surcharge,
	});
	const avecModeles = (dep: Dependances, coefficients: Partial<CoefficientsNote>) => {
		dep.note = () => ({ coefficients: { complets: modeleNonAppris(), sens: modeleNonAppris(), ...coefficients }, installes: INSTALLES });
	};
	const avecReglages = (dep: Dependances, contexte: Partial<typeof REGLAGES_PAR_DEFAUT.contexte>) => {
		dep.reglages = () => ({ ...REGLAGES_PAR_DEFAUT, contexte: { ...REGLAGES_PAR_DEFAUT.contexte, ...contexte } });
	};
	const demande = (surcharge: Partial<DemandeServir> = {}): DemandeServir => ({
		position: 'projets/Vela',
		message: 'un avoir',
		dejaServies: new Map(),
		dejaLues: new Map(),
		proposees: new Map(),
		ecartes: [],
		moment: 'message',
		muet: null,
		premier: false,
		fin: Date.now() + 5000,
		rappels: false,
		...surcharge,
	});
	const injectees = (s: Servi) => s.calcul.injectees.map((f) => f.chemin);
	const cartes = (s: Servi) => s.calcul.cartes.map((c) => c.chemin);
	const empreinte = async (dep: Dependances, chemin: string) => (await dep.index.fiches()).find((f) => f.chemin === chemin)!.empreinte;

	it('seuil franchi : la fiche est injectée entière, au message même, dans sa section ; marquée au classement, pas en piste', async () => {
		const dep = await memoireNotee();
		avecModeles(dep, { sens: modele() });
		const s = await servir(dep, demande());
		expect(injectees(s)).toEqual([AVOIRS]);
		const f = s.calcul.injectees[0]!;
		expect(f.p).toBeGreaterThanOrEqual(0.9);
		expect(f.niveau).toBe('sens');
		expect(f.empreinte).toBe(await empreinte(dep, AVOIRS));
		expect(s.texte).toContain(`${TITRE_INJECTEES_PAR_MNEMO}\n\n### Avoirs (${AVOIRS})`);
		expect(s.texte).toContain('Un avoir annule une facture.');
		expect(cartes(s)).not.toContain(AVOIRS);
		expect(s.calcul.classement.find((l) => l.chemin === AVOIRS)).toMatchObject({ auto: true, piste: false });
		expect(s.calcul.classement.filter((l) => l.auto === true)).toHaveLength(1);
		// la section vient après la fiche de position et avant les pistes
		expect(s.texte.indexOf(TITRE_INJECTEES_PAR_MNEMO)).toBeGreaterThan(s.texte.indexOf('### Vela'));
	});

	it('seuil à 100 : jamais d’injection ; la fiche reste une piste', async () => {
		const dep = await memoireNotee();
		avecModeles(dep, { sens: modele() });
		avecReglages(dep, { seuilInjection: 100 });
		const s = await servir(dep, demande());
		expect(injectees(s)).toEqual([]);
		expect(s.texte).not.toContain(TITRE_INJECTEES_PAR_MNEMO);
		expect(cartes(s)).toContain(AVOIRS);
	});

	it('plafond : au plus `injectionsParMessage` fiches, les mieux notées ; 0 = jamais', async () => {
		const dep = await memoireNotee();
		// toutes au-dessus du seuil
		avecModeles(dep, { sens: modele({ biais: 3, poids: { cosinusRelatif: 0 } }) });
		expect(injectees(await servir(dep, demande()))).toHaveLength(2);
		avecReglages(dep, { injectionsParMessage: 1 });
		const une = await servir(dep, demande());
		expect(injectees(une)).toHaveLength(1);
		// les autres restent des pistes
		expect(cartes(une)).toHaveLength(2);
		avecReglages(dep, { injectionsParMessage: 0 });
		expect(injectees(await servir(dep, demande()))).toEqual([]);
	});

	it('une fois par session : déjà injectée à son empreinte, plus rien ; la fiche a changé, elle repart', async () => {
		const dep = await memoireNotee();
		avecModeles(dep, { sens: modele() });
		const deja = await servir(dep, demande({ dejaServies: new Map([[AVOIRS, await empreinte(dep, AVOIRS)]]) }));
		expect(injectees(deja)).toEqual([]);
		expect(cartes(deja)).not.toContain(AVOIRS);
		// sans la trace « servie », la fiche passerait : même note, au seuil et au-dessus de la garde
		const ligne = deja.calcul.classement.find((l) => l.chemin === AVOIRS)!;
		expect(ligne.p).toBeGreaterThanOrEqual(REGLAGES_PAR_DEFAUT.contexte.seuilInjection / 100);
		expect(ligne.pSansApriori).toBeGreaterThanOrEqual(0.7);
		expect(injectees(await servir(dep, demande({ dejaServies: new Map([[AVOIRS, 'ancienne']]) })))).toEqual([AVOIRS]);
	});

	it('une fiche lue ou écrite par la session n’est jamais injectée ; une fiche seulement proposée en piste peut l’être', async () => {
		const dep = await memoireNotee();
		avecModeles(dep, { sens: modele() });
		expect(injectees(await servir(dep, demande({ dejaLues: new Map([[AVOIRS, null]]) })))).toEqual([]);
		expect(injectees(await servir(dep, demande({ dejaLues: new Map([[AVOIRS, await empreinte(dep, AVOIRS)]]) })))).toEqual([]);
		expect(injectees(await servir(dep, demande({ proposees: new Map([[AVOIRS, await empreinte(dep, AVOIRS)]]) })))).toEqual([AVOIRS]);
	});

	it('une fiche trop longue (plus de 8 000 caractères) n’est pas injectée : elle devient une piste', async () => {
		const dep = await memoireNotee(`Un avoir annule une facture. ${'Détail. '.repeat(1100)}`);
		avecModeles(dep, { sens: modele() });
		const s = await servir(dep, demande());
		expect(injectees(s)).toEqual([]);
		expect(cartes(s)[0]).toBe(AVOIRS);
	});

	it('garde de l’a priori : une note portée par l’a priori seul (p_sans_apriori < 0,7) n’injecte pas', async () => {
		const dep = await memoireNotee();
		avecModeles(dep, { sens: modele({ biais: -2, poids: { cosinusRelatif: 0, apriori: 1 } }) });
		const aprioris = () => new Map([[AVOIRS, 6]]);
		const s = await servir(dep, demande({ aprioris }));
		const ligne = s.calcul.classement.find((l) => l.chemin === AVOIRS)!;
		expect(ligne.p).toBeGreaterThanOrEqual(0.9);
		expect(ligne.pSansApriori).toBeLessThan(0.7);
		expect(injectees(s)).toEqual([]);
		// a priori non lu (hook sans service) alors que le modèle le pèse : note non calibrée, aucune injection
		avecModeles(dep, { sens: modele({ biais: -3, poids: { bm25Relatif: 6, apriori: 0.1 } }) });
		expect(injectees(await servir(dep, demande()))).toEqual([]);
		expect(injectees(await servir(dep, demande({ aprioris: () => new Map() })))).toEqual([AVOIRS]);
	});

	it('modèle refusé, module livré (`accepte: false`) : rien n’est injecté ; modèle de test accepté : l’injection a lieu', async () => {
		const dep = await memoireNotee();
		// le module du dépôt, sans coefficients propres à la mémoire
		expect(injectees(await servir(dep, demande()))).toEqual([]);
		avecModeles(dep, { sens: modele({ accepte: false, refus: ['trop peu d’injections'] }) });
		const refuse = await servir(dep, demande());
		expect(injectees(refuse)).toEqual([]);
		expect(cartes(refuse)).toContain(AVOIRS);
		avecModeles(dep, { sens: modele() });
		expect(injectees(await servir(dep, demande()))).toEqual([AVOIRS]);
	});

	it('niveau Complets : sans reranker au hook, aucune injection par lui ; avec le reranker, injectée à ce niveau', async () => {
		const dep = await memoireNotee();
		const complets = modele({ biais: -2, poids: { logit: 1, cosinusRelatif: 0 } });
		avecModeles(dep, { complets, sens: modele({ accepte: false, refus: ['x'] }) });
		dep.reranker = { noter: async (_r, textes) => textes.map((t) => (t.startsWith('Avoirs') ? 6 : -6)) };
		expect(injectees(await servir(dep, demande()))).toEqual([]);
		const duree = dureeDuReranker();
		for (const [documents, ms] of [[5, 35], [10, 60], [5, 35]] as const) duree.noter({ documents, ms });
		const s = await servir(dep, demande({ dureeReranker: duree }));
		expect(injectees(s)).toEqual([AVOIRS]);
		expect(s.calcul.injectees[0]!.niveau).toBe('complets');
	});

	it('niveau coupé par le suivi : aucune injection ; les % et l’ordre calibré restent, la fiche reste une piste', async () => {
		const dep = await memoireNotee();
		avecModeles(dep, { sens: modele() });
		const coupure = { niveau: 'sens' as const, injections: 20, ecartees: 17, depuisMs: 1, motif: 'm' };
		const s = await servir(dep, demande({ modeles: avecLesCoupures(modelesActifs(dep), { complets: null, sens: coupure }) }));
		expect(injectees(s)).toEqual([]);
		const libre = await servir(dep, demande());
		expect(s.calcul.calibree).toBe(true);
		expect(s.calcul.classement.map((l) => [l.chemin, l.p])).toEqual(libre.calcul.classement.map((l) => [l.chemin, l.p]));
		expect(s.calcul.classement.find((l) => l.chemin === AVOIRS)!.p).toBeGreaterThanOrEqual(0.9);
		expect(cartes(s)[0]).toBe(AVOIRS);
	});

	it('Complets coupé, Sens seul accepté : la candidate notée par Complets est injectée selon sa note Sens ; les % affichés restent ceux de Complets', async () => {
		const dep = await memoireNotee();
		const complets = modele({ biais: -2, poids: { logit: 1, cosinusRelatif: 0 } });
		avecModeles(dep, { complets, sens: modele() });
		// le reranker trouve aussi Avoirs : notée par Complets (logit), elle passerait à ce niveau
		dep.reranker = { noter: async (_r, textes) => textes.map((t) => (t.startsWith('Avoirs') ? 6 : -6)) };
		const duree = dureeDuReranker();
		for (const [documents, ms] of [[5, 35], [10, 60], [5, 35]] as const) duree.noter({ documents, ms });
		const libre = await servir(dep, demande({ dureeReranker: duree }));
		expect(libre.calcul.injectees.map((f) => [f.chemin, f.niveau])).toEqual([[AVOIRS, 'complets']]);
		const coupure = { niveau: 'complets' as const, injections: 20, ecartees: 17, depuisMs: 1, motif: 'm' };
		const s = await servir(dep, demande({ dureeReranker: duree, modeles: avecLesCoupures(modelesActifs(dep), { complets: coupure, sens: null }) }));
		// la mieux classée n'est pas bloquée : sa note Sens la fait passer
		expect(s.calcul.injectees.map((f) => [f.chemin, f.niveau])).toEqual([[AVOIRS, 'sens']]);
		expect(s.calcul.classement.map((l) => [l.chemin, l.p])).toEqual(libre.calcul.classement.map((l) => [l.chemin, l.p]));
		// les deux niveaux coupés : rien
		const deux = await servir(dep, demande({ dureeReranker: duree, modeles: avecLesCoupures(modelesActifs(dep), { complets: coupure, sens: { ...coupure, niveau: 'sens' } }) }));
		expect(injectees(deux)).toEqual([]);
	});

	it('session inconnue (`injectionAutomatique: false`) : aucune injection automatique', async () => {
		const dep = await memoireNotee();
		avecModeles(dep, { sens: modele() });
		expect(injectees(await servir(dep, demande({ injectionAutomatique: false })))).toEqual([]);
		expect(injectees(await servir(dep, demande()))).toEqual([AVOIRS]);
	});

	it('message muet avec une fiche demandée : le drapeau `injecter` faux empêche l’injection, même quand une note passerait le seuil', async () => {
		const dep = await memoireNotee();
		avecModeles(dep, { sens: modele() });
		const calculer = vi.mocked(moduleCartes.calculerCartes);
		const vrai = (await vi.importActual<typeof import('../../src/application/cartes.ts')>('../../src/application/cartes.ts')).calculerCartes;
		// le calcul reçoit un message porteur (une note passe le seuil) mais garde le drapeau décidé par `servir`
		const avecMessage = (forcer?: boolean) =>
			calculer.mockImplementationOnce((d, demandeCartes) => vrai(d, { ...demandeCartes, message: 'un avoir', ...(forcer === undefined ? {} : { injecter: forcer }) }));
		avecMessage();
		const s = await servir(dep, demande({ message: 'ok', muet: 'sans_contenu', demandees: [REMISES] }));
		expect(calculer.mock.lastCall![1].injecter).toBe(false);
		expect(s.calcul.classement.find((l) => l.chemin === AVOIRS)!.p).toBeGreaterThanOrEqual(REGLAGES_PAR_DEFAUT.contexte.seuilInjection / 100);
		expect(injectees(s)).toEqual([]);
		expect(s.texte).not.toContain(TITRE_INJECTEES_PAR_MNEMO);
		expect(s.demandees.map((f) => f.chemin)).toEqual([REMISES]);
		// le même calcul, drapeau levé : la fiche est injectée ; c'est donc le drapeau qui l'empêchait
		avecMessage(true);
		expect(injectees(await servir(dep, demande({ message: 'ok', muet: 'sans_contenu', demandees: [REMISES] })))).toEqual([AVOIRS]);
	});

	describe('réserve après injection', () => {
		afterEach(() => vi.restoreAllMocks());
		it('plus le temps de lire la fiche suivante (moins de 20 ms avant la fin du calcul) : elle n’est pas injectée, elle devient une piste', async () => {
			const dep = await memoireNotee();
			avecModeles(dep, { sens: modele({ biais: 3, poids: { cosinusRelatif: 0 } }) });
			const tout = await servir(dep, demande());
			expect(injectees(tout)).toHaveLength(2);
			const [premiere, seconde] = injectees(tout);
			// la lecture de la première fiche injectée fait passer l'horloge à 10 ms de la fin
			const fin = Date.now() + 5000;
			const reel = Date.now.bind(Date);
			let decalage = 0;
			vi.spyOn(Date, 'now').mockImplementation(() => reel() + decalage);
			const lire = dep.coffre.lire.bind(dep.coffre);
			dep.coffre.lire = async (chemin) => {
				const texte = await lire(chemin);
				if (chemin === premiere) decalage = fin - 10 - reel();
				return texte;
			};
			const s = await servir(dep, demande({ fin }));
			expect(injectees(s)).toEqual([premiere]);
			expect(cartes(s)).toContain(seconde);
			expect(s.calcul.classement.find((l) => l.chemin === seconde)).toMatchObject({ piste: true });
		});
	});

	it('ni à un message muet, ni à l’outil `contexte`', async () => {
		const dep = await memoireNotee();
		avecModeles(dep, { sens: modele() });
		expect(injectees(await servir(dep, demande({ message: 'ok', muet: 'sans_contenu' })))).toEqual([]);
		expect(injectees(await servir(dep, demande({ moment: 'contexte' })))).toEqual([]);
	});

	it('une fiche nommée dans le message et au seuil est injectée, pas aussi proposée en carte', async () => {
		const dep = await memoireNotee();
		avecModeles(dep, { sens: modele() });
		const s = await servir(dep, demande({ message: 'les Avoirs : un avoir' }));
		expect(injectees(s)).toEqual([AVOIRS]);
		expect(cartes(s)).not.toContain(AVOIRS);
	});
});
