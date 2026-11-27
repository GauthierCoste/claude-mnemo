import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { ecarterDuClassement } from '../../src/application/ecarter.ts';
import type { EtatSessions } from '../../src/application/ports.ts';
import type { Session } from '../../src/domaine/session.ts';
import { chmodSync, existsSync, readFileSync, statSync } from 'node:fs';
import { ouvrirEtat, VERSION_ETAT } from '../../src/infra/etat-sqlite.ts';
import { etatParesseux, preparerDossierLocal } from '../../src/infra/systeme.ts';
import { TOLERANCE } from '../aides/charge.ts';
import { dossierTemporaire } from '../aides/dossier-temporaire.ts';

const ouverts: EtatSessions[] = [];
afterEach(() => {
	while (ouverts.length > 0) ouverts.pop()?.fermer();
});

async function ouvrir(): Promise<{ etat: EtatSessions; chemin: string; dossier: string }> {
	const dossier = await dossierTemporaire();
	const chemin = join(dossier, 'etat.sqlite');
	const etat = ouvrirEtat(chemin);
	ouverts.push(etat);
	return { etat, chemin, dossier };
}

/** Retire ce que la version 15 a ajouté (outil d'un dialogue ouvert). */
function sansVersion15(base: DatabaseSync): void {
	base.exec('ALTER TABLE sessions DROP COLUMN dialogue_outil');
}

/**
 * Retire ce que la version 14 a ajouté (journal durable des gestes, écartées toujours, dernier message porteur, rang du
 * message, affinage, durée vue du service et calibration des entrées servies) : un état tel que la 1.6.1 l'écrit.
 */
function sansVersion14(base: DatabaseSync): void {
	sansVersion15(base);
	base.exec('DROP TABLE gestes');
	base.exec('DROP TABLE ecartees_toujours');
	base.exec('ALTER TABLE sessions DROP COLUMN dernier_message');
	for (const colonne of ['rang_message', 'affinage', 'ms_service', 'calibree']) base.exec(`ALTER TABLE servis DROP COLUMN ${colonne}`);
}

/** Retire ce que la version 13 a ajouté (moteur, modèle et fil des sessions). */
function sansVersion13(base: DatabaseSync): void {
	sansVersion14(base);
	for (const colonne of ['moteur', 'modele', 'fil']) base.exec(`ALTER TABLE sessions DROP COLUMN ${colonne}`);
}

/** Retire ce que la version 12 a ajouté (niveau des modèles d'une session). */
function sansVersion12(base: DatabaseSync): void {
	sansVersion13(base);
	base.exec('ALTER TABLE sessions DROP COLUMN niveau_modeles');
}

/** Retire ce que la version 10 a ajouté (injections à la main, compteur de messages porteurs). */
function sansVersion10(base: DatabaseSync): void {
	sansVersion12(base);
	base.exec('DROP TABLE injections_manuelles');
	base.exec('ALTER TABLE sessions DROP COLUMN messages_porteurs');
}

/** Retire ce que les versions 8 à 10 ont ajouté (cartes proposées, journal des actions, journal servi enrichi). */
function sansVersion8(base: DatabaseSync): void {
	sansVersion10(base);
	base.exec('DROP TABLE cartes_proposees');
	base.exec('DROP TABLE actions_fiches');
	for (const colonne of ['muet', 'cartes', 'position']) base.exec(`ALTER TABLE servis DROP COLUMN ${colonne}`);
	base.exec('ALTER TABLE sessions DROP COLUMN perimetre_propose_ms');
}

/** Retire ce que les versions 7 et 8 ont ajouté (fiches de travail des sessions). */
function sansVersion7(base: DatabaseSync): void {
	sansVersion8(base);
	base.exec('DROP TABLE fiches_servies_lues_ecrites');
}

/** Retire ce que les versions 6 et 7 ont ajouté (dossier non rattaché des sessions, liste des dossiers non rattachés). */
function sansVersion6(base: DatabaseSync): void {
	sansVersion7(base);
	base.exec('ALTER TABLE sessions DROP COLUMN dossier_non_rattache');
	base.exec('DROP TABLE dossiers_non_rattaches');
}

/** Retire ce que les versions 5 et 6 ont ajouté (classement et demande des entrées servies, écartés et leur trace). */
function sansVersion5(base: DatabaseSync): void {
	sansVersion6(base);
	base.exec('DROP TABLE ecartes');
	base.exec('DROP TABLE traces_ecartes');
	base.exec('ALTER TABLE servis DROP COLUMN classement');
	base.exec('ALTER TABLE servis DROP COLUMN demande');
}

