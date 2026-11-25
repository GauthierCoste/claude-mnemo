import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { messagesDuJournal } from '../../src/application/banc-extraire.ts';
import type { Session } from '../../src/domaine/session.ts';
import { ouvrirEtat } from '../../src/infra/etat-sqlite.ts';
import { ouvrirJournalEnLecture } from '../../src/infra/journal-en-lecture.ts';
import { dossierTemporaire } from '../aides/dossier-temporaire.ts';

const session = (id: string): Session => ({
	id,
	profil: 'dev',
	dossier: 'atelier',
	position: 'projets/atelier-vitrail',
	projet: 'episodes/x',
	objectif: null,
	etat: 'terminee',
	creeeMs: 1,
	majMs: 1,
	arretAttendu: null,
	bilanDemandeMs: null,
	commitDebut: null,
	branche: null,
	pid: null,
});

/** Un état écrit par ce Mnemo, puis ramené à la version demandée (11 : sans le niveau des modèles d'une session, ajouté en 12). */
async function etatEnVersion(version: number): Promise<string> {
	const chemin = join(await dossierTemporaire(), 'etat.sqlite');
	const etat = ouvrirEtat(chemin);
	await etat.creer(session('s1'));
	for (const [i, demande] of ['Comment cuire les grisailles du vitrail ?', 'oui', 'Et les températures du four pour la cuisson ?'].entries()) {
		await etat.journaliser({ session: 's1', moment: 'message', horodatageMs: 10 + i, ids: i === 0 ? ['pratiques/four.md'] : [], texte: '', ms: 0, sens: false, demande, classement: [], muet: demande === 'oui' ? 'sans_contenu' : null, cartes: [], position: null });
	}
	etat.fermer();
	const base = new DatabaseSync(chemin);
	if (version <= 11) base.exec('ALTER TABLE sessions DROP COLUMN niveau_modeles');
	base.exec(`PRAGMA user_version = ${version}`);
	base.close();
	return chemin;
}

const versionDe = (chemin: string) => {
	const base = new DatabaseSync(chemin, { readOnly: true });
	const v = Number((base.prepare('PRAGMA user_version').get() as { user_version: number }).user_version);
	const colonnes = (base.prepare('PRAGMA table_info(sessions)').all() as { name: string }[]).map((c) => c.name);
	base.close();
	return { v, niveau: colonnes.includes('niveau_modeles') };
};

describe('ouvrirJournalEnLecture', () => {
	it('une base en version 11, lue par l’extraction, reste en version 11, sans colonne ajoutée ni octet changé', async () => {
		const chemin = await etatEnVersion(11);
		const avant = readFileSync(chemin);
		const journal = ouvrirJournalEnLecture(chemin);
		expect(journal.version).toBe(11);
		const messages = await messagesDuJournal(journal);
		journal.fermer();
		expect(messages.map((m) => [m.rang, m.message, m.position])).toEqual([
			[1, 'Comment cuire les grisailles du vitrail ?', 'projets/atelier-vitrail'],
			[2, 'Et les températures du four pour la cuisson ?', 'projets/atelier-vitrail'],
		]);
		// fiches injectées entières, relues du journal (signal des injections à la main)
		expect(messages[0]!.injectionsDuJournal).toEqual([{ chemin: 'pratiques/four.md', messages: 0, position: null }]);
		expect(messages[1]!.injectionsDuJournal).toEqual([{ chemin: 'pratiques/four.md', messages: 1, position: null }]);
		expect(versionDe(chemin)).toEqual({ v: 11, niveau: false });
		expect(readFileSync(chemin).equals(avant)).toBe(true);
	});

	it('une version plus récente (13, d’une autre branche) est lue telle quelle, sans être touchée', async () => {
		const chemin = await etatEnVersion(13);
		const journal = ouvrirJournalEnLecture(chemin);
		expect(await messagesDuJournal(journal)).toHaveLength(2);
		journal.fermer();
		expect(versionDe(chemin).v).toBe(13);
	});

	it('banc : la trace d’un /clear au journal (entrée de début) arrête le message d’avant, comme au hook', async () => {
		const chemin = await etatEnVersion(13);
		const etat = ouvrirEtat(chemin);
		await etat.journaliser({ session: 's1', moment: 'debut', horodatageMs: 11, ids: [], texte: '', ms: 0, sens: false, demande: null, classement: [], muet: null, cartes: [], position: null });
		etat.fermer();
		const journal = ouvrirJournalEnLecture(chemin);
		const messages = await messagesDuJournal(journal);
		journal.fermer();
		expect(messages.map((m) => [m.message, m.precedent])).toEqual([
			['Comment cuire les grisailles du vitrail ?', null],
			['Et les températures du four pour la cuisson ?', null],
		]);
	});

	it('une version antérieure à 11 est refusée clairement, sans migration', async () => {
		const chemin = await etatEnVersion(10);
		expect(() => ouvrirJournalEnLecture(chemin)).toThrow(/version 10 : le banc lit la version 11 ou plus/u);
		expect(versionDe(chemin).v).toBe(10);
	});

	it('gestes (version 13) : journal des gestes, vecteurs, écartées toujours actives et dossiers, sans un octet changé', async () => {
		const chemin = join(await dossierTemporaire(), 'etat.sqlite');
		const etat = ouvrirEtat(chemin);
		await etat.creer(session('s1'));
		await etat.noterMessagePorteur('s1', 'les grisailles');
		const vecteur = { rang: 1, vecteur: { modele: 'sens@1', valeurs: Float32Array.from([0.5, -0.25]) } };
		await etat.noterGeste({ geste: 'injectee_main', session: 's1', fiche: 'pratiques/four.md', empreinte: null, horodatageMs: 20, vecteur });
		await etat.ecarterToujours({ fiche: 'notes/a.md', session: 's1', horodatageMs: 30 });
		await etat.ecarterToujours({ fiche: 'notes/b.md', session: 's1', horodatageMs: 31 });
		await etat.retablirToujours('notes/b.md', 32);
		etat.fermer();
		const avant = readFileSync(chemin);
		const journal = ouvrirJournalEnLecture(chemin);
		const gestes = await journal.gestes();
		journal.fermer();
		expect(gestes?.gestes).toEqual([
			{ geste: 'injectee_main', session: 's1', rangMessage: 1, horodatageMs: 20, dossier: 'atelier', position: 'projets/atelier-vitrail', fiche: 'pratiques/four.md', vecteur: { modele: 'sens@1', valeurs: Float32Array.from([0.5, -0.25]) } },
		]);
		expect(gestes?.ecarteesToujours).toEqual(new Set(['notes/a.md']));
		expect(gestes?.dossierDe).toEqual(new Map([['s1', 'atelier']]));
		expect(readFileSync(chemin).equals(avant)).toBe(true);
	});

	it('sans journal des gestes (version 12) : null, l’a priori du banc vaut 0', async () => {
		const chemin = await etatEnVersion(12);
		const base = new DatabaseSync(chemin);
		base.exec('DROP TABLE gestes');
		base.exec('DROP TABLE ecartees_toujours');
		base.close();
		const journal = ouvrirJournalEnLecture(chemin);
		expect(await journal.gestes()).toBeNull();
		journal.fermer();
	});

	it('base absente : erreur, rien n’est créé', async () => {
		const chemin = join(await dossierTemporaire(), 'etat.sqlite');
		expect(() => ouvrirJournalEnLecture(chemin)).toThrow('absent');
	});
});
