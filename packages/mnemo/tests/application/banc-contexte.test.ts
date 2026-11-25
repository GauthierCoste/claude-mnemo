import { describe, expect, it } from 'vitest';
import { rejouerCas } from '../../src/application/banc-contexte.ts';
import type { CasContexte } from '../../src/application/banc-contexte.ts';
import { extraireJugements, fusionnerCas, messagesDesCas, messagesDuJournal } from '../../src/application/banc-extraire.ts';
import { rejouerJugements } from '../../src/application/banc-rejeu.ts';
import type { Signaux } from '../../src/application/banc-signaux.ts';
import type { LectureDuJournal } from '../../src/application/banc-extraire.ts';
import type { EntreeServie, Reranker, Sens } from '../../src/application/ports.ts';
import { vectoriser } from '../../src/application/vectoriser.ts';
import type { MessageDuJournal } from '../../src/domaine/echantillon-banc.ts';
import { SANS_EXTRACTION, synchroniser } from '../../src/application/synchroniser.ts';
import { fauxPorts } from '../aides/faux-ports.ts';

const fiche = (type: string, titre: string, synthese: string, extra = '', corps = '', updated = '2026-11-01') =>
	`---\nid: 01ABC\ntype: ${type}\n${extra}updated: ${updated}\n---\n# ${titre}\n\n${synthese}\n${corps}`;
const relations = (...cibles: string[]) => `\n## Relations\n${cibles.map((c) => `- concerne [[${c}]]`).join('\n')}\n`;

/** Mémoire fictive de `cartes.test.ts` : SVE en position (client:SVE), Corvel (type entité) et son ERP à part. */
async function memoire(options: { synchroniser?: boolean } = {}) {
	const dep = fauxPorts();
	const e = dep.coffre.ecrire;
	await e('organisations/clients/SVE.md', fiche('entite', 'SVE', 'Client photovoltaïque.', 'portee: client:SVE\n', relations('Outil Parcs', 'Sous', 'Ysaline', 'Git', 'Doc SVE', 'Clients')));
	await e('organisations/clients/SVE/Outil Parcs.md', fiche('entite', 'Outil Parcs', 'Outil de suivi des sites du client. Il sert aux chantiers.', '', '', '2026-11-05'));
	await e('organisations/clients/SVE/Sous.md', fiche('entite', 'Sous', 'Un sous-traitant du client.', '', '', '2026-11-03'));
	await e('personnes/Ysaline.md', fiche('personne', 'Ysaline', 'Contact du client.', '', relations('ERP Corvelis'), '2026-11-02'));
	await e('pratiques/Git.md', fiche('pratique', 'Git', 'Pratiques Git.', '', '', '2026-11-04'));
	await e('projets/clients/Corvel/Corvel.md', fiche('entite', 'Corvel', 'Autre client.', 'portee: client:Corvel\n'));
	await e('projets/clients/Corvel/ERP Corvelis.md', fiche('entite', 'ERP Corvelis', 'ERP du client Corvel.'));
	await e('sources/Doc SVE.md', `---\nid: 01SRC\ntype: source\nchemin: docs/doc.md\ntype_source: spec_validee\nupdated: 2026-11-01\n---\n# Doc SVE\n`);
	await e('organisations/clients/clients.md', fiche('dossier', 'Clients', 'Les clients.'));
	if (options.synchroniser !== false) await synchroniser(dep, SANS_EXTRACTION);
	return dep;
}

const POSITION = 'organisations/clients/SVE';
const cas = (c: Partial<CasContexte> & Pick<CasContexte, 'nom' | 'message'>): CasContexte => ({ position: POSITION, premier: false, attendues: [], interdites: [], silence: false, ...c });

const CAS: CasContexte[] = [
	cas({ nom: 'premier message', message: 'Maquette ERP', premier: true, attendues: ['SVE.md', 'Outil Parcs.md'], interdites: ['ERP Corvelis.md', 'Doc SVE.md', 'clients.md'] }),
	cas({ nom: 'acquiescement', message: 'oui vas y pousse', silence: true }),
	cas({ nom: 'fiche nommée', message: 'parle-moi de Corvel', attendues: ['Corvel.md'], interdites: ['Outil Parcs.md'] }),
	cas({ nom: 'notification', message: '<task-notification>fini</task-notification>', silence: true }),
];

