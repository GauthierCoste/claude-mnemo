import { afterEach, describe, expect, it, vi } from 'vitest';
import { join } from 'node:path';
import { DEMANDE_MAX, estEtranger, relatifALaRacine, traiterEvenement } from '../../src/application/evenements.ts';
import type { EntreeHook } from '../../src/application/evenements.ts';
import type { EtatSessions, Pilotage } from '../../src/application/ports.ts';
import { dossiersNonRattaches } from '../../src/application/dossiers-non-rattaches.ts';
import { fichesDemandees } from '../../src/application/fiches-demandees.ts';
import { proposer } from '../../src/application/proposer.ts';
import { porteursRecents } from '../../src/application/porteurs-recents.ts';
import { aprioriDesGestes } from '../../src/application/apriori.ts';
import { affiner } from '../../src/application/affiner.ts';
import { modelesActifs } from '../../src/application/note-du-classement.ts';
import { coupuresDesInjections, reactiverInjection, SuiviIllisible, suiviDesInjections } from '../../src/application/suivi-injection.ts';
import { noterGeste } from '../../src/application/gestes.ts';
import type { DemandeAffinage } from '../../src/application/affiner.ts';
import { REGLAGES_PAR_DEFAUT } from '../../src/domaine/reglages.ts';
import { dureeDuReranker } from '../../src/application/duree-reranker.ts';
import { vectoriser } from '../../src/application/vectoriser.ts';
import { SANS_EXTRACTION, synchroniser } from '../../src/application/synchroniser.ts';
import type { Reranker, Sens } from '../../src/application/ports.ts';
import { servirQuestion } from '../aides/servir.ts';
import { echelleDesSignaux, modeleNonAppris } from '../../src/domaine/modele-de-note.ts';
import { texteDossierNonRattache } from '../../src/domaine/rattachement.ts';
import type { EvenementHook, Session } from '../../src/domaine/session.ts';
import { ouvrirEtat } from '../../src/infra/etat-sqlite.ts';
import { dossierTemporaire } from '../aides/dossier-temporaire.ts';
import { DEPOT_ABSENT, fauxPorts } from '../aides/faux-ports.ts';

const ID = '11111111-2222-4333-8444-555555555555';
const entete = (type = 'sujet', extra = '') => `---\nid: 01ABC\ntype: ${type}\n${extra}updated: 2026-11-01\n---\n`;
const ligne = (texte: string, ancre: string) => `- ${texte} | declare | src: utilisateur oral | appris 2026-11-20 | confiance 100 % ^${ancre}`;
const consigne = (texte: string, portee: string, niveau: string) => `${entete('consigne', `portee: ${portee}\nniveau: ${niveau}\n`)}# C\n\n${texte}\n`;

const ouverts: EtatSessions[] = [];
afterEach(() => {
	while (ouverts.length > 0) ouverts.pop()?.fermer();
});

function session(champs: Partial<Session> = {}): Session {
	return {
		id: ID,
		profil: 'travail',
		dossier: '',
		position: 'projets/vela',
		projet: 'vela',
		objectif: null,
		etat: 'attend',
		creeeMs: 1,
		majMs: 1,
		arretAttendu: null,
		bilanDemandeMs: null,
		commitDebut: null,
		branche: null,
		pid: null,
		...champs,
	};
}

async function contexte(champs: Partial<Session> | null = {}) {
	const dep = fauxPorts();
	await dep.coffre.ecrire('consignes/g.md', consigne('Réponds en français.', 'globale', 'toujours'));
	await dep.coffre.ecrire('projets/vela/vela.md', `${entete('dossier')}# Projet Vela\n\nRefonte du catalogue.\n\n## Faits\n${ligne('Le catalogue compte mille références', 'f-0001')}\n`);
	const etat = ouvrirEtat(join(await dossierTemporaire(), 'etat.sqlite'));
	ouverts.push(etat);
	if (champs !== null) await etat.creer(session(champs));
	const pil: Pick<Pilotage, 'etat' | 'depot'> = { etat, depot: DEPOT_ABSENT };
	return { dep, etat, pil };
}

const entree = (evenement: EvenementHook, horodatageMs: number, extra: Partial<EntreeHook> = {}): EntreeHook => ({ evenement, session: ID, horodatageMs, cwd: null, ...extra });
const local = { froid: 'si-budget' as const };

describe('traiterEvenement : états', () => {
	it('dialogue ouvert qui nomme son outil (Mistral Vibe, Codex) : l’après-outil d’un autre outil ne le ferme pas, celui de cet outil le ferme', async () => {
		const { dep, etat, pil } = await contexte({ etat: 'travaille', majMs: 5 });
		await traiterEvenement(dep, pil, entree('arret', 10, { arret: 'notification', outil: { nom: 'bash', entree: { command: 'ls' } } }), local);
		expect(await etat.lire(ID)).toMatchObject({ etat: 'attend', dernierArret: 'notification', dialogueOutil: 'bash' });
		await traiterEvenement(dep, pil, entree('apres_outil', 11, { outil: { nom: 'read_file', entree: {} }, sansContexte: true }), local);
		expect(await etat.lire(ID)).toMatchObject({ etat: 'attend', dernierArret: 'notification' });
		await traiterEvenement(dep, pil, entree('apres_outil', 12, { outil: { nom: 'bash', entree: {} }, sansContexte: true }), local);
		expect(await etat.lire(ID)).toMatchObject({ etat: 'travaille', dernierArret: null, dialogueOutil: null });
	});

	it('transitions : debut → attend, message → travaille, outil → travaille, arret → attend, fin → a_relire', async () => {
		const { dep, etat, pil } = await contexte({ etat: 'travaille' });
		const suite: [EvenementHook, string][] = [
			['debut', 'attend'],
			['message', 'travaille'],
			['arret', 'attend'],
			['outil', 'travaille'],
			['arret', 'attend'],
			['fin', 'a_relire'],
		];
		let t = 10;
		for (const [e, attendu] of suite) {
			await traiterEvenement(dep, pil, entree(e, t++, e === 'message' ? { prompt: 'Bonjour' } : {}), local);
			expect((await etat.lire(ID))?.etat, e).toBe(attendu);
		}
	});

	it('événement d’un autre moteur que celui de la session (codex lancé depuis une session Claude Code) : aucun effet', async () => {
		const { dep, etat, pil } = await contexte({ etat: 'travaille' });
		for (const e of ['debut', 'message', 'arret', 'fin'] as const) {
			expect(await traiterEvenement(dep, pil, entree(e, 10, { moteur: 'codex', fil: 'fil-codex', prompt: 'Autre objectif' }), local), e).toEqual({});
		}
		const s = await etat.lire(ID);
		expect(s).toMatchObject({ etat: 'travaille', objectif: null });
		expect(s?.fil).toBeUndefined();
		expect(s?.episodeMs ?? null).toBeNull();
	});

	it('session Codex : son fil appris au premier événement ; un autre fil ensuite est sans effet', async () => {
		const { dep, etat, pil } = await contexte({ etat: 'travaille', moteur: 'codex' });
		await traiterEvenement(dep, pil, entree('arret', 10, { moteur: 'codex', fil: 'fil-a' }), local);
		expect(await etat.lire(ID)).toMatchObject({ etat: 'attend', fil: 'fil-a' });
		await traiterEvenement(dep, pil, entree('message', 11, { moteur: 'codex', fil: 'fil-b', prompt: 'Autre' }), local);
		await traiterEvenement(dep, pil, entree('fin', 12, { moteur: 'codex', fil: 'fil-b' }), local);
		expect(await etat.lire(ID)).toMatchObject({ etat: 'attend', fil: 'fil-a', objectif: null });
		// un événement de Claude Code n'est pas de cette session Codex
		await traiterEvenement(dep, pil, entree('fin', 13), local);
		expect((await etat.lire(ID))?.etat).toBe('attend');
		await traiterEvenement(dep, pil, entree('fin', 14, { moteur: 'codex', fil: 'fil-a' }), local);
		expect((await etat.lire(ID))?.etat).toBe('a_relire');
	});

	it('/clear (debut de source clear, même moteur, autre fil ; non mesuré) : le fil est remplacé, la suite vient de lui', async () => {
		const { dep, etat, pil } = await contexte({ etat: 'travaille', moteur: 'mistral-vibe' });
		await traiterEvenement(dep, pil, entree('arret', 10, { moteur: 'mistral-vibe', fil: 'fil-a' }), local);
		expect(await etat.lire(ID)).toMatchObject({ fil: 'fil-a' });
		// un autre fil sans /clear (sous-agent, /new) : toujours étranger
		expect(await estEtranger(pil, entree('debut', 11, { moteur: 'mistral-vibe', fil: 'fil-b', source: 'startup' }))).toBe(true);
		// /clear venant d'un autre moteur : étranger
		expect(await estEtranger(pil, entree('debut', 11, { moteur: 'codex', fil: 'fil-b', source: 'clear' }))).toBe(true);
		await traiterEvenement(dep, pil, entree('debut', 11, { moteur: 'mistral-vibe', fil: 'fil-b', source: 'clear' }), local);
		expect(await etat.lire(ID)).toMatchObject({ etat: 'attend', fil: 'fil-b' });
		await traiterEvenement(dep, pil, entree('message', 12, { moteur: 'mistral-vibe', fil: 'fil-b', prompt: 'Suite' }), local);
		expect(await etat.lire(ID)).toMatchObject({ etat: 'travaille', fil: 'fil-b' });
		await traiterEvenement(dep, pil, entree('message', 13, { moteur: 'mistral-vibe', fil: 'fil-a', prompt: 'Ancien' }), local);
		expect(await estEtranger(pil, entree('message', 13, { moteur: 'mistral-vibe', fil: 'fil-a' }))).toBe(true);
		expect(await etat.lire(ID)).toMatchObject({ fil: 'fil-b', objectif: 'Suite' });
	});

	it('fin selon arretAttendu : pause → en_pause', async () => {
		const { dep, etat, pil } = await contexte({ arretAttendu: 'pause' });
		await traiterEvenement(dep, pil, entree('fin', 10), local);
		expect((await etat.lire(ID))?.etat).toBe('en_pause');
	});

	it('message : objectif posé au premier prompt ; un événement plus ancien est ignoré', async () => {
		const { dep, etat, pil } = await contexte();
		await traiterEvenement(dep, pil, entree('message', 10, { prompt: '\n  Refaire   le catalogue\nsuite' }), local);
		await traiterEvenement(dep, pil, entree('message', 11, { prompt: 'Autre chose' }), local);
		await traiterEvenement(dep, pil, entree('arret', 5), local);
		const s = await etat.lire(ID);
		expect(s?.objectif).toBe('Refaire le catalogue');
		expect(s?.etat).toBe('travaille');
	});

	it('outil, arret, fin : rien à servir', async () => {
		const { dep, etat, pil } = await contexte();
		for (const e of ['outil', 'arret', 'fin'] as const) expect(await traiterEvenement(dep, pil, entree(e, 10), local)).toEqual({});
		expect(await etat.servis(ID, 10)).toEqual([]);
	});
});

