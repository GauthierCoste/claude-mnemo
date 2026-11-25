import { describe, expect, it } from 'vitest';
import { avecSensMemorise, chercher, chercherAvecAvis, chercherSansSynchro, chronologie, optionsOutils, VARIANTE_COMPLETE } from '../../src/application/chercher.ts';
import type { Requete, Variante } from '../../src/application/chercher.ts';
import type { Dependances, FiltreIndex, OptionsModele, Reranker, Sens } from '../../src/application/ports.ts';
import type { DemandeFait } from '../../src/application/proposer/fait.ts';
import { prochesDeFait } from '../../src/application/proposer/proches.ts';
import { synchroniser } from '../../src/application/synchroniser.ts';
import { vectoriser } from '../../src/application/vectoriser.ts';
import { POIDS_COMPLEMENTAIRE } from '../../src/domaine/classement.ts';
import { fauxPorts } from '../aides/faux-ports.ts';
import { fauxSens, vecteurFaux } from '../aides/faux-sens.ts';

const entete = (type = 'sujet', extra = '') => `---\nid: 01ABC\ntype: ${type}\n${extra}updated: 2026-11-01\n---\n`;
const ligne = (texte: string, ancre: string, src = 'utilisateur oral', appris = '2026-11-20') =>
	`- ${texte} | declare | src: ${src} | appris ${appris} | confiance 100 % ^${ancre}`;
const faits = (...textes: string[]) => textes.map((t, i) => ligne(t, `f-${String(i + 1).padStart(4, '0')}`)).join('\n');

/** Petite mémoire réaliste : projet lié à un client (entité), une source avec un document. */
async function memoireDeReference() {
	const dep = fauxPorts();
	const e = dep.coffre.ecrire;
	await e('projets/vela/vela.md', `${entete('dossier')}# Projet Vela\n\nRefonte du catalogue.\n\n## Faits\n${faits('Le catalogue compte mille références', 'La remise du catalogue est de cinq pour cent', 'Le dépôt est sur GitLab')}\n\n## Relations\n- client [[clients/ombellerail/ombellerail]]\n`);
	await e('clients/ombellerail/ombellerail.md', `${entete('entite')}# Ombelle Rail\n\nClient ferroviaire.\n\n## Faits\n${faits('Ombelle Rail paie à soixante jours', 'Ombelle Rail veut une remise annuelle', 'Le contact est Marc')}\n`);
	await e('projets/autre/autre.md', `${entete()}# Autre\n\nAutre projet.\n\n## Faits\n${faits('Le catalogue papier est abandonné', 'La remise annuelle est supprimée')}\n`);
	dep.documents.deposer('docs/notice.md', '# Notice\n\n## Tarifs\n\nLa remise du catalogue Ombelle Rail est négociée chaque année.\n');
	await e('sources/notice.md', `---\nid: 01SRC\ntype: source\nchemin: docs/notice.md\ntype_source: spec_validee\nupdated: 2026-11-01\n---\n# Notice\n`);
	await synchroniser(dep);
	return dep;
}