describe('rejouerCas', () => {
	it('quatre cas étiquetés : quatre justes, aucune carte indésirable', async () => {
		const { mesure, echecs } = await rejouerCas(await memoire(), CAS);
		expect(echecs).toEqual([]);
		expect(mesure).toMatchObject({ cas: 4, justes: 4, attenduesProposees: 3, attenduesTotal: 3, indesirables: 0 });
		expect(mesure.caracteres).toBeGreaterThan(0);
	});

	it('une carte interdite proposée compte comme indésirable et fait échouer le cas', async () => {
		const { mesure, echecs } = await rejouerCas(await memoire(), [cas({ nom: 'interdit', message: 'Maquette ERP', premier: true, interdites: ['Outil Parcs.md'] })]);
		expect(mesure).toMatchObject({ cas: 1, justes: 0, indesirables: 1 });
		expect(echecs).toEqual([{ nom: 'interdit', manquees: [], indesirables: ['Outil Parcs.md'] }]);
	});

	it('une attendue non proposée est signalée', async () => {
		const { mesure, echecs } = await rejouerCas(await memoire(), [cas({ nom: 'manquée', message: 'parle-moi de Corvel', attendues: ['ERP Corvelis.md'] })]);
		expect(mesure).toMatchObject({ justes: 0, attenduesProposees: 0, attenduesTotal: 1 });
		expect(echecs).toEqual([{ nom: 'manquée', manquees: ['ERP Corvelis.md'], indesirables: [] }]);
	});

	it('un cas silence qui reçoit des cartes compte ces cartes comme indésirables', async () => {
		const { mesure } = await rejouerCas(await memoire(), [cas({ nom: 'bavard', message: 'parle-moi de Corvel', silence: true })]);
		expect(mesure.justes).toBe(0);
		expect(mesure.indesirables).toBeGreaterThan(0);
	});
});

describe('rejouerCas : fiche injectée à la main', () => {
	const injectee = cas({ nom: 'fiche injectée', message: 'prépare la maquette du chantier', injectees: ['Ysaline.md'], attendues: ['ERP Corvelis.md'], interdites: ['Corvel.md'] });

	it('sa voisine d’ailleurs est proposée au message qui part avec elle ; elle-même, injectée entière, n’est ni attendue ni indésirable', async () => {
		const { mesure, echecs } = await rejouerCas(await memoire(), [injectee]);
		expect(echecs).toEqual([]);
		expect(mesure).toMatchObject({ cas: 1, justes: 1, attenduesProposees: 1, attenduesTotal: 1, indesirables: 0 });
	});

	it('sans le geste, la voisine d’ailleurs n’est pas proposée', async () => {
		const { echecs } = await rejouerCas(await memoire(), [{ ...injectee, injectees: [] }]);
		expect(echecs).toEqual([{ nom: 'fiche injectée', manquees: ['ERP Corvelis.md'], indesirables: [] }]);
	});

	it('une injectée inconnue de l’index est signalée, comme une attendue inconnue : le cas échoue', async () => {
		const { mesure, echecs } = await rejouerCas(await memoire(), [cas({ nom: 'injectée absente', message: 'prépare la maquette du chantier', injectees: ['Absente.md'] })]);
		expect(echecs).toEqual([{ nom: 'injectée absente', manquees: ['Absente.md (injectée inconnue)'], indesirables: [] }]);
		expect(mesure).toMatchObject({ cas: 1, justes: 0, attenduesProposees: 0, attenduesTotal: 0 });
	});
});

describe('rejouerCas : premier message muet en cas silence', () => {
	it('la fiche de position injectée n\'est pas indésirable, seules les cartes le sont', async () => {
		const { mesure, echecs } = await rejouerCas(await memoire(), [cas({ nom: 'ok merci', message: 'oui vas y pousse', premier: true, silence: true })]);
		expect(echecs).toEqual([]);
		expect(mesure).toMatchObject({ justes: 1, indesirables: 0 });
		expect(mesure.caracteres).toBeGreaterThan(0);
	});

	it('un message porteur en cas silence : tout ce qui est proposé reste indésirable', async () => {
		const { mesure } = await rejouerCas(await memoire(), [cas({ nom: 'bavard', message: 'parle-moi de Corvel', premier: true, silence: true })]);
		expect(mesure.indesirables).toBeGreaterThan(0);
	});
});

describe('rejouerCas : index non synchronisé', () => {
	it('synchronise d\'abord : un cas silence qui n\'est pas le premier reste juste', async () => {
		const dep = await memoire({ synchroniser: false });
		const { mesure, echecs } = await rejouerCas(dep, [cas({ nom: 'acquiescement', message: 'oui vas y pousse', silence: true })]);
		expect(echecs).toEqual([]);
		expect(mesure.justes).toBe(1);
	});
});

// ——— Jugement par mise en commun ———