describe('traiterEvenement : contexte servi et journalisé', () => {
	it('message : sert le contexte de la position de la session et le journalise', async () => {
		const { dep, etat, pil } = await contexte();
		const r = await traiterEvenement(dep, pil, entree('message', 10, { prompt: 'catalogue références' }), local);
		const attendu = await servirQuestion(dep, 'projets/vela', 'catalogue références');
		expect(r.contexte).toBe(attendu.texte);
		expect(r.contexte).toContain('Réponds en français.');
		expect(r.contexte).toContain('mille références');
		const [j] = await etat.servis(ID, 10);
		expect(j).toMatchObject({ session: ID, moment: 'message', horodatageMs: 10, texte: attendu.texte, ids: attendu.calcul.position === null ? [] : [attendu.calcul.position.chemin], sens: false });
		expect(j!.ms).toBeGreaterThanOrEqual(0);
	});

	it('debut : rien servi ni journalisé ; /clear et /compact rendent à servir les fiches déjà injectées', async () => {
		const { dep, etat, pil } = await contexte({ objectif: 'catalogue' });
		expect(await traiterEvenement(dep, pil, entree('debut', 10), local)).toEqual({});
		expect(await etat.servis(ID, 10)).toEqual([]);
		await etat.noterFicheServieLueOuEcrite(ID, { chemin: 'projets/vela/vela.md', action: 'servie', horodatageMs: 11, empreinte: 'e' });
		await traiterEvenement(dep, pil, entree('debut', 12, { source: 'compact' }), local);
		expect((await etat.fichesServiesLuesOuEcrites(ID)).map((f) => f.empreinteInjectee)).toEqual([null]);
	});

	it('rappels au premier message, même après un appel de l’outil `contexte` journalisé avant lui ; plus au message suivant', async () => {
		const { dep, etat, pil } = await contexte();
		await dep.coffre.ecrire('consignes/r.md', consigne('Relis le cahier des charges.', 'globale', 'rappelee'));
		await etat.journaliser({ session: ID, moment: 'contexte', horodatageMs: 5, ids: [], texte: 'pistes', ms: 1, sens: false, demande: 'catalogue', classement: [], muet: null, cartes: [], position: null });
		const premier = await traiterEvenement(dep, pil, entree('message', 10, { prompt: 'catalogue références' }), local);
		expect(premier.contexte).toContain('## Rappels');
		expect(premier.contexte).toContain('Relis le cahier des charges.');
		const second = await traiterEvenement(dep, pil, entree('message', 11, { prompt: 'catalogue références' }), local);
		expect(second.contexte).not.toContain('Relis le cahier des charges.');
	});

	it('session inconnue : sert quand même (position tirée du cwd), sans état ni journal', async () => {
		const { dep, etat, pil } = await contexte(null);
		await dep.coffre.ecrire('projets/vela/vela.md', `${entete('dossier', 'dossier_projet: code/vela\n')}# Projet Vela\n\nRefonte du catalogue.\n`);
		const r = await traiterEvenement(dep, pil, entree('message', 10, { cwd: '/racine/code/vela/src', prompt: 'catalogue' }), { froid: 'si-budget', racine: '/racine' });
		expect(r.contexte).toContain('Projet Vela');
		expect(await etat.lire(ID)).toBeNull();
		expect(await etat.servis(ID, 10)).toEqual([]);
	});

	it('session inconnue, dossier sans lien : racine, une entrée « dossier non rattaché » ; le lien posé par proposer la retire au hook suivant', async () => {
		const { dep, etat, pil } = await contexte(null);
		await dep.coffre.ecrire('g1/d1/d1.md', `${entete('dossier')}# Lieu D1\n\nLe lieu.\n`);
		const debut = (h: number) => traiterEvenement(dep, pil, entree('debut', h, { cwd: '/racine/h1/d1' }), { froid: 'si-budget', racine: '/racine' });
		await debut(10);
		expect(await dossiersNonRattaches(dep, etat)).toEqual([{ dossier: 'h1/d1', texte: texteDossierNonRattache('h1/d1') }]);
		// un second hook ne double pas l'entrée
		await debut(11);
		expect((await etat.dossiersNonRattaches()).map((d) => d.dossier)).toEqual(['h1/d1']);
		expect(await proposer(dep, { genre: 'modification', fiche: 'g1/d1/d1.md', dossier_projet: 'h1/d1', source: { type: 'session', ref: 'archiviste' } })).toMatchObject({ statut: 'ecrit' });
		// la liste ne le montre plus dès que le lien existe ; le hook suivant le retire
		expect(await dossiersNonRattaches(dep, etat)).toEqual([]);
		await debut(12);
		expect(await etat.dossiersNonRattaches()).toEqual([]);
	});

	it('session non rattachée : le lien posé par proposer donne sa position et son projet au hook suivant, plugin réécrit une fois', async () => {
		const { dep, etat, pil } = await contexte({ dossier: 'h1/d1', position: '', projet: 'divers', dossierNonRattache: true });
		await etat.noterRattachement('h1/d1', false, 1);
		await dep.coffre.ecrire('g1/d1/d1.md', `${entete('dossier', 'portee: projet:P1\n')}# Lieu D1\n\nLe lieu.\n`);
		const rattachees: string[] = [];
		const reglages = { froid: 'si-budget' as const, racine: '/racine', rattachee: async (id: string) => void rattachees.push(id) };
		expect((await traiterEvenement(dep, pil, entree('debut', 10), reglages)).contexte ?? '').not.toContain('Lieu D1');
		expect(await proposer(dep, { genre: 'modification', fiche: 'g1/d1/d1.md', dossier_projet: 'h1/d1', source: { type: 'session', ref: 'archiviste' } })).toMatchObject({ statut: 'ecrit' });
		expect((await traiterEvenement(dep, pil, entree('message', 11, { prompt: 'lieu' }), reglages)).contexte).toContain('Lieu D1');
		expect(await etat.lire(ID)).toMatchObject({ position: 'g1/d1', projet: 'P1', dossierNonRattache: false });
		// le plugin (skills du projet) est réécrit une fois, au hook qui constate le lien
		expect(rattachees).toEqual([ID]);
		await traiterEvenement(dep, pil, entree('message', 12, { prompt: 'x' }), reglages);
		expect(rattachees).toEqual([ID]);
		expect(await etat.dossiersNonRattaches()).toEqual([]);
	});

	it('session non rattachée, lien écrit à la main : pris au hook qui suit la synchronisation de servir', async () => {
		const { dep, etat, pil } = await contexte({ dossier: 'h1/d1', position: '', projet: 'divers', dossierNonRattache: true });
		await traiterEvenement(dep, pil, entree('debut', 10), local);
		await dep.coffre.ecrire('g1/d1/d1.md', `${entete('dossier', 'dossier_projet: h1/d1\n')}# Lieu D1\n\nLe lieu.\n`);
		await traiterEvenement(dep, pil, entree('message', 11, { prompt: 'x' }), local);
		expect((await traiterEvenement(dep, pil, entree('message', 12, { prompt: 'lieu' }), local)).contexte).toContain('Lieu D1');
		expect(await etat.lire(ID)).toMatchObject({ position: 'g1/d1', dossierNonRattache: false });
	});

	it('session rattachée : sa position est gardée, rien n\'est recalculé', async () => {
		const { dep, etat, pil } = await contexte({ dossier: 'h1/d1' });
		await traiterEvenement(dep, pil, entree('debut', 10), { froid: 'si-budget', racine: '/racine' });
		expect(await etat.lire(ID)).toMatchObject({ position: 'projets/vela' });
		expect(await etat.dossiersNonRattaches()).toEqual([]);
	});

	it('journal : ms mesuré depuis debutMs ; échéance passée → rien servi, rien journalisé', async () => {
		const { dep, etat, pil } = await contexte();
		await traiterEvenement(dep, pil, entree('message', 10, { prompt: 'catalogue' }), { froid: 'si-budget', debutMs: Date.now() - 1000, echeance: Date.now() + 5000 });
		expect((await etat.servis(ID, 1))[0]!.ms).toBeGreaterThanOrEqual(1000);
		const r = await traiterEvenement(dep, pil, entree('message', 11, { prompt: 'catalogue' }), { froid: 'si-budget', echeance: Date.now() - 1 });
		expect(r).toEqual({});
		expect(await etat.servis(ID, 10)).toHaveLength(1);
		// l'état, lui, est appliqué
		expect((await etat.lire(ID))?.majMs).toBe(11);
	});

	it('état en panne : l’état est perdu, le contexte est servi quand même', async () => {
		const { dep } = await contexte(null);
		const panne = () => Promise.reject(new Error('database is locked'));
		const etat = { lire: panne, appliquer: panne, journaliser: panne } as unknown as EtatSessions;
		const r = await traiterEvenement(dep, { etat, depot: DEPOT_ABSENT }, entree('message', 10, { prompt: 'catalogue' }), local);
		expect(r.contexte).toContain('Réponds en français.');
	});

	it('rien à servir (mémoire vide, prompt sans mot) : aucun contexte, rien de journalisé', async () => {
		const dep = fauxPorts();
		const etat = ouvrirEtat(join(await dossierTemporaire(), 'etat.sqlite'));
		ouverts.push(etat);
		await etat.creer(session());
		const r = await traiterEvenement(dep, { etat, depot: DEPOT_ABSENT }, entree('message', 10, { prompt: 'ok merci' }), local);
		expect(r).toEqual({});
		expect(await etat.servis(ID, 10)).toEqual([]);
	});
});

describe('traiterEvenement : position, demande et écartés', () => {
	const ID2 = '66666666-7777-4888-8999-000000000000';
	const FICHE = 'projets/vela/vela.md';

	it('message : la fiche de position servie et la demande sont journalisées', async () => {
		const { dep, etat, pil } = await contexte();
		await traiterEvenement(dep, pil, entree('message', 10, { prompt: 'catalogue références' }), local);
		const [j] = await etat.servis(ID, 1);
		expect(j!.demande).toBe('catalogue références');
		expect(j!.ids).toEqual([FICHE]);
		// demande très longue : coupée à DEMANDE_MAX caractères
		await traiterEvenement(dep, pil, entree('message', 11, { prompt: `catalogue ${'x'.repeat(DEMANDE_MAX + 10)}` }), local);
		expect((await etat.servis(ID, 1))[0]!.demande).toHaveLength(DEMANDE_MAX);
	});

	it('écarté : plus servi ni classé au message suivant de la même session, toujours dans une autre ; rétabli : de retour', async () => {
		const { dep, etat, pil } = await contexte();
		await etat.creer(session({ id: ID2 }));
		await etat.ecarter(ID, { id: FICHE, titre: 'Projet Vela' }, { dossier: '', demande: 'catalogue', horodatageMs: 5 });
		const r = await traiterEvenement(dep, pil, entree('message', 10, { prompt: 'catalogue références' }), local);
		expect(r.contexte).not.toContain('mille références');
		const [j] = await etat.servis(ID, 1);
		expect(j?.ids ?? []).not.toContain(FICHE);
		const autre = await traiterEvenement(dep, pil, { ...entree('message', 10, { prompt: 'catalogue références' }), session: ID2 }, local);
		expect(autre.contexte).toContain('mille références');
		await etat.retablir(ID, FICHE);
		expect((await traiterEvenement(dep, pil, entree('message', 11, { prompt: 'catalogue références' }), local)).contexte).toContain('mille références');
	});
});

describe('relatifALaRacine', () => {
	it('POSIX et Windows (séparateurs, casse du lecteur), hors racine → null', () => {
		expect(relatifALaRacine('/r', '/r')).toBe('');
		expect(relatifALaRacine('/r/', '/r/a/b/')).toBe('a/b');
		expect(relatifALaRacine('/r', '/rx/a')).toBeNull();
		expect(relatifALaRacine('/r', '/autre')).toBeNull();
		expect(relatifALaRacine('C:\\Users\\a\\Dossier', 'c:\\users\\a\\dossier\\Code\\vela')).toBe('Code/vela');
		expect(relatifALaRacine('/', '/a')).toBe('a');
	});
});

