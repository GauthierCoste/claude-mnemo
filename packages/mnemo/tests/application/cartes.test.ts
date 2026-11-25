import { describe, expect, it } from 'vitest';
import { calculerCartes, ligneDeCarte } from '../../src/application/cartes.ts';
import type { DemandeCartes } from '../../src/application/cartes.ts';
import type { Dependances, Reranker, Sens } from '../../src/application/ports.ts';
import { SANS_EXTRACTION, synchroniser } from '../../src/application/synchroniser.ts';
import { vectoriser } from '../../src/application/vectoriser.ts';
import { REGLAGES_PAR_DEFAUT } from '../../src/domaine/reglages.ts';
import { fauxPorts } from '../aides/faux-ports.ts';

const SVE = 'organisations/clients/SVE.md';
const OUTIL = 'organisations/clients/SVE/Outil Parcs.md';
const SOUS = 'organisations/clients/SVE/Sous.md';
const YSALINE = 'personnes/Ysaline.md';
const GIT = 'pratiques/Git.md';
const CORVEL = 'projets/clients/Corvel/Corvel.md';
const ERP = 'projets/clients/Corvel/ERP Corvelis.md';
const DOC = 'sources/Doc SVE.md';
const DOSSIER = 'organisations/clients/clients.md';

const fiche = (type: string, titre: string, synthese: string, extra = '', corps = '', updated = '2026-11-01') =>
	`---\nid: 01ABC\ntype: ${type}\n${extra}updated: ${updated}\n---\n# ${titre}\n\n${synthese}\n${corps}`;
const relations = (...cibles: string[]) => `\n## Relations\n${cibles.map((c) => `- concerne [[${c}]]`).join('\n')}\n`;

/** Mémoire fictive : un client en position (SVE), un autre client lexicalement proche (Corvel) dont l'ERP est à deux sauts. */
async function memoire(options: { syntheseDePosition?: string } = {}) {
	const dep = fauxPorts();
	const e = dep.coffre.ecrire;
	await e(SVE, fiche('entite', 'SVE', options.syntheseDePosition ?? 'Client photovoltaïque.', 'portee: client:SVE\n', relations('Outil Parcs', 'Sous', 'Ysaline', 'Git', 'Doc SVE', 'Clients')));
	await e(OUTIL, fiche('entite', 'Outil Parcs', 'Outil de suivi des sites du client. Il sert aux chantiers.', '', '', '2026-11-05'));
	await e(SOUS, fiche('entite', 'Sous', 'Un sous-traitant du client.', '', '', '2026-11-03'));
	await e(YSALINE, fiche('personne', 'Ysaline', 'Contact du client.', '', relations('ERP Corvelis'), '2026-11-02'));
	await e(GIT, fiche('pratique', 'Git', 'Pratiques Git.', '', '', '2026-11-04'));
	await e(CORVEL, fiche('entite', 'Corvel', 'Autre client.', 'portee: client:Corvel\n'));
	await e(ERP, fiche('entite', 'ERP Corvelis', 'ERP du client Corvel.'));
	await e(DOC, `---\nid: 01SRC\ntype: source\nchemin: docs/doc.md\ntype_source: spec_validee\nupdated: 2026-11-01\n---\n# Doc SVE\n`);
	await e(DOSSIER, fiche('dossier', 'Clients', 'Les clients.'));
	await synchroniser(dep, SANS_EXTRACTION);
	// plafond large (l'ancien plafond du périmètre) : ces tests portent sur le choix des cartes, pas sur leur nombre
	dep.reglages = () => ({ ...REGLAGES_PAR_DEFAUT, contexte: { ...REGLAGES_PAR_DEFAUT.contexte, pistesParMessage: 10 } });
	return dep;
}

const demande = (surcharge: Partial<DemandeCartes> = {}): DemandeCartes => ({
	position: 'organisations/clients/SVE',
	message: 'Maquette ERP',
	classer: true,
	// par défaut, le premier message porteur : des pistes, le périmètre par date sans le sens
	pistes: true,
	premier: true,
	servirPosition: true,
	question: false,
	dejaServies: new Map(),
	dejaLues: new Map(),
	proposees: new Map(),
	ecartes: [],
	fin: Date.now() + 5000,
	...surcharge,
});

const chemins = (c: { cartes: { chemin: string }[] }) => c.cartes.map((x) => x.chemin);

function avecReglages(dep: Dependances, contexte: Partial<typeof REGLAGES_PAR_DEFAUT.contexte>): void {
	dep.reglages = () => ({ ...REGLAGES_PAR_DEFAUT, contexte: { ...REGLAGES_PAR_DEFAUT.contexte, ...contexte } });
}