const MOTS_DU_SENS = ['site', 'maquette', 'contact', 'erp', 'git'];
/** Sens fictif : un axe par mot du vocabulaire (nombre d'occurrences), plus un petit axe commun. */
const sensParMots: Sens = {
	modele: () => 'mots@1',
	vecteurs: async (textes) => textes.map((t) => Float32Array.from([...MOTS_DU_SENS.map((m) => t.toLowerCase().split(m).length - 1), 0.01])),
};
/** Reranker fictif : logit fixé par le titre (première ligne du texte soumis). */
const rerankerParTitre = (logits: Record<string, number>): Reranker & { requetes: string[] } => {
	const r = {
		requetes: [] as string[],
		noter: async (requete: string, textes: string[]) => (r.requetes.push(requete), textes.map((t) => logits[t.split('\n')[0]!] ?? -5)),
	};
	return r;
};

const OUTIL = 'organisations/clients/SVE/Outil Parcs.md';
const SOUS = 'organisations/clients/SVE/Sous.md';
const YSALINE = 'personnes/Ysaline.md';
const GIT = 'pratiques/Git.md';
const CORVEL = 'projets/clients/Corvel/Corvel.md';
const ERP = 'projets/clients/Corvel/ERP Corvelis.md';

async function memoireAvecModeles(logits: Record<string, number> = { Sous: 4, Ysaline: 3 }) {
	const dep = await memoire();
	dep.sens = sensParMots;
	const reranker = rerankerParTitre(logits);
	dep.reranker = reranker;
	await vectoriser(dep, { budgetMs: 60_000, demarrer: true });
	return { dep, reranker };
}

const duJournal = (m: Partial<MessageDuJournal> & Pick<MessageDuJournal, 'message'>): MessageDuJournal => ({
	session: 'session-1',
	groupe: 'SVE',
	rang: 1,
	horodatageMs: 1,
	position: POSITION,
	precedent: null,
	...m,
});