function session(id: string, champs: Partial<Session> = {}): Session {
	return {
		id,
		profil: 'dev',
		dossier: 'sous/dossier',
		position: 'a/b',
		projet: 'episodes/x',
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

describe('etat.sqlite', () => {
	it('rend une session telle qu\'elle a été créée', async () => {
		const { etat } = await ouvrir();
		const s = session('s1', {
			objectif: 'un objectif',
			arretAttendu: 'pause',
			bilanDemandeMs: 5,
			commitDebut: 'abc',
			branche: 'main',
			pid: 42,
			demarrageMachineMs: 1000,
			lanceMs: 2000,
			vuVivantMs: 3000,
			bilanLuMs: 6,
			dernierArret: 'notification',
			dialogueOutil: 'bash',
			episodeMs: 7,
			dossierNonRattache: true,
		});
		await etat.creer(s);
		expect(await etat.lire('s1')).toEqual(s);
		expect(await etat.lire('inconnue')).toBeNull();
		expect(await etat.lister()).toEqual([s]);
	});

	it('cache les sessions terminées sauf avec archivees', async () => {
		const { etat } = await ouvrir();
		await etat.creer(session('a'));
		await etat.creer(session('b', { etat: 'terminee' }));
		expect((await etat.lister()).map((s) => s.id)).toEqual(['a']);
		expect((await etat.lister({ archivees: true })).map((s) => s.id).sort()).toEqual(['a', 'b']);
	});

	it('applique un événement, pose objectif et complément', async () => {
		const { etat } = await ouvrir();
		await etat.creer(session('s1'));
		const apres = await etat.appliquer('s1', 'message', 10, { objectif: 'but', commitDebut: 'c1', branche: 'dev' });
		expect(apres).toMatchObject({ etat: 'travaille', majMs: 10, objectif: 'but', commitDebut: 'c1', branche: 'dev' });
		// l'objectif n'est posé qu'une fois
		const encore = await etat.appliquer('s1', 'message', 11, { objectif: 'autre' });
		expect(encore?.objectif).toBe('but');
		expect(await etat.appliquer('inconnue', 'message', 1)).toBeNull();
	});

	it('ignore un événement plus ancien', async () => {
		const { etat } = await ouvrir();
		await etat.creer(session('s1'));
		await etat.appliquer('s1', 'message', 3);
		const apres = await etat.appliquer('s1', 'arret', 2);
		expect(apres?.etat).toBe('travaille');
		expect(apres?.majMs).toBe(3);
		expect((await etat.appliquer('s1', 'arret', 3))?.etat).toBe('travaille');
	});

	it('applique fin selon l\'arrêt attendu', async () => {
		const { etat } = await ouvrir();
		await etat.creer(session('s1'));
		await etat.modifier('s1', { arretAttendu: 'pause' });
		expect((await etat.appliquer('s1', 'fin', 5))?.etat).toBe('en_pause');
	});

	it('modifie des champs choisis', async () => {
		const { etat } = await ouvrir();
		await etat.creer(session('s1'));
		const apres = await etat.modifier('s1', { etat: 'en_pause', pid: 7, arretAttendu: 'service', bilanDemandeMs: 9 });
		expect(apres).toMatchObject({ etat: 'en_pause', pid: 7, arretAttendu: 'service', bilanDemandeMs: 9 });
		expect(await etat.modifier('inconnue', { pid: 1 })).toBeNull();
	});

	it('une session terminée garde son état et son arrêt attendu ; ses autres champs restent modifiables', async () => {
		const { etat } = await ouvrir();
		await etat.creer(session('s1', { etat: 'terminee', arretAttendu: 'bilan', pid: 5 }));
		const apres = await etat.modifier('s1', { etat: 'attend', arretAttendu: null, pid: null });
		expect(apres).toMatchObject({ etat: 'terminee', arretAttendu: 'bilan', pid: null });
	});

	it('borne le journal à 200 entrées par session', async () => {
		const { etat } = await ouvrir();
		await etat.creer(session('s1'));
		await etat.creer(session('s2'));
		for (let i = 0; i < 250; i++) {
			await etat.journaliser({ session: 's1', moment: 'message', horodatageMs: i, ids: ['a', 'b'], texte: `t${i}`, ms: i, sens: i % 2 === 0, demande: null, classement: [], muet: null, cartes: [], position: null });
		}
		await etat.journaliser({ session: 's2', moment: 'debut', horodatageMs: 1, ids: [], texte: 'x', ms: 1, sens: false, demande: null, classement: [], muet: null, cartes: [], position: null });
		const tous = await etat.servis('s1', 1000);
		expect(tous).toHaveLength(200);
		// une entrée de message non muette reçoit le rang du dernier message porteur de la session (0 : aucun)
		expect(tous[0]).toEqual({ session: 's1', moment: 'message', horodatageMs: 249, ids: ['a', 'b'], texte: 't249', ms: 249, sens: false, demande: null, classement: [], muet: null, cartes: [], position: null, rangMessage: 0 });
		expect(tous[199]?.horodatageMs).toBe(50);
		expect(await etat.servis('s1', 3)).toHaveLength(3);
		expect(await etat.servis('s2', 10)).toHaveLength(1);
		expect(await etat.servis('s2', 10, 'message')).toEqual([]);
		expect((await etat.servis('s1', 2, 'message')).map((e) => e.horodatageMs)).toEqual([249, 248]);
	});

	it('journal : demande et classement gardés ; reclasser remplace le classement de l’entrée, et elle seule', async () => {
		const { etat } = await ouvrir();
		await etat.creer(session('s1'));
		const classement = [
			{ id: 'a.md', titre: 'A', note: null, servi: true, rang: 1 },
			{ id: 'b.md#^f-0001', titre: 'B', note: null, servi: false, rang: 2 },
		];
		await etat.journaliser({ session: 's1', moment: 'message', horodatageMs: 10, ids: ['a.md'], texte: 't', ms: 1, sens: false, demande: 'quoi ?', classement, muet: null, cartes: [], position: null });
		await etat.journaliser({ session: 's1', moment: 'message', horodatageMs: 20, ids: ['a.md'], texte: 't', ms: 1, sens: false, demande: null, classement, muet: null, cartes: [], position: null });
		expect((await etat.servis('s1', 2))[1]).toMatchObject({ demande: 'quoi ?', classement });
	});

	it('confirmerInjectionsAuto : après la livraison, la fiche rejoint les injectées de l’entrée et sa ligne est `auto` ; l’affinage garde la marque', async () => {
		const { etat } = await ouvrir();
		await etat.creer(session('s1'));
		const signaux = { cosinus: 0.81, cosinusRelatif: 0.12, bm25Relatif: 0.5, signalSession: 0 };
		const classement = [
			{ id: 'a.md', note: 0.9, servi: false, rang: 1, signaux, p: 0.94 },
			{ id: 'b.md', note: 0.5, servi: false, rang: 2, signaux, p: 0.5 },
		];
		await etat.journaliser({ session: 's1', moment: 'message', horodatageMs: 10, ids: ['pos.md'], texte: 't', ms: 1, sens: true, demande: 'q', classement, muet: null, cartes: [], position: null });
		await etat.confirmerInjectionsAuto('s1', 10, ['a.md']);
		const [e] = await etat.servis('s1', 1);
		expect(e!.ids).toEqual(['pos.md', 'a.md']);
		expect(e!.classement.map((c) => c.auto ?? null)).toEqual([true, null]);
		// l'affinage réécrit le classement (sans la marque) : elle reste sur la ligne de la fiche
		expect(await etat.completerClassement('s1', 10, [{ ...classement[1]!, rang: 1 }, { ...classement[0]!, rang: 2 }], 'fait')).toBe(true);
		expect((await etat.servis('s1', 1))[0]!.classement.map((c) => [c.id, c.auto ?? null])).toEqual([
			['b.md', null],
			['a.md', true],
		]);
		// entrée inconnue : rien
		await etat.confirmerInjectionsAuto('s1', 99, ['a.md']);
	});

	it('completerClassement : l’entrée la plus récente de la session seulement, avec son état d’affinage ; une entrée dépassée : rien', async () => {
		const { etat } = await ouvrir();
		await etat.creer(session('s1'));
		await etat.creer(session('s2'));
		const entree = { moment: 'message' as const, ids: [], texte: '', ms: 1, sens: true, demande: 'q', muet: null, cartes: [], position: null };
		const signaux = { cosinus: 0.81, cosinusRelatif: 0.12, bm25Relatif: 0.5, signalSession: 0 };
		const avant = [
			{ id: 'a.md', note: 0.81, servi: false, rang: 1, signaux, piste: true, raison: 'perimetre' as const },
			{ id: 'b.md', note: 0.7, servi: false, rang: 2, signaux, deja: 'proposee' as const },
		];
		await etat.journaliser({ ...entree, session: 's1', horodatageMs: 10, classement: avant });
		await etat.journaliser({ ...entree, session: 's1', horodatageMs: 20, classement: avant });
		await etat.journaliser({ ...entree, session: 's2', horodatageMs: 20, classement: avant });
		// les champs du classement vivant sont relus tels quels ; pas d'affinage encore
		expect((await etat.servis('s1', 1))[0]!.classement).toEqual(avant);
		expect((await etat.servis('s1', 1))[0]).not.toHaveProperty('affinage');
		const apres = [
			{ ...avant[1]!, rang: 1, p: 0.93, signaux: { ...signaux, logit: 2.4 } },
			{ ...avant[0]!, rang: 2, p: 0.4 },
		];
		// l'entrée de 10 n'est plus la plus récente : un message plus récent rend l'affinage caduc
		expect(await etat.completerClassement('s1', 10, apres, 'fait')).toBe(false);
		expect(await etat.completerClassement('s1', 20, apres, 'en_cours')).toBe(true);
		expect(await etat.completerClassement('s1', 20, apres, 'fait')).toBe(true);
		const [vingt, dix] = await etat.servis('s1', 2);
		expect(vingt!.classement).toEqual(apres);
		// le reste de l'entrée ne change pas
		expect(vingt).toMatchObject({ horodatageMs: 20, demande: 'q', texte: '', moment: 'message', affinage: 'fait' });
		expect(dix!.classement).toEqual(avant);
		expect((await etat.servis('s2', 1))[0]!.classement).toEqual(avant);
		expect(await etat.completerClassement('s1', 99, apres, 'fait')).toBe(false);
		// une entrée d'après un outil, un message muet, une trace de /clear, plus récents : l'affinage du message reste écrit
		await etat.journaliser({ ...entree, moment: 'apres_outil', session: 's1', horodatageMs: 30, classement: [] });
		await etat.journaliser({ ...entree, session: 's1', horodatageMs: 31, classement: [], muet: 'sans_contenu' });
		await etat.journaliser({ ...entree, moment: 'debut', session: 's1', horodatageMs: 32, classement: [], demande: null });
		expect(await etat.completerClassement('s1', 20, avant, 'fait', { sens: true })).toBe(true);
		expect((await etat.servis('s1', 5, 'message')).find((e) => e.horodatageMs === 20)).toMatchObject({ classement: avant, sens: true, affinage: 'fait' });
		// le classement lu « dernier » : celui de la dernière entrée qui n'est pas une trace de début
		await etat.journaliser({ ...entree, moment: 'debut', session: 's2', horodatageMs: 25, classement: [], demande: null });
		const [debutS2, messageS2] = await etat.servis('s2', 2, undefined, { classement: 'dernier' });
		expect(debutS2!.moment).toBe('debut');
		expect(messageS2!.classement).toEqual(avant);
		// rien d'ajouté : l'état d'affinage revient à null
		expect(await etat.completerClassement('s1', 20, avant, null)).toBe(true);
		expect((await etat.servis('s1', 5, 'message')).find((e) => e.horodatageMs === 20)).not.toHaveProperty('affinage');
		// caduc (un message porteur plus récent) : rien n'est écrit, un affinage en cours revient à null
		await etat.completerClassement('s1', 20, avant, 'en_cours');
		await etat.journaliser({ ...entree, session: 's1', horodatageMs: 40, classement: [] });
		expect(await etat.completerClassement('s1', 20, apres, 'fait')).toBe(false);
		const vingtCaduc = (await etat.servis('s1', 10, 'message')).find((e) => e.horodatageMs === 20)!;
		expect(vingtCaduc.classement).toEqual(avant);
		expect(vingtCaduc).not.toHaveProperty('affinage');
	});

	it('calibration du classement : journalisée, relue (aussi « dernier »), mise à jour par l’affinage, gardée si l’affinage ne la donne pas ; absente : rien', async () => {
		const { etat } = await ouvrir();
		await etat.creer(session('s1'));
		const entree = { session: 's1', moment: 'message' as const, ids: [], texte: '', ms: 1, sens: true, demande: 'q', muet: null, cartes: [], position: null };
		const classement = [{ id: 'a.md', note: 0.8, servi: false, rang: 1, p: 0.91, pSansApriori: 0.88, signaux: { cosinus: 0.8, cosinusRelatif: 0.1, bm25Relatif: 0, signalSession: 0 } }];
		await etat.journaliser({ ...entree, horodatageMs: 5, classement: [] });
		await etat.journaliser({ ...entree, horodatageMs: 10, classement, calibree: false });
		expect((await etat.servis('s1', 2)).map((e) => e.calibree)).toEqual([false, undefined]);
		expect((await etat.servis('s1', 1))[0]!.classement).toEqual(classement);
		expect(await etat.completerClassement('s1', 10, classement, 'fait', { calibree: true })).toBe(true);
		expect((await etat.servis('s1', 1, undefined, { classement: 'dernier' }))[0]).toMatchObject({ calibree: true, affinage: 'fait' });
		expect(await etat.completerClassement('s1', 10, classement, null)).toBe(true);
		expect((await etat.servis('s1', 1))[0]!.calibree).toBe(true);
	});

	it('journal : un même instant ne s’écrit qu’une fois par session et par moment (repli local du hook)', async () => {
		const { etat } = await ouvrir();
		await etat.creer(session('s1'));
		const entree = { session: 's1', moment: 'message' as const, horodatageMs: 10, ids: [], texte: 'service', ms: 1, sens: true, demande: 'q', classement: [], muet: null, cartes: [], position: null };
		await etat.journaliser(entree);
		await etat.journaliser({ ...entree, texte: 'repli local' });
		await etat.journaliser({ ...entree, moment: 'contexte', texte: 'outil' });
		expect((await etat.servis('s1', 10)).map((e) => e.texte)).toEqual(['outil', 'service']);
	});

	it('journal : les 50 dernières entrées gardent leur classement entier ; plus anciennes, coupé à 30 lignes et compté', async () => {
		const { etat } = await ouvrir();
		await etat.creer(session('s1'));
		const classement = Array.from({ length: 40 }, (_, i) => ({ id: `f${i}.md`, note: null, servi: false, rang: i + 1 }));
		for (let h = 1; h <= 52; h++) {
			await etat.journaliser({ session: 's1', moment: 'message', horodatageMs: h, ids: [], texte: '', ms: 1, sens: false, demande: null, classement, muet: null, cartes: [], position: null });
		}
		const entrees = await etat.servis('s1', 100);
		expect(entrees.slice(0, 50).every((e) => e.classement.length === 40)).toBe(true);
		for (const e of entrees.slice(50)) {
			expect(e.classement).toHaveLength(30);
			expect(e.classement.at(-1)).toMatchObject({ rang: 30, coupees: 10 });
		}
	});

	it('servis : `classement: dernier` ne rend que le classement de l’entrée la plus récente (de ce moment)', async () => {
		const { etat } = await ouvrir();
		await etat.creer(session('s1'));
		const classement = [{ id: 'a.md', note: null, servi: false, rang: 1 }];
		const entree = (moment: 'message' | 'contexte', horodatageMs: number) => ({ session: 's1', moment, horodatageMs, ids: [], texte: '', ms: 1, sens: false, demande: null, classement, muet: null, cartes: [], position: null });
		await etat.journaliser(entree('message', 1));
		await etat.journaliser(entree('message', 2));
		await etat.journaliser(entree('contexte', 3));
		expect((await etat.servis('s1', 10, undefined, { classement: 'dernier' })).map((e) => e.classement.length)).toEqual([1, 0, 0]);
		expect((await etat.servis('s1', 10, 'message', { classement: 'dernier' })).map((e) => [e.horodatageMs, e.classement.length])).toEqual([
			[2, 1],
			[1, 0],
		]);
		expect((await etat.servis('s1', 10)).map((e) => e.classement.length)).toEqual([1, 1, 1]);
	});

	it('servis : `classement: dernier` saute un message muet (une ➤ partie avec un « ok ») : le classement reste celui du dernier message porteur', async () => {
		const { etat } = await ouvrir();
		await etat.creer(session('s1'));
		const porteur = [{ id: 'a.md', note: 0.9, servi: false, rang: 1 }, { id: 'b.md', note: 0.5, servi: false, rang: 2 }];
		await etat.journaliser({ session: 's1', moment: 'message', horodatageMs: 1, ids: [], texte: '', ms: 1, sens: true, demande: 'les avoirs', classement: porteur, muet: null, cartes: [], position: null });
		await etat.journaliser({ session: 's1', moment: 'message', horodatageMs: 2, ids: ['c.md'], texte: 'c', ms: 1, sens: false, demande: 'ok', classement: [{ id: 'a.md', note: null, servi: false, rang: 1 }], muet: 'sans_contenu', cartes: [], position: null });
		const [muet, dernier] = await etat.servis('s1', 10, undefined, { classement: 'dernier' });
		expect(muet!.classement).toEqual([]);
		expect(dernier!.classement.map((c) => [c.id, c.note])).toEqual([['a.md', 0.9], ['b.md', 0.5]]);
		// « Pas pour cette session » trouve une ligne du classement porteur, et la trace en garde la demande
		expect(await ecarterDuClassement(etat, { id: 's1', dossier: '' }, 'b.md')).toMatchObject({ resultat: 'ecarte' });
	});

	it('une entrée ancienne (classement sans les champs du classement vivant) reste lisible', async () => {
		const { etat, chemin } = await ouvrir();
		await etat.creer(session('s1'));
		await etat.journaliser({ session: 's1', moment: 'message', horodatageMs: 10, ids: [], texte: 't', ms: 1, sens: true, demande: null, classement: [], muet: null, cartes: [], position: null });
		const base = new DatabaseSync(chemin);
		base.prepare('UPDATE servis SET classement = ?').run(JSON.stringify([{ id: 'a.md#^f-0001', titre: 'A', note: 0.4, servi: true, rang: 1 }]));
		base.close();
		expect((await etat.servis('s1', 1))[0]!.classement).toEqual([{ id: 'a.md#^f-0001', titre: 'A', note: 0.4, servi: true, rang: 1 }]);
	});

	it('écartés : écarter (une fois), lister, rétablir ; trace gardée ; effacés quand la session se termine (fin ou modifier)', async () => {
		const { etat, chemin } = await ouvrir();
		await etat.creer(session('s1'));
		await etat.creer(session('s2'));
		const trace = { dossier: 'code/x', demande: 'la demande', horodatageMs: 100 };
		expect(await etat.ecarter('s1', { id: 'a.md', titre: 'A' }, trace)).toBe('ecarte');
		expect(await etat.ecarter('s1', { id: 'a.md', titre: 'A' }, { ...trace, horodatageMs: 101 })).toBe('deja_ecarte');
		await etat.ecarter('s1', { id: 'b.md#^f-0001', titre: 'B' }, trace);
		await etat.ecarter('s2', { id: 'c.md', titre: 'C' }, trace);
		expect(await etat.ecartes('s1')).toEqual([
			{ id: 'a.md', titre: 'A', horodatageMs: 100 },
			{ id: 'b.md#^f-0001', titre: 'B', horodatageMs: 100 },
		]);
		expect(await etat.retablir('s1', 'a.md')).toBe('retabli');
		expect(await etat.retablir('s1', 'a.md')).toBe('non_ecarte');
		expect((await etat.ecartes('s1')).map((e) => e.id)).toEqual(['b.md#^f-0001']);
		await etat.appliquer('s1', 'fin', 5);
		await etat.modifier('s1', { etat: 'terminee' });
		expect(await etat.ecartes('s1')).toEqual([]);
		expect((await etat.ecartes('s2')).map((e) => e.id)).toEqual(['c.md']);
		await etat.modifier('s2', { etat: 'terminee' });
		expect(await etat.ecartes('s2')).toEqual([]);
		// la trace reste : chaque ✗, une ligne
		const base = new DatabaseSync(chemin);
		const traces = base.prepare('SELECT session, dossier, demande, fiche, horodatage_ms FROM traces_ecartes ORDER BY rang').all();
		base.close();
		expect(traces).toEqual([
			{ session: 's1', dossier: 'code/x', demande: 'la demande', fiche: 'a.md', horodatage_ms: 100 },
			{ session: 's1', dossier: 'code/x', demande: 'la demande', fiche: 'a.md', horodatage_ms: 101 },
			{ session: 's1', dossier: 'code/x', demande: 'la demande', fiche: 'b.md#^f-0001', horodatage_ms: 100 },
			{ session: 's2', dossier: 'code/x', demande: 'la demande', fiche: 'c.md', horodatage_ms: 100 },
		]);
	});

	it('écarter ou rétablir sur une session terminée ou inconnue : refusé, rien noté', async () => {
		const { etat } = await ouvrir();
		await etat.creer(session('s1', { etat: 'terminee' }));
		expect(await etat.ecarter('s1', { id: 'a.md', titre: 'A' }, { dossier: '', demande: null, horodatageMs: 1 })).toBe('terminee');
		expect(await etat.ecarter('inconnue', { id: 'a.md', titre: 'A' }, { dossier: '', demande: null, horodatageMs: 1 })).toBe('terminee');
		expect(await etat.ecartes('s1')).toEqual([]);
		expect(await etat.retablir('s1', 'a.md')).toBe('terminee');
		expect(await etat.retablir('inconnue', 'a.md')).toBe('terminee');
	});

	it('supprimer : une session terminée et tout ce qui la concerne (servis, écartés, traces) ; refusé sinon', async () => {
		const { etat, chemin } = await ouvrir();
		await etat.creer(session('s1'));
		await etat.creer(session('s2'));
		const trace = { dossier: 'code/x', demande: 'la demande', horodatageMs: 100 };
		for (const id of ['s1', 's2']) {
			await etat.journaliser({ session: id, moment: 'debut', horodatageMs: 5, ids: ['a.md'], texte: 't', ms: 1, sens: false, demande: null, classement: [], muet: null, cartes: [], position: null });
			await etat.ecarter(id, { id: 'a.md', titre: 'A' }, trace);
		}
		expect(await etat.supprimer('s1')).toBe('non_terminee');
		expect(await etat.supprimer('inconnue')).toBe('inconnue');
		expect(await etat.lire('s1')).not.toBeNull();
		await etat.modifier('s1', { etat: 'terminee' });
		expect(await etat.supprimer('s1')).toBe('supprimee');
		expect(await etat.lire('s1')).toBeNull();
		expect(await etat.servis('s1', 10)).toEqual([]);
		expect(await etat.lister({ archivees: true })).toEqual([expect.objectContaining({ id: 's2' })]);
		// rien de la session voisine n'est touché
		expect(await etat.servis('s2', 10)).toHaveLength(1);
		expect((await etat.ecartes('s2')).map((e) => e.id)).toEqual(['a.md']);
		const base = new DatabaseSync(chemin);
		const traces = base.prepare('SELECT session FROM traces_ecartes ORDER BY rang').all();
		const ecartes = base.prepare("SELECT session FROM ecartes WHERE session = 's1'").all();
		base.close();
		expect(traces).toEqual([{ session: 's2' }]);
		expect(ecartes).toEqual([]);
	});

	it('sessionsAyantServi : sessions connues à qui la fiche ou un de ses éléments a été servi, plus récentes d\'abord, bornées ; total de toutes', async () => {
		const { etat } = await ouvrir();
		for (const id of ['s1', 's2', 's3', 's4']) await etat.creer(session(id));
		const servir = (s: string, horodatageMs: number, ids: string[]) => etat.journaliser({ session: s, moment: 'message', horodatageMs, ids, texte: 't', ms: 1, sens: false, demande: null, classement: [], muet: null, cartes: [], position: null });
		await servir('s1', 10, ['a/b.md']);
		await servir('s1', 40, ['a/b.md#^f-0001']);
		await servir('s2', 20, ['x.md', 'a/b.md#~1234abcd']);
		await servir('s3', 30, ['a/b.mdx', 'a/b.md.bak', 'z/a/b.md']);
		await servir('s4', 50, ['autre.md']);
		// servie à une session inconnue de la table des sessions : ni listée ni comptée
		await servir('retiree', 60, ['a/b.md']);
		const resume = async (limite: number | null) => {
			const r = await etat.sessionsAyantServi('a/b.md', limite);
			return { sessions: r.sessions.map((s) => [s.session.id, s.horodatageMs]), total: r.total };
		};
		expect(await resume(10)).toEqual({ sessions: [['s1', 40], ['s2', 20]], total: 2 });
		expect(await resume(1)).toEqual({ sessions: [['s1', 40]], total: 2 });
		expect((await resume(null)).sessions).toHaveLength(2);
		expect(await etat.sessionsAyantServi('absente.md', 10)).toEqual({ sessions: [], total: 0 });
		// motifs LIKE neutralisés : « % » et « _ » ne sont que des caractères
		expect(await etat.sessionsAyantServi('a/%.md', 10)).toEqual({ sessions: [], total: 0 });
	});

	it('rend la dernière modification', async () => {
		const { etat } = await ouvrir();
		expect(await etat.derniereModificationMs()).toBe(0);
		await etat.creer(session('s1'));
		expect(await etat.derniereModificationMs()).toBeGreaterThan(0);
	});

	it('session créée sans trace : champs de trace à null ; modifier les pose', async () => {
		const { etat } = await ouvrir();
		await etat.creer(session('s1'));
		expect(await etat.lire('s1')).toMatchObject({ demarrageMachineMs: null, lanceMs: null, vuVivantMs: null });
		expect(await etat.modifier('s1', { pid: 9, demarrageMachineMs: 1000, lanceMs: 2000, vuVivantMs: 2500 })).toMatchObject({ pid: 9, demarrageMachineMs: 1000, lanceMs: 2000, vuVivantMs: 2500 });
	});

	it('battre : vuVivantMs de plusieurs sessions en une écriture, sans compter comme une modification', async () => {
		const { etat } = await ouvrir();
		await etat.creer(session('s1'));
		await etat.creer(session('s2'));
		await etat.creer(session('s3'));
		const avant = await etat.derniereModificationMs();
		await new Promise((r) => setTimeout(r, 5));
		await etat.battre(['s1', 's2', 'inconnue'], 7777);
		await etat.battre([], 8888);
		expect((await etat.lire('s1'))?.vuVivantMs).toBe(7777);
		expect((await etat.lire('s2'))?.vuVivantMs).toBe(7777);
		expect((await etat.lire('s3'))?.vuVivantMs).toBeNull();
		expect(await etat.derniereModificationMs()).toBe(avant);
	});

	it('moteur et modèle : enregistrés tels quels ; absents, ils le restent (session d’avant les moteurs)', async () => {
		const { etat } = await ouvrir();
		await etat.creer(session('m', { moteur: 'claude-code', modele: '' }));
		await etat.creer(session('n'));
		expect(await etat.lire('m')).toMatchObject({ moteur: 'claude-code', modele: '' });
		expect(await etat.lire('n')).not.toHaveProperty('moteur');
		expect(await etat.lire('n')).not.toHaveProperty('modele');
	});

	it('moteur inconnu de ce Mnemo : gardé tel quel', async () => {
		const { etat } = await ouvrir();
		await etat.creer(session('g', { moteur: 'gemini' }));
		expect((await etat.lire('g'))?.moteur).toBe('gemini');
	});

	it('fil (identifiant chez le moteur) : noté au premier événement qui le porte, même ancien, jamais écrasé', async () => {
		const { etat } = await ouvrir();
		await etat.creer(session('f', { majMs: 10 }));
		await etat.appliquer('f', 'message', 20, { objectif: 'x' });
		expect(await etat.lire('f')).not.toHaveProperty('fil');
		await etat.appliquer('f', 'debut', 5, { fil: 'fil-1' });
		expect((await etat.lire('f'))?.fil).toBe('fil-1');
		await etat.appliquer('f', 'message', 30, { fil: 'fil-2' });
		expect(await etat.lire('f')).toMatchObject({ fil: 'fil-1', majMs: 30 });
	});

	it('migre la version 12 (niveau des modèles, sans moteur ni modèle ni fil) vers la dernière en passant par la 13 : le niveau de la session est gardé', async () => {
		const { etat, chemin } = await ouvrir();
		await etat.creer(session('n1', { pid: 7, niveauModeles: 'sens' }));
		etat.fermer();
		ouverts.pop();
		const base = new DatabaseSync(chemin);
		sansVersion13(base);
		base.exec('PRAGMA user_version = 12');
		base.close();
		const rouvert = ouvrirEtat(chemin);
		ouverts.push(rouvert);
		const lue = await rouvert.lire('n1');
		expect(lue).toMatchObject({ pid: 7, niveauModeles: 'sens' });
		expect(lue).not.toHaveProperty('moteur');
		expect(lue).not.toHaveProperty('fil');
		await rouvert.appliquer('n1', 'debut', Date.now(), { fil: 'fil-codex' });
		expect((await rouvert.lire('n1'))?.fil).toBe('fil-codex');
		expect(await rouvert.gestes({ limite: null })).toEqual([]);
		const verif = new DatabaseSync(chemin);
		expect(verif.prepare('PRAGMA user_version').get()).toEqual({ user_version: VERSION_ETAT });
		verif.close();
	});

	it('migre la version 14 (sans l’outil d’un dialogue ouvert) vers la dernière : la session est gardée, son dialogue sans outil', async () => {
		const { etat, chemin } = await ouvrir();
		await etat.creer(session('d1', { moteur: 'mistral-vibe', dernierArret: 'notification', fil: 'f' }));
		etat.fermer();
		ouverts.pop();
		const base = new DatabaseSync(chemin);
		sansVersion15(base);
		base.exec('PRAGMA user_version = 14');
		base.close();
		const rouvert = ouvrirEtat(chemin);
		ouverts.push(rouvert);
		expect(await rouvert.lire('d1')).toMatchObject({ moteur: 'mistral-vibe', dernierArret: 'notification', dialogueOutil: null, fil: 'f' });
		const verif = new DatabaseSync(chemin);
		expect(verif.prepare('PRAGMA user_version').get()).toEqual({ user_version: VERSION_ETAT });
		verif.close();
	});

	it('migre la version 11 (sans niveau des modèles, moteur ni modèle) vers la dernière sans rien perdre', async () => {
		const { etat, chemin } = await ouvrir();
		await etat.creer(session('s1', { pid: 4 }));
		etat.fermer();
		ouverts.pop();
		const base = new DatabaseSync(chemin);
		for (const colonne of ['niveau_modeles', 'moteur', 'modele', 'fil']) base.exec(`ALTER TABLE sessions DROP COLUMN ${colonne}`);
		base.exec('PRAGMA user_version = 11');
		base.close();
		const rouvert = ouvrirEtat(chemin);
		ouverts.push(rouvert);
		expect(await rouvert.lire('s1')).toMatchObject({ pid: 4 });
		expect(await rouvert.lire('s1')).not.toHaveProperty('moteur');
		await rouvert.creer(session('s2', { moteur: 'claude-code', modele: '' }));
		expect(await rouvert.lire('s2')).toMatchObject({ moteur: 'claude-code', modele: '' });
		const verif = new DatabaseSync(chemin);
		expect(verif.prepare('PRAGMA user_version').get()).toEqual({ user_version: VERSION_ETAT });
		verif.close();
	});

	it('migre la version 1 (sans trace) vers la dernière sans rien perdre', async () => {
		const { etat, chemin } = await ouvrir();
		await etat.creer(session('s1', { pid: 4 }));
		etat.fermer();
		ouverts.pop();
		const base = new DatabaseSync(chemin);
		for (const colonne of ['demarrage_machine_ms', 'lance_ms', 'vu_vivant_ms', 'bilan_lu_ms', 'dernier_arret', 'episode_ms']) base.exec(`ALTER TABLE sessions DROP COLUMN ${colonne}`);
		sansVersion5(base);
		base.exec('PRAGMA user_version = 1');
		base.close();
		const rouvert = ouvrirEtat(chemin);
		ouverts.push(rouvert);
		expect(await rouvert.lire('s1')).toMatchObject({ pid: 4, lanceMs: null });
		await rouvert.battre(['s1'], 5);
		expect((await rouvert.lire('s1'))?.vuVivantMs).toBe(5);
		const verif = new DatabaseSync(chemin);
		expect(verif.prepare('PRAGMA user_version').get()).toEqual({ user_version: VERSION_ETAT });
		verif.close();
	});

	it('migre la version 2 (sans bilan lu) vers la dernière sans rien perdre', async () => {
		const { etat, chemin } = await ouvrir();
		await etat.creer(session('s1', { pid: 4, lanceMs: 9, arretAttendu: 'bilan', bilanDemandeMs: 50 }));
		etat.fermer();
		ouverts.pop();
		const base = new DatabaseSync(chemin);
		for (const colonne of ['bilan_lu_ms', 'dernier_arret', 'episode_ms']) base.exec(`ALTER TABLE sessions DROP COLUMN ${colonne}`);
		sansVersion5(base);
		base.exec('PRAGMA user_version = 2');
		base.close();
		const rouvert = ouvrirEtat(chemin);
		ouverts.push(rouvert);
		expect(await rouvert.lire('s1')).toMatchObject({ pid: 4, lanceMs: 9, arretAttendu: 'bilan', bilanDemandeMs: 50, bilanLuMs: null });
		const verif = new DatabaseSync(chemin);
		expect(verif.prepare('PRAGMA user_version').get()).toEqual({ user_version: VERSION_ETAT });
		verif.close();
	});

	it('migre la version 3 vers la dernière : dernier arrêt inconnu ; épisode tenu pour écrit pour les sessions terminées depuis plus de 7 jours', async () => {
		const { etat, chemin } = await ouvrir();
		const vieux = Date.now() - 8 * 86_400_000;
		const recent = Date.now() - 86_400_000;
		await etat.creer(session('vieille', { etat: 'terminee', majMs: vieux }));
		await etat.creer(session('recente', { etat: 'terminee', majMs: recent }));
		await etat.creer(session('active', { etat: 'a_relire', majMs: vieux }));
		etat.fermer();
		ouverts.pop();
		const base = new DatabaseSync(chemin);
		for (const colonne of ['dernier_arret', 'episode_ms']) base.exec(`ALTER TABLE sessions DROP COLUMN ${colonne}`);
		sansVersion5(base);
		base.exec('PRAGMA user_version = 3');
		base.close();
		const rouvert = ouvrirEtat(chemin, {});
		ouverts.push(rouvert);
		expect(await rouvert.lire('vieille')).toMatchObject({ dernierArret: null, episodeMs: vieux });
		expect(await rouvert.lire('recente')).toMatchObject({ dernierArret: null, episodeMs: null });
		expect(await rouvert.lire('active')).toMatchObject({ episodeMs: null });
		const verif = new DatabaseSync(chemin);
		expect(verif.prepare('PRAGMA user_version').get()).toEqual({ user_version: VERSION_ETAT });
		verif.close();
	});

	it('migre la version 4 vers la dernière : entrées servies gardées (classement vide, demande inconnue), écartés vides', async () => {
		const { etat, chemin } = await ouvrir();
		await etat.creer(session('s1'));
		etat.fermer();
		ouverts.pop();
		const base = new DatabaseSync(chemin);
		sansVersion5(base);
		base.prepare("INSERT INTO servis (session, moment, horodatage_ms, ids, texte, ms, sens) VALUES ('s1', 'debut', 7, '[\"a.md\"]', 'ctx', 3, 1)").run();
		base.exec('PRAGMA user_version = 4');
		base.close();
		const rouvert = ouvrirEtat(chemin);
		ouverts.push(rouvert);
		expect(await rouvert.servis('s1', 5)).toEqual([{ session: 's1', moment: 'debut', horodatageMs: 7, ids: ['a.md'], texte: 'ctx', ms: 3, sens: true, demande: null, classement: [], muet: null, cartes: [], position: null }]);
		expect(await rouvert.ecartes('s1')).toEqual([]);
		expect(await rouvert.ecarter('s1', { id: 'a.md', titre: 'A' }, { dossier: '', demande: null, horodatageMs: 1 })).toBe('ecarte');
		const verif = new DatabaseSync(chemin);
		expect(verif.prepare('PRAGMA user_version').get()).toEqual({ user_version: VERSION_ETAT });
		verif.close();
	});

	it('migre la version 5 vers la 6 : sessions gardées et tenues pour rattachées, aucun dossier non rattaché', async () => {
		const { etat, chemin } = await ouvrir();
		await etat.creer(session('s1', { pid: 4 }));
		etat.fermer();
		ouverts.pop();
		const base = new DatabaseSync(chemin);
		sansVersion6(base);
		base.exec('PRAGMA user_version = 5');
		base.close();
		const rouvert = ouvrirEtat(chemin);
		ouverts.push(rouvert);
		expect(await rouvert.lire('s1')).toMatchObject({ pid: 4, dossierNonRattache: false });
		expect(await rouvert.dossiersNonRattaches()).toEqual([]);
		const verif = new DatabaseSync(chemin);
		expect(verif.prepare('PRAGMA user_version').get()).toEqual({ user_version: VERSION_ETAT });
		verif.close();
	});

	it('migration depuis la version 6 : la table des fiches de travail est ajoutée, rien n’est perdu', async () => {
		const { etat, chemin } = await ouvrir();
		await etat.creer(session('s1', { pid: 4 }));
		etat.fermer();
		ouverts.pop();
		const base = new DatabaseSync(chemin);
		sansVersion7(base);
		base.exec('PRAGMA user_version = 6');
		base.close();
		const rouvert = ouvrirEtat(chemin);
		ouverts.push(rouvert);
		expect(await rouvert.lire('s1')).toMatchObject({ pid: 4 });
		expect(await rouvert.fichesServiesLuesOuEcrites('s1')).toEqual([]);
	});

	it('migration depuis la version 7 : une entrée servie est gardée (muet nul, aucune carte, position inconnue), les nouvelles tables sont vides', async () => {
		const { etat, chemin } = await ouvrir();
		await etat.creer(session('s1', { pid: 4 }));
		await etat.journaliser({ session: 's1', moment: 'message', horodatageMs: 5, ids: ['a.md'], texte: 't', ms: 1, sens: true, demande: 'q', classement: [], muet: null, cartes: [], position: null });
		etat.fermer();
		ouverts.pop();
		const base = new DatabaseSync(chemin);
		sansVersion8(base);
		base.exec('PRAGMA user_version = 7');
		base.close();
		const rouvert = ouvrirEtat(chemin);
		ouverts.push(rouvert);
		expect(await rouvert.lire('s1')).toMatchObject({ pid: 4 });
		expect(await rouvert.servis('s1', 10)).toEqual([
			{ session: 's1', moment: 'message', horodatageMs: 5, ids: ['a.md'], texte: 't', ms: 1, sens: true, demande: 'q', classement: [], muet: null, cartes: [], position: null },
		]);
		expect(await rouvert.cartesProposees('s1')).toEqual(new Map());
		expect(await rouvert.perimetrePropose('s1')).toBeNull();
		expect(await rouvert.actions('s1')).toEqual([]);
		const verif = new DatabaseSync(chemin);
		expect(verif.prepare('PRAGMA user_version').get()).toEqual({ user_version: VERSION_ETAT });
		verif.close();
	});

	it('journal servi : muet, cartes proposées et position sont rendus tels quels, la demande n’est pas coupée', async () => {
		const { etat } = await ouvrir();
		await etat.creer(session('s1'));
		const demande = 'x'.repeat(5000);
		await etat.journaliser({
			session: 's1',
			moment: 'message',
			horodatageMs: 1,
			ids: [],
			texte: '',
			ms: 1,
			sens: false,
			demande,
			classement: [],
			muet: 'balise',
			cartes: [{ chemin: 'a.md', raison: 'perimetre' }, { chemin: 'b.md', raison: 'nommee' }],
			position: 'projets/alpha',
		});
		expect(await etat.servis('s1', 1)).toMatchObject([{ demande, muet: 'balise', cartes: [{ chemin: 'a.md', raison: 'perimetre' }, { chemin: 'b.md', raison: 'nommee' }], position: 'projets/alpha' }]);
	});

	it('cartes proposées : l’empreinte est rendue, une fiche seulement proposée n’est pas une fiche servie, lue ou écrite', async () => {
		const { etat } = await ouvrir();
		await etat.creer(session('s1'));
		await etat.noterCarteProposee('s1', { chemin: 'a.md', empreinte: 'e1', horodatageMs: 10 });
		await etat.noterCarteProposee('s1', { chemin: 'b.md', empreinte: 'e2', horodatageMs: 11 });
		await etat.noterCarteProposee('s1', { chemin: 'a.md', empreinte: 'e3', horodatageMs: 12 });
		expect(await etat.cartesProposees('s1')).toEqual(new Map([['b.md', 'e2'], ['a.md', 'e3']]));
		expect(await etat.fichesServiesLuesOuEcrites('s1')).toEqual([]);
		await etat.noterCarteProposee('inconnue', { chemin: 'a.md', empreinte: 'e', horodatageMs: 1 });
		expect(await etat.cartesProposees('inconnue')).toEqual(new Map());
	});

	it('journal des actions : proposée puis lue, dans l’ordre', async () => {
		const { etat } = await ouvrir();
		await etat.creer(session('s1'));
		await etat.noterCarteProposee('s1', { chemin: 'a.md', empreinte: 'e1', horodatageMs: 10 });
		await etat.noterFicheServieLueOuEcrite('s1', { chemin: 'a.md', action: 'lue', horodatageMs: 20, empreinte: null });
		await etat.noterFicheServieLueOuEcrite('s1', { chemin: 'b.md', action: 'servie', horodatageMs: 20, empreinte: 'e' });
		expect(await etat.actions('s1')).toEqual([
			{ chemin: 'a.md', action: 'proposee', horodatageMs: 10 },
			{ chemin: 'a.md', action: 'lue', horodatageMs: 20 },
			{ chemin: 'b.md', action: 'servie', horodatageMs: 20 },
		]);
	});

	it('périmètre proposé : noté, puis oublié avec les cartes proposées après /clear ; retiré avec la session', async () => {
		const { etat } = await ouvrir();
		await etat.creer(session('s1'));
		expect(await etat.perimetrePropose('s1')).toBeNull();
		await etat.noterPerimetrePropose('s1', 42);
		await etat.noterCarteProposee('s1', { chemin: 'a.md', empreinte: 'e1', horodatageMs: 10 });
		expect(await etat.perimetrePropose('s1')).toBe(42);
		await etat.oublierInjections('s1');
		expect(await etat.perimetrePropose('s1')).toBeNull();
		expect(await etat.cartesProposees('s1')).toEqual(new Map());
		await etat.noterCarteProposee('s1', { chemin: 'b.md', empreinte: 'e2', horodatageMs: 11 });
		await etat.modifier('s1', { etat: 'terminee' });
		expect(await etat.supprimer('s1')).toBe('supprimee');
		expect(await etat.cartesProposees('s1')).toEqual(new Map());
		expect(await etat.actions('s1')).toEqual([]);
	});

	it('fiches de travail : première et dernière action gardées, empreinte notée à l’injection, oubliée après /clear', async () => {
		const { etat } = await ouvrir();
		await etat.creer(session('s1'));
		await etat.noterFicheServieLueOuEcrite('s1', { chemin: 'a.md', action: 'servie', horodatageMs: 10, empreinte: 'e1' });
		await etat.noterFicheServieLueOuEcrite('s1', { chemin: 'b.md', action: 'lue', horodatageMs: 20, empreinte: null });
		await etat.noterFicheServieLueOuEcrite('s1', { chemin: 'a.md', action: 'ecrite', horodatageMs: 30, empreinte: null });
		expect(await etat.fichesServiesLuesOuEcrites('s1')).toEqual([
			{ chemin: 'a.md', premiereAction: 'servie', premiereMs: 10, derniereAction: 'ecrite', derniereMs: 30, empreinteInjectee: 'e1', empreinteLue: null },
			{ chemin: 'b.md', premiereAction: 'lue', premiereMs: 20, derniereAction: 'lue', derniereMs: 20, empreinteInjectee: null, empreinteLue: null },
		]);
		await etat.oublierInjections('s1');
		expect((await etat.fichesServiesLuesOuEcrites('s1')).map((f) => f.empreinteInjectee)).toEqual([null, null]);
	});

	it('fiches de travail : l’empreinte d’une lecture est gardée à part de l’injection, une écriture l’oublie', async () => {
		const { etat } = await ouvrir();
		await etat.creer(session('s1'));
		await etat.noterFicheServieLueOuEcrite('s1', { chemin: 'a.md', action: 'servie', horodatageMs: 10, empreinte: 'i1' });
		await etat.noterFicheServieLueOuEcrite('s1', { chemin: 'a.md', action: 'lue', horodatageMs: 20, empreinte: 'l1' });
		expect(await etat.fichesServiesLuesOuEcrites('s1')).toMatchObject([{ derniereAction: 'lue', empreinteInjectee: 'i1', empreinteLue: 'l1' }]);
		await etat.noterFicheServieLueOuEcrite('s1', { chemin: 'a.md', action: 'servie', horodatageMs: 30, empreinte: 'i2' });
		expect(await etat.fichesServiesLuesOuEcrites('s1')).toMatchObject([{ empreinteInjectee: 'i2', empreinteLue: 'l1' }]);
		await etat.noterFicheServieLueOuEcrite('s1', { chemin: 'a.md', action: 'ecrite', horodatageMs: 40, empreinte: null });
		expect(await etat.fichesServiesLuesOuEcrites('s1')).toMatchObject([{ derniereAction: 'ecrite', empreinteInjectee: 'i2', empreinteLue: null }]);
	});

	it('migration depuis la version 8 : les fiches de travail sont gardées, sans empreinte de lecture', async () => {
		const { etat, chemin } = await ouvrir();
		await etat.creer(session('s1'));
		await etat.noterFicheServieLueOuEcrite('s1', { chemin: 'a.md', action: 'servie', horodatageMs: 10, empreinte: 'i1' });
		etat.fermer();
		ouverts.pop();
		const base = new DatabaseSync(chemin);
		sansVersion10(base);
		base.exec('ALTER TABLE fiches_servies_lues_ecrites DROP COLUMN empreinte_lue');
		base.exec('PRAGMA user_version = 8');
		base.close();
		const rouvert = ouvrirEtat(chemin);
		ouverts.push(rouvert);
		expect(await rouvert.fichesServiesLuesOuEcrites('s1')).toMatchObject([{ chemin: 'a.md', empreinteInjectee: 'i1', empreinteLue: null }]);
		const verif = new DatabaseSync(chemin);
		expect(verif.prepare('PRAGMA user_version').get()).toEqual({ user_version: VERSION_ETAT });
		verif.close();
	});

	it('injections à la main : âge en messages porteurs, réinjection à 0, oubliées après /clear, retirées avec la session', async () => {
		const { etat, chemin } = await ouvrir();
		await etat.creer(session('s1'));
		await etat.creer(session('s2'));
		await etat.noterMessagePorteur('s1', 'un message');
		await etat.noterInjectionManuelle('s1', 'a.md');
		expect(await etat.injectionsManuelles('s1')).toEqual([{ chemin: 'a.md', messages: 0 }]);
		await etat.noterMessagePorteur('s1', 'un message');
		await etat.noterInjectionManuelle('s1', 'b.md');
		await etat.noterMessagePorteur('s1', 'un message');
		await etat.noterMessagePorteur('s2', 'un message');
		expect(await etat.injectionsManuelles('s1')).toEqual([
			{ chemin: 'a.md', messages: 2 },
			{ chemin: 'b.md', messages: 1 },
		]);
		expect(await etat.injectionsManuelles('s2')).toEqual([]);
		await etat.noterInjectionManuelle('s1', 'a.md');
		expect(await etat.injectionsManuelles('s1')).toEqual([
			{ chemin: 'b.md', messages: 1 },
			{ chemin: 'a.md', messages: 0 },
		]);
		await etat.oublierInjections('s1');
		expect(await etat.injectionsManuelles('s1')).toEqual([]);
		await etat.noterInjectionManuelle('s1', 'c.md');
		await etat.noterInjectionManuelle('inconnue', 'c.md');
		expect(await etat.injectionsManuelles('inconnue')).toEqual([]);
		// la lecture joint la session : après `supprimer`, seule la table dit si les lignes sont parties
		const lignesDeS1 = () => {
			const base = new DatabaseSync(chemin);
			const ligne = base.prepare("SELECT COUNT(*) AS n FROM injections_manuelles WHERE session = 's1'").get();
			base.close();
			return ligne;
		};
		expect(lignesDeS1()).toEqual({ n: 1 });
		await etat.modifier('s1', { etat: 'terminee' });
		expect(await etat.supprimer('s1')).toBe('supprimee');
		expect(lignesDeS1()).toEqual({ n: 0 });
	});

	it('migration depuis la version 9 : sessions et fiches de travail gardées, aucune injection à la main, compteur à 0', async () => {
		const { etat, chemin } = await ouvrir();
		await etat.creer(session('s1', { pid: 4 }));
		await etat.noterFicheServieLueOuEcrite('s1', { chemin: 'a.md', action: 'servie', horodatageMs: 10, empreinte: 'i1' });
		etat.fermer();
		ouverts.pop();
		const base = new DatabaseSync(chemin);
		sansVersion10(base);
		base.exec('PRAGMA user_version = 9');
		base.close();
		const rouvert = ouvrirEtat(chemin);
		ouverts.push(rouvert);
		expect(await rouvert.lire('s1')).toMatchObject({ pid: 4 });
		expect(await rouvert.fichesServiesLuesOuEcrites('s1')).toMatchObject([{ chemin: 'a.md', empreinteInjectee: 'i1' }]);
		expect(await rouvert.injectionsManuelles('s1')).toEqual([]);
		await rouvert.noterMessagePorteur('s1', 'un message');
		await rouvert.noterInjectionManuelle('s1', 'a.md');
		await rouvert.noterMessagePorteur('s1', 'un message');
		expect(await rouvert.injectionsManuelles('s1')).toEqual([{ chemin: 'a.md', messages: 1 }]);
		const verif = new DatabaseSync(chemin);
		expect(verif.prepare('PRAGMA user_version').get()).toEqual({ user_version: VERSION_ETAT });
		verif.close();
	});

	it('migration depuis la version 11 : sessions gardées, sans niveau des modèles (elles suivent la machine)', async () => {
		const { etat, chemin } = await ouvrir();
		await etat.creer(session('s1', { pid: 4 }));
		etat.fermer();
		ouverts.pop();
		const base = new DatabaseSync(chemin);
		sansVersion12(base);
		base.exec('PRAGMA user_version = 11');
		base.close();
		const rouvert = ouvrirEtat(chemin);
		ouverts.push(rouvert);
		const lue = await rouvert.lire('s1');
		expect(lue).toMatchObject({ pid: 4 });
		expect(lue).not.toHaveProperty('niveauModeles');
		expect(await rouvert.modifier('s1', { niveauModeles: 'coupes' })).toMatchObject({ niveauModeles: 'coupes' });
		const verif = new DatabaseSync(chemin);
		expect(verif.prepare('PRAGMA user_version').get()).toEqual({ user_version: VERSION_ETAT });
		verif.close();
	});

	it('niveau des modèles d’une session : absent à la création, posé, gardé à la réouverture, retiré par null ; invalide ignoré', async () => {
		const { etat, chemin } = await ouvrir();
		await etat.creer(session('s1'));
		await etat.creer(session('s2', { niveauModeles: 'sens' }));
		expect(await etat.lire('s1')).not.toHaveProperty('niveauModeles');
		expect(await etat.lire('s2')).toMatchObject({ niveauModeles: 'sens' });
		expect(await etat.modifier('s1', { niveauModeles: 'coupes' })).toMatchObject({ niveauModeles: 'coupes' });
		// une valeur qui n'est pas un niveau n'est pas écrite
		expect(await etat.modifier('s1', { niveauModeles: 'aucun' as never })).toMatchObject({ niveauModeles: 'coupes' });
		// une session terminée peut encore en changer (le champ n'est pas son état)
		await etat.modifier('s2', { etat: 'terminee' });
		expect(await etat.modifier('s2', { niveauModeles: 'complets' })).toMatchObject({ niveauModeles: 'complets' });
		etat.fermer();
		ouverts.pop();
		// écrit à la main hors des niveaux : ignoré à la lecture
		const base = new DatabaseSync(chemin);
		base.prepare("UPDATE sessions SET niveau_modeles = 'bizarre' WHERE id = 's2'").run();
		base.close();
		const rouvert = ouvrirEtat(chemin);
		ouverts.push(rouvert);
		expect(await rouvert.lire('s1')).toMatchObject({ niveauModeles: 'coupes' });
		expect(await rouvert.lire('s2')).not.toHaveProperty('niveauModeles');
		expect(await rouvert.modifier('s1', { niveauModeles: null })).not.toHaveProperty('niveauModeles');
	});

	it('fiches de travail : ignorées pour une session inconnue, retirées avec la session', async () => {
		const { etat } = await ouvrir();
		await etat.noterFicheServieLueOuEcrite('inconnue', { chemin: 'a.md', action: 'lue', horodatageMs: 1, empreinte: null });
		expect(await etat.fichesServiesLuesOuEcrites('inconnue')).toEqual([]);
		await etat.creer(session('s1'));
		await etat.noterFicheServieLueOuEcrite('s1', { chemin: 'a.md', action: 'lue', horodatageMs: 1, empreinte: null });
		await etat.modifier('s1', { etat: 'terminee' });
		expect(await etat.supprimer('s1')).toBe('supprimee');
		expect(await etat.fichesServiesLuesOuEcrites('s1')).toEqual([]);
	});

	it('dossiers non rattachés : notés une fois (premier instant gardé), retirés quand ils sont rattachés', async () => {
		const { etat } = await ouvrir();
		await etat.noterRattachement('h1', false, 5);
		await etat.noterRattachement('h2', false, 3);
		await etat.noterRattachement('h1', false, 9);
		expect(await etat.dossiersNonRattaches()).toEqual([{ dossier: 'h2', vuMs: 3 }, { dossier: 'h1', vuMs: 5 }]);
		await etat.noterRattachement('h2', true, 10);
		await etat.noterRattachement('h3', true, 10);
		expect(await etat.dossiersNonRattaches()).toEqual([{ dossier: 'h1', vuMs: 5 }]);
	});

	it('modifier : position, projet et dossier non rattaché', async () => {
		const { etat } = await ouvrir();
		await etat.creer(session('s1', { position: '', projet: 'divers', dossierNonRattache: true }));
		expect(await etat.modifier('s1', { position: 'g1/d1', projet: 'P1', dossierNonRattache: false })).toMatchObject({ position: 'g1/d1', projet: 'P1', dossierNonRattache: false });
	});

	it('dernier arrêt : Stop ou Notification noté par arret (Stop par défaut), effacé par debut, message, outil ; l’état reste attend', async () => {
		const { etat } = await ouvrir();
		await etat.creer(session('s', { majMs: 10 }));
		expect(await etat.appliquer('s', 'arret', 11, { arret: 'notification' })).toMatchObject({ etat: 'attend', dernierArret: 'notification' });
		expect(await etat.appliquer('s', 'arret', 12)).toMatchObject({ etat: 'attend', dernierArret: 'stop' });
		expect(await etat.appliquer('s', 'arret', 13, { arret: 'notification' })).toMatchObject({ dernierArret: 'notification' });
		expect(await etat.appliquer('s', 'outil', 14)).toMatchObject({ etat: 'travaille', dernierArret: null });
		await etat.appliquer('s', 'arret', 15, { arret: 'notification' });
		expect(await etat.appliquer('s', 'message', 16)).toMatchObject({ dernierArret: null });
		await etat.appliquer('s', 'arret', 17, { arret: 'stop' });
		expect(await etat.appliquer('s', 'debut', 18)).toMatchObject({ dernierArret: null });
		await etat.appliquer('s', 'arret', 19, { arret: 'notification' });
		// un arret plus ancien que le dernier événement ne change rien
		expect(await etat.appliquer('s', 'arret', 5, { arret: 'stop' })).toMatchObject({ dernierArret: 'notification' });
		// fin ne touche pas au dernier arrêt
		expect(await etat.appliquer('s', 'fin', 20)).toMatchObject({ dernierArret: 'notification' });
	});

	it('dialogue ouvert pour un outil nommé : seul l’après-outil de cet outil le ferme ; un outil inconnu d’un côté ou de l’autre le ferme', async () => {
		const { etat } = await ouvrir();
		await etat.creer(session('s', { majMs: 10 }));
		expect(await etat.appliquer('s', 'arret', 11, { arret: 'notification', outil: 'bash' })).toMatchObject({ etat: 'attend', dernierArret: 'notification', dialogueOutil: 'bash' });
		// l'après-outil d'un autre outil, lancé en parallèle : ignoré, le dialogue reste ouvert
		expect(await etat.appliquer('s', 'apres_outil', 12, { outil: 'read_file' })).toMatchObject({ etat: 'attend', dernierArret: 'notification', dialogueOutil: 'bash', majMs: 11 });
		expect(await etat.appliquer('s', 'apres_outil', 13, { outil: 'bash' })).toMatchObject({ etat: 'travaille', dernierArret: null, dialogueOutil: null });
		// sans nom d'outil au dialogue (Claude Code) ou à l'après-outil : il le ferme
		await etat.appliquer('s', 'arret', 14, { arret: 'notification' });
		expect(await etat.appliquer('s', 'apres_outil', 15, { outil: 'read_file' })).toMatchObject({ dernierArret: null });
		await etat.appliquer('s', 'arret', 16, { arret: 'notification', outil: 'bash' });
		expect(await etat.appliquer('s', 'apres_outil', 17)).toMatchObject({ dernierArret: null, dialogueOutil: null });
		// un arrêt Stop ou un autre événement efface l'outil avec le dialogue ; fin le garde
		await etat.appliquer('s', 'arret', 18, { arret: 'notification', outil: 'bash' });
		expect(await etat.appliquer('s', 'fin', 19)).toMatchObject({ dernierArret: 'notification', dialogueOutil: 'bash' });
		await etat.creer(session('t', { majMs: 10 }));
		await etat.appliquer('t', 'arret', 11, { arret: 'notification', outil: 'bash' });
		expect(await etat.appliquer('t', 'arret', 12, { arret: 'stop', outil: 'bash' })).toMatchObject({ dernierArret: 'stop', dialogueOutil: null });
	});

	it('episodeMs : absent à la création, posé par modifier', async () => {
		const { etat } = await ouvrir();
		await etat.creer(session('s'));
		expect(await etat.lire('s')).toMatchObject({ episodeMs: null, dernierArret: null });
		expect(await etat.modifier('s', { episodeMs: 42 })).toMatchObject({ episodeMs: 42 });
	});

	it('bilan lu : le premier message après la demande de bilan est noté ; ni avant, ni sans bilan, ni le suivant', async () => {
		const { etat } = await ouvrir();
		await etat.creer(session('b', { arretAttendu: 'bilan', bilanDemandeMs: 100, majMs: 10 }));
		await etat.creer(session('n', { bilanDemandeMs: 100, majMs: 10 }));
		await etat.appliquer('b', 'message', 90);
		expect((await etat.lire('b'))?.bilanLuMs).toBeNull();
		await etat.appliquer('b', 'arret', 101);
		expect((await etat.lire('b'))?.bilanLuMs).toBeNull();
		await etat.appliquer('b', 'message', 102);
		expect((await etat.lire('b'))?.bilanLuMs).toBe(102);
		await etat.appliquer('b', 'message', 105);
		expect((await etat.lire('b'))?.bilanLuMs).toBe(102);
		await etat.appliquer('n', 'message', 102);
		expect((await etat.lire('n'))?.bilanLuMs).toBeNull();
		// une nouvelle demande l'efface
		expect((await etat.modifier('b', { bilanLuMs: null, bilanDemandeMs: 200 }))?.bilanLuMs).toBeNull();
	});

	it('migration depuis la version 12 : sessions, journal servi et injections gardés ; gestes vides, dernier message et rang inconnus', async () => {
		const { etat, chemin } = await ouvrir();
		await etat.creer(session('s1', { pid: 4, niveauModeles: 'sens' }));
		await etat.noterMessagePorteur('s1', 'quoi ?');
		await etat.noterInjectionManuelle('s1', 'a.md');
		await etat.journaliser({ session: 's1', moment: 'message', horodatageMs: 10, ids: ['a.md'], texte: 't', ms: 1, sens: false, demande: 'quoi ?', classement: [], muet: null, cartes: [], position: 'a/b' });
		etat.fermer();
		ouverts.pop();
		const base = new DatabaseSync(chemin);
		sansVersion13(base);
		base.exec('PRAGMA user_version = 12');
		base.close();
		const rouvert = ouvrirEtat(chemin);
		ouverts.push(rouvert);
		expect(await rouvert.lire('s1')).toMatchObject({ pid: 4, niveauModeles: 'sens' });
		expect(await rouvert.injectionsManuelles('s1')).toEqual([{ chemin: 'a.md', messages: 0 }]);
		expect(await rouvert.servis('s1', 10)).toMatchObject([{ demande: 'quoi ?' }]);
		expect((await rouvert.servis('s1', 10))[0]).not.toHaveProperty('rangMessage');
		expect(await rouvert.gestes({ limite: null })).toEqual([]);
		// le texte du dernier message porteur n'était pas gardé : rang connu, texte inconnu
		await rouvert.noterGeste({ geste: 'ecartee_ici', session: 's1', fiche: 'a.md', empreinte: 'e1', horodatageMs: 20 });
		expect(await rouvert.gestes({ limite: null })).toMatchObject([{ geste: 'ecartee_ici', message: null, rangMessage: 1 }]);
		expect(await rouvert.noterMessagePorteur('s1', 'la suite')).toBe(2);
		const verif = new DatabaseSync(chemin);
		expect(verif.prepare('PRAGMA user_version').get()).toEqual({ user_version: VERSION_ETAT });
		expect(VERSION_ETAT).toBe(16);
		verif.close();
	});

	it('migration depuis la version 13 (1.6.1 : moteur, modèle et fil) : sessions, moteur, fil et journal servi gardés ; gestes et écartées toujours vides, colonnes du classement vivant ajoutées', async () => {
		const { etat, chemin } = await ouvrir();
		await etat.creer(session('s1', { pid: 4, niveauModeles: 'sens', moteur: 'codex', modele: 'gpt-a' }));
		await etat.appliquer('s1', 'debut', 5, { fil: 'fil-1' });
		await etat.journaliser({ session: 's1', moment: 'message', horodatageMs: 10, ids: ['a.md'], texte: 't', ms: 1, sens: false, demande: 'quoi ?', classement: [], muet: null, cartes: [], position: 'a/b' });
		etat.fermer();
		ouverts.pop();
		const base = new DatabaseSync(chemin);
		sansVersion14(base);
		base.exec('PRAGMA user_version = 13');
		base.close();
		const rouvert = ouvrirEtat(chemin);
		ouverts.push(rouvert);
		expect(await rouvert.lire('s1')).toMatchObject({ pid: 4, niveauModeles: 'sens', moteur: 'codex', modele: 'gpt-a', fil: 'fil-1' });
		expect(await rouvert.servis('s1', 10)).toMatchObject([{ demande: 'quoi ?' }]);
		expect((await rouvert.servis('s1', 10))[0]).not.toHaveProperty('rangMessage');
		expect(await rouvert.gestes({ limite: null })).toEqual([]);
		expect(await rouvert.ecarteesToujours()).toEqual([]);
		expect(await rouvert.noterMessagePorteur('s1', 'la suite')).toBe(1);
		await rouvert.journaliser({ session: 's1', moment: 'message', horodatageMs: 20, ids: [], texte: '', ms: 1, sens: true, demande: 'la suite', classement: [], calibree: true, muet: null, cartes: [], position: null });
		expect((await rouvert.servis('s1', 1))[0]).toMatchObject({ calibree: true, rangMessage: 1 });
		expect(await rouvert.ecarterToujours({ fiche: 'a.md', session: 's1', horodatageMs: 30 })).toBe('ecartee');
		const verif = new DatabaseSync(chemin);
		expect(verif.prepare('PRAGMA user_version').get()).toEqual({ user_version: VERSION_ETAT });
		expect(verif.prepare("SELECT 1 AS un FROM sqlite_master WHERE type = 'index' AND name = 'gestes_sorte'").get()).toEqual({ un: 1 });
		verif.close();
	});

	it('état en 13 de développement (classement vivant en partie, sans écartées toujours, affinage ni calibration) : complété jusqu’à la dernière, rien perdu', async () => {
		const { etat, chemin } = await ouvrir();
		await etat.creer(session('s1'));
		await etat.noterGeste({ geste: 'ecartee_ici', session: 's1', fiche: 'a.md', empreinte: null, horodatageMs: 5 });
		etat.fermer();
		ouverts.pop();
		const base = new DatabaseSync(chemin);
		base.exec('DROP TABLE ecartees_toujours');
		base.exec('ALTER TABLE servis DROP COLUMN affinage');
		base.exec('ALTER TABLE servis DROP COLUMN calibree');
		base.exec('PRAGMA user_version = 13');
		base.close();
		const rouvert = ouvrirEtat(chemin);
		ouverts.push(rouvert);
		await rouvert.journaliser({ session: 's1', moment: 'message', horodatageMs: 7, ids: [], texte: '', ms: 1, sens: true, demande: 'q', classement: [], calibree: true, muet: null, cartes: [], position: null });
		expect((await rouvert.servis('s1', 1))[0]!.calibree).toBe(true);
		expect(await rouvert.gestes({ limite: null })).toMatchObject([{ geste: 'ecartee_ici', fiche: 'a.md' }]);
		expect(await rouvert.ecarterToujours({ fiche: 'a.md', session: 's1', horodatageMs: 10 })).toBe('ecartee');
		expect(await rouvert.ecarteesToujours()).toEqual([{ fiche: 'a.md', session: 's1', horodatageMs: 10, retablieMs: null }]);
		const verif = new DatabaseSync(chemin);
		expect(verif.prepare('PRAGMA user_version').get()).toEqual({ user_version: VERSION_ETAT });
		verif.close();
	});

	it('écartées toujours : une fois chacune, rétablies (instant gardé), écartées à nouveau', async () => {
		const { etat } = await ouvrir();
		expect(await etat.ecarterToujours({ fiche: 'b.md', session: 's1', horodatageMs: 20 })).toBe('ecartee');
		expect(await etat.ecarterToujours({ fiche: 'a.md', session: null, horodatageMs: 10 })).toBe('ecartee');
		expect(await etat.ecarterToujours({ fiche: 'a.md', session: 's2', horodatageMs: 30 })).toBe('deja_ecartee');
		expect(await etat.ecarteesToujours()).toEqual([
			{ fiche: 'a.md', session: null, horodatageMs: 10, retablieMs: null },
			{ fiche: 'b.md', session: 's1', horodatageMs: 20, retablieMs: null },
		]);
		expect(await etat.retablirToujours('b.md', 40)).toEqual({ fiche: 'b.md', session: 's1', horodatageMs: 20, retablieMs: 40 });
		expect(await etat.retablirToujours('b.md', 50)).toBeNull();
		expect((await etat.ecarteesToujours()).find((e) => e.fiche === 'b.md')).toEqual({ fiche: 'b.md', session: 's1', horodatageMs: 20, retablieMs: 40 });
		expect(await etat.ecarterToujours({ fiche: 'b.md', session: 's3', horodatageMs: 60 })).toBe('ecartee');
		expect((await etat.ecarteesToujours()).find((e) => e.fiche === 'b.md')).toEqual({ fiche: 'b.md', session: 's3', horodatageMs: 60, retablieMs: null });
	});

	it('gestes depuis un rang : ceux écrits ensuite seulement', async () => {
		const { etat } = await ouvrir();
		await etat.creer(session('s1'));
		for (const fiche of ['a.md', 'b.md', 'c.md']) await etat.noterGeste({ geste: 'ecartee_ici', session: 's1', fiche, empreinte: null, horodatageMs: 5 });
		const tous = await etat.gestes({ limite: null });
		const deuxieme = tous.find((g) => g.fiche === 'b.md')!.rang;
		expect((await etat.gestes({ depuisRang: deuxieme, limite: null })).map((g) => g.fiche).sort()).toEqual(['b.md', 'c.md']);
	});

	it('dernier message porteur : texte et rang gardés ensemble ; rang écrit dans les entrées de message non muettes seulement', async () => {
		const { etat } = await ouvrir();
		await etat.creer(session('s1'));
		expect(await etat.noterMessagePorteur('inconnue', 'x')).toBeNull();
		expect(await etat.noterMessagePorteur('s1', 'premier')).toBe(1);
		await etat.journaliser({ session: 's1', moment: 'message', horodatageMs: 10, ids: [], texte: 't', ms: 1, sens: false, demande: 'premier', classement: [], muet: null, cartes: [], position: null });
		await etat.journaliser({ session: 's1', moment: 'message', horodatageMs: 11, ids: [], texte: 't', ms: 1, sens: false, demande: '<x>chut</x>', classement: [], muet: 'balise', cartes: [], position: null });
		await etat.journaliser({ session: 's1', moment: 'contexte', horodatageMs: 12, ids: [], texte: 't', ms: 1, sens: false, demande: 'une question', classement: [], muet: null, cartes: [], position: null });
		expect((await etat.servis('s1', 10)).map((e) => e.rangMessage ?? null)).toEqual([null, null, 1]);
		// un message porteur sans rien de servi (pas de journal) devient quand même le dernier
		expect(await etat.noterMessagePorteur('s1', 'second')).toBe(2);
		await etat.noterGeste({ geste: 'retablie', session: 's1', fiche: 'a.md', empreinte: null, horodatageMs: 20 });
		expect(await etat.gestes({ limite: null })).toMatchObject([{ message: 'second', rangMessage: 2 }]);
	});

	it('journal des gestes : la note d’un geste reprend la ligne de la fiche au dernier classement qui la contient (rang, p, signaux)', async () => {
		const { etat } = await ouvrir();
		await etat.creer(session('s1'));
		await etat.noterMessagePorteur('s1', 'le porteur');
		const signaux = { cosinus: 0.8, cosinusRelatif: 0.1, bm25Relatif: 0, signalSession: 0 };
		const classement = [
			{ id: 'a.md', titre: 'A', note: 0.8, servi: false, rang: 1, p: null, signaux, piste: true, raison: 'proche' as const },
			{ id: 'b.md', titre: 'B', note: null, servi: false, rang: 2, p: null, signaux },
		];
		await etat.journaliser({ session: 's1', moment: 'message', horodatageMs: 10, ids: [], texte: '', ms: 1, sens: true, demande: 'le porteur', classement, muet: null, cartes: [{ chemin: 'a.md', raison: 'proche', note: 0.8 }], position: null });
		await etat.noterGeste({ geste: 'ecartee_ici', session: 's1', fiche: 'a.md', empreinte: null, horodatageMs: 20 });
		await etat.noterGeste({ geste: 'ecartee_ici', session: 's1', fiche: 'b.md', empreinte: null, horodatageMs: 21 });
		const [b, a] = await etat.gestes({ limite: null });
		expect(a!.note).toEqual({ note: 0.8, servi: false, rang: 1, p: null, signaux, piste: true, raison: 'proche' });
		// sans note provisoire (pas de sens) : la ligne sans `note`
		expect(b!.note).toEqual({ servi: false, rang: 2, p: null, signaux });
		// la recherche se borne aux 5 dernières entrées de la session
		for (let h = 11; h <= 15; h++) {
			await etat.journaliser({ session: 's1', moment: 'message', horodatageMs: h, ids: [], texte: '', ms: 1, sens: true, demande: null, classement: [], muet: null, cartes: [], position: null });
		}
		await etat.noterGeste({ geste: 'ecartee_ici', session: 's1', fiche: 'a.md', empreinte: null, horodatageMs: 30 });
		expect((await etat.gestes({ limite: 1 }))[0]!.note).toBeNull();
	});

	it('journal des gestes : contexte lu dans la session, note de la carte (JSON), vecteur du même message seulement, origines', async () => {
		const { etat, chemin } = await ouvrir();
		await etat.creer(session('s1', { dossier: 'projets/alpha', position: 'projets/alpha' }));
		await etat.noterMessagePorteur('s1', 'un ancien');
		await etat.noterMessagePorteur('s1', 'le porteur');
		const cartes = [{ chemin: 'b.md', raison: 'perimetre' as const, note: 0.72 }, { chemin: 'c.md', raison: 'perimetre' as const }];
		await etat.journaliser({ session: 's1', moment: 'message', horodatageMs: 10, ids: [], texte: 't', ms: 1, sens: true, demande: 'le porteur', classement: [], muet: null, cartes, position: null });
		await etat.noterCarteProposee('s1', { chemin: 'c.md', empreinte: 'ec', horodatageMs: 10 });
		const vecteur = { modele: 'bge-m3@abc', valeurs: new Float32Array([0.25, -0.5, 1]) };
		await etat.noterGeste({ geste: 'ecartee_ici', session: 's1', fiche: 'b.md', empreinte: 'e1', horodatageMs: 20 });
		await etat.noterGeste({ geste: 'lue_apres_carte', session: 's1', fiche: 'c.md', empreinte: null, horodatageMs: 21, vecteur: { rang: 1, vecteur } });
		await etat.noterGeste({ geste: 'injectee_main', session: 's1', fiche: 'd.md', empreinte: 'e2', horodatageMs: 22, note: { note: 0.9 }, vecteur: { rang: 2, vecteur } });
		await etat.noterGeste({ geste: 'injectee_auto', session: 's1', fiche: 'e.md', empreinte: null, horodatageMs: 23, porteur: { texte: 'explicite', rang: 1 } });
		// session inconnue : rien
		await etat.noterGeste({ geste: 'ecartee_ici', session: 'inconnue', fiche: 'b.md', empreinte: null, horodatageMs: 24 });
		const gestes = await etat.gestes({ limite: null });
		expect(gestes.map((g) => g.geste)).toEqual(['injectee_auto', 'injectee_main', 'lue_apres_carte', 'ecartee_ici']);
		expect(gestes[3]).toEqual({
			rang: expect.any(Number),
			horodatageMs: 20,
			geste: 'ecartee_ici',
			origine: 'utilisateur',
			session: 's1',
			dossier: 'projets/alpha',
			position: 'projets/alpha',
			fiche: 'b.md',
			empreinte: 'e1',
			message: 'le porteur',
			rangMessage: 2,
			note: { note: 0.72 },
			vecteur: null,
			modeleVecteur: null,
		});
		// une carte sans note : note inconnue ; un vecteur d'un autre message que le porteur du geste n'est pas gardé
		expect(gestes[2]).toMatchObject({ fiche: 'c.md', note: null, message: 'le porteur', origine: 'claude', vecteur: null });
		expect(gestes[1]).toMatchObject({ message: 'le porteur', note: { note: 0.9 }, origine: 'utilisateur' });
		expect(gestes[1]!.vecteur?.modele).toBe('bge-m3@abc');
		expect([...gestes[1]!.vecteur!.valeurs]).toEqual([0.25, -0.5, 1]);
		// le modèle du vecteur, lu aussi sans le vecteur
		expect(gestes[1]!.modeleVecteur).toBe('bge-m3@abc');
		expect((await etat.gestes({ sortes: ['injectee_main'], sansVecteur: true, limite: null }))[0]).toMatchObject({ vecteur: null, modeleVecteur: 'bge-m3@abc' });
		expect(gestes[0]).toMatchObject({ origine: 'auto', message: 'explicite', rangMessage: 1, vecteur: null });
		// note en JSON, vecteur en Float32 petit-boutiste, quelle que soit la machine
		const base = new DatabaseSync(chemin);
		const brut = base.prepare("SELECT note, vecteur FROM gestes WHERE geste = 'injectee_main'").get() as { note: string; vecteur: Uint8Array };
		base.close();
		expect(brut.note).toBe('{"note":0.9}');
		expect(new DataView(brut.vecteur.buffer, brut.vecteur.byteOffset).getFloat32(4, true)).toBe(-0.5);
		// filtres : par fiche, depuis un instant, limite ; comptes par sorte et par fiche
		expect((await etat.gestes({ fiche: 'b.md', limite: null })).map((g) => g.horodatageMs)).toEqual([20]);
		expect((await etat.gestes({ session: 'inconnue', limite: null })).length).toBe(0);
		expect((await etat.gestes({ session: 's1', sortes: ['injectee_main'], limite: null })).map((g) => g.fiche)).toEqual(['d.md']);
		expect((await etat.gestes({ depuisMs: 22, limite: null })).map((g) => g.horodatageMs)).toEqual([23, 22]);
		expect((await etat.gestes({ limite: 1 })).map((g) => g.horodatageMs)).toEqual([23]);
		await etat.noterGeste({ geste: 'ecartee_ici', session: 's1', fiche: 'b.md', empreinte: 'e1', horodatageMs: 25 });
		const comptes = await etat.comptesGestes();
		expect([...comptes].sort((a, b) => a.fiche.localeCompare(b.fiche) || a.geste.localeCompare(b.geste))).toEqual([
			{ geste: 'ecartee_ici', fiche: 'b.md', nombre: 2 },
			{ geste: 'lue_apres_carte', fiche: 'c.md', nombre: 1 },
			{ geste: 'injectee_main', fiche: 'd.md', nombre: 1 },
			{ geste: 'injectee_auto', fiche: 'e.md', nombre: 1 },
		]);
		// nombre de gestes (sans lire une ligne) : mêmes filtres que la lecture
		for (const f of [{}, { depuisMs: 22 }, { sortes: ['ecartee_ici', 'injectee_main'] as const }, { depuisMs: 21, sortes: ['ecartee_ici'] as const }]) {
			expect(await etat.nombreGestes(f)).toBe((await etat.gestes({ ...f, limite: null })).length);
		}
		expect(await etat.nombreGestes({ sortes: ['ecartee_ici'] })).toBe(2);
		expect(await etat.nombreGestes({ sortes: [] })).toBe(0);
	});

	it('lue après carte : seulement après une proposition, une fois par proposition, même après /clear ; une nouvelle proposition recompte', async () => {
		const { etat } = await ouvrir();
		await etat.creer(session('s1'));
		await etat.creer(session('s2'));
		const lue = (session: string, ms: number) => etat.noterGeste({ geste: 'lue_apres_carte', session, fiche: 'a.md', empreinte: null, horodatageMs: ms });
		await lue('s1', 5);
		await etat.noterCarteProposee('s1', { chemin: 'a.md', empreinte: 'e', horodatageMs: 10 });
		await lue('s1', 11);
		await lue('s1', 12);
		// une autre session : sa propre proposition
		await lue('s2', 13);
		await etat.oublierInjections('s1');
		await lue('s1', 14);
		await etat.noterCarteProposee('s1', { chemin: 'a.md', empreinte: 'e', horodatageMs: 20 });
		await lue('s1', 21);
		await lue('s1', 22);
		expect((await etat.gestes({ limite: null })).map((g) => [g.session, g.horodatageMs])).toEqual([
			['s1', 21],
			['s1', 11],
		]);
	});

	it('journal des gestes : sans message porteur, message nul ; sans limite de 200 ; gardé après /clear', async () => {
		const { etat } = await ouvrir();
		await etat.creer(session('s1'));
		for (let i = 0; i < 205; i++) await etat.noterGeste({ geste: 'ecartee_ici', session: 's1', fiche: `f${i}.md`, empreinte: null, horodatageMs: i });
		await etat.oublierInjections('s1');
		const gestes = await etat.gestes({ limite: null });
		expect(gestes).toHaveLength(205);
		expect(gestes[0]).toMatchObject({ message: null, rangMessage: 0, position: 'a/b' });
	});

	it('supprimer une session garde ses gestes sans le texte ni le vecteur de ses messages ; ceux des autres sessions sont intacts', async () => {
		const { etat, chemin } = await ouvrir();
		await etat.creer(session('s1'));
		await etat.creer(session('s2'));
		const vecteur = { modele: 'bge-m3@abc', valeurs: new Float32Array([1, 0]) };
		// d'autres gestes de s1, entre ceux de s2, avant le dernier : leurs textes effacés laissent des trous au milieu des pages
		for (let i = 0; i < 5; i++) {
			await etat.noterGeste({ geste: 'ecartee_ici', session: 's1', fiche: `f${i}.md`, empreinte: null, horodatageMs: 0, porteur: { texte: `texte-confidentiel-du-message ${i} ${'x'.repeat(300)}`, rang: 1 } });
			await etat.noterGeste({ geste: 'ecartee_ici', session: 's2', fiche: `f${i}.md`, empreinte: null, horodatageMs: 0, porteur: { texte: `un autre message ${i}`, rang: 1 } });
		}
		await etat.noterGeste({ geste: 'injectee_main', session: 's1', fiche: 'a.md', empreinte: 'e', horodatageMs: 1, porteur: { texte: 'texte-confidentiel-du-message', rang: 1 }, vecteur: { rang: 1, vecteur } });
		await etat.noterGeste({ geste: 'injectee_main', session: 's2', fiche: 'a.md', empreinte: 'e', horodatageMs: 2, porteur: { texte: 'autre', rang: 1 }, vecteur: { rang: 1, vecteur } });
		await etat.modifier('s1', { etat: 'terminee' });
		expect(await etat.supprimer('s1')).toBe('supprimee');
		const gestes = await etat.gestes({ depuisMs: 1, limite: null });
		expect(gestes).toMatchObject([
			{ session: 's2', message: 'autre' },
			{ session: 's1', message: null, vecteur: null, fiche: 'a.md', empreinte: 'e', geste: 'injectee_main', rangMessage: 1 },
		]);
		expect(gestes[0]!.vecteur?.modele).toBe('bge-m3@abc');
		const base = new DatabaseSync(chemin);
		expect(base.prepare("SELECT modele_vecteur, vecteur FROM gestes WHERE session = 's1'").get()).toEqual({ modele_vecteur: null, vecteur: null });
		base.close();
		// effacé du fichier lui-même (secure_delete), pas seulement libéré
		etat.fermer();
		ouverts.pop();
		const contenu = [chemin, `${chemin}-wal`].filter((f) => existsSync(f)).map((f) => readFileSync(f));
		expect(contenu.some((c) => c.includes(Buffer.from('texte-confidentiel-du-message')))).toBe(false);
	});

	it('refuse une version de schéma inconnue sans rien effacer', async () => {
		const { etat, chemin } = await ouvrir();
		await etat.creer(session('s1'));
		etat.fermer();
		ouverts.pop();
		const base = new DatabaseSync(chemin);
		base.exec('PRAGMA user_version = 99');
		base.close();
		expect(() => ouvrirEtat(chemin)).toThrow(/version/i);
		const base2 = new DatabaseSync(chemin);
		expect(base2.prepare('SELECT count(*) AS n FROM sessions').get()).toEqual({ n: 1 });
		base2.close();
	});

	it('10 processus appliquent 50 événements chacun : rien de perdu, l\'état final est le plus récent', async () => {
		const { etat, chemin, dossier } = await ouvrir();
		await etat.creer(session('s1'));
		// en URL `file:` : un chemin absolu Windows (`D:\…`) n'est pas un spécificateur d'import valide
		const adaptateur = pathToFileURL(resolve(import.meta.dirname, '../../src/infra/etat-sqlite.ts')).href;
		const script = join(dossier, 'ecrivain.mjs');
		await mkdir(dossier, { recursive: true });
		await writeFile(
			script,
			`import { ouvrirEtat } from ${JSON.stringify(adaptateur)};
const [chemin, p] = [process.argv[2], Number(process.argv[3])];
const etat = ouvrirEtat(chemin);
const evenements = ['message', 'outil', 'arret'];
for (let i = 0; i < 50; i++) {
	const t = 100 + i * 10 + p;
	// l'événement le plus récent (i = 49, p = 9) est un arret
	const e = t === 100 + 49 * 10 + 9 ? 'arret' : (['message', 'outil'])[(i + p) % 2];
	await etat.appliquer('s1', e, t);
}
etat.fermer();
`,
		);
		const codes = await Promise.all(
			Array.from({ length: 10 }, (_, p) =>
				new Promise<{ code: number | null; err: string }>((fini) => {
					const enfant = spawn(process.execPath, [script, chemin, String(p)], { stdio: ['ignore', 'ignore', 'pipe'] });
					let err = '';
					enfant.stderr.on('data', (d) => (err += d));
					enfant.on('close', (code) => fini({ code, err }));
				}),
			),
		);
		for (const c of codes) expect(c).toEqual({ code: 0, err: '' });
		const final = await etat.lire('s1');
		expect(final).toMatchObject({ etat: 'attend', majMs: 100 + 49 * 10 + 9 });
	}, 60_000);

	it('n\'ouvre rien tant qu\'on ne s\'en sert pas, puis prépare .mnemo avec son .gitignore', async () => {
		const dossier = await dossierTemporaire();
		const etat = etatParesseux(dossier);
		etat.fermer();
		expect(existsSync(join(dossier, '.mnemo'))).toBe(false);
		await etat.lister();
		expect(existsSync(join(dossier, '.mnemo', 'etat.sqlite'))).toBe(true);
		expect(readFileSync(join(dossier, '.mnemo', '.gitignore'), 'utf8')).toBe('*\n');
		etat.fermer();
	});
});

describe('etat.sqlite : attente bornée (hooks)', () => {
	it('attenteMaxMs : base verrouillée en écriture → l’ouverture échoue vite ; sans verrou, tout fonctionne', async () => {
		const { etat, chemin } = await ouvrir();
		await etat.creer(session('s1'));
		const autre = new DatabaseSync(chemin);
		autre.exec('BEGIN IMMEDIATE');
		try {
			const debut = Date.now();
			expect(() => ouvrirEtat(chemin, { attenteMaxMs: 150 })).toThrow(/locked|busy/i);
			const duree = Date.now() - debut;
			expect(duree).toBeGreaterThanOrEqual(140);
			expect(duree).toBeLessThanOrEqual(150 + 50 * TOLERANCE);
		} finally {
			autre.exec('ROLLBACK');
			autre.close();
		}
		const borne = ouvrirEtat(chemin, { attenteMaxMs: 150 });
		ouverts.push(borne);
		expect((await borne.appliquer('s1', 'message', 5))?.etat).toBe('travaille');
	});

	it('attenteMaxMs : une écriture sur base verrouillée échoue dans la borne', async () => {
		const { chemin } = await ouvrir();
		const borne = ouvrirEtat(chemin, { attenteMaxMs: 150 });
		ouverts.push(borne);
		await borne.creer(session('s1'));
		const autre = new DatabaseSync(chemin);
		autre.exec('BEGIN IMMEDIATE');
		try {
			const debut = Date.now();
			await expect(borne.appliquer('s1', 'message', 5)).rejects.toThrow(/locked|busy/i);
			expect(Date.now() - debut).toBeLessThanOrEqual(150 + 50 * TOLERANCE);
			const avant = Date.now();
			await expect(borne.journaliser({ session: 's1', moment: 'message', horodatageMs: 1, ids: [], texte: 'x', ms: 1, sens: false, demande: null, classement: [], muet: null, cartes: [], position: null })).rejects.toThrow(/locked|busy/i);
			expect(Date.now() - avant).toBeLessThanOrEqual(150 + 50 * TOLERANCE);
			// une lecture n'attend pas l'écrivain (WAL)
			expect((await borne.lire('s1'))?.etat).toBe('attend');
		} finally {
			autre.exec('ROLLBACK');
			autre.close();
		}
	});
});

describe.skipIf(process.platform === 'win32')('etat.sqlite : droits', () => {
	it('base, -wal et -shm en 0600 ; .mnemo/ créé en 0700', async () => {
		const racine = await dossierTemporaire();
		const local = preparerDossierLocal(racine);
		expect(statSync(local).mode & 0o777).toBe(0o700);
		const chemin = join(local, 'etat.sqlite');
		const etat = ouvrirEtat(chemin);
		ouverts.push(etat);
		await etat.creer(session('11111111-1111-4111-8111-111111111111'));
		for (const f of [chemin, `${chemin}-wal`, `${chemin}-shm`]) expect(statSync(f).mode & 0o777, f).toBe(0o600);
	});

	it('.mnemo/ existant trop ouvert : remis en 0700 ; index.sqlite et verrou présents remis en 0600', async () => {
		const racine = await dossierTemporaire();
		const local = join(racine, '.mnemo');
		await mkdir(local, { mode: 0o755 });
		chmodSync(local, 0o755);
		for (const nom of ['index.sqlite', 'verrou']) {
			await writeFile(join(local, nom), '');
			chmodSync(join(local, nom), 0o644);
		}
		expect(preparerDossierLocal(racine)).toBe(local);
		expect(statSync(local).mode & 0o777).toBe(0o700);
		for (const nom of ['index.sqlite', 'verrou']) expect(statSync(join(local, nom)).mode & 0o777, nom).toBe(0o600);
		// absents : rien n'est créé
		const autre = await dossierTemporaire();
		preparerDossierLocal(autre);
		expect(existsSync(join(autre, '.mnemo', 'verrou'))).toBe(false);
		expect(existsSync(join(autre, '.mnemo', 'index.sqlite'))).toBe(false);
	});
});