describe('traiterEvenement : après un outil', () => {
	const lire = (id: string): Partial<EntreeHook> => ({ outil: { nom: 'mcp__mnemo__lire', entree: { id } } });

	it('apres_outil : la fiche lue par un outil Mnemo est notée lue ; rien n’est calculé ni servi', async () => {
		const { dep, etat, pil } = await contexte();
		// le sens n'est jamais appelé après un outil : rien n'est classé
		let appels = 0;
		dep.sens = { modele: () => 'mots@1', vecteurs: async (t) => (appels++, t.map(() => Float32Array.from([1, 0]))) };
		expect(await traiterEvenement(dep, pil, entree('apres_outil', 10, lire('projets/vela/vela.md#^f-0001')), local)).toEqual({});
		expect(await etat.fichesServiesLuesOuEcrites(ID)).toMatchObject([{ chemin: 'projets/vela/vela.md', derniereAction: 'lue', empreinteInjectee: null }]);
		expect(await etat.servis(ID, 5)).toEqual([]);
		expect(await etat.cartesProposees(ID)).toEqual(new Map());
		expect(await etat.perimetrePropose(ID)).toBeNull();
		expect(appels).toBe(0);
	});

	it('lue après une carte : geste noté une fois par proposition, avec le message porteur ; fiche jamais proposée, `voisins` : rien', async () => {
		const { dep, etat, pil } = await contexte();
		const AVOIRS = 'projets/vela/avoirs.md';
		await dep.coffre.ecrire(AVOIRS, `${entete()}# Avoirs\n\nUn avoir annule une facture.\n`);
		await traiterEvenement(dep, pil, entree('message', 10, { prompt: 'catalogue références' }), local);
		expect((await etat.cartesProposees(ID)).has(AVOIRS)).toBe(true);
		await traiterEvenement(dep, pil, entree('apres_outil', 11, { outil: { nom: 'mcp__mnemo__voisins', entree: { id: AVOIRS } } }), local);
		expect(await etat.gestes({ limite: null })).toEqual([]);
		await traiterEvenement(dep, pil, entree('apres_outil', 12, lire(AVOIRS)), local);
		await traiterEvenement(dep, pil, entree('apres_outil', 13, lire(AVOIRS)), local);
		// la fiche de position, injectée entière, n'a jamais été proposée en carte
		await traiterEvenement(dep, pil, entree('apres_outil', 14, lire('projets/vela/vela.md')), local);
		const empreinte = (await dep.index.fiches()).find((f) => f.chemin === AVOIRS)!.empreinte;
		expect(await etat.gestes({ limite: null })).toMatchObject([
			{ geste: 'lue_apres_carte', origine: 'claude', fiche: AVOIRS, empreinte, horodatageMs: 12, message: 'catalogue références', rangMessage: 1, position: 'projets/vela', vecteur: null },
		]);
	});

	it('le service garde le classement du dernier message porteur : la note d’un geste vient de lui, sans relire le journal', async () => {
		const { dep, etat, pil } = await contexte();
		const AVOIRS = 'projets/vela/avoirs.md';
		await dep.coffre.ecrire(AVOIRS, `${entete()}# Avoirs\n\nUn avoir annule une facture.\n`);
		const porteurs = porteursRecents();
		await traiterEvenement(dep, pil, entree('message', 10, { prompt: 'catalogue références' }), { ...local, porteurs });
		const ligne = porteurs.lire(ID)?.classement?.get(AVOIRS);
		expect(ligne).toMatchObject({ rang: 1, piste: true, raison: 'perimetre' });
		// une note différente du journal en mémoire : c'est elle que le geste reprend
		porteurs.noter(ID, { ...porteurs.lire(ID)!, classement: new Map([[AVOIRS, { rang: 7, note: 0.5 }]]) });
		await traiterEvenement(dep, pil, entree('apres_outil', 11, lire(AVOIRS)), { ...local, porteurs });
		expect((await etat.gestes({ limite: null }))[0]).toMatchObject({ geste: 'lue_apres_carte', note: { rang: 7, note: 0.5 } });
	});

	it('trop peu de temps pour noter avant l’échéance : rien n’est noté, journalisé ni rendu', async () => {
		const { dep, etat, pil } = await contexte();
		const r = await traiterEvenement(dep, pil, entree('message', 10, { prompt: 'catalogue références' }), { froid: 'si-budget', echeance: Date.now() + 15 });
		expect(r).toEqual({});
		expect(await etat.servis(ID, 5)).toEqual([]);
		expect(await etat.fichesServiesLuesOuEcrites(ID)).toEqual([]);
	});

	it('lue après une carte, après /clear : comptée une fois ; une nouvelle proposition la fait compter de nouveau', async () => {
		const { dep, etat, pil } = await contexte();
		const AVOIRS = 'projets/vela/avoirs.md';
		await dep.coffre.ecrire(AVOIRS, `${entete()}# Avoirs\n\nUn avoir annule une facture.\n`);
		await traiterEvenement(dep, pil, entree('message', 10, { prompt: 'catalogue références' }), local);
		await traiterEvenement(dep, pil, entree('debut', 11, { source: 'clear' }), local);
		expect((await etat.cartesProposees(ID)).has(AVOIRS)).toBe(false);
		await traiterEvenement(dep, pil, entree('apres_outil', 12, lire(AVOIRS)), local);
		await traiterEvenement(dep, pil, entree('apres_outil', 13, lire(AVOIRS)), local);
		// la fiche change (la lecture ne la tient plus pour vue) ; le périmètre est de nouveau proposé après /clear
		await dep.coffre.ecrire(AVOIRS, `${entete()}# Avoirs\n\nUn avoir annule une facture, en tout ou partie.\n`);
		await traiterEvenement(dep, pil, entree('message', 14, { prompt: 'avoirs références' }), local);
		expect((await etat.cartesProposees(ID)).has(AVOIRS)).toBe(true);
		await traiterEvenement(dep, pil, entree('apres_outil', 15, lire(AVOIRS)), local);
		expect((await etat.gestes({ limite: null })).map((g) => [g.horodatageMs, g.message, g.rangMessage])).toEqual([
			[15, 'avoirs références', 2],
			[12, 'catalogue références', 1],
		]);
	});

	it('message porteur qui dépasse l’échéance : rien d’injecté, mais il devient le message des gestes suivants, texte et rang ensemble', async () => {
		const { dep, etat, pil } = await contexte();
		const AVOIRS = 'projets/vela/avoirs.md';
		await dep.coffre.ecrire(AVOIRS, `${entete()}# Avoirs\n\nUn avoir annule une facture.\n`);
		await traiterEvenement(dep, pil, entree('message', 10, { prompt: 'catalogue références' }), local);
		expect(await traiterEvenement(dep, pil, entree('message', 11, { prompt: 'factures impayées' }), { ...local, echeance: Date.now() - 1 })).toEqual({});
		expect(await etat.servis(ID, 5)).toHaveLength(1);
		await traiterEvenement(dep, pil, entree('apres_outil', 12, lire(AVOIRS)), local);
		expect(await etat.gestes({ limite: null })).toMatchObject([{ geste: 'lue_apres_carte', message: 'factures impayées', rangMessage: 2 }]);
	});

	it('apres_outil : un outil sans lien avec une fiche ne note rien et rend {}', async () => {
		const { dep, etat, pil } = await contexte();
		expect(await traiterEvenement(dep, pil, entree('apres_outil', 10, { outil: { nom: 'Read', entree: { file_path: '/a.php' } } }), local)).toEqual({});
		expect(await etat.fichesServiesLuesOuEcrites(ID)).toEqual([]);
	});
});

describe('traiterEvenement : fiches demandées par l’utilisateur (➤)', () => {
	const AVOIRS = 'projets/vela/avoirs.md';
	async function avecDemande() {
		const c = await contexte();
		await c.dep.coffre.ecrire(AVOIRS, `${entete()}# Avoirs\n\nUn avoir annule une facture.\n`);
		const demandees = fichesDemandees();
		demandees.demander(ID, AVOIRS);
		return { ...c, demandees };
	}

	it('après un outil : rien, la demande attend ; au message suivant : injectée entière, notée injectée, retirée de l’attente', async () => {
		const { dep, etat, pil, demandees } = await avecDemande();
		const reglages = { ...local, demandees };
		expect(await traiterEvenement(dep, pil, entree('apres_outil', 10, { outil: { nom: 'Read', entree: { file_path: '/a.php' } } }), reglages)).toEqual({});
		expect(demandees.voir(ID)).toEqual([AVOIRS]);
		const r = await traiterEvenement(dep, pil, entree('message', 11, { prompt: 'ok' }), reglages);
		expect(r.contexte).toContain('## Fiches injectées à la demande de l’utilisateur');
		expect(r.contexte).toContain('Un avoir annule une facture.');
		expect(demandees.voir(ID)).toEqual([]);
		const avoirs = (await etat.fichesServiesLuesOuEcrites(ID)).find((f) => f.chemin === AVOIRS);
		expect(avoirs).toMatchObject({ derniereAction: 'servie' });
		expect(avoirs!.empreinteInjectee).not.toBeNull();
		expect((await etat.servis(ID, 1))[0]!.ids).toContain(AVOIRS);
		// « ok » est muet et aucun message porteur ne l'a précédé : geste sans message, au rang 0
		expect(await etat.gestes({ limite: null })).toMatchObject([{ geste: 'injectee_main', fiche: AVOIRS, empreinte: avoirs!.empreinteInjectee, message: null, rangMessage: 0, position: 'projets/vela' }]);
	});

	it('avec le sens : l’injection à la main garde le vecteur de son message ; le service le garde pour la lecture d’une carte qui suit', async () => {
		const { dep, etat, pil, demandees } = await avecDemande();
		// sens fictif : un axe par mot, plus un terme constant (jamais de vecteur nul)
		const sens: Sens = {
			modele: () => 'mots@1',
			vecteurs: async (textes) => textes.map((t) => Float32Array.from([...['catalogue', 'avoir', 'facture'].map((m) => t.toLowerCase().split(m).length - 1), 0.01])),
		};
		dep.sens = sens;
		const porteurs = porteursRecents();
		const reglages = { ...local, demandees, porteurs };
		await dep.coffre.ecrire('projets/vela/factures.md', `${entete()}# Factures\n\nUne facture se paie.\n`);
		await vectoriser(dep, { budgetMs: 60_000, demarrer: true });
		await traiterEvenement(dep, pil, entree('message', 11, { prompt: 'catalogue des avoirs' }), reglages);
		expect(porteurs.lire(ID)).toMatchObject({ rang: 1, position: 'projets/vela' });
		expect(porteurs.lire(ID)?.vecteur?.modele).toBe('mots@1');
		const [injection] = await etat.gestes({ limite: null });
		expect(injection).toMatchObject({ geste: 'injectee_main', message: 'catalogue des avoirs', rangMessage: 1 });
		expect(injection!.vecteur?.modele).toBe('mots@1');
		expect(injection!.vecteur?.valeurs.length).toBe(4);
		// une carte proposée à ce message, lue ensuite : même message, même vecteur (repris du service)
		const carte = (await etat.cartesProposees(ID)).keys().next().value!;
		await traiterEvenement(dep, pil, entree('apres_outil', 12, { outil: { nom: 'mcp__mnemo__lire', entree: { id: carte } } }), reglages);
		const [lecture] = await etat.gestes({ limite: null });
		expect(lecture).toMatchObject({ geste: 'lue_apres_carte', origine: 'claude', fiche: carte, rangMessage: 1 });
		expect([...lecture!.vecteur!.valeurs]).toEqual([...injection!.vecteur!.valeurs]);
	});

	it('injection à la main : notée avec le message porteur qui la porte et son rang ; portée par un message muet : le dernier porteur', async () => {
		const { dep, etat, pil, demandees } = await avecDemande();
		const reglages = { ...local, demandees };
		await traiterEvenement(dep, pil, entree('message', 11, { prompt: 'catalogue des avoirs' }), reglages);
		await traiterEvenement(dep, pil, entree('message', 12, { prompt: 'références produits' }), reglages);
		demandees.demander(ID, AVOIRS);
		await traiterEvenement(dep, pil, entree('message', 13, { prompt: 'ok' }), reglages);
		expect(await etat.gestes({ limite: null })).toMatchObject([
			{ geste: 'injectee_main', fiche: AVOIRS, horodatageMs: 13, message: 'références produits', rangMessage: 2 },
			{ geste: 'injectee_main', fiche: AVOIRS, horodatageMs: 11, message: 'catalogue des avoirs', rangMessage: 1, origine: 'utilisateur' },
		]);
	});

	it('le hook n’attend plus : rien d’injecté, la demande est remise en attente pour le message suivant', async () => {
		const { dep, etat, pil, demandees } = await avecDemande();
		expect(await traiterEvenement(dep, pil, entree('message', 11, { prompt: 'ok' }), { ...local, demandees, echeance: Date.now() - 1 })).toEqual({});
		expect(demandees.voir(ID)).toEqual([AVOIRS]);
		expect(await etat.servis(ID, 5)).toEqual([]);
		expect(await etat.gestes({ limite: null })).toEqual([]);
	});
});