/** Résultats du jalon 4 (commit a599077, avant la chaîne complète) sur `memoireDeReference`. */
const JALON_4: Record<string, string[]> = {
	'remise catalogue|': [
		'projets/vela/vela.md#^f-0002 0.999052',
		'sources/notice.md#p-efdd7612 0.899801',
		'projets/autre/autre.md#^f-0002 0.491469',
		'clients/ombellerail/ombellerail.md#^f-0002 0.483668',
		'projets/autre/autre.md#^f-0001 0.476111',
		'projets/vela/vela.md 0.464645',
		'projets/vela/vela.md#^f-0001 0.461683',
	],
	'remise catalogue|projets/vela': [
		'projets/vela/vela.md#^f-0002 0.999052',
		'sources/notice.md#p-efdd7612 0.899801',
		'clients/ombellerail/ombellerail.md#^f-0002 0.604585',
		'projets/vela/vela.md 0.580806',
		'projets/vela/vela.md#^f-0001 0.577104',
		'projets/autre/autre.md#^f-0002 0.491469',
		'projets/autre/autre.md#^f-0001 0.476111',
	],
	'remise|': [
		'projets/autre/autre.md#^f-0002 0.999052',
		'clients/ombellerail/ombellerail.md#^f-0002 0.982939',
		'projets/vela/vela.md#^f-0002 0.967336',
		'sources/notice.md#p-efdd7612 0.905469',
	],
	'remise|projets/vela': [
		'clients/ombellerail/ombellerail.md#^f-0002 0.999052',
		'projets/autre/autre.md#^f-0002 0.999052',
		'projets/vela/vela.md#^f-0002 0.999052',
		'sources/notice.md#p-efdd7612 0.905469',
	],
	// jalon 7 : « paiement » trouve « paie » par sa racine (« pai ») ; le fait qui a tous les mots passe devant
	'Ombelle Rail paiement|': [
		'clients/ombellerail/ombellerail.md#^f-0001 0.999052',
		'clients/ombellerail/ombellerail.md 0.487127',
		'clients/ombellerail/ombellerail.md#^f-0002 0.483668',
		'clients/ombellerail/ombellerail.md#^f-0003 0.476111',
		'sources/notice.md#p-efdd7612 0.445769',
	],
	'Ombelle Rail paiement|projets/vela': [
		'clients/ombellerail/ombellerail.md#^f-0001 0.999052',
		'clients/ombellerail/ombellerail.md 0.608909',
		'clients/ombellerail/ombellerail.md#^f-0002 0.604585',
		'clients/ombellerail/ombellerail.md#^f-0003 0.595139',
		'sources/notice.md#p-efdd7612 0.445769',
	],
	'catalogue|': [
		'projets/autre/autre.md#^f-0001 0.999052',
		'projets/vela/vela.md 0.974255',
		'projets/vela/vela.md#^f-0001 0.967336',
		'projets/vela/vela.md#^f-0002 0.952222',
		'sources/notice.md#p-efdd7612 0.891538',
	],
	'catalogue|projets/vela': [
		'projets/autre/autre.md#^f-0001 0.999052',
		'projets/vela/vela.md#^f-0001 0.999052',
		'projets/vela/vela.md#^f-0002 0.999052',
		'projets/vela/vela.md 0.990226',
		'sources/notice.md#p-efdd7612 0.891538',
	],
	'GitLab|': ['projets/vela/vela.md#^f-0003 0.999052'],
	'GitLab|projets/vela': ['projets/vela/vela.md#^f-0003 0.999052'],
	// jalon 7 : la racine de « remise » (dans le texte) passe devant « Ombelle Rail », qui n'est que dans le contexte
	'remise annuelle Ombelle Rail|': [
		'clients/ombellerail/ombellerail.md#^f-0002 0.999052',
		'projets/autre/autre.md#^f-0002 0.491469',
		'clients/ombellerail/ombellerail.md 0.479395',
		'clients/ombellerail/ombellerail.md#^f-0001 0.476111',
		'projets/vela/vela.md#^f-0002 0.468786',
		'clients/ombellerail/ombellerail.md#^f-0003 0.461683',
		'sources/notice.md#p-efdd7612 0.432463',
	],
	'remise annuelle Ombelle Rail|projets/vela': [
		'clients/ombellerail/ombellerail.md#^f-0002 0.999052',
		'clients/ombellerail/ombellerail.md 0.599244',
		'clients/ombellerail/ombellerail.md#^f-0001 0.595139',
		'projets/vela/vela.md#^f-0002 0.585983',
		'clients/ombellerail/ombellerail.md#^f-0003 0.577104',
		'projets/autre/autre.md#^f-0002 0.491469',
		'sources/notice.md#p-efdd7612 0.432463',
	],
};

/**
 * Mêmes requêtes, note unique (`base + Σ poids`, poids par défaut, horloge fixe du faux système) : la référence qui prend la
 * suite du jalon 4. Mêmes éléments ; sans position, même ordre, sauf le passage de la notice (« remise catalogue »), du 2e
 * au 4e rang : sa base, modulée par son bm25, tombe à 0,47, et sans le poids de la mémoire (contenu d'un document) il passe
 * derrière les deux faits qui suivaient.
 */
