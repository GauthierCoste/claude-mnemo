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
		await etat.journaliser({ session: 's1', moment: 'message', horodatageMs: 10 + i, ids: [], texte: '', ms: 0, sens: false, demande, classement: [], muet: demande === 'oui' ? 'sans_contenu' : null, cartes: [], position: null });
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

	it('une version antérieure à 11 est refusée clairement, sans migration', async () => {
		const chemin = await etatEnVersion(10);
		expect(() => ouvrirJournalEnLecture(chemin)).toThrow(/version 10 : le banc lit la version 11 ou plus/u);
		expect(versionDe(chemin).v).toBe(10);
	});

	it('base absente : erreur, rien n’est créé', async () => {
		const chemin = join(await dossierTemporaire(), 'etat.sqlite');
		expect(() => ouvrirJournalEnLecture(chemin)).toThrow('absent');
	});
});