describe('calculerCartes : premier message', () => {
	it('sert la fiche de position et propose le périmètre, sans fiche d\'ailleurs, source ni dossier', async () => {
		const c = await calculerCartes(await memoire(), demande());
		expect(c.position?.chemin).toBe(SVE);
		expect(c.position?.titre).toBe('SVE');
		expect(c.position?.encadree).toBe(false);
		expect(new Set(chemins(c))).toEqual(new Set([OUTIL, SOUS, YSALINE, GIT]));
		expect(c.cartes.every((x) => x.raison === 'perimetre')).toBe(true);
		expect(chemins(c)).not.toContain(ERP);
		expect(chemins(c)).not.toContain(DOC);
		expect(chemins(c)).not.toContain(DOSSIER);
		expect(chemins(c)).not.toContain(SVE);
	});

	it('ne propose pas plus que contexte.pistesParMessage', async () => {
		const dep = await memoire();
		avecReglages(dep, { pistesParMessage: 2 });
		const c = await calculerCartes(dep, demande());
		expect(c.cartes).toHaveLength(2);
	});

	it('sans modèle de sens : les cartes du périmètre par date de mise à jour décroissante', async () => {
		const c = await calculerCartes(await memoire(), demande());
		expect(chemins(c)).toEqual([OUTIL, GIT, SOUS, YSALINE]);
		expect(c.mesure).toBe('aucune');
	});

	it('une fiche temporaire périmée (perime_le passé) n\'est plus proposée ; avant ce jour, elle l\'est', async () => {
		const dep = await memoire();
		const outil = (jour: string) => fiche('entite', 'Outil Parcs', 'État du chantier Outil Parcs.', `perime_le: ${jour}\n`, '', '2026-11-05');
		await dep.coffre.ecrire(OUTIL, outil('2026-11-22'));
		await synchroniser(dep, SANS_EXTRACTION);
		expect(chemins(await calculerCartes(dep, demande()))).toEqual([GIT, SOUS, YSALINE]);
		await dep.coffre.ecrire(OUTIL, outil('2026-11-23'));
		await synchroniser(dep, SANS_EXTRACTION);
		expect(chemins(await calculerCartes(dep, demande()))).toEqual([OUTIL, GIT, SOUS, YSALINE]);
	});

	it('une carte porte titre, première phrase de la synthèse, type et raison ; sans modèle du sens, pas de note', async () => {
		const c = await calculerCartes(await memoire(), demande());
		expect(c.cartes.find((x) => x.chemin === OUTIL)).toEqual({
			chemin: OUTIL,
			titre: 'Outil Parcs',
			ligne: 'Outil de suivi des sites du client.',
			typeFiche: 'entite',
			raison: 'perimetre',
			depuis: null,
			note: null,
			encadree: false,
			empreinte: expect.any(String),
		});
	});

	it('position à la racine : pas de fiche de position, pas de carte du périmètre', async () => {
		const c = await calculerCartes(await memoire(), demande({ position: '' }));
		expect(c.position).toBeNull();
		expect(c.cartes).toEqual([]);
	});

	it('les fiches nommées restent proposées à la racine', async () => {
		const c = await calculerCartes(await memoire(), demande({ position: '', message: 'parle-moi de Ysaline' }));
		expect(c.cartes.map((x) => [x.chemin, x.raison])).toEqual([[YSALINE, 'nommee']]);
	});

	it('position introuvable : comme la racine, sans erreur', async () => {
		const c = await calculerCartes(await memoire(), demande({ position: 'organisations/clients/Disparue' }));
		expect(c.position).toBeNull();
		expect(c.cartes).toEqual([]);
	});

	it('une fiche de position de 9 000 caractères devient la première carte', async () => {
		const c = await calculerCartes(await memoire({ syntheseDePosition: 'Client photovoltaïque. '.concat('x'.repeat(9000)) }), demande());
		expect(c.position).toBeNull();
		expect(c.cartes[0]).toMatchObject({ chemin: SVE, raison: 'perimetre' });
		expect(chemins(c).slice(1).sort()).toEqual([GIT, YSALINE, OUTIL, SOUS].sort());
		// sans modèle du sens, pas de note, pas plus pour elle que pour les autres
		expect(c.cartes.every((x) => x.note === null)).toBe(true);
	});

	it('une fiche de position trop longue déjà proposée avec la même empreinte n\'est pas reproposée', async () => {
		const dep = await memoire({ syntheseDePosition: 'Client photovoltaïque. '.concat('x'.repeat(9000)) });
		const empreinte = (await dep.index.fiches()).find((f) => f.chemin === SVE)!.empreinte;
		const c = await calculerCartes(dep, demande({ proposees: new Map([[SVE, empreinte]]) }));
		expect(c.position).toBeNull();
		expect(chemins(c)).not.toContain(SVE);
	});

	it('ne ressert pas la fiche de position déjà servie avec la même empreinte, mais la sert si elle a changé', async () => {
		const dep = await memoire();
		const empreinte = (await dep.index.fiches()).find((f) => f.chemin === SVE)!.empreinte;
		expect((await calculerCartes(dep, demande({ dejaServies: new Map([[SVE, empreinte]]) }))).position).toBeNull();
		expect((await calculerCartes(dep, demande({ dejaServies: new Map([[SVE, 'ancienne']]) }))).position?.chemin).toBe(SVE);
	});

	it('servirPosition faux : pas de fiche de position', async () => {
		const c = await calculerCartes(await memoire(), demande({ servirPosition: false }));
		expect(c.position).toBeNull();
	});
});