const NOTE_UNIQUE: Record<string, string[]> = {
	'remise catalogue|': [
		'projets/vela/vela.md#^f-0002 1.099810',
		'projets/autre/autre.md#^f-0002 0.591746',
		'clients/ombellerail/ombellerail.md#^f-0002 0.548270',
		'sources/notice.md#p-efdd7612 0.518580',
		'projets/autre/autre.md#^f-0001 0.459131',
		'projets/vela/vela.md 0.442340',
		'projets/vela/vela.md#^f-0001 0.438889',
	],
	'remise catalogue|projets/vela': [
		'projets/vela/vela.md#^f-0002 1.199810',
		'clients/ombellerail/ombellerail.md#^f-0002 0.648270',
		'projets/autre/autre.md#^f-0002 0.591746',
		'projets/vela/vela.md 0.542340',
		'projets/vela/vela.md#^f-0001 0.538889',
		'sources/notice.md#p-efdd7612 0.518580',
		'projets/autre/autre.md#^f-0001 0.459131',
	],
	'remise|': [
		'projets/autre/autre.md#^f-0002 1.099810',
		'clients/ombellerail/ombellerail.md#^f-0002 1.011196',
		'projets/vela/vela.md#^f-0002 0.968554',
		'sources/notice.md#p-efdd7612 0.521563',
	],
	'remise|projets/vela': [
		'clients/ombellerail/ombellerail.md#^f-0002 1.111196',
		'projets/autre/autre.md#^f-0002 1.099810',
		'projets/vela/vela.md#^f-0002 1.068554',
		'sources/notice.md#p-efdd7612 0.521563',
	],
	'Ombelle Rail paiement|': [
		'clients/ombellerail/ombellerail.md#^f-0001 1.099810',
		'clients/ombellerail/ombellerail.md 0.589981',
		'clients/ombellerail/ombellerail.md#^f-0002 0.562539',
		'clients/ombellerail/ombellerail.md#^f-0003 0.456614',
		'sources/notice.md#p-efdd7612 0.279616',
	],
	'Ombelle Rail paiement|projets/vela': [
		'clients/ombellerail/ombellerail.md#^f-0001 1.199810',
		'clients/ombellerail/ombellerail.md 0.689981',
		'clients/ombellerail/ombellerail.md#^f-0002 0.662539',
		'clients/ombellerail/ombellerail.md#^f-0003 0.556614',
		'sources/notice.md#p-efdd7612 0.279616',
	],
	'catalogue|': [
		'projets/autre/autre.md#^f-0001 1.099810',
		'projets/vela/vela.md 1.042711',
		'projets/vela/vela.md#^f-0001 1.029481',
		'projets/vela/vela.md#^f-0002 0.954979',
		'sources/notice.md#p-efdd7612 0.514232',
	],
	'catalogue|projets/vela': [
		'projets/vela/vela.md 1.142711',
		'projets/vela/vela.md#^f-0001 1.129481',
		'projets/autre/autre.md#^f-0001 1.099810',
		'projets/vela/vela.md#^f-0002 1.054979',
		'sources/notice.md#p-efdd7612 0.514232',
	],
	'GitLab|': [
		'projets/vela/vela.md#^f-0003 1.099810',
	],
	'GitLab|projets/vela': [
		'projets/vela/vela.md#^f-0003 1.199810',
	],
	'remise annuelle Ombelle Rail|': [
		'clients/ombellerail/ombellerail.md#^f-0002 1.099810',
		'projets/autre/autre.md#^f-0002 0.591746',
		'clients/ombellerail/ombellerail.md 0.467188',
		'clients/ombellerail/ombellerail.md#^f-0001 0.452127',
		'projets/vela/vela.md#^f-0002 0.414602',
		'clients/ombellerail/ombellerail.md#^f-0003 0.391208',
		'sources/notice.md#p-efdd7612 0.272612',
	],
	'remise annuelle Ombelle Rail|projets/vela': [
		'clients/ombellerail/ombellerail.md#^f-0002 1.199810',
		'projets/autre/autre.md#^f-0002 0.591746',
		'clients/ombellerail/ombellerail.md 0.567188',
		'clients/ombellerail/ombellerail.md#^f-0001 0.552127',
		'projets/vela/vela.md#^f-0002 0.514602',
		'clients/ombellerail/ombellerail.md#^f-0003 0.491208',
		'sources/notice.md#p-efdd7612 0.272612',
	],
};

const SANS_GRAPHE: Variante = { ...VARIANTE_COMPLETE, graphe: false };

/**
 * Faux sens « à concepts » : un texte qui contient un mot d'un concept reçoit le vecteur du concept (paraphrases sans mot
 * commun), les autres un vecteur pseudo-aléatoire.
 */
function sensAConcepts(concepts: string[][]): Sens & { appels: OptionsModele[] } {
	const appels: OptionsModele[] = [];
	return {
		appels,
		modele: () => 'concepts@000000000001',
		async vecteurs(textes, options) {
			appels.push({ ...options });
			return textes.map((texte) => {
				const minuscule = texte.toLowerCase();
				const i = concepts.findIndex((mots) => mots.some((m) => minuscule.includes(m)));
				return i < 0 ? vecteurFaux(texte) : vecteurFaux(`concept ${i}`);
			});
		},
	};
}

/** Faux reranker : note (logit) donnée par `note(texte)`, appels notés. */
function fauxReranker(note: (texte: string) => number): Reranker & { appels: { requete: string; textes: string[]; options: OptionsModele }[] } {
	const appels: { requete: string; textes: string[]; options: OptionsModele }[] = [];
	return {
		appels,
		async noter(requete, textes, options) {
			appels.push({ requete, textes: [...textes], options: { ...options } });
			return textes.map(note);
		},
	};
}

/** Sens gradué : la requête `requete` = le concept ; un texte qui contient un mot de `proches` = concept + `bruit` × aléa. */
function sensGradue(requete: string, proches: string[], bruit: number): Sens {
	const concept = vecteurFaux('CONCEPT');
	return {
		modele: () => 'gradue@000000000001',
		async vecteurs(textes) {
			return textes.map((t) => {
				const m = t.toLowerCase();
				if (m.trim() === requete) return concept;
				if (!proches.some((x) => m.includes(x))) return vecteurFaux(t);
				const alea = vecteurFaux(t);
				return Float32Array.from(concept, (c, i) => c + bruit * alea[i]!);
			});
		},
	};
}

async function memoireParaphrase() {
	const dep = fauxPorts();
	await dep.coffre.ecrire('a.md', `${entete()}# Garage\n\n## Faits\n${faits('La voiture du client est rouge', 'Le garage ferme le lundi')}\n`);
	await dep.coffre.ecrire('b.md', `${entete()}# Divers\n\n## Faits\n${faits('Le tamanoir mange des termites')}\n`);
	const sens = sensAConcepts([['voiture', 'automobile']]);
	dep.sens = sens;
	await synchroniser(dep);
	await vectoriser(dep, { budgetMs: 60_000, demarrer: true });
	return { dep, sens };
}

const cles = (trouves: { id: string; score: number }[]) => trouves.map((t) => `${t.id} ${t.score.toFixed(6)}`);

