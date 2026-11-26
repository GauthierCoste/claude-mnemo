import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import type { Lots } from '../../src/application/ports.ts';
import type { Lot } from '../../src/domaine/lot.ts';
import { ouvrirEtat, ouvrirLots, VERSION_ETAT } from '../../src/infra/etat-sqlite.ts';
import { dossierTemporaire } from '../aides/dossier-temporaire.ts';

const ouverts: { fermer(): void }[] = [];
afterEach(() => {
	while (ouverts.length > 0) ouverts.pop()!.fermer();
});

async function ouvrir(chemin?: string): Promise<{ lots: Lots; chemin: string }> {
	const fichier = chemin ?? join(await dossierTemporaire(), 'etat.sqlite');
	const lots = ouvrirLots(fichier);
	ouverts.push(lots);
	return { lots, chemin: fichier };
}

const lot = (id: string, proposeMs: number): Lot => ({ id, genre: 'fusionner', fiche: 'clients/acme.md', lignes: [{ garder: 'f-0001', absorber: ['f-0002'] }], motif: 'Doublons', empreinte: 'abcd', proposeMs, session: null });

describe('lots d\'informations dans etat.sqlite', () => {
	it('survivent à la fermeture (redémarrage du service) ; décidés une seule fois ; la version change à chaque proposition et décision', async () => {
		const { lots, chemin } = await ouvrir();
		const v0 = await lots.version();
		await lots.enregistrer(lot('L1', 10));
		await lots.enregistrer(lot('L2', 20));
		const v1 = await lots.version();
		expect(v1).not.toBe(v0);
		lots.fermer();
		ouverts.pop();

		const { lots: rouverts } = await ouvrir(chemin);
		expect(await rouverts.enAttente()).toEqual([lot('L1', 10), lot('L2', 20)]);
		expect(await rouverts.lire('L2')).toEqual(lot('L2', 20));
		expect(await rouverts.decider('L1', { sort: 'valide', lignes: [0], commit: 'c1' }, 30)).toBe(true);
		expect(await rouverts.decider('L1', { sort: 'rejete' }, 31)).toBe(false);
		expect(await rouverts.version()).not.toBe(v1);
		expect(await rouverts.lire('L1')).toBeNull();
		expect(await rouverts.enAttente()).toEqual([lot('L2', 20)]);
		expect(await rouverts.decides(-1, 10)).toEqual([{ ...lot('L1', 10), decision: { sort: 'valide', lignes: [0], commit: 'c1' }, decideMs: 30 }]);
		expect(await rouverts.decides(30, 10)).toEqual([]);
	});

	it('même fichier que l\'état des sessions : les deux s\'ouvrent ensemble', async () => {
		const { lots, chemin } = await ouvrir();
		const etat = ouvrirEtat(chemin);
		ouverts.push(etat);
		await lots.enregistrer(lot('L1', 10));
		expect(await etat.lister()).toEqual([]);
		expect(await lots.enAttente()).toHaveLength(1);
	});

	it('les empreintes des informations visées font l\'aller-retour ; un lot sans elles est relu sans elles', async () => {
		const { lots, chemin } = await ouvrir();
		const avec: Lot = { ...lot('L1', 10), empreintes: { 'f-0001': '0123456789abcdef', 'f-0002': 'fedcba9876543210' } };
		await lots.enregistrer(avec);
		await lots.enregistrer(lot('L2', 20));
		lots.fermer();
		ouverts.pop();
		const { lots: rouverts } = await ouvrir(chemin);
		expect(await rouverts.enAttente()).toEqual([avec, lot('L2', 20)]);
		expect((await rouverts.lire('L2'))).not.toHaveProperty('empreintes');
		expect(await rouverts.decider('L1', { sort: 'perime' }, 30)).toBe(true);
		expect((await rouverts.decides(-1, 10))[0]).toMatchObject({ id: 'L1', empreintes: avec.empreintes, decision: { sort: 'perime' } });
	});

	it('migration d\'un état en version 15 (lots sans empreintes par information) : la colonne s\'ajoute, les lots d\'avant sont relus sans elles', async () => {
		const chemin = join(await dossierTemporaire(), 'etat.sqlite');
		ouvrirEtat(chemin).fermer();
		const base = new DatabaseSync(chemin);
		base.exec('ALTER TABLE lots DROP COLUMN empreintes');
		base.prepare('INSERT INTO lots (id, genre, fiche, lignes, motif, empreinte, propose_ms, session) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run('L1', 'fusionner', 'clients/acme.md', JSON.stringify([{ garder: 'f-0001', absorber: ['f-0002'] }]), 'Doublons', 'abcd', 10, null);
		base.exec('PRAGMA user_version = 15');
		base.close();
		const { lots } = await ouvrir(chemin);
		expect(await lots.enAttente()).toEqual([lot('L1', 10)]);
		const avec: Lot = { ...lot('L2', 20), empreintes: { 'f-0003': '0123456789abcdef' } };
		await lots.enregistrer(avec);
		expect(await lots.lire('L2')).toEqual(avec);
		const verif = new DatabaseSync(chemin);
		expect(verif.prepare('PRAGMA user_version').get()).toEqual({ user_version: VERSION_ETAT });
		verif.close();
	});

	it('migration d\'un état en version 10 (sans table des lots) : la table s\'ajoute, rien n\'est perdu', async () => {
		const chemin = join(await dossierTemporaire(), 'etat.sqlite');
		const etat = ouvrirEtat(chemin);
		await etat.noterRattachement('projets/x', false, 7);
		etat.fermer();
		const base = new DatabaseSync(chemin);
		base.exec('DROP TABLE lots');
		base.exec('PRAGMA user_version = 10');
		base.close();
		const { lots } = await ouvrir(chemin);
		await lots.enregistrer(lot('L1', 10));
		expect(await lots.enAttente()).toEqual([lot('L1', 10)]);
		const rouvert = ouvrirEtat(chemin);
		ouverts.push(rouvert);
		expect(await rouvert.dossiersNonRattaches()).toEqual([{ dossier: 'projets/x', vuMs: 7 }]);
		const verif = new DatabaseSync(chemin);
		expect(verif.prepare('PRAGMA user_version').get()).toEqual({ user_version: VERSION_ETAT });
		verif.close();
	});
});