describe('calculerCartes : fiches nommées', () => {
	it('propose Corvel puis Ysaline, dans l\'ordre du message, sans ERP Corvelis non nommé', async () => {
		const c = await calculerCartes(await memoire(), demande({ message: 'parle-moi de Corvel et de Ysaline', classer: false }));
		expect(c.cartes.map((x) => [x.chemin, x.raison])).toEqual([
			[CORVEL, 'nommee'],
			[YSALINE, 'nommee'],
		]);
		// sans modèle du sens, une fiche nommée n'a pas de note
		expect(c.cartes.map((x) => x.note)).toEqual([null, null]);
		expect(c.mesure).toBe('aucune');
	});

	it('ne retient ni source ni dossier nommés', async () => {
		const c = await calculerCartes(await memoire(), demande({ message: 'regarde Doc SVE et Clients', classer: false }));
		expect(c.cartes).toEqual([]);
	});

	it('une fiche nommée n\'est pas doublée par le périmètre, et son rang suit le message', async () => {
		const c = await calculerCartes(await memoire(), demande({ message: 'que dit Ysaline ?' }));
		expect(chemins(c).filter((x) => x === YSALINE)).toHaveLength(1);
		expect(c.cartes.find((x) => x.chemin === YSALINE)?.raison).toBe('nommee');
		// le périmètre d'abord, puis la fiche nommée
		expect(c.cartes.map((x) => x.raison)).toEqual(['perimetre', 'perimetre', 'perimetre', 'nommee']);
		expect(chemins(c)[3]).toBe(YSALINE);
	});

	it('une fiche d\'ailleurs rangée sous un lieu nommé n\'est proposée que si elle est nommée aussi', async () => {
		const c = await calculerCartes(await memoire(), demande({ message: 'Corvel et ERP Corvelis', classer: false }));
		expect(chemins(c)).toEqual([CORVEL, ERP]);
	});

	it('une fiche d\'ailleurs nommée sans son lieu n\'est pas proposée', async () => {
		const c = await calculerCartes(await memoire(), demande({ message: 'ouvre ERP Corvelis', classer: false }));
		expect(c.cartes).toEqual([]);
	});

	it('au plus contexte.cartesNommees cartes', async () => {
		const dep = await memoire();
		avecReglages(dep, { cartesNommees: 1 });
		const c = await calculerCartes(dep, demande({ message: 'Ysaline, Outil Parcs et Corvel', classer: false }));
		expect(chemins(c)).toEqual([YSALINE]);
	});
});

describe('calculerCartes : fiches déjà vues', () => {
	it('jamais en carte : fiche déjà servie avec la même empreinte, déjà lue, déjà proposée avec la même empreinte, écartée', async () => {
		const dep = await memoire();
		const empreintes = new Map((await dep.index.fiches()).map((f) => [f.chemin, f.empreinte]));
		const c = await calculerCartes(
			dep,
			demande({
				dejaServies: new Map([[OUTIL, empreintes.get(OUTIL)!]]),
				dejaLues: new Map([[SOUS, null]]),
				proposees: new Map([[GIT, empreintes.get(GIT)!]]),
				ecartes: [YSALINE],
				message: 'Ysaline, Outil Parcs, Git et Sous',
			}),
		);
		expect(c.cartes).toEqual([]);
	});

	it('une fiche lue n\'est plus tenue pour vue si son empreinte a changé depuis la lecture', async () => {
		const dep = await memoire();
		const empreinte = (await dep.index.fiches()).find((f) => f.chemin === YSALINE)!.empreinte;
		// fiche nommée, sans le périmètre : seule la règle de l'empreinte lue décide
		const message = 'parle-moi de Ysaline';
		const identique = await calculerCartes(dep, demande({ dejaLues: new Map([[YSALINE, empreinte]]), message, classer: false }));
		expect(chemins(identique)).toEqual([]);
		const changee = await calculerCartes(dep, demande({ dejaLues: new Map([[YSALINE, 'ancienne']]), message, classer: false }));
		expect(chemins(changee)).toEqual([YSALINE]);
	});

	it('une fiche de position écartée n\'est jamais servie, ni en position ni en carte', async () => {
		const dep = await memoire();
		expect((await calculerCartes(dep, demande())).position?.chemin).toBe(SVE);
		const c = await calculerCartes(dep, demande({ ecartes: [SVE] }));
		expect(c.position).toBeNull();
		expect(chemins(c)).not.toContain(SVE);
	});

	it('une fiche servie sans empreinte injectée, ou proposée avec une autre empreinte, est reproposée', async () => {
		const dep = await memoire();
		const c = await calculerCartes(dep, demande({ dejaServies: new Map([[OUTIL, null]]), proposees: new Map([[GIT, 'ancienne']]), classer: true }));
		expect(chemins(c)).toContain(OUTIL);
		expect(chemins(c)).toContain(GIT);
	});
});

/** Sens fictif : un axe par mot (comptage dans le texte), plus un petit terme constant pour ne jamais avoir de vecteur nul. */
const MOTS_DU_SENS = ['site', 'maquette', 'contact', 'erp'];
const sensParMots: Sens = {
	modele: () => 'mots@1',
	vecteurs: async (textes) =>
		textes.map((t) => {
			const bas = t.toLowerCase();
			return Float32Array.from([...MOTS_DU_SENS.map((m) => bas.split(m).length - 1), 0.01]);
		}),
};

/**
 * Sens fictif à deux axes : la question sur le premier ; une fiche dont le texte contient l'un des titres donnés, à la similarité
 * donnée avec la question ; toute autre, à 0.
 */