/** Comme un appel d'outil, reranker permis explicitement (indépendant de `RERANKER_PAR_DEFAUT`). */
async function chercherAvecReranker(dep: Dependances, requete: Requete) {
	await synchroniser(dep);
	return chercherSansSynchro(dep, requete, { ...optionsOutils(), reranker: { demarrer: true } });
}

/** Sens seulement s'il tourne déjà, 400 ms, sans reranker : les options des hooks avant le 2026-11-23. */
const optionsSansDemarrage = () => ({ fin: Date.now() + 400, sens: { demarrer: false, similariteMin: 0.55 }, reranker: null, froid: 'si-budget' as const });

describe('chercher : sens, reranker, graphe', () => {
	it('modèles null : mêmes résultats que la référence de la note unique (variante complète, sans graphe, sans option), mêmes éléments que le jalon 4', async () => {
		const dep = await memoireDeReference();
		const ids = (lignes: string[]) => lignes.map((l) => l.split(' ')[0]!);
		expect(Object.keys(NOTE_UNIQUE)).toEqual(Object.keys(JALON_4));
		for (const [cle, attendu] of Object.entries(NOTE_UNIQUE)) {
			const [texte, position] = cle.split('|') as [string, string];
			const requete = { texte, ...(position === '' ? {} : { position }) };
			expect(cles(await chercher(dep, { ...requete, variante: SANS_GRAPHE })), cle).toEqual(attendu);
			expect(cles(await chercher(dep, requete)), cle).toEqual(attendu);
			// aucune option de modèle (appelant non listé) : idem
			expect(cles(await chercherSansSynchro(dep, requete)), cle).toEqual(attendu);
			// le seuil porte sur la pertinence, d'échelle inchangée : les mêmes éléments qu'au jalon 4
			const jalon = ids(JALON_4[cle]!);
			expect([...ids(attendu)].sort(), cle).toEqual([...jalon].sort());
			// sans position (le jalon 4 saturait avec elle), même ordre qu'au jalon 4, sauf la notice de « remise catalogue »
			if (position === '' && cle !== 'remise catalogue|') expect(ids(attendu), cle).toEqual(jalon);
		}
		const sansNotice = (l: string[]) => ids(l).filter((id) => id !== 'sources/notice.md#p-efdd7612');
		expect(sansNotice(NOTE_UNIQUE['remise catalogue|']!)).toEqual(sansNotice(JALON_4['remise catalogue|']!));
	});

	it('graphe non vide : les éléments trouvés par les mots gardent leur rang du jalon 4 et leur score', async () => {
		const dep = fauxPorts();
		await dep.coffre.ecrire('projets/p/p.md', `${entete()}# P\n\n## Faits\n${faits(...Array.from({ length: 6 }, (_, i) => `Remise catalogue ${i}`))}\n\n## Relations\n- client [[clients/c/c]]\n`);
		await dep.coffre.ecrire('clients/c/c.md', `${entete('organisation', 'portee: client:c\n')}# Client C\n\n## Faits\n${faits('Le client exige une remise')}\n`);
		await dep.coffre.ecrire('a/a.md', `${entete()}# A\n\n## Faits\n${faits('Remise catalogue unique')}\n`);
		// jalon 4 (a599077), même mémoire, limite 3 : le fait du client n'y est pas
		const jalon4 = ['a/a.md#^f-0001', 'projets/p/p.md#^f-0001', 'projets/p/p.md#^f-0002'];
		const graphe: string[][] = [];
		const chercherIndex = dep.index.chercher.bind(dep.index);
		dep.index.chercher = async (expression, filtre, limite) => {
			const r = await chercherIndex(expression, filtre, limite);
			if (filtre.chemins !== undefined) graphe.push(r.map((e) => e.id));
			return r;
		};
		const obtenu = cles(await chercher(dep, { texte: 'remise catalogue', limite: 3 }));
		expect(graphe).toEqual([['clients/c/c.md#^f-0001']]);
		// le fait du seul graphe vaut au plus λ : il ne déloge pas un élément des mots
		expect(obtenu.map((c) => c.split(' ')[0])).toEqual(jalon4);
		expect(cles(await chercher(dep, { texte: 'remise catalogue', limite: 3, variante: SANS_GRAPHE }))).toEqual(obtenu);
	});

	it('sens seul : au plus λ, jamais à égalité avec un premier des mots, quel que soit le nombre de listes de mots', async () => {
		for (const nombre of [3, 12]) {
			const dep = fauxPorts();
			await dep.coffre.ecrire('a.md', `${entete()}# A\n\n## Faits\n${faits(...Array.from({ length: nombre }, (_, i) => `La voiture numéro ${i} est garée`))}\n`);
			await dep.coffre.ecrire('b.md', `${entete()}# B\n\n## Faits\n${faits("L'automobile du directeur est neuve", 'Le tamanoir mange des termites')}\n`);
			await synchroniser(dep);
			const mots = cles(await chercherSansSynchro(dep, { texte: 'voiture', limite: 20, sansSeuil: true }));
			dep.sens = sensGradue('voiture', ['automobile'], 0.8);
			await vectoriser(dep, { budgetMs: 60_000, demarrer: true });
			const avec = await chercherSansSynchro(dep, { texte: 'voiture', limite: 20, sansSeuil: true }, optionsSansDemarrage());
			const seul = avec.find((t) => t.id === 'b.md#^f-0001')!;
			// sa base (sans aucun mot, r = 1 : sa pertinence) ; les poids (mémoire, fraîcheur) sont les mêmes que ceux des faits des mots
			expect(seul.base).toBeLessThanOrEqual(POIDS_COMPLEMENTAIRE);
			const desMots = avec.filter((t) => t.id.startsWith('a.md'));
			expect(cles(desMots)).toEqual(mots);
			for (const t of desMots) expect(t.score).toBeGreaterThan(seul.score);
		}
	});

	it('mots + sens : pas de saturation, l\'apport du sens reste gradué', async () => {
		const dep = fauxPorts();
		const textes = ['voiture voiture voiture rouge', 'voiture voiture bleue', ...Array.from({ length: 10 }, (_, i) => `Une longue phrase qui parle surtout de jardinage et de plantes numéro ${i} et accessoirement de voiture`)];
		await dep.coffre.ecrire('a.md', `${entete()}# A\n\n## Faits\n${faits(...textes)}\n`);
		await synchroniser(dep);
		const requete = { texte: 'voiture', limite: 12 };
		const sans = new Map((await chercherSansSynchro(dep, requete, optionsSansDemarrage())).map((t) => [t.id, t.score]));
		dep.sens = sensGradue('voiture', ['jardinage'], 0.8);
		await vectoriser(dep, { budgetMs: 60_000, demarrer: true });
		const avec = await chercherSansSynchro(dep, requete, optionsSansDemarrage());
		expect(avec).toHaveLength(12);
		// les deux faits que le sens ne rapproche pas gardent leur score des mots
		for (const id of ['a.md#^f-0001', 'a.md#^f-0002']) expect(avec.find((t) => t.id === id)!.score).toBe(sans.get(id));
		const jardinage = avec.filter((t) => !['a.md#^f-0001', 'a.md#^f-0002'].includes(t.id));
		for (const t of jardinage) {
			expect(t.score).toBeGreaterThan(sans.get(t.id)!);
			expect(t.base).toBeLessThan(0.99);
		}
		expect(new Set(jardinage.map((t) => t.score)).size).toBe(jardinage.length);
	});

	it('échéance déjà passée : ni sens ni reranker appelés', async () => {
		const { dep, sens } = await memoireParaphrase();
		const reranker = fauxReranker(() => 1);
		dep.reranker = reranker;
		sens.appels.length = 0;
		await chercherSansSynchro(dep, { texte: 'garage' }, optionsOutils(Date.now() - 10_000));
		expect(sens.appels).toEqual([]);
		expect(reranker.appels).toEqual([]);
	});

	it('modèles qui échouent (null, exception) : repli silencieux sur les mots', async () => {
		const dep = await memoireDeReference();
		const requete = { texte: 'remise catalogue' };
		const attendu = cles(await chercherSansSynchro(dep, requete, optionsOutils()));
		expect(attendu.length).toBeGreaterThan(0);
		// (le contrat des ports est de rendre null ; une exception est quand même absorbée par la recherche)
		dep.sens = { modele: () => 'x@1', vecteurs: async () => { throw new Error('panne'); } };
		dep.reranker = { noter: async () => { throw new Error('panne'); } };
		expect(cles(await chercherSansSynchro(dep, requete, optionsOutils()))).toEqual(attendu);
		dep.sens = { modele: () => 'x@1', vecteurs: async () => [new Float32Array(0)] };
		dep.reranker = { noter: async () => [1] }; // mauvais nombre de notes
		expect(cles(await chercherSansSynchro(dep, requete, optionsOutils()))).toEqual(attendu);
		dep.sens = { modele: () => 'x@1', vecteurs: async () => [Float32Array.of(Number.NaN, 1)] };
		dep.reranker = { noter: async (_r, textes) => textes.map(() => Number.NaN) };
		expect(cles(await chercherSansSynchro(dep, requete, optionsOutils()))).toEqual(attendu);
	});

	it('une paraphrase sans mot commun est trouvée par le sens, seulement quand il est actif', async () => {
		const { dep, sens } = await memoireParaphrase();
		const { trouves } = await chercherAvecAvis(dep, { texte: 'automobile' });
		expect(trouves[0]!.id).toBe('a.md#^f-0001');
		// la requête est vectorisée telle quelle, dans le budget des outils, démarrage permis
		expect(sens.appels.at(-1)).toEqual({ budgetMs: expect.any(Number), demarrer: true });
		expect(sens.appels.at(-1)!.budgetMs).toBeLessThanOrEqual(2000);
		expect((await chercherAvecAvis(dep, { texte: 'automobile', variante: { ...VARIANTE_COMPLETE, sens: false } })).trouves).toEqual([]);
		// sans option de modèle : les mots seuls
		expect(await chercherSansSynchro(dep, { texte: 'automobile' })).toEqual([]);
		// modèle absent : les mots seuls
		dep.sens = fauxSens(null);
		expect((await chercherAvecAvis(dep, { texte: 'automobile' })).trouves).toEqual([]);
	});

	it('chercherAvecAvis rapide : les mots seuls, sans vectoriser ni noter (premier temps de l’interface)', async () => {
		const { dep, sens } = await memoireParaphrase();
		const reranker = fauxReranker(() => 1);
		dep.reranker = reranker;
		const avant = sens.appels.length;
		const rapide = await chercherAvecAvis(dep, { texte: 'automobile' }, { rapide: true });
		expect(rapide.trouves).toEqual([]);
		expect(rapide.notes).toBeNull();
		expect(sens.appels.length).toBe(avant);
		expect(reranker.appels).toEqual([]);
		const parLesMots = await chercherAvecAvis(dep, { texte: 'voiture' }, { rapide: true });
		expect(parLesMots.trouves[0]!.id).toBe('a.md#^f-0001');
		expect(sens.appels.length).toBe(avant);
		// l'appel complet, lui, passe par le sens et le reranker : notes par id
		const complet = await chercherAvecAvis(dep, { texte: 'automobile' });
		expect(complet.trouves[0]!.id).toBe('a.md#^f-0001');
		expect(complet.notes?.get('a.md#^f-0001')).toEqual(expect.any(Number));
	});

	it('un passage trouvé par le sens porte la fiabilité de son type de source', async () => {
		const dep = await memoireDeReference();
		dep.sens = sensAConcepts([['négociée', 'marchandage']]);
		await vectoriser(dep, { budgetMs: 60_000, demarrer: true });
		const { trouves } = await chercherAvecAvis(dep, { texte: 'marchandage' });
		const passage = trouves.find((t) => t.id === 'sources/notice.md#p-efdd7612')!;
		expect(passage.genre).toBe('passage');
		expect(passage.typeSource).toBe('spec_validee');
		expect(passage.confiance).toBe(0.9);
		expect(passage.contexte).not.toBe('');
	});

	it('le sens respecte les filtres (genres, statuts, périmètre)', async () => {
		const { dep } = await memoireParaphrase();
		expect((await chercherAvecAvis(dep, { texte: 'automobile', genres: ['consigne'] })).trouves).toEqual([]);
		expect((await chercherAvecAvis(dep, { texte: 'automobile', perimetre: 'zzz' })).trouves).toEqual([]);
	});

	it('requête sans aucun mot : rien, même avec le sens (le modèle n\'est pas appelé)', async () => {
		const { dep, sens } = await memoireParaphrase();
		sens.appels.length = 0;
		expect((await chercherAvecAvis(dep, { texte: '"*-:()' })).trouves).toEqual([]);
		expect(sens.appels).toEqual([]);
	});

	it('le reranker réordonne les 40 premiers (préfixe + texte) sans changer l\'échelle des scores', async () => {
		const dep = await memoireDeReference();
		const avant = await chercher(dep, { texte: 'catalogue' });
		expect(avant[0]!.id).toBe('projets/autre/autre.md#^f-0001');
		const reranker = fauxReranker((texte) => (texte.includes('mille références') ? 6 : -6));
		dep.reranker = reranker;
		const apres = await chercherAvecReranker(dep, { texte: 'catalogue' });
		expect(apres[0]!.id).toBe('projets/vela/vela.md#^f-0001');
		// le reranker fixe l'ordre, pas l'échelle : les mêmes éléments restent au-dessus du seuil (sigmoïde(−6) ≈ 0,002 ne
		// les retire plus), et le premier prend la pertinence du premier d'avant
		expect(apres.map((t) => t.id).sort()).toEqual(avant.map((t) => t.id).sort());
		expect(apres[0]!.score).toBeCloseTo(avant[0]!.score, 6);
		const appel = reranker.appels.at(-1)!;
		expect(appel.requete).toBe('catalogue');
		expect(appel.textes.length).toBeLessThanOrEqual(40);
		const mille = avant.find((t) => t.id === 'projets/vela/vela.md#^f-0001')!;
		expect(appel.textes).toContain(`${mille.contexte}\n\n${mille.texte}`);
		expect(appel.options.demarrer).toBe(true);
		expect(appel.options.budgetMs).toBeLessThanOrEqual(3500);
		// variante sans reranker : l'ordre des mots
		const sans = await chercherAvecReranker(dep, { texte: 'catalogue', variante: { ...VARIANTE_COMPLETE, reranker: false } });
		expect(cles(sans)).toEqual(cles(avant));
	});

	it('outils : reranker actif par défaut (démarrage permis)', async () => {
		const dep = await memoireDeReference();
		const reranker = fauxReranker((texte) => (texte.includes('mille références') ? 6 : -6));
		dep.reranker = reranker;
		expect(optionsOutils().reranker).toEqual({ demarrer: true });
		expect((await chercher(dep, { texte: 'catalogue' }))[0]!.id).toBe('projets/vela/vela.md#^f-0001');
		expect(reranker.appels).toHaveLength(1);
	});

	it('le reranker ne voit que les 40 premiers candidats', async () => {
		const dep = fauxPorts();
		await dep.coffre.ecrire('a.md', `${entete()}# A\n\n## Faits\n${faits(...Array.from({ length: 60 }, (_, i) => `Zorglub numéro ${i}`))}\n`);
		const reranker = fauxReranker(() => 0);
		dep.reranker = reranker;
		await chercherAvecReranker(dep, { texte: 'zorglub' });
		expect(reranker.appels[0]!.textes).toHaveLength(40);
	});

	it('graphe : un fait de la fiche client liée remonte devant les mots équivalents ; désactivable', async () => {
		const dep = fauxPorts();
		await dep.coffre.ecrire('projets/p/p.md', `${entete()}# P\n\n## Faits\n${faits('Remise catalogue A')}\n\n## Relations\n- client [[clients/c/c]]\n`);
		// plus long que les autres : les mots le classent derrière les six fiches sans lien (hors des 5 premières fiches)
		await dep.coffre.ecrire('clients/c/c.md', `${entete('organisation', 'portee: client:c\n')}# Client C\n\n## Faits\n${faits('Le client exige une remise sur chaque commande passée cette année')}\n`);
		for (let i = 1; i <= 6; i++) await dep.coffre.ecrire(`zzz/z${i}.md`, `${entete()}# Z${i}\n\n## Faits\n${faits('Une remise')}\n`);
		const rangDuClient = (trouves: { id: string }[]) => trouves.findIndex((t) => t.id === 'clients/c/c.md#^f-0001');
		const requete = { texte: 'remise catalogue', limite: 20, sansSeuil: true };
		const sans = await chercher(dep, { ...requete, variante: SANS_GRAPHE });
		expect(rangDuClient(sans)).toBe(sans.length - 1);
		const avec = await chercher(dep, requete);
		expect(rangDuClient(avec)).toBe(1);
		// les éléments des mots seuls gardent leur score
		const scoresSans = new Map(sans.map((t) => [t.id, t.score]));
		for (const t of avec) if (t.id !== 'clients/c/c.md#^f-0001') expect(t.score).toBe(scoresSans.get(t.id));
		// une fiche liée qui n'est pas un dossier et ne déclare ni portée ni dossier de projet n'entre pas dans le graphe
		await dep.coffre.ecrire('clients/c/c.md', `${entete('sujet')}# Client C\n\n## Faits\n${faits('Le client exige une remise sur chaque commande passée cette année')}\n`);
		const sujet = await chercher(dep, requete);
		expect(rangDuClient(sujet)).toBe(sujet.length - 1);
	});

	it('graphe et voisinage : un lien écrit par titre ou par nom compte comme un lien par chemin', async () => {
		const dep = fauxPorts();
		await dep.coffre.ecrire('projets/p/p.md', `${entete()}# P\n\n## Faits\n${faits('Remise catalogue A')}\n\n## Relations\n- client [[Client C]]\n`);
		await dep.coffre.ecrire('clients/c/c.md', `${entete('organisation', 'portee: client:c\n')}# Client C\n\n## Faits\n${faits('Le client exige une remise sur chaque commande passée cette année')}\n`);
		for (let i = 1; i <= 6; i++) await dep.coffre.ecrire(`zzz/z${i}.md`, `${entete()}# Z${i}\n\n## Faits\n${faits('Une remise')}\n`);
		const rangDuClient = (trouves: { id: string }[]) => trouves.findIndex((t) => t.id === 'clients/c/c.md#^f-0001');
		const avec = await chercher(dep, { texte: 'remise catalogue', limite: 20, sansSeuil: true });
		expect(rangDuClient(avec)).toBe(1);
		const sansGraphe = { texte: 'remise', limite: 20, sansSeuil: true, variante: SANS_GRAPHE };
		const loin = await chercher(dep, sansGraphe);
		const pres = await chercher(dep, { ...sansGraphe, position: 'projets/p' });
		const score = (trouves: { id: string; score: number }[]) => trouves.find((t) => t.id === 'clients/c/c.md#^f-0001')!.score;
		expect(score(pres)).toBeGreaterThan(score(loin));
	});

	it('position désactivée : aucun bonus de voisinage', async () => {
		const dep = await memoireDeReference();
		const sansPosition = cles(await chercher(dep, { texte: 'remise', variante: SANS_GRAPHE }));
		const avec = cles(await chercher(dep, { texte: 'remise', position: 'projets/vela', variante: SANS_GRAPHE }));
		expect(avec).not.toEqual(sansPosition);
		const coupee = cles(await chercher(dep, { texte: 'remise', position: 'projets/vela', variante: { ...SANS_GRAPHE, position: false } }));
		expect(coupee).toEqual(sansPosition);
	});

	it('similarité minimale : un sens aléatoire n\'ajoute rien (chronologie, sans seuil, ne rend que le fait des mots)', async () => {
		const dep = fauxPorts();
		await dep.coffre.ecrire('a.md', `${entete()}# A\n\n## Faits\n${faits('Le dépôt est sur GitLab', 'Le tamanoir mange des termites', 'La voiture est rouge', 'Le garage ferme le lundi')}\n`);
		await synchroniser(dep);
		const sansSens = (await chronologie(dep, 'GitLab')).map((t) => t.id);
		expect(sansSens).toEqual(['a.md#^f-0001']);
		dep.sens = fauxSens();
		await vectoriser(dep, { budgetMs: 60_000, demarrer: true });
		expect((await chronologie(dep, 'GitLab')).map((t) => t.id)).toEqual(sansSens);
		expect(cles(await chercher(dep, { texte: 'GitLab' })).map((c) => c.split(' ')[0])).toEqual(sansSens);
	});

	it('chronologie : sens avec démarrage (2 s), jamais de reranker', async () => {
		const { dep, sens } = await memoireParaphrase();
		const reranker = fauxReranker(() => 1);
		dep.reranker = reranker;
		sens.appels.length = 0;
		const trouves = await chronologie(dep, 'automobile');
		expect(trouves.map((t) => t.id)).toContain('a.md#^f-0001');
		expect(sens.appels.every((a) => a.demarrer && a.budgetMs <= 2000)).toBe(true);
		expect(reranker.appels).toEqual([]);
	});
});

