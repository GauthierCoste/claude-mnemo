import { describe, expect, it } from 'vitest';
import { proposer } from '../../src/application/proposer.ts';
import { SANS_EXTRACTION, synchroniser } from '../../src/application/synchroniser.ts';
import { choixDesTypesAConfirmer, phraseDesTypes, typesDuCoffre } from '../../src/application/types-du-coffre.ts';
import { lireReglages, modifierReglages } from '../../src/domaine/reglages.ts';
import { fauxPorts } from '../aides/faux-ports.ts';

async function memoire() {
	const dep = fauxPorts();
	await proposer(dep, { genre: 'fiche', chemin: 'clients/lea.md', type: 'personne', titre: 'Léa' });
	await proposer(dep, { genre: 'fiche', chemin: 'clients/marc.md', type: 'personne', titre: 'Marc' });
	await proposer(dep, { genre: 'fiche', chemin: 'clients/acme.md', type: 'organisation', titre: 'Acme' });
	await synchroniser(dep, SANS_EXTRACTION);
	return dep;
}

describe('types du coffre', () => {
	it('dérive les types des fiches, les plus employés d’abord', async () => {
		const types = await typesDuCoffre(await memoire());
		expect(types[0]).toEqual({ type: 'personne', fiches: 2 });
		expect(types).toContainEqual({ type: 'organisation', fiches: 1 });
	});

	it('choix du réglage : types du coffre sans profil, plus les types cochés que plus aucune fiche ne porte', async () => {
		const choix = (await choixDesTypesAConfirmer(await memoire(), ['recette'])).map((c) => c.valeur);
		expect(choix).toEqual(expect.arrayContaining(['personne', 'organisation', 'dossier', 'recette']));
		expect(choix).not.toContain('profil');
		expect(choix.at(-1)).toBe('recette');
	});

	it('le réglage accepte tout type de forme valide et refuse un type mal formé', () => {
		expect(modifierReglages(lireReglages({}).reglages, { 'archiviste.typesAConfirmer': ['personne', 'consigne'] }).ok).toBe(true);
		expect(modifierReglages(lireReglages({}).reglages, { 'archiviste.typesAConfirmer': ['Pas Bien'] }).ok).toBe(false);
	});
});

describe('phrase des types pour Claude', () => {
	it('cite les types réservés, puis les types libres employés avec leur nombre de fiches', () => {
		const phrase = phraseDesTypes([
			{ type: 'source', fiches: 9 },
			{ type: 'personne', fiches: 4 },
			{ type: 'organisation', fiches: 1 },
		]);
		expect(phrase).toContain('réservés consigne, profil, source, episode, dossier');
		expect(phrase).toContain('libres déjà employés : personne (4), organisation (1).');
		expect(phraseDesTypes([])).toContain('aucun pour l’instant');
	});
});