const sensDeSimilarites = (question: string, parTitre: Record<string, number>): Sens => ({
	modele: () => 'similarites@1',
	vecteurs: async (textes) =>
		textes.map((t) => {
			if (t === question) return Float32Array.from([1, 0]);
			const s = Object.entries(parTitre).find(([titre]) => t.includes(titre))?.[1] ?? 0;
			return Float32Array.from([s, Math.sqrt(1 - s * s)]);
		}),
});

describe('calculerCartes : par le sens', () => {
	it('le sens ordonne le périmètre d\'après le message seul', async () => {
		const dep = await memoire();
		dep.sens = sensParMots;
		await vectoriser(dep, { budgetMs: 60_000, demarrer: true });
		const c = await calculerCartes(dep, demande({ message: 'les sites du client' }));
		expect(chemins(c)[0]).toBe(OUTIL);
		expect(c.mesure).toBe('sens');
		// chaque carte du périmètre porte sa note, dans l'ordre du classement
		const notes = c.cartes.map((x) => x.note);
		expect(notes.every((n) => typeof n === 'number')).toBe(true);
		expect([...(notes as number[])].sort((a, b) => b - a)).toEqual(notes);
	});

	it('message non classé (muet, sans geste) et sans fiche nommée : le sens n\'est pas appelé et la mesure n\'est pas « sens »', async () => {
		const dep = await memoire();
		dep.sens = sensParMots;
		await vectoriser(dep, { budgetMs: 60_000, demarrer: true });
		let appels = 0;
		dep.sens = { modele: sensParMots.modele, vecteurs: async (t, o) => (appels++, sensParMots.vecteurs(t, o)) };
		const c = await calculerCartes(dep, demande({ message: 'on reprend la maquette', classer: false }));
		expect(appels).toBe(0);
		expect(c.mesure).not.toBe('sens');
		expect(c.cartes).toEqual([]);
		// le sens n'a pas tourné : aucun vecteur du message n'est rendu
		expect(c.vecteur).toBeUndefined();
	});

	it('message non classé avec une fiche nommée : le sens est appelé une fois et la note la fiche nommée', async () => {
		const dep = await memoire();
		dep.sens = sensParMots;
		await vectoriser(dep, { budgetMs: 60_000, demarrer: true });
		let appels = 0;
		dep.sens = { modele: sensParMots.modele, vecteurs: async (t, o) => (appels++, sensParMots.vecteurs(t, o)) };
		const c = await calculerCartes(dep, demande({ message: 'parle-moi de Corvel et de Ysaline', classer: false }));
		expect(appels).toBe(1);
		expect(c.mesure).toBe('sens');
		// le vecteur du message, déjà calculé, est rendu avec l'identité du modèle (pour le journal des gestes)
		expect(c.vecteur?.modele).toBe('mots@1');
		expect(c.vecteur?.valeurs).toBeInstanceOf(Float32Array);
		// ordre du message et raison inchangés : la note ne reclasse pas les fiches nommées
		expect(c.cartes.map((x) => [x.chemin, x.raison])).toEqual([
			[CORVEL, 'nommee'],
			[YSALINE, 'nommee'],
		]);
		expect(c.cartes.every((x) => typeof x.note === 'number' && x.note > 0)).toBe(true);
	});

	it('la fiche de position trop longue et une fiche nommée sont notées comme le périmètre, sans changer d\'ordre ni de raison', async () => {
		const dep = await memoire({ syntheseDePosition: 'Client photovoltaïque. '.concat('x'.repeat(9000)) });
		dep.sens = sensParMots;
		await vectoriser(dep, { budgetMs: 60_000, demarrer: true });
		let appels = 0;
		dep.sens = { modele: sensParMots.modele, vecteurs: async (t, o) => (appels++, sensParMots.vecteurs(t, o)) };
		const c = await calculerCartes(dep, demande({ message: 'les sites du client, et Ysaline ?' }));
		expect(appels).toBe(1);
		expect(c.mesure).toBe('sens');
		// la fiche de position d'abord, le périmètre classé par la note, la fiche nommée à la fin
		expect(c.cartes.map((x) => x.raison)).toEqual(['perimetre', 'perimetre', 'perimetre', 'perimetre', 'nommee']);
		expect(chemins(c)[0]).toBe(SVE);
		expect(chemins(c)[1]).toBe(OUTIL);
		expect(chemins(c)[4]).toBe(YSALINE);
		expect(c.cartes.every((x) => typeof x.note === 'number')).toBe(true);
		// le périmètre reste dans l'ordre de sa note
		const notes = c.cartes.slice(1, 4).map((x) => x.note as number);
		expect([...notes].sort((a, b) => b - a)).toEqual(notes);
	});
});