describe('traiterEvenement : contexte sobre au message', () => {
	const VELA = 'projets/vela/vela.md';
	const AVOIRS = 'projets/vela/avoirs.md';
	const message = (h: number, prompt: string) => entree('message', h, { prompt });

	async function memoire() {
		const c = await contexte();
		await c.dep.coffre.ecrire(AVOIRS, `${entete()}# Avoirs\n\nUn avoir annule une facture.\n`);
		return c;
	}

	it('premier message porteur : fiche de position et cartes du périmètre, notées et journalisées', async () => {
		const { dep, etat, pil } = await memoire();
		const prompt = 'catalogue références';
		const r = await traiterEvenement(dep, pil, message(10, prompt), local);
		expect(r.contexte).toContain('Réponds en français.');
		expect(r.contexte).toContain('### Projet Vela');
		expect(r.contexte).toContain('- Avoirs — projets/vela/avoirs.md');
		const empreinte = (await dep.index.fiches()).find((f) => f.chemin === AVOIRS)!.empreinte;
		expect((await etat.cartesProposees(ID)).get(AVOIRS)).toBe(empreinte);
		expect(await etat.perimetrePropose(ID)).toBe(10);
		expect(await etat.fichesServiesLuesOuEcrites(ID)).toMatchObject([{ chemin: VELA, derniereAction: 'servie' }]);
		expect((await etat.fichesServiesLuesOuEcrites(ID))[0]!.empreinteInjectee).not.toBeNull();
		expect((await etat.servis(ID, 1))[0]).toMatchObject({ moment: 'message', demande: prompt, muet: null, position: 'projets/vela', ids: [VELA], cartes: [{ chemin: AVOIRS, raison: 'perimetre' }] });
	});

	it('second message porteur : classé (journal), sans pistes ; seule une fiche nommée part', async () => {
		const { dep, etat, pil } = await memoire();
		await traiterEvenement(dep, pil, message(10, 'catalogue références'), local);
		await dep.coffre.ecrire('projets/vela/ristournes.md', `${entete()}# Ristournes\n\nUne ristourne baisse le prix.\n`);
		const seul = await traiterEvenement(dep, pil, message(11, 'catalogue références'), local);
		expect(seul.contexte).toContain('Réponds en français.');
		expect(seul.contexte).not.toContain('###');
		// Ristournes, nouvelle, est classée mais ne part pas en piste : tant que la note n'est pas apprise, pas de pistes à ce message
		expect(seul.contexte).not.toContain('Pistes de Mnemo');
		const classement = (await etat.servis(ID, 1))[0]!.classement;
		expect(new Set(classement.map((c) => c.id))).toEqual(new Set([AVOIRS, 'projets/vela/ristournes.md']));
		expect(classement.find((c) => c.id === AVOIRS)).toMatchObject({ deja: 'proposee' });
		expect(classement.some((c) => c.piste === true)).toBe(false);
		const nomme = await traiterEvenement(dep, pil, message(12, 'les Ristournes du catalogue'), local);
		expect(nomme.contexte).toContain('- Ristournes — projets/vela/ristournes.md');
		expect(nomme.contexte).not.toContain('- Avoirs');
		expect((await etat.servis(ID, 1))[0]!.cartes).toEqual([{ chemin: 'projets/vela/ristournes.md', raison: 'nommee' }]);
		// le périmètre n'a été noté qu'une fois, au premier message
		expect(await etat.perimetrePropose(ID)).toBe(10);
	});

	it('message porteur sans rien à injecter : aucun contexte, mais une entrée au journal avec son classement', async () => {
		const dep = fauxPorts();
		await dep.coffre.ecrire(VELA, `${entete('dossier')}# Projet Vela\n\nRefonte du catalogue.\n`);
		await dep.coffre.ecrire(AVOIRS, `${entete()}# Avoirs\n\nUn avoir annule une facture.\n`);
		const etat = ouvrirEtat(join(await dossierTemporaire(), 'etat.sqlite'));
		ouverts.push(etat);
		await etat.creer(session());
		const pil = { etat, depot: DEPOT_ABSENT };
		expect((await traiterEvenement(dep, pil, message(10, 'catalogue références'), local)).contexte).toContain('- Avoirs');
		// rien de nouveau : ni consigne, ni position, ni piste
		expect(await traiterEvenement(dep, pil, message(11, 'avoirs des factures'), local)).toEqual({});
		const [j] = await etat.servis(ID, 1);
		expect(j).toMatchObject({ moment: 'message', horodatageMs: 11, texte: '', ids: [], cartes: [], demande: 'avoirs des factures', muet: null, rangMessage: 2 });
		expect(j!.classement).toMatchObject([{ id: AVOIRS, rang: 1, deja: 'proposee', servi: false }]);
		// journal léger : ni titre (relu dans l'index), ni `p` tant qu'il est null
		expect(j!.classement[0]).not.toHaveProperty('titre');
		expect(j!.classement[0]).not.toHaveProperty('p');
		// un message muet sans rien à injecter n'est pas classé, ni journalisé
		expect(await traiterEvenement(dep, pil, message(12, 'ok merci'), local)).toEqual({});
		expect(await etat.servis(ID, 5)).toHaveLength(2);
	});

	it('service : reranker au hook si l’estimation tient ; logit brut au journal et dans la mémoire des porteurs ; sans service, aucun', async () => {
		const { dep, etat, pil } = await memoire();
		const requetes: string[] = [];
		dep.reranker = { noter: async (requete, textes) => (requetes.push(requete), textes.map(() => 1.5)) };
		const duree = dureeDuReranker();
		duree.noter({ documents: 5, ms: 35 });
		duree.noter({ documents: 10, ms: 60 });
		duree.noter({ documents: 5, ms: 35 });
		const porteurs = porteursRecents();
		await traiterEvenement(dep, pil, message(10, 'catalogue références'), { ...local, dureeReranker: duree, porteurs });
		expect(requetes).toEqual(['catalogue références']);
		const [j] = await etat.servis(ID, 1);
		expect(j!.classement.find((c) => c.id === AVOIRS)!.signaux).toMatchObject({ logit: 1.5 });
		expect(porteurs.lire(ID)!.classement!.get(AVOIRS)).toMatchObject({ signaux: { logit: 1.5 } });
		// hook local (sans service) : pas d'estimation, pas de reranker
		await traiterEvenement(dep, pil, message(11, 'catalogue références'), local);
		expect(requetes).toHaveLength(1);
		expect((await etat.servis(ID, 1))[0]!.classement.find((c) => c.id === AVOIRS)!.signaux).not.toHaveProperty('logit');
	});

	it('service sans estimation fiable : le reranker est mesuré après la réponse (rien d’autre) ; le logit vient dès le message suivant', async () => {
		const { dep, etat, pil } = await memoire();
		for (const [i, chemin] of ['tarifs', 'remises', 'devis', 'acomptes'].entries()) {
			await dep.coffre.ecrire(`projets/vela/${chemin}.md`, `${entete()}# Catalogue ${chemin}\n\nRéférence ${i} du catalogue.\n`);
		}
		const appels: { textes: number; operation: string | undefined; demarrer: boolean }[] = [];
		const duree = dureeDuReranker();
		const brut: Reranker = {
			noter: async (_requete, textes, o) => (appels.push({ textes: textes.length, operation: o.activite?.operation, demarrer: o.demarrer }), textes.map(() => 0.5)),
		};
		dep.reranker = duree.envelopper(brut);
		const taches: Promise<unknown>[] = [];
		const service = { ...local, dureeReranker: duree, enFond: (t: Promise<unknown>) => void taches.push(t) };
		await traiterEvenement(dep, pil, message(10, 'catalogue références'), service);
		// rien au hook même : la mesure part après la réponse
		expect(appels).toHaveLength(0);
		expect((await etat.servis(ID, 1))[0]!.classement.every((c) => c.signaux?.logit === undefined)).toBe(true);
		await Promise.all(taches);
		// trois appels de mesure (8, 5 et 8 premières : ici les 5 candidates), jamais pour démarrer le modèle
		expect(appels).toEqual([
			{ textes: 5, operation: 'injection', demarrer: false },
			{ textes: 5, operation: 'injection', demarrer: false },
			{ textes: 5, operation: 'injection', demarrer: false },
		]);
		expect(duree.fiable()).toBe(true);
		taches.length = 0;
		await traiterEvenement(dep, pil, message(11, 'catalogue références des remises'), service);
		expect((await etat.servis(ID, 1))[0]!.classement.some((c) => c.signaux?.logit === 0.5)).toBe(true);
		// estimation fiable : plus d'appel de mesure
		expect(taches).toHaveLength(0);
	});

	it('service avec affinage : la demande d’affinage du message journalisé (requête, classement, à mesurer) ; pas d’appel de mesure à part', async () => {
		const { dep, pil } = await memoire();
		const appels: number[] = [];
		const duree = dureeDuReranker();
		dep.reranker = duree.envelopper({ noter: async (_r, textes) => (appels.push(textes.length), textes.map(() => 0.5)) });
		const taches: Promise<unknown>[] = [];
		const demandes: DemandeAffinage[] = [];
		const service = { ...local, dureeReranker: duree, enFond: (t: Promise<unknown>) => void taches.push(t), affiner: (d: DemandeAffinage) => void demandes.push(d) };
		await traiterEvenement(dep, pil, message(10, 'catalogue références'), service);
		await Promise.all(taches);
		expect(appels).toEqual([]);
		expect(demandes).toHaveLength(1);
		expect(demandes[0]).toMatchObject({ session: ID, horodatageMs: 10, requete: 'catalogue références', mesurer: true });
		expect(demandes[0]!.classement.length).toBeGreaterThan(0);
		// un message muet n'est pas journalisé : rien à affiner
		await traiterEvenement(dep, pil, message(11, 'ok merci'), service);
		expect(demandes).toHaveLength(1);
	});

	it('reranker coupé par son échéance, puis base lente : la fiche de position et la fiche demandée partent quand même', async () => {
		const { dep, etat, pil } = await memoire();
		await dep.coffre.ecrire('projets/vela/ristournes.md', `${entete()}# Ristournes\n\nUne ristourne baisse le prix du catalogue.\n`);
		const duree = dureeDuReranker();
		for (let i = 0; i < 3; i++) duree.noter({ documents: 1, ms: 1 });
		let budgetRecu = 0;
		// coupé : comme le client réel, il ne rend rien au-delà du budget qu'il reçoit
		dep.reranker = duree.envelopper({ noter: (_r, _t, o) => ((budgetRecu = o.budgetMs), new Promise((r) => setTimeout(() => r(null), o.budgetMs))) });
		// base lente : chaque écriture du journal prend 110 ms (plus que la marge de sortie seule)
		const lente: EtatSessions = Object.create(etat) as EtatSessions;
		lente.journaliser = async (e) => {
			await new Promise((r) => setTimeout(r, 110));
			return etat.journaliser(e);
		};
		const demandees = fichesDemandees();
		demandees.demander(ID, AVOIRS);
		const debut = Date.now();
		const r = await traiterEvenement(dep, { ...pil, etat: lente }, message(10, 'catalogue références'), { ...local, dureeReranker: duree, demandees, echeance: debut + 500 });
		expect(budgetRecu).toBeGreaterThan(0);
		expect(r.contexte).toContain('### Projet Vela');
		expect(r.contexte).toContain('Un avoir annule une facture.');
		expect(Date.now()).toBeLessThan(debut + 500);
		expect((await etat.fichesServiesLuesOuEcrites(ID)).map((f) => f.chemin).sort()).toEqual([AVOIRS, VELA].sort());
	});

	it('journal : `ms` depuis le démarrage du hook, `msService` depuis l’appel reçu par le service ; sans service, pas de `msService`', async () => {
		const { dep, etat, pil } = await memoire();
		const maintenant = Date.now();
		await traiterEvenement(dep, pil, message(10, 'catalogue références'), { ...local, debutMs: maintenant - 300, appelMs: maintenant - 20 });
		const [j] = await etat.servis(ID, 1);
		expect(j!.ms).toBeGreaterThanOrEqual(300);
		expect(j!.msService).toBeGreaterThanOrEqual(20);
		expect(j!.msService).toBeLessThan(j!.ms);
		await traiterEvenement(dep, pil, message(11, 'avoirs des factures'), local);
		expect((await etat.servis(ID, 1))[0]).not.toHaveProperty('msService');
	});

	it('requête jointe (réglage interne) : un message court reprend le message porteur d’avant, jamais un muet ; par défaut, le message seul', async () => {
		const { dep, etat, pil } = await memoire();
		const vus: string[] = [];
		dep.sens = { modele: () => 'espion@1', vecteurs: async (textes) => (vus.push(...textes), textes.map(() => Float32Array.from([1, 0]))) };
		await traiterEvenement(dep, pil, message(10, 'les avoirs du catalogue de la refonte'), local);
		await traiterEvenement(dep, pil, message(11, 'ok merci'), local);
		vus.length = 0;
		await traiterEvenement(dep, pil, message(12, 'et pour les factures annulées ?'), { ...local, varianteRequete: 'jointe' });
		expect(vus).toEqual(['les avoirs du catalogue de la refonte\net pour les factures annulées ?']);
		vus.length = 0;
		await traiterEvenement(dep, pil, message(13, 'et pour les factures annulées ?'), local);
		expect(vus).toEqual(['et pour les factures annulées ?']);
		// après un /clear, Claude ne voit plus l'échange d'avant : sa trace au journal (une entrée de début), puis le message seul
		await traiterEvenement(dep, pil, entree('debut', 14, { source: 'clear' }), local);
		expect((await etat.servis(ID, 1))[0]).toMatchObject({ moment: 'debut', horodatageMs: 14, ids: [], texte: '' });
		vus.length = 0;
		await traiterEvenement(dep, pil, message(15, 'et pour les factures annulées ?'), { ...local, varianteRequete: 'jointe' });
		expect(vus).toEqual(['et pour les factures annulées ?']);
	});

	it('note apprise : la requête suit la variante du modèle, l’entrée journalise sa calibration ; modèle refusé : pistes à chaque message, non calibré', async () => {
		const { dep, etat, pil } = await memoire();
		const vus: string[] = [];
		dep.sens = { modele: () => 'espion@1', vecteurs: async (textes) => (vus.push(...textes), textes.map((t) => Float32Array.from([t.includes('avoir') ? 1 : 0.2, 1]))) };
		await synchroniser(dep, SANS_EXTRACTION);
		await vectoriser(dep, { budgetMs: 60_000, demarrer: true });
		const echelle = echelleDesSignaux(dep.reglages().contexte);
		const sens = { ...modeleNonAppris(), apprisLe: '2026-11-25', refus: [], accepte: true, requete: 'jointe' as const, biais: 0, poids: { cosinusRelatif: 1 }, echelle };
		let lectures = 0;
		dep.note = () => (lectures++, { coefficients: { complets: modeleNonAppris(), sens }, installes: { sens: null, reranker: null } });
		const affinages: DemandeAffinage[] = [];
		await traiterEvenement(dep, pil, message(10, 'les avoirs du catalogue de la refonte'), { ...local, affiner: (d) => affinages.push(d) });
		expect((await etat.servis(ID, 1))[0]).toMatchObject({ calibree: true });
		// les modèles sont lus une fois pour le message, et passés à l'affinage ; a priori non lu (hook sans service)
		expect(lectures).toBe(1);
		expect(affinages[0]).toMatchObject({ modeles: { sens: { etat: 'accepte' } }, aprioriConnu: false });
		vus.length = 0;
		await traiterEvenement(dep, pil, message(11, 'et pour les factures annulées ?'), local);
		expect(vus).toEqual(['les avoirs du catalogue de la refonte\net pour les factures annulées ?']);
		// refusé : pas de %, mais une piste à un message qui n'est pas le premier (une fiche nouvelle, au-dessus du seuil)
		const REMISES = 'projets/vela/remises.md';
		await dep.coffre.ecrire(REMISES, `${entete()}# Remises\n\nUne remise devient un avoir.\n`);
		await synchroniser(dep, SANS_EXTRACTION);
		await vectoriser(dep, { budgetMs: 60_000, demarrer: true });
		dep.note = () => ({ coefficients: { complets: modeleNonAppris(), sens: { ...sens, accepte: false, requete: 'seule' as const } }, installes: { sens: null, reranker: null } });
		const r = await traiterEvenement(dep, pil, message(12, 'quel montant pour la refonte du catalogue en avoir'), local);
		const j = (await etat.servis(ID, 1))[0]!;
		expect(j.calibree).toBe(false);
		expect(j.classement.every((c) => c.p === undefined)).toBe(true);
		expect(j.classement.find((c) => c.id === REMISES)).toMatchObject({ piste: true, raison: 'perimetre' });
		expect(r.contexte).toContain('- Remises — projets/vela/remises.md');
		// déjà proposée : classée, jamais reproposée
		expect(j.classement.find((c) => c.id === AVOIRS)).toMatchObject({ deja: 'proposee' });
	});

	it('hook local sans service : une écartée toujours (active) sort des candidates, une rétablie y revient ; a priori 0', async () => {
		const { dep, etat, pil } = await memoire();
		await dep.coffre.ecrire('projets/vela/ristournes.md', `${entete()}# Ristournes\n\nUne ristourne baisse le prix.\n`);
		await etat.ecarterToujours({ fiche: AVOIRS, session: null, horodatageMs: 5 });
		const r = await traiterEvenement(dep, pil, message(10, 'catalogue références'), local);
		expect(r.contexte).not.toContain('Avoirs');
		const premier = (await etat.servis(ID, 1))[0]!.classement;
		expect(premier.map((c) => c.id)).toEqual(['projets/vela/ristournes.md']);
		expect(premier[0]!.signaux?.apriori).toBe(0);
		await etat.retablirToujours(AVOIRS, 6);
		await traiterEvenement(dep, pil, message(11, 'catalogue références'), local);
		expect((await etat.servis(ID, 1))[0]!.classement.map((c) => c.id)).toContain(AVOIRS);
	});

	it('service : a priori des gestes d’une autre session dans les signaux journalisés ; écartées lues dans la base tant qu’il n’est pas chargé', async () => {
		const { dep, etat, pil } = await memoire();
		await dep.coffre.ecrire('projets/vela/ristournes.md', `${entete()}# Ristournes\n\nUne ristourne baisse le prix.\n`);
		const AUTRE = '22222222-2222-4333-8444-555555555555';
		await etat.creer(session({ id: AUTRE }));
		await etat.noterGeste({ geste: 'injectee_main', session: AUTRE, fiche: AVOIRS, empreinte: null, horodatageMs: 5 });
		const apriori = aprioriDesGestes(etat, { horloge: () => 10 });
		// pas encore chargé : l'écartée toujours est relue dans la base
		await etat.ecarterToujours({ fiche: 'projets/vela/ristournes.md', session: null, horodatageMs: 6 });
		expect(apriori.charge()).toBe(false);
		await traiterEvenement(dep, pil, message(10, 'catalogue références'), { ...local, apriori });
		expect((await etat.servis(ID, 1))[0]!.classement.map((c) => c.id)).toEqual([AVOIRS]);
		await etat.retablirToujours('projets/vela/ristournes.md', 7);
		await apriori.actualiser({ ecartees: true });
		await traiterEvenement(dep, pil, message(11, 'catalogue références'), { ...local, apriori });
		const classement = (await etat.servis(ID, 1))[0]!.classement;
		const avoirs = classement.find((c) => c.id === AVOIRS)!;
		expect(avoirs.signaux?.apriori).toBeGreaterThan(0);
		// arrondi à 4 décimales, comme les autres signaux
		expect(avoirs.signaux?.apriori).toBe(Math.round(avoirs.signaux!.apriori! * 10_000) / 10_000);
		expect(classement.find((c) => c.id === 'projets/vela/ristournes.md')?.signaux?.apriori).toBe(0);
		// l'a priori ne décide rien : même ordre que sans lui
		await traiterEvenement(dep, pil, message(12, 'catalogue références'), local);
		expect((await etat.servis(ID, 1))[0]!.classement.map((c) => c.id)).toEqual(classement.map((c) => c.id));
	});

	it('message muet (balise) : consignes seules, journal muet « balise », aucune carte notée', async () => {
		const { dep, etat, pil } = await memoire();
		// la fiche de position est déjà servie : seules les consignes restent
		const vela = (await servirQuestion(dep, 'projets/vela', 'catalogue')).calcul.position!;
		await etat.noterFicheServieLueOuEcrite(ID, { chemin: vela.chemin, action: 'servie', horodatageMs: 5, empreinte: vela.empreinte });
		const r = await traiterEvenement(dep, pil, message(10, '<task-notification>Avoirs catalogue</task-notification>'), local);
		expect(r.contexte).toContain('Réponds en français.');
		expect(r.contexte).not.toContain('Pistes de Mnemo');
		expect(r.contexte).not.toContain('###');
		expect(await etat.cartesProposees(ID)).toEqual(new Map());
		expect(await etat.perimetrePropose(ID)).toBeNull();
		expect((await etat.servis(ID, 1))[0]).toMatchObject({ muet: 'balise', cartes: [] });
	});

	it('message muet sans consigne ni fiche à servir : {} et rien de journalisé', async () => {
		const dep = fauxPorts();
		const etat = ouvrirEtat(join(await dossierTemporaire(), 'etat.sqlite'));
		ouverts.push(etat);
		await etat.creer(session());
		const r = await traiterEvenement(dep, { etat, depot: DEPOT_ABSENT }, message(10, '<task-notification>fini</task-notification>'), local);
		expect(r).toEqual({});
		expect(await etat.servis(ID, 5)).toEqual([]);
	});

	it('premier message muet : fiche de position sans cartes ; le message porteur suivant reçoit les cartes du périmètre', async () => {
		const { dep, etat, pil } = await memoire();
		const muet = await traiterEvenement(dep, pil, message(10, 'ok merci'), local);
		expect(muet.contexte).toContain('### Projet Vela');
		expect(muet.contexte).not.toContain('Pistes de Mnemo');
		expect(await etat.perimetrePropose(ID)).toBeNull();
		expect((await etat.servis(ID, 1))[0]).toMatchObject({ muet: 'sans_contenu', cartes: [] });
		const porteur = await traiterEvenement(dep, pil, message(11, 'catalogue références'), local);
		expect(porteur.contexte).toContain('- Avoirs — projets/vela/avoirs.md');
		expect(porteur.contexte).not.toContain('### Projet Vela');
		expect(await etat.perimetrePropose(ID)).toBe(11);
	});

	it('position sans fiche : le périmètre n’est pas noté proposé (une session rattachée ensuite le recevra)', async () => {
		const { dep, etat, pil } = await contexte({ position: '' });
		const r = await traiterEvenement(dep, pil, message(10, 'catalogue références'), local);
		expect(r.contexte).toContain('Réponds en français.');
		expect(await etat.perimetrePropose(ID)).toBeNull();
	});

	it('/clear puis message porteur : fiche de position et cartes du périmètre de nouveau injectées, même une carte proposée avant', async () => {
		const { dep, etat, pil } = await memoire();
		const premier = await traiterEvenement(dep, pil, message(10, 'catalogue références'), local);
		expect(premier.contexte).toContain('- Avoirs');
		await traiterEvenement(dep, pil, entree('debut', 11, { source: 'clear' }), local);
		expect(await etat.perimetrePropose(ID)).toBeNull();
		const apres = await traiterEvenement(dep, pil, message(12, 'catalogue références'), local);
		expect(apres.contexte).toContain('### Projet Vela');
		expect(apres.contexte).toContain('- Avoirs — projets/vela/avoirs.md');
		expect(await etat.perimetrePropose(ID)).toBe(12);
	});
});