describe('extraireJugements : mise en commun', () => {
	it('union des premières du sens, des mots et du reranker ; jamais source, dossier ni la fiche de position', async () => {
		const { dep } = await memoireAvecModeles();
		const { cas, modeles } = await extraireJugements(dep, [duJournal({ message: 'les sites du client' })], { premieres: 1 });
		expect(modeles).toEqual({ sens: true, reranker: true });
		expect(cas).toHaveLength(1);
		const candidates = cas[0]!.candidates!;
		// sens : « site » → Outil Parcs ; mots : « sites », « client » → une fiche du périmètre ; reranker : Sous
		const listes = Object.fromEntries(candidates.map((c) => [c.chemin, c.listes]));
		expect(listes[OUTIL]).toContain('sens');
		expect(listes[SOUS]).toContain('reranker');
		expect(candidates.some((c) => c.listes.includes('mots'))).toBe(true);
		expect(candidates.filter((c) => c.horsPile !== true).length).toBeLessThanOrEqual(3);
		const chemins = candidates.map((c) => c.chemin);
		expect(chemins.some((c) => c.startsWith('sources/') || c.endsWith('clients.md') || c.endsWith('SVE.md'))).toBe(false);
		expect(cas[0]).toMatchObject({ session: 'session-1', rang: 1, horodatageMs: 1, premier: true, jugements: {}, silence: false, modeles: { sens: true, reranker: true } });
		expect(cas[0]!.extraitLe).toMatch(/^\d{4}-\d{2}-\d{2}T/u);
	});

	it('deux fiches hors pile, tirées de façon stable hors de l’union, marquées ; chaque candidate garde l’empreinte de sa fiche', async () => {
		const { dep } = await memoireAvecModeles();
		const message = duJournal({ message: 'les sites du client' });
		const { cas } = await extraireJugements(dep, [message], { premieres: 1 });
		const hors = cas[0]!.candidates!.filter((c) => c.horsPile === true);
		expect(hors).toHaveLength(2);
		expect(hors.every((c) => c.listes.length === 0)).toBe(true);
		const encore = await extraireJugements(dep, [message], { premieres: 1 });
		expect(encore.cas[0]!.candidates!.filter((c) => c.horsPile === true).map((c) => c.chemin)).toEqual(hors.map((c) => c.chemin));
		const empreintes = new Map((await dep.index.fiches()).map((f) => [f.chemin, f.empreinte]));
		expect(cas[0]!.candidates!.every((c) => c.empreinte === empreintes.get(c.chemin))).toBe(true);
	});

	it('un modèle disponible qui ne répond pas à un message : le message est laissé, compté sansModele', async () => {
		const { dep } = await memoireAvecModeles();
		const notes = dep.reranker.noter;
		dep.reranker = { noter: async (requete, textes, o) => (requete === 'les sites du client' ? null : notes(requete, textes, o)) };
		const bilan = await extraireJugements(dep, [duJournal({ message: 'les sites du client' }), duJournal({ message: 'la maquette du contact', rang: 2 })]);
		expect(bilan.modeles).toEqual({ sens: true, reranker: true });
		expect(bilan.sansModele).toBe(1);
		expect(bilan.cas.map((c) => c.message)).toEqual(['la maquette du contact']);
	});

	it('voisines des fiches injectées à la main avant le message : candidates ; la fiche injectée à ce message même ne l’est pas', async () => {
		const { dep } = await memoireAvecModeles();
		// Ysaline injectée à la main un message plus tôt : sa voisine d'ailleurs (ERP Corvelis) devient candidate
		const avant = await extraireJugements(dep, [{ ...duJournal({ message: 'la maquette du chantier', rang: 2 }), injectionsDuJournal: [{ chemin: YSALINE, messages: 1, position: POSITION }] }]);
		expect(avant.cas[0]!.candidates!.map((c) => c.chemin)).toContain(ERP);
		expect(avant.cas[0]!.injectionsManuelles).toEqual([{ chemin: YSALINE, messages: 1 }]);
		const sans = await extraireJugements(dep, [duJournal({ message: 'la maquette du chantier', rang: 2 })], { premieres: 20 });
		expect(sans.cas[0]!.candidates!.map((c) => c.chemin)).not.toContain(ERP);
		// injectée à ce message (âge 0) : injectée entière, pas à juger ; la fiche de position servie n'est pas une injection à la main
		const ici = await extraireJugements(
			dep,
			[{ ...duJournal({ message: 'la maquette du chantier', rang: 2 }), injectionsDuJournal: [{ chemin: YSALINE, messages: 0, position: POSITION }, { chemin: 'organisations/clients/SVE.md', messages: 1, position: POSITION }] }],
			{ premieres: 20 },
		);
		expect(ici.cas[0]!.candidates!.map((c) => c.chemin)).not.toContain(YSALINE);
		expect(ici.cas[0]!.injectionsManuelles).toEqual([{ chemin: YSALINE, messages: 0 }]);
	});

	it('chaque candidate porte titre, première ligne et ses signaux bruts : logit, cosinus, cosinus relatif, bm25 relatif', async () => {
		const { dep } = await memoireAvecModeles();
		const { cas } = await extraireJugements(dep, [duJournal({ message: 'les sites du client' })]);
		const outil = cas[0]!.candidates!.find((c) => c.chemin === OUTIL)!;
		expect(outil).toMatchObject({ titre: 'Outil Parcs', ligne: 'Outil de suivi des sites du client.' });
		const s = outil.signaux.seule!;
		expect(s.cosinus).toBeGreaterThan(0);
		expect(s.cosinusRelatif).toBeGreaterThan(0);
		expect(s.logit).toBe(-5);
		expect(s.bm25Relatif).toBeGreaterThan(0);
		expect(outil.signaux.jointe).toBeUndefined();
	});

	it('à la racine, seules les fiches neutres ; une fiche d’ailleurs n’entre que si son lieu est nommé', async () => {
		const { dep } = await memoireAvecModeles();
		const racine = await extraireJugements(dep, [duJournal({ message: 'les pratiques git du site', position: '' })]);
		// neutres : sans lieu déclaré (Corvel et ses fiches en déclarent un)
		expect(racine.cas[0]!.candidates!.map((c) => c.chemin)).toEqual([OUTIL, SOUS, YSALINE, GIT].sort());
		const ailleurs = await extraireJugements(dep, [duJournal({ message: 'maquette de l’ERP' })]);
		expect(ailleurs.cas[0]!.candidates!.map((c) => c.chemin)).not.toContain(ERP);
		const nomme = await extraireJugements(dep, [duJournal({ message: 'maquette de l’ERP chez Corvel' })]);
		expect(nomme.cas[0]!.candidates!.map((c) => c.chemin)).toEqual(expect.arrayContaining([CORVEL, ERP]));
	});

	it('variante jointe : candidates et signaux aussi pour la requête jointe (règle donnée par T4)', async () => {
		const { dep, reranker } = await memoireAvecModeles();
		const jointe = (message: string, precedent: string | null) => (precedent === null ? null : `${precedent}\n${message}`);
		const { cas } = await extraireJugements(dep, [duJournal({ message: 'et pour le contact ?', rang: 2, precedent: 'les sites du client' })], { requeteJointe: jointe });
		expect(reranker.requetes.filter((r) => r !== 'essai')).toEqual(['et pour le contact ?', 'les sites du client\net pour le contact ?']);
		expect(cas[0]!.candidates!.every((c) => c.signaux.seule !== undefined && c.signaux.jointe !== undefined)).toBe(true);
		expect(cas[0]).toMatchObject({ premier: false, precedent: 'les sites du client' });
	});

	it('sans modèle : les mots seuls, signaux de modèle nuls, modèles dits absents', async () => {
		const dep = await memoire();
		const { cas, modeles } = await extraireJugements(dep, [duJournal({ message: 'les sites du client' })]);
		expect(modeles).toEqual({ sens: false, reranker: false });
		expect(cas[0]!.candidates!.filter((c) => c.horsPile !== true).every((c) => c.listes.join() === 'mots')).toBe(true);
		expect(cas[0]!.candidates!.every((c) => c.signaux.seule!.logit === null && c.signaux.seule!.cosinus === null)).toBe(true);
		expect(cas[0]!.modeles).toEqual({ sens: false, reranker: false });
	});

	it('un message sans aucune candidate n’est pas gardé, il est compté', async () => {
		const dep = await memoire();
		const bilan = await extraireJugements(dep, [duJournal({ message: 'zzzz yyyy xxxx', position: '' })]);
		expect(bilan).toMatchObject({ cas: [], sansCandidate: 1 });
	});
});