describe('calculerCartes : classement à chaque message porteur', () => {
	const NEUTRE = 'notes/Maquette web.md';
	/** La mémoire de base, plus une fiche neutre (sans lieu déclaré, reliée à rien). */
	async function avecNeutre() {
		const dep = await memoire();
		await dep.coffre.ecrire(NEUTRE, fiche('pratique', 'Maquette web', 'Règles des maquettes.', '', '', '2026-10-01'));
		await synchroniser(dep, SANS_EXTRACTION);
		return dep;
	}
	const classees = (c: { classement: { chemin: string }[] }) => c.classement.map((l) => l.chemin);

	it('à un message qui n\'est pas le premier : toutes les candidates sont classées, fiche de position exclue, p null', async () => {
		const dep = await avecNeutre();
		const empreinte = (await dep.index.fiches()).find((f) => f.chemin === SVE)!.empreinte;
		const c = await calculerCartes(dep, demande({ dejaServies: new Map([[SVE, empreinte]]), message: 'on avance' }));
		expect(c.position).toBeNull();
		expect(new Set(classees(c))).toEqual(new Set([OUTIL, SOUS, YSALINE, GIT, NEUTRE]));
		expect(c.classement.every((l) => l.p === null && l.note === null)).toBe(true);
		// sans le sens : le périmètre part en pistes par date ; la neutre, que ni le sens ni les mots ne désignent, reste classée seulement
		expect(chemins(c)).toEqual([OUTIL, GIT, SOUS, YSALINE]);
		expect(c.classement.find((l) => l.chemin === NEUTRE)).toMatchObject({ piste: false, raison: null, deja: null });
	});

	it('message non classé (muet, sans geste) : rien au classement', async () => {
		const c = await calculerCartes(await avecNeutre(), demande({ classer: false, message: '' }));
		expect(c.classement).toEqual([]);
	});

	it('une fiche neutre est candidate ; trouvée par les mots, elle part en piste, raison « proche du message »', async () => {
		const c = await calculerCartes(await avecNeutre(), demande({ message: 'Maquette ERP' }));
		expect(classees(c)).toContain(NEUTRE);
		expect(c.cartes.find((x) => x.chemin === NEUTRE)?.raison).toBe('proche');
		expect(c.classement.find((l) => l.chemin === NEUTRE)).toMatchObject({ piste: true, raison: 'proche' });
		// les mots ont été cherchés : la neutre les porte, les autres non
		expect(c.classement.find((l) => l.chemin === NEUTRE)!.signaux.bm25Relatif).toBeGreaterThan(0);
		expect(c.classement.find((l) => l.chemin === GIT)!.signaux.bm25Relatif).toBe(0);
	});

	it('à la racine : les fiches neutres seules, rien d\'ailleurs ni du lieu d\'un client', async () => {
		const c = await calculerCartes(await avecNeutre(), demande({ position: '', message: 'Maquette ERP' }));
		expect(new Set(classees(c))).toEqual(new Set([OUTIL, SOUS, YSALINE, GIT, NEUTRE]));
		expect(chemins(c)).toEqual([NEUTRE]);
	});

	it('une fiche d\'ailleurs reste fermée tant que son lieu n\'est pas nommé ; nommé, elle est candidate', async () => {
		const dep = await avecNeutre();
		expect(classees(await calculerCartes(dep, demande({ message: 'Maquette ERP' })))).not.toContain(ERP);
		const c = await calculerCartes(dep, demande({ message: 'Maquette ERP pour Corvel' }));
		expect(classees(c)).toContain(ERP);
		// le lieu nommé est une carte « nommée » ; classé lui aussi, avec cette raison, sans être une piste
		expect(c.cartes.find((x) => x.chemin === CORVEL)?.raison).toBe('nommee');
		expect(c.classement.find((l) => l.chemin === CORVEL)).toMatchObject({ raison: 'nommee', piste: false });
		expect(c.cartes.find((x) => x.chemin === ERP)?.raison).toBe('proche');
	});

	it('jamais au classement : source, dossier, fiche écartée', async () => {
		const dep = await avecNeutre();
		for (const position of ['organisations/clients/SVE', '']) {
			const c = await calculerCartes(dep, demande({ position, message: 'Doc SVE et Clients, Outil Parcs', ecartes: [OUTIL] }));
			expect(classees(c)).not.toContain(DOC);
			expect(classees(c)).not.toContain(DOSSIER);
			expect(classees(c)).not.toContain(OUTIL);
		}
	});

	it('déjà injectée, lue ou proposée : au classement, marquée, jamais en piste', async () => {
		const dep = await avecNeutre();
		const empreintes = new Map((await dep.index.fiches()).map((f) => [f.chemin, f.empreinte]));
		const c = await calculerCartes(
			dep,
			demande({ dejaServies: new Map([[OUTIL, empreintes.get(OUTIL)!]]), dejaLues: new Map([[SOUS, null]]), proposees: new Map([[GIT, empreintes.get(GIT)!]]) }),
		);
		const ligne = (chemin: string) => c.classement.find((l) => l.chemin === chemin);
		expect(ligne(OUTIL)).toMatchObject({ deja: 'injectee', piste: false });
		expect(ligne(SOUS)).toMatchObject({ deja: 'lue', piste: false });
		expect(ligne(GIT)).toMatchObject({ deja: 'proposee', piste: false });
		// la neutre, trouvée par les mots (« Maquette »), devant Ysaline
		expect(chemins(c)).toEqual([NEUTRE, YSALINE]);
	});

	it('pistes : au plus contexte.pistesParMessage, les premières nouvelles de l\'ordre du sens', async () => {
		const dep = await avecNeutre();
		dep.sens = sensParMots;
		await vectoriser(dep, { budgetMs: 60_000, demarrer: true });
		avecReglages(dep, { pistesParMessage: 2 });
		const empreinte = (await dep.index.fiches()).find((f) => f.chemin === OUTIL)!.empreinte;
		const c = await calculerCartes(dep, demande({ message: 'la maquette des sites', proposees: new Map([[OUTIL, empreinte]]) }));
		const nouvelles = c.classement.filter((l) => l.deja === null).map((l) => l.chemin);
		expect(chemins(c)).toEqual(nouvelles.slice(0, 2));
		expect(c.classement.filter((l) => l.piste).map((l) => l.chemin)).toEqual(chemins(c));
		// Outil Parcs, la plus proche du message, est classée en tête mais déjà proposée
		expect(c.classement[0]).toMatchObject({ chemin: OUTIL, deja: 'proposee', piste: false });
	});

	it('avec le sens : signaux bruts (cosinus, cosinus relatif à la médiane de toute la mémoire, bm25 relatif), note = cosinus', async () => {
		const dep = await avecNeutre();
		dep.sens = sensParMots;
		await vectoriser(dep, { budgetMs: 60_000, demarrer: true });
		let appels = 0;
		dep.sens = { modele: sensParMots.modele, vecteurs: async (t, o) => (appels++, sensParMots.vecteurs(t, o)) };
		const c = await calculerCartes(dep, demande({ message: 'la maquette des sites' }));
		// le sens du message est calculé une fois
		expect(appels).toBe(1);
		expect(c.mesure).toBe('sens');
		const lignes = c.classement;
		expect(lignes.every((l) => l.signaux.cosinus !== null && l.signaux.cosinusRelatif !== null)).toBe(true);
		// un même écart à la médiane pour tous : cosinus − cosinus relatif est une constante (la médiane du message)
		const medianes = new Set(lignes.map((l) => (l.signaux.cosinus! - l.signaux.cosinusRelatif!).toFixed(9)));
		expect(medianes.size).toBe(1);
		for (const l of lignes) expect(l.note).toBeCloseTo(Math.max(0, l.signaux.cosinus!), 9);
		expect(lignes.every((l) => l.signaux.signalSession === 0)).toBe(true);
		// l'ordre est celui de la note
		const notes = lignes.map((l) => l.note!);
		expect([...notes].sort((a, b) => b - a)).toEqual(notes);
	});

	it('message porteur suivant (sans pistes) : tout est classé, seules les fiches nommées partent', async () => {
		const dep = await avecNeutre();
		dep.sens = sensParMots;
		await vectoriser(dep, { budgetMs: 60_000, demarrer: true });
		const c = await calculerCartes(dep, demande({ message: 'la maquette des sites, et Ysaline', pistes: false, premier: false }));
		expect(c.cartes.map((x) => [x.chemin, x.raison])).toEqual([[YSALINE, 'nommee']]);
		expect(new Set(classees(c))).toEqual(new Set([OUTIL, SOUS, YSALINE, GIT, NEUTRE]));
		expect(c.classement.filter((l) => l.piste)).toEqual([]);
		expect(c.classement.find((l) => l.chemin === YSALINE)?.raison).toBe('nommee');
	});

	it('sans le sens, hors du premier message : une piste doit être trouvée par les mots ou désignée par un signal', async () => {
		const c = await calculerCartes(await avecNeutre(), demande({ message: 'Maquette ERP', premier: false }));
		// la neutre porte « Maquette » ; le périmètre, que la date seule ordonne, n'est pas proposé
		expect(chemins(c)).toEqual([NEUTRE]);
	});

	it('à la racine, la voisine d’une fiche injectée à la main reste candidate : le geste vaut désignation', async () => {
		const c = await calculerCartes(await avecNeutre(), demande({ position: '', message: 'Maquette', premier: false, injectees: [{ chemin: YSALINE, messages: 0 }] }));
		expect(classees(c)).toContain(ERP);
		expect(c.cartes.find((x) => x.chemin === ERP)).toMatchObject({ raison: 'liee', depuis: { chemin: YSALINE, titre: 'Ysaline' } });
	});

	it('une fiche rangée sous un lieu ascendant de la position est candidate, du périmètre', async () => {
		const dep = fauxPorts();
		await dep.coffre.ecrire('clients/Orme/Orme.md', fiche('entite', 'Orme', 'Client Orme.', 'portee: client:Orme\n'));
		await dep.coffre.ecrire('clients/Orme/Chantier/Chantier.md', fiche('entite', 'Chantier', 'Le chantier du client.'));
		await dep.coffre.ecrire('clients/Orme/Tarifs.md', fiche('entite', 'Tarifs', 'Les tarifs du client.'));
		await synchroniser(dep, SANS_EXTRACTION);
		const c = await calculerCartes(dep, demande({ position: 'clients/Orme/Chantier', message: 'on avance' }));
		expect(c.position?.chemin).toBe('clients/Orme/Chantier/Chantier.md');
		expect(classees(c)).toEqual(expect.arrayContaining(['clients/Orme/Tarifs.md', 'clients/Orme/Orme.md']));
		expect(c.cartes.find((x) => x.chemin === 'clients/Orme/Tarifs.md')?.raison).toBe('perimetre');
	});

	it('le geste pèse au classement : signal de session de la voisine d’une fiche injectée à la main', async () => {
		const dep = await avecNeutre();
		const c = await calculerCartes(dep, demande({ message: 'Maquette', injectees: [{ chemin: YSALINE, messages: 0 }] }));
		const erp = c.classement.find((l) => l.chemin === ERP);
		expect(erp?.signaux.signalSession).toBeGreaterThan(0);
		expect(erp?.raison).toBe('liee');
	});
});