describe('traiterEvenement : poids d’une fiche injectée à la main', () => {
	const AVOIRS = 'projets/vela/avoirs.md';
	// hors du périmètre de Vela (ni rangée sous lui, ni reliée à sa fiche) : seulement voisine d'Avoirs
	const FACTURES = 'pratiques/factures.md';
	const message = (h: number, prompt: string) => entree('message', h, { prompt });

	async function memoire() {
		const c = await contexte();
		await c.dep.coffre.ecrire(AVOIRS, `${entete()}# Avoirs\n\nUn avoir annule une facture.\n\n## Relations\n- concerne [[Factures]]\n`);
		await c.dep.coffre.ecrire(FACTURES, `${entete()}# Factures\n\nUne facture se numérote sans trou.\n`);
		const demandees = fichesDemandees();
		return { ...c, demandees, reglages: { ...local, demandees } };
	}

	it('le message qui porte la fiche propose sa voisine hors périmètre, « liée à » elle ; journal et état le gardent', async () => {
		const { dep, etat, pil, demandees, reglages } = await memoire();
		const premier = await traiterEvenement(dep, pil, message(10, 'catalogue références'), reglages);
		expect(premier.contexte).toContain('- Avoirs — projets/vela/avoirs.md');
		expect(premier.contexte).not.toContain('Factures —');
		demandees.demander(ID, AVOIRS);
		const r = await traiterEvenement(dep, pil, message(11, 'catalogue références'), reglages);
		expect(r.contexte).toContain('Un avoir annule une facture.');
		expect(r.contexte).toContain('- Factures — pratiques/factures.md — Une facture se numérote sans trou. (sujet, liée à Avoirs)');
		expect((await etat.servis(ID, 1))[0]!.cartes).toEqual([{ chemin: FACTURES, raison: 'liee', depuis: AVOIRS }]);
		expect(await etat.injectionsManuelles(ID)).toEqual([{ chemin: AVOIRS, messages: 0 }]);
	});

	it('âge en messages porteurs : un message muet ne compte pas ; réinjecter fait repartir de 0 ; /clear efface tout', async () => {
		const { dep, etat, pil, demandees, reglages } = await memoire();
		demandees.demander(ID, AVOIRS);
		await traiterEvenement(dep, pil, message(10, 'catalogue références'), reglages);
		expect(await etat.injectionsManuelles(ID)).toEqual([{ chemin: AVOIRS, messages: 0 }]);
		await traiterEvenement(dep, pil, message(11, 'ok merci'), reglages);
		await traiterEvenement(dep, pil, message(12, '<task-notification>fini</task-notification>'), reglages);
		expect(await etat.injectionsManuelles(ID)).toEqual([{ chemin: AVOIRS, messages: 0 }]);
		await traiterEvenement(dep, pil, message(13, 'catalogue références'), reglages);
		await traiterEvenement(dep, pil, message(14, 'les remises du catalogue'), reglages);
		expect(await etat.injectionsManuelles(ID)).toEqual([{ chemin: AVOIRS, messages: 2 }]);
		demandees.demander(ID, AVOIRS);
		await traiterEvenement(dep, pil, message(15, 'catalogue références'), reglages);
		expect(await etat.injectionsManuelles(ID)).toEqual([{ chemin: AVOIRS, messages: 0 }]);
		await traiterEvenement(dep, pil, entree('debut', 16, { source: 'clear' }), reglages);
		expect(await etat.injectionsManuelles(ID)).toEqual([]);
	});

	it('après /clear, plus de poids : la voisine n’est plus proposée avec le périmètre', async () => {
		const { dep, etat, pil, demandees, reglages } = await memoire();
		demandees.demander(ID, AVOIRS);
		const avant = await traiterEvenement(dep, pil, message(10, 'catalogue références'), reglages);
		expect(avant.contexte).toContain('(sujet, liée à Avoirs)');
		await traiterEvenement(dep, pil, entree('debut', 11, { source: 'clear' }), reglages);
		const apres = await traiterEvenement(dep, pil, message(12, 'catalogue références'), reglages);
		expect(apres.contexte).toContain('- Avoirs — projets/vela/avoirs.md');
		expect(apres.contexte).not.toContain('Factures —');
		expect((await etat.servis(ID, 1))[0]!.cartes).toEqual([{ chemin: AVOIRS, raison: 'perimetre' }]);
	});
});