describe('messagesDuJournal', () => {
	const entree = (demande: string, horodatageMs: number, muet: EntreeServie['muet'] = null, position: string | null = null, ids: string[] = []) => ({
		moment: 'message' as const, horodatageMs, demande, muet, position, ids,
	});
	const session = (id: string, profil = 'defaut') => ({ id, profil, dossier: `dossier-${id}`, position: 'organisations/clients/SVE' });

	it('messages porteurs seulement (ni muets ni balises), dans l’ordre, avec rang, position, groupe et message d’avant ; jamais l’archiviste', async () => {
		const journaux: Record<string, ReturnType<typeof entree>[]> = {
			a: [entree('parle-moi de la maquette du site', 3, null, 'projets/X'), entree('oui', 2, 'sans_contenu'), entree('<task-notification>x</task-notification>', 4), entree('prépare la maquette ERP du chantier', 1)],
			b: [entree('extraire les documents du dossier', 1)],
		};
		const journal: LectureDuJournal = {
			sessions: async () => [session('a'), session('b', 'archiviste')],
			session: async () => null,
			messages: async (id) => journaux[id] ?? [],
		};
		const messages = await messagesDuJournal(journal);
		expect(messages.map((m) => [m.session, m.rang, m.message, m.position, m.groupe, m.precedent])).toEqual([
			['a', 1, 'prépare la maquette ERP du chantier', 'organisations/clients/SVE', 'dossier-a', null],
			['a', 2, 'parle-moi de la maquette du site', 'projets/X', 'dossier-a', 'prépare la maquette ERP du chantier'],
		]);
	});

	it('fiches injectées entières avant chaque message, avec leur âge en messages porteurs (muets non comptés)', async () => {
		const journal: LectureDuJournal = {
			sessions: async () => [session('a')],
			session: async () => null,
			messages: async () => [
				entree('prépare la maquette ERP du chantier', 1, null, 'p', ['p.md']),
				entree('oui', 2, 'sans_contenu', 'p', ['y.md']),
				entree('parle-moi de la maquette du site', 3),
				entree('et le planning des livraisons ?', 4, null, 'p', ['z.md']),
			],
		};
		const [premier, deuxieme, troisieme] = await messagesDuJournal(journal);
		expect(premier!.injectionsDuJournal).toEqual([{ chemin: 'p.md', messages: 0, position: 'p' }]);
		expect(deuxieme!.injectionsDuJournal).toEqual([{ chemin: 'p.md', messages: 1, position: 'p' }, { chemin: 'y.md', messages: 1, position: 'p' }]);
		expect(troisieme!.injectionsDuJournal).toEqual([
			{ chemin: 'p.md', messages: 2, position: 'p' },
			{ chemin: 'y.md', messages: 2, position: 'p' },
			{ chemin: 'z.md', messages: 0, position: 'p' },
		]);
	});

	it('session nommée inconnue : erreur lisible', async () => {
		const journal: LectureDuJournal = { sessions: async () => [], session: async () => null, messages: async () => [] };
		await expect(messagesDuJournal(journal, 'inconnue')).rejects.toThrow('Session inconnue');
	});
});