describe('calculerCartes : outil contexte (question)', () => {
	/** Note brute d'après le titre : l'ERP d'abord, puis l'outil, puis le reste. */
	const fauxReranker: Reranker = {
		noter: async (_requete, textes) => textes.map((t) => (/^ERP/u.test(t) ? 3 : /^Outil/u.test(t) ? 2 : -1)),
	};

	it('classe par le sens, ailleurs admis, au plus 10, raison question', async () => {
		const dep = await memoire();
		dep.sens = sensParMots;
		await vectoriser(dep, { budgetMs: 60_000, demarrer: true });
		const c = await calculerCartes(dep, demande({ question: true, classer: false, servirPosition: false, message: 'maquette ERP du site' }));
		expect(c.cartes.length).toBeGreaterThan(0);
		expect(c.cartes.length).toBeLessThanOrEqual(10);
		expect(c.cartes.every((x) => x.raison === 'question')).toBe(true);
		expect(chemins(c)).toContain(ERP);
		expect(chemins(c)).not.toContain(DOC);
		expect(chemins(c)).not.toContain(DOSSIER);
		expect(c.mesure).toBe('sens');
	});

	it('le reranker, s\'il répond, fixe l\'ordre', async () => {
		const dep = await memoire();
		dep.sens = sensParMots;
		dep.reranker = fauxReranker;
		await vectoriser(dep, { budgetMs: 60_000, demarrer: true });
		const c = await calculerCartes(dep, demande({ question: true, classer: false, servirPosition: false, message: 'maquette ERP du site' }));
		expect(chemins(c).slice(0, 2)).toEqual([ERP, OUTIL]);
		expect(c.mesure).toBe('reranker');
		expect(c.cartes[0]!.note).toBeGreaterThan(c.cartes[1]!.note!);
	});
});