describe('traiterEvenement : injection automatique', () => {
	const AVOIRS = 'projets/vela/avoirs.md';
	const VOISINE = 'projets/vela/remises.md';
	const message = (h: number, prompt: string) => entree('message', h, { prompt });
	const sensParMots: Sens = {
		modele: () => 'mots@1',
		vecteurs: async (textes) => textes.map((t) => Float32Array.from([...['avoir', 'remise', 'catalogue'].map((m) => t.toLowerCase().split(m).length - 1), 0.01])),
	};
	const modele = (surcharge: object = {}) => ({
		...modeleNonAppris(),
		apprisLe: '2026-11-25T10:00:00.000Z',
		refus: [],
		accepte: true,
		echelle: echelleDesSignaux(REGLAGES_PAR_DEFAUT.contexte),
		biais: -3,
		poids: { bm25Relatif: 6, cosinusRelatif: 0.5 },
		...surcharge,
	});

	async function memoire() {
		const c = await contexte();
		await c.dep.coffre.ecrire(AVOIRS, `${entete()}# Avoirs\n\nUn avoir annule une facture.\n\n## Relations\n- concerne [[Remises]]\n`);
		await c.dep.coffre.ecrire(VOISINE, `${entete()}# Remises\n\nUne remise baisse le prix.\n`);
		await synchroniser(c.dep, SANS_EXTRACTION);
		c.dep.sens = sensParMots;
		await vectoriser(c.dep, { budgetMs: 60_000, demarrer: true });
		c.dep.note = () => ({ coefficients: { complets: modeleNonAppris(), sens: modele() }, installes: { sens: null, reranker: null } });
		return c;
	}

	it('geste `injectee_auto` (niveau, ligne du classement, vecteur), notée servie et au journal ; aucun poids sur les voisines', async () => {
		const { dep, etat, pil } = await memoire();
		const r = await traiterEvenement(dep, pil, message(10, 'montant exact des avoirs annulés en novembre'), local);
		expect(r.contexte).toContain('## Fiches injectées par Mnemo');
		expect(r.contexte).toContain('Un avoir annule une facture.');
		const [j] = await etat.servis(ID, 1);
		expect(j!.ids).toContain(AVOIRS);
		expect(j!.classement.find((c) => c.id === AVOIRS)).toMatchObject({ auto: true });
		expect((await etat.fichesServiesLuesOuEcrites(ID)).find((f) => f.chemin === AVOIRS)).toMatchObject({ derniereAction: 'servie' });
		const gestes = await etat.gestes({ limite: null });
		expect(gestes.map((g) => g.geste)).toEqual(['injectee_auto']);
		expect(gestes[0]).toMatchObject({ fiche: AVOIRS, origine: 'auto', rangMessage: 1 });
		expect(gestes[0]!.note).toMatchObject({ niveau: 'sens', auto: true, p: expect.any(Number) });
		expect(gestes[0]!.vecteur).not.toBeNull();
		// jamais une injection à la main : aucune voisine ne prend de poids
		expect(await etat.injectionsManuelles(ID)).toEqual([]);
		const suivant = await traiterEvenement(dep, pil, message(11, 'montant exact des remises accordées en novembre'), local);
		expect((await etat.servis(ID, 1))[0]!.cartes.every((c) => c.raison !== 'liee')).toBe(true);
		// une fois par session
		expect(suivant.contexte ?? '').not.toContain('Un avoir annule une facture.');
		// le même message encore : la fiche passerait sans la trace « servie » (au seuil, au-dessus de la garde), elle ne repart pas
		const encore = await traiterEvenement(dep, pil, message(12, 'montant exact des avoirs annulés en novembre'), local);
		expect(encore.contexte ?? '').not.toContain('Un avoir annule une facture.');
		const ligne = (await etat.servis(ID, 1))[0]!.classement.find((c) => c.id === AVOIRS)!;
		expect(ligne.p).toBeGreaterThanOrEqual(REGLAGES_PAR_DEFAUT.contexte.seuilInjection / 100);
		expect(ligne.pSansApriori ?? ligne.p).toBeGreaterThanOrEqual(0.7);
		expect(ligne.auto).toBeUndefined();
		// Avoirs une seule fois (la deuxième injection est celle de Remises, au message sur les remises)
		expect((await etat.gestes({ sortes: ['injectee_auto'], limite: null })).map((g) => g.fiche).filter((f) => f === AVOIRS)).toEqual([AVOIRS]);
	});

	it('service : la trace « servie » et le geste attendent que la route ait livré la réponse (`aLaReponse`)', async () => {
		const { dep, etat, pil } = await memoire();
		const apres: (() => Promise<unknown>)[] = [];
		const enFond: Promise<unknown>[] = [];
		const r = await traiterEvenement(dep, pil, message(10, 'montant exact des avoirs annulés en novembre'), { ...local, enFond: (t) => enFond.push(t), aLaReponse: (t) => apres.push(t) });
		expect(r.contexte).toContain('Fiches injectées par Mnemo');
		await Promise.all(enFond);
		expect(await etat.gestes({ limite: null })).toEqual([]);
		expect((await etat.fichesServiesLuesOuEcrites(ID)).some((f) => f.chemin === AVOIRS)).toBe(false);
		expect(apres).toHaveLength(1);
		await apres[0]!();
		expect((await etat.gestes({ limite: null })).map((g) => g.geste)).toEqual(['injectee_auto']);
		expect((await etat.fichesServiesLuesOuEcrites(ID)).some((f) => f.chemin === AVOIRS)).toBe(true);
	});

	describe('plus le temps de répondre après les écritures, avec une injection automatique décidée', () => {
		afterEach(() => vi.restoreAllMocks());
		for (const avecService of [false, true]) {
			it(`${avecService ? 'service' : 'sans service'} : la position et les fiches demandées notées partent quand même ; seule la fiche auto est retirée`, async () => {
				const { dep, etat, pil } = await memoire();
				const demandees = fichesDemandees();
				demandees.demander(ID, VOISINE);
				const echeance = Date.now() + 10_000;
				// le journal écrit, l'échéance est passée : le dernier contrôle échoue
				const reel = Date.now.bind(Date);
				let decalage = 0;
				vi.spyOn(Date, 'now').mockImplementation(() => reel() + decalage);
				const journaliser = etat.journaliser.bind(etat);
				etat.journaliser = async (e) => {
					await journaliser(e);
					decalage = echeance + 1 - reel();
				};
				const apres: (() => Promise<unknown>)[] = [];
				const service = avecService ? { enFond: () => {}, aLaReponse: (t: () => Promise<unknown>) => apres.push(t) } : {};
				const r = await traiterEvenement(dep, pil, message(10, 'montant exact des avoirs annulés en novembre'), { ...local, echeance, demandees, ...service });
				// ce qui est noté servi part : la position et la fiche demandée ; la fiche auto, non
				expect(r.contexte).toContain('Refonte du catalogue.');
				expect(r.contexte).toContain('Une remise baisse le prix.');
				expect(r.contexte).not.toContain('Fiches injectées par Mnemo');
				expect(r.contexte).not.toContain('Un avoir annule une facture.');
				const [j] = await etat.servis(ID, 1);
				expect(j!.classement.some((c) => c.auto === true)).toBe(false);
				expect(j!.ids).not.toContain(AVOIRS);
				expect(apres).toEqual([]);
				expect(await etat.gestes({ sortes: ['injectee_auto'], limite: null })).toEqual([]);
				expect((await etat.fichesServiesLuesOuEcrites(ID)).some((f) => f.chemin === AVOIRS)).toBe(false);
				// la fiche demandée n'est pas remise : partie, elle n'est jamais notée deux fois
				expect(demandees.voir(ID)).toEqual([]);
				vi.restoreAllMocks();
				const suivant = await traiterEvenement(dep, pil, message(11, 'montant exact des avoirs annulés en novembre'), { ...local, demandees });
				expect(suivant.contexte ?? '').not.toContain('Une remise baisse le prix.');
				expect((await etat.gestes({ sortes: ['injectee_main'], limite: null })).map((g) => g.fiche)).toEqual([VOISINE]);
				expect(await etat.injectionsManuelles(ID)).toHaveLength(1);
				// la fiche auto, elle, part à ce message
				expect(suivant.contexte).toContain('Un avoir annule une facture.');
			});
		}
	});

	describe('sans service, moins de MARGE_ECRITURE_MS après les écritures : pas le temps d’écrire les traces avant de répondre', () => {
		afterEach(() => vi.restoreAllMocks());
		for (const avecService of [false, true]) {
			it(`${avecService ? 'service (traces après la livraison) : elle part' : 'sans service : seule la fiche auto est retirée, elle reste injectable'}`, async () => {
				const { dep, etat, pil } = await memoire();
				const echeance = Date.now() + 10_000;
				const reel = Date.now.bind(Date);
				let decalage = 0;
				vi.spyOn(Date, 'now').mockImplementation(() => reel() + decalage);
				const journaliser = etat.journaliser.bind(etat);
				// le journal écrit, il reste 10 ms : assez pour répondre, pas pour écrire les traces d'abord
				etat.journaliser = async (e) => {
					await journaliser(e);
					decalage = echeance - 10 - reel();
				};
				const apres: (() => Promise<unknown>)[] = [];
				const service = avecService ? { enFond: () => {}, aLaReponse: (t: () => Promise<unknown>) => apres.push(t) } : {};
				const r = await traiterEvenement(dep, pil, message(10, 'montant exact des avoirs annulés en novembre'), { ...local, echeance, ...service });
				if (avecService) {
					expect(r.contexte).toContain('Un avoir annule une facture.');
					expect(apres).toHaveLength(1);
				} else {
					// la position part ; la fiche auto est retirée (pas le temps d'écrire ses traces d'abord)
					expect(r.contexte).toContain('Refonte du catalogue.');
					expect(r.contexte).not.toContain('Un avoir annule une facture.');
					expect(await etat.gestes({ sortes: ['injectee_auto'], limite: null })).toEqual([]);
					expect((await etat.fichesServiesLuesOuEcrites(ID)).some((f) => f.chemin === AVOIRS)).toBe(false);
				}
			});
		}
	});

	describe('plus le temps d’écrire les traces d’une injection automatique', () => {
		afterEach(() => vi.restoreAllMocks());
		/** La lecture de la fiche pour l'injecter amène l'horloge à `resteMs` de l'échéance du hook. */
		function horlogeAuBord(dep: Awaited<ReturnType<typeof memoire>>['dep'], echeance: number, resteMs: number) {
			const reel = Date.now.bind(Date);
			let decalage = 0;
			vi.spyOn(Date, 'now').mockImplementation(() => reel() + decalage);
			const lire = dep.coffre.lire.bind(dep.coffre);
			dep.coffre.lire = async (chemin) => {
				const texte = await lire(chemin);
				if (chemin === AVOIRS && decalage === 0) decalage = echeance - resteMs - reel();
				return texte;
			};
		}
		for (const avecService of [false, true]) {
			it(`${avecService ? 'service' : 'sans service'} : la fiche ne part pas ; ni servie, ni journalisée \`auto\`, ni geste ; injectable au message suivant`, async () => {
				const { dep, etat, pil } = await memoire();
				const echeance = Date.now() + 10_000;
				// assez pour noter le reste et répondre (MARGE_ECRITURE_MS), pas pour les traces de l'injection automatique
				horlogeAuBord(dep, echeance, 45);
				const apres: (() => Promise<unknown>)[] = [];
				const service = avecService ? { enFond: () => {}, aLaReponse: (t: () => Promise<unknown>) => apres.push(t) } : {};
				const r = await traiterEvenement(dep, pil, message(10, 'montant exact des avoirs annulés en novembre'), { ...local, echeance, ...service });
				expect(r.contexte ?? '').not.toContain('Fiches injectées par Mnemo');
				expect(r.contexte ?? '').not.toContain('Un avoir annule une facture.');
				expect(apres).toEqual([]);
				expect(await etat.gestes({ limite: null })).toEqual([]);
				expect((await etat.fichesServiesLuesOuEcrites(ID)).some((f) => f.chemin === AVOIRS)).toBe(false);
				const [j] = await etat.servis(ID, 1);
				expect(j!.ids).not.toContain(AVOIRS);
				expect(j!.classement.some((c) => c.auto === true)).toBe(false);
				vi.restoreAllMocks();
				// le message suivant, avec le temps : elle part
				expect((await traiterEvenement(dep, pil, message(11, 'montant exact des avoirs annulés en novembre'), local)).contexte).toContain('Un avoir annule une facture.');
			});
		}
	});

	it('a priori pas encore chargé par le service (démarrage, lecture en échec) : une note qui le pèse n’est pas calibrée, rien n’est injecté', async () => {
		const { dep, etat, pil } = await memoire();
		dep.note = () => ({ coefficients: { complets: modeleNonAppris(), sens: modele({ poids: { bm25Relatif: 6, cosinusRelatif: 0.5, apriori: 0.1 } }) }, installes: { sens: null, reranker: null } });
		const apriori = aprioriDesGestes(etat);
		expect(apriori.charge()).toBe(false);
		const avant = await traiterEvenement(dep, pil, message(10, 'montant exact des avoirs annulés en novembre'), { ...local, apriori });
		expect(avant.contexte ?? '').not.toContain('Fiches injectées par Mnemo');
		expect((await etat.servis(ID, 1))[0]).toMatchObject({ calibree: false });
		await apriori.actualiser({ ecartees: true });
		const apres = await traiterEvenement(dep, pil, message(11, 'montant exact des avoirs annulés en novembre'), { ...local, apriori });
		expect(apres.contexte).toContain('Fiches injectées par Mnemo');
	});

	describe('fiche injectée par Mnemo retirée faute de temps : remise au message porteur suivant', () => {
		afterEach(() => vi.restoreAllMocks());
		const PROMPT = 'montant exact des avoirs annulés en novembre';
		/** À la lecture d'Avoirs pour l'injecter, l'horloge saute à `resteMs` de l'échéance (une fois). */
		function horlogeAuBord(dep: Awaited<ReturnType<typeof memoire>>['dep'], echeance: number, resteMs: number) {
			const reel = Date.now.bind(Date);
			let decalage = 0;
			vi.spyOn(Date, 'now').mockImplementation(() => reel() + decalage);
			const lire = dep.coffre.lire.bind(dep.coffre);
			dep.coffre.lire = async (chemin) => {
				const texte = await lire(chemin);
				if (chemin === AVOIRS && decalage === 0) decalage = echeance - resteMs - reel();
				return texte;
			};
			return () => {
				vi.restoreAllMocks();
				dep.coffre.lire = lire;
			};
		}
		async function retiree(echeanceDansMs = 10_000) {
			const c = await memoire();
			const remises = fichesDemandees();
			const echeance = Date.now() + echeanceDansMs;
			const retablir = horlogeAuBord(c.dep, echeance, 45);
			const r = await traiterEvenement(c.dep, c.pil, message(10, PROMPT), { ...local, echeance, remises });
			retablir();
			expect(r.contexte ?? '').not.toContain('Un avoir annule une facture.');
			return { ...c, remises };
		}

		it('remise au message porteur suivant, notée à nouveau et injectée ; un message muet entre-temps ne la prend pas', async () => {
			const { dep, etat, pil, remises } = await retiree();
			expect(remises.voir(ID)).toEqual([AVOIRS]);
			await traiterEvenement(dep, pil, message(11, 'ok'), { ...local, remises });
			expect(remises.voir(ID)).toEqual([AVOIRS]);
			const r = await traiterEvenement(dep, pil, message(12, PROMPT), { ...local, remises });
			expect(r.contexte).toContain('Un avoir annule une facture.');
			expect(remises.voir(ID)).toEqual([]);
			expect((await etat.gestes({ sortes: ['injectee_auto'], limite: null })).map((g) => g.fiche)).toEqual([AVOIRS]);
		});

		it('remise aussi quand elle est retirée après les écritures', async () => {
			const { dep, etat, pil } = await memoire();
			const remises = fichesDemandees();
			const echeance = Date.now() + 10_000;
			const reel = Date.now.bind(Date);
			let decalage = 0;
			vi.spyOn(Date, 'now').mockImplementation(() => reel() + decalage);
			const journaliser = etat.journaliser.bind(etat);
			etat.journaliser = async (e) => {
				await journaliser(e);
				decalage = echeance + 1 - reel();
			};
			const r = await traiterEvenement(dep, pil, message(10, PROMPT), { ...local, echeance, remises });
			expect(r.contexte ?? '').not.toContain('Un avoir annule une facture.');
			expect(remises.voir(ID)).toEqual([AVOIRS]);
		});

		it('pour un seul message suivant : retirée encore, elle n’est pas remise une seconde fois', async () => {
			const { dep, pil, remises } = await retiree();
			const echeance = Date.now() + 10_000;
			const retablir = horlogeAuBord(dep, echeance, 45);
			await traiterEvenement(dep, pil, message(11, PROMPT), { ...local, echeance, remises });
			retablir();
			expect(remises.voir(ID)).toEqual([]);
		});

		it('un /clear l’efface ; une autre session ne la reçoit pas', async () => {
			const { dep, etat, pil, remises } = await retiree();
			const AUTRE = '44444444-2222-4333-8444-555555555555';
			await etat.creer(session({ id: AUTRE }));
			await traiterEvenement(dep, pil, entree('message', 11, { session: AUTRE, prompt: 'bonjour, une question sur le catalogue' }), { ...local, remises });
			expect(remises.voir(ID)).toEqual([AVOIRS]);
			await traiterEvenement(dep, pil, entree('debut', 12, { source: 'clear' }), { ...local, remises });
			expect(remises.voir(ID)).toEqual([]);
		});
	});

	it('session inconnue : aucune injection automatique', async () => {
		const { dep, etat, pil } = await memoire();
		const r = await traiterEvenement(dep, pil, message(10, 'montant exact des avoirs annulés en novembre'), local);
		expect(r.contexte).toContain('Fiches injectées par Mnemo');
		const inconnue = await traiterEvenement(dep, pil, entree('message', 11, { session: '99999999-2222-4333-8444-555555555555', prompt: 'montant exact des avoirs annulés en novembre' }), local);
		expect(inconnue.contexte ?? '').not.toContain('Fiches injectées par Mnemo');
		expect((await etat.gestes({ limite: null })).map((g) => g.geste)).toEqual(['injectee_auto']);
	});

	it('chaîne complète, après l’apprentissage : hook → geste `injectee_auto` → écart → coupure ; le suivi du service la tient sans relire au hook', async () => {
		const { dep, etat, pil } = await memoire();
		const T = Date.parse('2026-11-25T11:00:00.000Z');
		const PROMPT = 'montant exact des avoirs annulés en novembre';
		// 17 sessions : Avoirs injectée par le hook dans chacune, puis écartée ici par l'utilisateur
		for (let i = 0; i < 17; i++) {
			const id = `${String(i + 10).padStart(8, '0')}-2222-4333-8444-555555555555`;
			await etat.creer(session({ id }));
			const r = await traiterEvenement(dep, pil, entree('message', T + i * 1000, { session: id, prompt: PROMPT }), local);
			expect(r.contexte).toContain('Un avoir annule une facture.');
			await noterGeste(dep, etat, { geste: 'ecartee_ici', session: id, fiche: AVOIRS, empreinte: null, horodatageMs: T + i * 1000 + 500 });
		}
		const gestes = await etat.gestes({ sortes: ['injectee_auto'], limite: null });
		expect(gestes).toHaveLength(17);
		expect(gestes.every((g) => g.horodatageMs > Date.parse('2026-11-25T10:00:00.000Z') && g.note?.['niveau'] === 'sens')).toBe(true);
		expect((await coupuresDesInjections(etat, modelesActifs(dep))).sens).toMatchObject({ injections: 17, ecartees: 17 });
		// sans service : coupée au message suivant (lecture bornée)
		expect((await traiterEvenement(dep, pil, message(T + 20_000, PROMPT), local)).contexte ?? '').not.toContain('Fiches injectées par Mnemo');
		// le service : l'état tenu en mémoire ; le hook ne lit plus le journal des gestes
		const changements: unknown[] = [];
		const suivi = suiviDesInjections(etat, () => modelesActifs(dep), (c) => void changements.push(c));
		await suivi.actualiser();
		expect(changements).toHaveLength(1);
		const lire = vi.spyOn(etat, 'gestes');
		const AUTRE = '33333333-2222-4333-8444-555555555555';
		await etat.creer(session({ id: AUTRE }));
		const r = await traiterEvenement(dep, pil, entree('message', T + 30_000, { session: AUTRE, prompt: PROMPT }), { ...local, suivi });
		expect(r.contexte ?? '').not.toContain('Fiches injectées par Mnemo');
		expect(lire.mock.calls.filter(([f]) => f.sortes?.includes('injectee_auto') === true)).toEqual([]);
		lire.mockRestore();
	});

	it('suivi : une série d’écarts après les injections coupe le niveau sans intervention ; réactivé par l’utilisateur ou un nouvel apprentissage', async () => {
		const { dep, etat, pil } = await memoire();
		const AUTRE = '22222222-2222-4333-8444-555555555555';
		await etat.creer(session({ id: AUTRE }));
		// 17 fiches injectées par Mnemo dans une autre session, puis écartées : la fenêtre ne peut plus passer
		for (let i = 0; i < 17; i++) {
			await etat.noterGeste({ geste: 'injectee_auto', session: AUTRE, fiche: `notes/n${i}.md`, empreinte: null, horodatageMs: Date.parse('2026-11-25T11:00:00.000Z') + i, note: { niveau: 'sens' } });
			await etat.noterGeste({ geste: 'ecartee_ici', session: AUTRE, fiche: `notes/n${i}.md`, empreinte: null, horodatageMs: Date.parse('2026-11-25T11:00:00.000Z') + i, note: null });
		}
		// le filtre du suivi : ses sortes, sans vecteur
		const lus = await etat.gestes({ sortes: ['injectee_auto'], sansVecteur: true, limite: null });
		expect(lus).toHaveLength(17);
		expect(lus.every((g) => g.vecteur === null && g.geste === 'injectee_auto')).toBe(true);
		const coupee = await traiterEvenement(dep, pil, message(10, 'montant exact des avoirs annulés en novembre'), local);
		expect(coupee.contexte ?? '').not.toContain('Fiches injectées par Mnemo');
		// coupée : les % restent (classement calibré), seule l'injection automatique s'arrête ; la fiche part en piste
		expect((await etat.servis(ID, 1))[0]).toMatchObject({ calibree: true });
		expect(coupee.contexte).toContain(`- Avoirs — ${AVOIRS}`);
		expect((await coupuresDesInjections(etat, modelesActifs(dep))).sens).toMatchObject({ injections: 17, ecartees: 17, motif: '17 des 17 dernières fiches injectées par Mnemo ont été écartées' });
		// réactivée par l'utilisateur, hors session : geste noté, l'injection revient
		expect(await reactiverInjection(etat, modelesActifs(dep), { session: '', horodatageMs: Date.parse('2026-11-25T12:00:00.000Z') })).toEqual(['sens']);
		expect((await etat.gestes({ sortes: ['injection_reactivee'], limite: null }))[0]).toMatchObject({ session: '', fiche: '', note: { niveau: 'sens' } });
		expect(await reactiverInjection(etat, modelesActifs(dep), { session: '', horodatageMs: Date.parse('2026-11-25T12:00:01.000Z') })).toEqual([]);
		expect((await traiterEvenement(dep, pil, message(11, 'montant exact des avoirs annulés en novembre'), local)).contexte).toContain('Fiches injectées par Mnemo');
		// un apprentissage plus récent que la coupure la lève aussi
		const etat2 = await contexte();
		dep.note = () => ({ coefficients: { complets: modeleNonAppris(), sens: modele({ apprisLe: '2026-11-25T13:00:00.000Z' }) }, installes: { sens: null, reranker: null } });
		for (let i = 0; i < 17; i++) await etat2.etat.noterGeste({ geste: 'injectee_auto', session: ID, fiche: `notes/n${i}.md`, empreinte: null, horodatageMs: Date.parse('2026-11-25T11:00:00.000Z') + i, note: { niveau: 'sens' } });
		for (let i = 0; i < 17; i++) await etat2.etat.noterGeste({ geste: 'ecartee_ici', session: ID, fiche: `notes/n${i}.md`, empreinte: null, horodatageMs: Date.parse('2026-11-25T11:30:00.000Z') + i, note: null });
		expect((await coupuresDesInjections(etat2.etat, modelesActifs(dep))).sens).toBeNull();
	});

	it('réactivation pendant une panne de lecture du suivi : aucun geste (coupure inconnue), `SuiviIllisible`', async () => {
		const { dep, etat } = await memoire();
		const noter = vi.spyOn(etat, 'noterGeste');
		const lire = vi.spyOn(etat, 'gestes').mockRejectedValue(new Error('base occupée'));
		await expect(reactiverInjection(etat, modelesActifs(dep), { session: '', horodatageMs: 1 })).rejects.toBeInstanceOf(SuiviIllisible);
		expect(noter).not.toHaveBeenCalled();
		lire.mockRestore();
		noter.mockRestore();
	});

	it('rien après un outil, rien en différé : l’affinage qui met une fiche au seuil ne l’injecte pas', async () => {
		const { dep, etat, pil } = await memoire();
		// Complets accepté (le logit seul décide), Sens seul refusé : sans reranker au hook, rien n'est injecté
		dep.note = () => ({
			coefficients: { complets: modele({ biais: -2, poids: { logit: 1, cosinusRelatif: 0 } }), sens: modele({ accepte: false, refus: ['x'] }) },
			installes: { sens: null, reranker: null },
		});
		const affinages: DemandeAffinage[] = [];
		const r = await traiterEvenement(dep, pil, message(10, 'montant exact des avoirs annulés en novembre'), { ...local, affiner: (d) => affinages.push(d) });
		expect(r.contexte ?? '').not.toContain('Fiches injectées par Mnemo');
		dep.reranker = { noter: async (_q, textes) => textes.map((t) => (t.startsWith('Avoirs') ? 8 : -8)) };
		expect(affinages).toHaveLength(1);
		const fait = await affiner(dep, etat, affinages[0]!);
		expect(fait!.classement.find((c) => c.id === AVOIRS)!.p).toBeGreaterThanOrEqual(0.9);
		expect((await etat.fichesServiesLuesOuEcrites(ID)).some((f) => f.chemin === AVOIRS)).toBe(false);
		expect(await etat.gestes({ limite: null })).toEqual([]);
		expect(await traiterEvenement(dep, pil, entree('apres_outil', 11, { outil: { nom: 'Bash', entree: { command: 'ls' } } }), local)).toEqual({});
		expect(await etat.gestes({ limite: null })).toEqual([]);
	});
});