describe('fusionnerCas', () => {
	const extrait = (message: string, chemins: string[]): CasContexte =>
		cas({ nom: message, message, session: 's', rang: 1, jugements: {}, candidates: chemins.map((chemin) => ({ chemin, titre: chemin, ligne: '', listes: ['sens'], signaux: {} })) });

	it('ajoute les nouveaux ; un cas connu garde ses jugements et reçoit les candidates qui lui manquent', () => {
		const existant = { ...extrait('m1', [OUTIL]), jugements: { [OUTIL]: 'pertinente' as const } };
		const { cas: tous, ajoutes, completes } = fusionnerCas([existant], [extrait('m1', [OUTIL, SOUS]), extrait('m2', [GIT])]);
		expect({ ajoutes, completes }).toEqual({ ajoutes: 1, completes: 1 });
		expect(tous[0]!.candidates!.map((c) => c.chemin)).toEqual([OUTIL, SOUS]);
		expect(tous[0]!.jugements).toEqual({ [OUTIL]: 'pertinente' });
		expect(existant.candidates).toHaveLength(1);
	});

	it('un cas étiqueté à la main : attendues pertinentes, interdites non pertinentes, tout non pertinent en silence', () => {
		const etiquete = cas({ nom: 'à la main', message: 'm1', attendues: ['Outil Parcs.md'], interdites: ['Sous.md'] });
		const silence = cas({ nom: 'muet', message: 'm2', silence: true });
		const { cas: tous } = fusionnerCas([etiquete, silence], [extrait('m1', [OUTIL, SOUS, GIT]), extrait('m2', [GIT])]);
		expect(tous[0]!.jugements).toEqual({ [OUTIL]: 'pertinente', [SOUS]: 'non_pertinente' });
		expect(tous[0]).toMatchObject({ session: 's', rang: 1 });
		expect(tous[1]!.jugements).toEqual({ [GIT]: 'non_pertinente' });
	});
});

describe('--completer : messagesDesCas et fusion', () => {
	it('un cas déjà jugé relancé reçoit ses nouvelles fiches seules ; pas de nouvelles fiches hors pile s’il en a déjà', () => {
		const carte = (chemin: string, horsPile = false) => ({ chemin, titre: chemin, ligne: '', listes: [], signaux: {}, ...(horsPile ? { horsPile: true } : {}) });
		const existant = cas({ nom: 'x', message: 'm', session: 's', rang: 3, horodatageMs: 7, injectionsManuelles: [{ chemin: YSALINE, messages: 1 }], candidates: [carte(OUTIL), carte(GIT, true)], jugements: { [OUTIL]: 'pertinente', [GIT]: 'non_pertinente' } });
		expect(messagesDesCas([existant, { ...existant, nom: 'sauté', saute: true }])).toEqual([
			{ session: 's', groupe: '', rang: 3, horodatageMs: 7, message: 'm', position: POSITION, precedent: null, injectees: [{ chemin: YSALINE, messages: 1 }] },
		]);
		const relance = { ...existant, candidates: [carte(OUTIL), carte(SOUS), carte(ERP, true)], jugements: {} };
		const { cas: tous, completes, fichesAjoutees } = fusionnerCas([existant], [relance]);
		expect({ completes, fichesAjoutees }).toEqual({ completes: 1, fichesAjoutees: 1 });
		expect(tous[0]!.candidates!.map((c) => c.chemin)).toEqual([OUTIL, GIT, SOUS]);
		expect(tous[0]!.jugements).toEqual({ [OUTIL]: 'pertinente', [GIT]: 'non_pertinente' });
	});
});

describe('rejouerCas sans synchroniser', () => {
	it('l’index est lu tel qu’il est : rien n’est écrit', async () => {
		const dep = await memoire({ synchroniser: false });
		await rejouerCas(dep, [cas({ nom: 'muet', message: 'oui vas y pousse', silence: true })], { synchroniser: false });
		expect(await dep.index.fiches()).toEqual([]);
	});
});