describe('hooks et proches : jamais de démarrage, budget court', () => {

	it('voisins mémorisés : mêmes résultats qu’un parcours par genre, un seul parcours', async () => {
		const dep = await memoireDeReference();
		dep.sens = fauxSens();
		await vectoriser(dep, { budgetMs: 60_000, demarrer: true });
		const modele = dep.sens.modele()!;
		const requete = vecteurFaux('remise catalogue');
		const statuts: FiltreIndex['statuts'] = ['servi', 'source_disparue', 'ancienne_version'];
		const plusProches = dep.index.plusProches.bind(dep.index);
		let parcours = 0;
		const compte: Dependances = { ...dep, index: { ...dep.index, plusProches: (...a) => (parcours++, plusProches(...a)) } };
		const memo = avecSensMemorise(compte);
		const genres: FiltreIndex['genres'][] = [['fiche', 'fait', 'consigne'], ['passage'], ['fait', 'consigne', 'passage'], undefined, ['fait']];
		for (const limite of [50, 3]) {
			for (const g of genres) {
				const filtre: FiltreIndex = g === undefined ? { statuts } : { statuts, genres: g };
				const attendu = await plusProches(modele, requete, filtre, limite);
				expect(attendu.length).toBeGreaterThan(0);
				expect(await memo.index.plusProches(modele, requete, filtre, limite)).toEqual(attendu);
			}
		}
		expect(parcours).toBe(1);
		// une autre requête ou un autre filtre (hors genres) : un nouveau parcours
		await memo.index.plusProches(modele, vecteurFaux('autre'), { statuts }, 5);
		await memo.index.plusProches(modele, requete, { statuts: ['servi'] }, 5);
		expect(parcours).toBe(3);
	});

	it('proches avant écriture : par les mots seuls (ni sens ni reranker)', async () => {
		const { dep } = await memoireParaphrase();
		const lent = fauxSens();
		lent.delaiMs = 5000;
		dep.sens = lent;
		const reranker = fauxReranker(() => 1);
		dep.reranker = reranker;
		const debut = Date.now();
		const proches = await prochesDeFait(dep, { genre: 'fait', fiche: 'a.md', texte: 'La voiture du client est rouge vif', nature: 'declare', source: { ref: 'oral', type: 'utilisateur' } } as DemandeFait);
		expect(proches.map((t) => t.id)).toEqual(['a.md#^f-0001']);
		expect(Date.now() - debut).toBeLessThan(250);
		expect(lent.appels).toEqual([]);
		expect(reranker.appels).toEqual([]);
	});
});