describe('calculerCartes : poids d’une fiche injectée à la main', () => {
	const YSALINE_INJECTEE = [{ chemin: YSALINE, messages: 0 }];

	it('au message qui la porte : sa voisine « d’ailleurs » devient candidate et passe devant le périmètre restant, raison « liée à »', async () => {
		const dep = await memoire();
		const empreinte = (await dep.index.fiches()).find((f) => f.chemin === YSALINE)!.empreinte;
		const c = await calculerCartes(
			dep,
			demande({ message: 'Maquette', premier: false, servirPosition: false, injectees: YSALINE_INJECTEE, dejaServies: new Map([[YSALINE, empreinte]]) }),
		);
		expect(c.cartes[0]).toMatchObject({ chemin: ERP, raison: 'liee', depuis: { chemin: YSALINE, titre: 'Ysaline' } });
		// sans modèle et hors du premier message, une piste doit être trouvée par les mots ou désignée : le périmètre reste classé seulement
		expect(chemins(c)).toEqual([ERP]);
		expect(c.classement.map((l) => l.chemin)).toEqual(expect.arrayContaining([ERP, OUTIL, GIT, SOUS]));
	});

	it('message non classé (muet, sans geste) : le poids encore actif ne propose rien hors des fiches nommées', async () => {
		const c = await calculerCartes(await memoire(), demande({ message: 'Maquette', classer: false, injectees: YSALINE_INJECTEE }));
		expect(c.cartes).toEqual([]);
	});

	it('une voisine d’une fiche injectée monte au-dessus d’une fiche du périmètre de même sens', async () => {
		const dep = await memoire();
		dep.sens = sensParMots;
		await vectoriser(dep, { budgetMs: 60_000, demarrer: true });
		// « ERP Corvelis » et « Outil Parcs » sont aussi proches du message l'une que l'autre (un mot du message, deux fois chacune)
		const message = 'maquette ERP du site';
		const sans = await calculerCartes(dep, demande({ message }));
		expect(chemins(sans)[0]).toBe(OUTIL);
		expect(chemins(sans)).not.toContain(ERP);
		const avec = await calculerCartes(dep, demande({ message, injectees: YSALINE_INJECTEE }));
		expect(chemins(avec).slice(0, 2)).toEqual([ERP, OUTIL]);
		// ERP Corvelis n'est candidate que par le geste : sa raison est le signal, même si le sens pèse plus que le poids
		expect(avec.cartes[0]).toMatchObject({ raison: 'liee', depuis: { chemin: YSALINE, titre: 'Ysaline' } });
		expect(avec.cartes[1]!.raison).toBe('perimetre');
	});

	it('une injection trop ancienne (11 messages) ne pèse plus : la voisine n’est plus candidate', async () => {
		const c = await calculerCartes(await memoire(), demande({ message: 'Maquette', classer: true, servirPosition: false, injectees: [{ chemin: YSALINE, messages: 11 }] }));
		expect(chemins(c)).not.toContain(ERP);
	});

	it('les fiches nommées gardent l’ordre du message et leur raison ; une voisine d’ailleurs nommée est ouverte par le geste', async () => {
		const dep = await memoire();
		const c = await calculerCartes(dep, demande({ message: 'Corvel et ERP Corvelis', classer: false, injectees: YSALINE_INJECTEE }));
		expect(c.cartes.map((x) => [x.chemin, x.raison])).toEqual([
			[CORVEL, 'nommee'],
			[ERP, 'nommee'],
		]);
		const seule = await calculerCartes(dep, demande({ message: 'ouvre ERP Corvelis', classer: false, injectees: YSALINE_INJECTEE }));
		expect(seule.cartes.map((x) => [x.chemin, x.raison])).toEqual([[ERP, 'nommee']]);
	});

	it('outil contexte : le poids s’ajoute au sens de la question', async () => {
		const dep = await memoire();
		dep.sens = sensParMots;
		await vectoriser(dep, { budgetMs: 60_000, demarrer: true });
		const c = await calculerCartes(dep, demande({ question: true, classer: false, servirPosition: false, message: 'maquette ERP du site', injectees: YSALINE_INJECTEE }));
		expect(chemins(c)[0]).toBe(ERP);
		// le sens pèse plus que le poids : la raison reste « question »
		expect(c.cartes[0]!.raison).toBe('question');
	});

	it('outil contexte : le seuil de sens porte sur la base ; une voisine trop loin de la question n’entre pas par le poids', async () => {
		const dep = await memoire();
		const question = 'où en est le chantier ?';
		dep.sens = sensDeSimilarites(question, { 'ERP Corvelis': 0.3, 'Outil Parcs': 0.5 });
		await vectoriser(dep, { budgetMs: 60_000, demarrer: true });
		const c = await calculerCartes(dep, demande({ question: true, classer: false, servirPosition: false, message: question, injectees: YSALINE_INJECTEE }));
		// ERP Corvelis : sens 0,30 sous le seuil (0,45) ; le poids (0,25) la porterait à 0,55, mais il fait monter, il ne fait pas entrer
		expect(chemins(c)).toContain(OUTIL);
		expect(chemins(c)).not.toContain(ERP);
	});

	it('outil contexte avec le reranker : une candidate seule garde sa base absolue (pas 1) ; le poids qui la dépasse donne la raison', async () => {
		const dep = await memoire();
		const question = 'où en est le chantier ?';
		dep.sens = sensDeSimilarites(question, { 'ERP Corvelis': 0.6 });
		await vectoriser(dep, { budgetMs: 60_000, demarrer: true });
		dep.reranker = { noter: async (_requete, textes) => textes.map(() => -2) };
		const c = await calculerCartes(dep, demande({ question: true, classer: false, servirPosition: false, message: question, injectees: YSALINE_INJECTEE }));
		expect(c.mesure).toBe('reranker');
		// base sigmoïde(-2) ≈ 0,12 < poids 0,25 : c'est le geste qui la porte
		expect(c.cartes).toHaveLength(1);
		expect(c.cartes[0]).toMatchObject({ chemin: ERP, raison: 'liee', depuis: { chemin: YSALINE, titre: 'Ysaline' } });
	});

	it('outil contexte avec le reranker : deux candidates proches gardent des bases proches, le poids les départage', async () => {
		const dep = await memoire();
		const question = 'où en est le chantier ?';
		dep.sens = sensDeSimilarites(question, { 'ERP Corvelis': 0.6, 'Outil Parcs': 0.6 });
		await vectoriser(dep, { budgetMs: 60_000, demarrer: true });
		dep.reranker = { noter: async (_requete, textes) => textes.map((t) => (/^ERP/u.test(t) ? 0.1 : /^Outil/u.test(t) ? 0.2 : -5)) };
		const c = await calculerCartes(dep, demande({ question: true, classer: false, servirPosition: false, message: question, injectees: YSALINE_INJECTEE }));
		// bases ≈ 0,525 (ERP) et 0,550 (Outil) : ERP passe devant avec le poids (≈ 0,775) ; ramenées à 0 et 1, Outil resterait devant
		expect(chemins(c)).toEqual([ERP, OUTIL]);
		// le sens (≈ 0,525) pèse plus que le poids : la raison reste « question »
		expect(c.cartes.map((x) => x.raison)).toEqual(['question', 'question']);
	});

	it('une fiche injectée entière à ce message n’est pas candidate : elle ne prend pas la place d’une carte sous le plafond', async () => {
		const dep = await memoire();
		avecReglages(dep, { pistesParMessage: 1 });
		// sans modèle, par date : Outil Parcs (05/11) puis Git (04/11)
		expect(chemins(await calculerCartes(dep, demande()))).toEqual([OUTIL]);
		expect(chemins(await calculerCartes(dep, demande({ demandees: [OUTIL] })))).toEqual([GIT]);
	});

	it('une fiche de position trop longue, demandée à ce message, ne devient pas aussi la première carte', async () => {
		const dep = await memoire({ syntheseDePosition: 'Client photovoltaïque. '.concat('x'.repeat(9000)) });
		const c = await calculerCartes(dep, demande({ demandees: [SVE] }));
		expect(c.position).toBeNull();
		expect(chemins(c)).not.toContain(SVE);
		expect(chemins(c).length).toBeGreaterThan(0);
	});
});

describe('ligneDeCarte', () => {
	it('première phrase de la synthèse', () => {
		expect(ligneDeCarte('Première phrase. Deuxième phrase.')).toBe('Première phrase.');
	});

	it('coupée à 160 caractères avec « … »', () => {
		const ligne = ligneDeCarte('mot '.repeat(80));
		expect([...ligne]).toHaveLength(160);
		expect(ligne.endsWith('…')).toBe(true);
	});

	it('vide sans synthèse', () => {
		expect(ligneDeCarte('')).toBe('');
	});
});