describe('rejouerJugements', () => {
	const signaux = (logit: number | null, cosinusRelatif: number | null, bm25Relatif: number): Signaux => ({ logit, cosinus: cosinusRelatif, cosinusRelatif, bm25Relatif });
	const juge = (nom: string, session: string, lignes: [string, Signaux, 'pertinente' | 'non_pertinente' | 'indecise'][], extra: Partial<CasContexte> = {}): CasContexte =>
		cas({
			nom,
			message: nom,
			session,
			rang: 1,
			candidates: lignes.map(([chemin, s]) => ({ chemin, titre: chemin, ligne: '', listes: ['sens'], signaux: { seule: s } })),
			jugements: Object.fromEntries(lignes.map(([chemin, , j]) => [chemin, j])),
			...extra,
		});
	const CAS_JUGES = [
		juge('m1', 's1', [
			['a.md', signaux(3, 0.2, 0.1), 'pertinente'],
			['b.md', signaux(1, 0.3, 1), 'non_pertinente'],
			['c.md', signaux(null, 0.1, 0.5), 'indecise'],
		]),
		juge('m2', 's2', [
			['a.md', signaux(-2, -0.1, 0), 'non_pertinente'],
			['d.md', signaux(-1, 0.05, 1), 'non_pertinente'],
		], { silence: true }),
		// pas encore jugé, ou sauté : ni paire ni mesure
		{ ...juge('m3', 's3', [['a.md', signaux(1, 1, 1), 'pertinente']]), jugements: {} },
		{ ...juge('m4', 's4', [['a.md', signaux(1, 1, 1), 'pertinente']]), saute: true },
	];

	it('paires des messages jugés avec leurs signaux bruts ; indécises exclues et comptées ; silence porté', async () => {
		const r = await rejouerJugements(fauxPorts(), CAS_JUGES);
		expect(r).toMatchObject({ messagesJuges: 2, sessions: 2, indecises: 1, modeles: null });
		expect(r.paires.map((p) => [p.cas, p.chemin, p.pertinente, p.silence])).toEqual([
			['m1', 'a.md', true, false],
			['m1', 'b.md', false, false],
			['m2', 'a.md', false, true],
			['m2', 'd.md', false, true],
		]);
		expect(r.paires[0]).toMatchObject({ session: 's1', rang: 1, variante: 'seule', signaux: { logit: 3, cosinusRelatif: 0.2, bm25Relatif: 0.1 } });
		expect(r.aBrancher.join('\n')).toMatch(/T3\/T4[\s\S]*T4[\s\S]*T8\/T9/u);
	});

	it('une mesure par niveau : l’ordre du niveau fixe les pistes (3 premières)', async () => {
		const r = await rejouerJugements(fauxPorts(), CAS_JUGES, { pistesParMessage: 1 });
		const de = (niveau: string) => r.mesures.find((m) => m.niveau === niveau && m.variante === 'seule')!;
		// Complets : a (logit 3) d'abord ; Sens seul : b (0,3) d'abord ; Coupés : b (bm25 1) d'abord
		expect(de('complets')).toMatchObject({ messages: 2, sessions: 2, silences: 1, pertinentes: 1, nonPertinentes: 3, rappel10: 1, rappelPistes: 1, precisionPistes: 0.5, note: null });
		expect(de('sens')).toMatchObject({ rappelPistes: 0, rappel10: 1 });
		expect(de('ordre')).toMatchObject({ rappelPistes: 0 });
		expect(r.mesures.some((m) => m.variante === 'jointe')).toBe(false);
	});

	it('avec une note (T9) : précision au seuil, Wilson, injections, silences avec injection, ECE et courbes', async () => {
		const note = (_niveau: string, s: Signaux) => (s.logit === null ? null : 1 / (1 + Math.exp(-s.logit)));
		const r = await rejouerJugements(fauxPorts(), CAS_JUGES, { note, seuilInjection: 0.7 });
		const complets = r.mesures.find((m) => m.niveau === 'complets')!.note!;
		// au seuil 0,7 : m1 injecte a (0,95, juste) et b (0,73, fausse) ; m2 (silence) rien
		expect(complets.auSeuil).toMatchObject({ seuil: 0.7, injections: 2, justes: 1, precision: 0.5, sessions: 1, injectionsParMessage: 1, silencesAvecInjection: 0 });
		expect(complets.auSeuil.wilsonBasse).toBeGreaterThan(0);
		expect(complets.ece).not.toBeNull();
		expect(complets.courbeInjection.map((s) => s.seuil)).toEqual([0.7, 0.75, 0.8, 0.85, 0.9, 0.95, 1]);
		expect(complets.courbePistes).toHaveLength(13);
	});

	it('fiches non jugées : gardées parmi les injections simulées, comptées, précision pessimiste à côté de l’observée', async () => {
		// message jugé en partie (une fiche ajoutée par --completer, pas encore jugée) : il se rejoue quand même
		const partiel = juge('m5', 's5', [
			['n.md', signaux(5, 0.1, 0.1), 'pertinente'],
			['o.md', signaux(4, 0.1, 0.1), 'pertinente'],
		]);
		partiel.jugements = { 'o.md': 'pertinente' };
		const note = (_niveau: string, s: Signaux) => (s.logit === null ? null : 1 / (1 + Math.exp(-s.logit)));
		const r = await rejouerJugements(fauxPorts(), [partiel], { note, seuilInjection: 0.9 });
		const s = r.mesures.find((m) => m.niveau === 'complets')!.note!.auSeuil;
		expect(s).toMatchObject({ injections: 2, justes: 1, injectionsNonJugees: 1, precision: 1, precisionPessimiste: 0.5 });
		expect(s.wilsonBassePessimiste).toBeLessThan(s.wilsonBasse);
		expect(r.mesures.find((m) => m.niveau === 'complets')!.nonJugeesEnTete).toBe(1);
	});

	it('silence déduit d’un message jugé sans aucune fiche pertinente ni indécise', async () => {
		const sansRien = juge('m6', 's6', [['a.md', signaux(1, 0, 0), 'non_pertinente'], ['b.md', signaux(0, 0, 0), 'non_pertinente']]);
		const indecis = juge('m7', 's7', [['a.md', signaux(1, 0, 0), 'non_pertinente'], ['b.md', signaux(0, 0, 0), 'indecise']]);
		const r = await rejouerJugements(fauxPorts(), [sansRien, indecis]);
		expect(r.paires.filter((p) => p.silence).map((p) => p.cas)).toEqual(['m6', 'm6']);
		expect(r.mesures.find((m) => m.niveau === 'ordre')!.silences).toBe(1);
	});

	it('empreinte changée depuis l’extraction : signalée, jugement exclu par défaut, gardé avec « garder »', async () => {
		const dep = await memoire();
		const actuelle = (await dep.index.fiches()).find((f) => f.chemin === OUTIL)!.empreinte;
		const c = juge('m8', 's8', [[OUTIL, signaux(1, 0, 0), 'pertinente'], [SOUS, signaux(0, 0, 0), 'non_pertinente']]);
		c.candidates = c.candidates!.map((x) => ({ ...x, empreinte: x.chemin === OUTIL ? actuelle : 'ancienne' }));
		const exclu = await rejouerJugements(dep, [c]);
		expect(exclu.empreintesChangees).toEqual([{ cas: 'm8', chemin: SOUS }]);
		expect(exclu.paires.map((p) => p.chemin)).toEqual([OUTIL]);
		const garde = await rejouerJugements(dep, [c], { empreintes: 'garder' });
		expect(garde.paires.map((p) => p.chemin)).toEqual([OUTIL, SOUS]);
	});

	it('biais de la pile : pertinentes parmi les fiches de la pile et parmi celles tirées hors pile', async () => {
		const c = juge('m9', 's9', [['a.md', signaux(1, 0, 0), 'pertinente'], ['h.md', signaux(0, 0, 0), 'non_pertinente'], ['k.md', signaux(0, 0, 0), 'pertinente']]);
		c.candidates = c.candidates!.map((x) => (x.chemin === 'a.md' ? x : { ...x, horsPile: true }));
		const r = await rejouerJugements(fauxPorts(), [c]);
		expect(r.biais).toEqual({ pile: { jugees: 1, pertinentes: 1 }, horsPile: { jugees: 2, pertinentes: 1 } });
		expect(r.paires.filter((p) => p.horsPile).map((p) => p.chemin)).toEqual(['h.md', 'k.md']);
	});

	it('recalcul par les faux modèles : les signaux viennent du rejeu, pour chaque variante', async () => {
		const { dep, reranker } = await memoireAvecModeles();
		const { cas: extraits } = await extraireJugements(dep, [duJournal({ message: 'et le contact ?', rang: 2, precedent: 'les sites du client' })]);
		const jugeTout = extraits.map((c) => ({ ...c, jugements: Object.fromEntries(c.candidates!.map((x) => [x.chemin, x.chemin === YSALINE ? 'pertinente' : 'non_pertinente'] as const)) }));
		reranker.requetes.length = 0;
		const jointe = (message: string, precedent: string | null) => (precedent === null ? null : `${precedent}\n${message}`);
		const r = await rejouerJugements(dep, jugeTout, { recalculer: true, requeteJointe: jointe });
		expect(r.modeles).toEqual({ sens: true, reranker: true });
		expect(reranker.requetes.filter((q) => q !== 'essai')).toEqual(['et le contact ?', 'les sites du client\net le contact ?']);
		expect(new Set(r.paires.map((p) => p.variante))).toEqual(new Set(['seule', 'jointe']));
		expect(r.mesures.filter((m) => m.variante === 'jointe')).toHaveLength(3);
		expect(r.aBrancher.join('\n')).toMatch(/au lieu de la règle provisoire/u);
	});
});