describe('budget unique d\'un appel d\'outil', () => {
	it('modèles lents ou rapides, vecteurs à calculer : chercherAvecAvis rend la main en 3,6 s au plus', async () => {
		const combinaisons = [[0, 0], [5000, 0], [0, 5000], [5000, 5000], [1900, 5000], [600, 2500]] as const;
		const durees = await Promise.all(
			combinaisons.map(async ([delaiSens, delaiReranker]) => {
				const dep = await memoireDeReference();
				const sens = fauxSens();
				dep.sens = sens;
				await vectoriser(dep, { budgetMs: 60_000, demarrer: true });
				// des vecteurs à calculer : vectoriser a du travail dans l'appel
				await dep.coffre.ecrire('x.md', `${entete()}# X\n\n## Faits\n${faits('Remise nouvelle', 'Catalogue neuf')}\n`);
				sens.delaiMs = delaiSens;
				dep.reranker = {
					async noter(_requete, textes, options) {
						await new Promise((r) => setTimeout(r, Math.min(delaiReranker, Math.max(0, options.budgetMs))));
						return delaiReranker > options.budgetMs ? null : textes.map(() => 0);
					},
				};
				const debut = Date.now();
				await chercherAvecAvis(dep, { texte: 'remise catalogue' });
				return Date.now() - debut;
			}),
		);
		for (const duree of durees) expect(duree).toBeLessThanOrEqual(3600);
	});

	it('chronologie : 3,5 s au plus avec un modèle lent', async () => {
		const { dep } = await memoireParaphrase();
		const lent = fauxSens();
		lent.delaiMs = 10_000;
		dep.sens = lent;
		const debut = Date.now();
		await chronologie(dep, 'garage');
		expect(Date.now() - debut).toBeLessThanOrEqual(3600);
		expect(lent.appels.map((a) => a.options.demarrer)).toEqual([true]);
	});
});
