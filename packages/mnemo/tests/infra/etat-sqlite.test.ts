import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
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

/** Retire ce que la version 12 a ajouté (niveau des modèles d'une session). */
function sansVersion12(base: DatabaseSync): void {
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
		expect(tous[0]).toEqual({ session: 's1', moment: 'message', horodatageMs: 249, ids: ['a', 'b'], texte: 't249', ms: 249, sens: false, demande: null, classement: [], muet: null, cartes: [], position: null });
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

	it('écartés : écarter (une fois), lister, rétablir ; trace gardée ; effacés quand la session se termine (fin ou modifier)', async () => {
		const { etat, chemin } = await ouvrir();
		await etat.creer(session('s1'));
		await etat.creer(session('s2'));
		const trace = { dossier: 'code/x', demande: 'la demande', horodatageMs: 100 };
		await etat.ecarter('s1', { id: 'a.md', titre: 'A' }, trace);
		await etat.ecarter('s1', { id: 'a.md', titre: 'A' }, { ...trace, horodatageMs: 101 });
		await etat.ecarter('s1', { id: 'b.md#^f-0001', titre: 'B' }, trace);
		await etat.ecarter('s2', { id: 'c.md', titre: 'C' }, trace);
		expect(await etat.ecartes('s1')).toEqual([
			{ id: 'a.md', titre: 'A', horodatageMs: 100 },
			{ id: 'b.md#^f-0001', titre: 'B', horodatageMs: 100 },
		]);
		expect(await etat.retablir('s1', 'a.md')).toBe(true);
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

	it('écarter ou rétablir sur une session terminée ou inconnue : refusé (false), rien noté', async () => {
		const { etat } = await ouvrir();
		await etat.creer(session('s1', { etat: 'terminee' }));
		expect(await etat.ecarter('s1', { id: 'a.md', titre: 'A' }, { dossier: '', demande: null, horodatageMs: 1 })).toBe(false);
		expect(await etat.ecarter('inconnue', { id: 'a.md', titre: 'A' }, { dossier: '', demande: null, horodatageMs: 1 })).toBe(false);
		expect(await etat.ecartes('s1')).toEqual([]);
		expect(await etat.retablir('s1', 'a.md')).toBe(false);
		expect(await etat.retablir('inconnue', 'a.md')).toBe(false);
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
		expect(await rouvert.ecarter('s1', { id: 'a.md', titre: 'A' }, { dossier: '', demande: null, horodatageMs: 1 })).toBe(true);
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
		await etat.noterMessagePorteur('s1');
		await etat.noterInjectionManuelle('s1', 'a.md');
		expect(await etat.injectionsManuelles('s1')).toEqual([{ chemin: 'a.md', messages: 0 }]);
		await etat.noterMessagePorteur('s1');
		await etat.noterInjectionManuelle('s1', 'b.md');
		await etat.noterMessagePorteur('s1');
		await etat.noterMessagePorteur('s2');
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
		await rouvert.noterMessagePorteur('s1');
		await rouvert.noterInjectionManuelle('s1', 'a.md');
		await rouvert.noterMessagePorteur('s1');
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
		const adaptateur = resolve(import.meta.dirname, '../../src/infra/etat-sqlite.ts');
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
