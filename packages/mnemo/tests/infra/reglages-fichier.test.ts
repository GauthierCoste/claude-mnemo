import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REGLAGES_PAR_DEFAUT } from '../../src/domaine/reglages.ts';
import { ecrireReglagesDuDossier, lireReglagesDuDossier, reglagesDuDossier } from '../../src/infra/reglages-fichier.ts';
import { dependancesReelles } from '../../src/infra/systeme.ts';
import { dossierTemporaire } from '../aides/dossier-temporaire.ts';

const fichier = (racine: string) => join(racine, '.mnemo', 'reglages.json');

describe('.mnemo/reglages.json', () => {
	it('absent : les défauts, sans avertissement, et rien n’est créé', async () => {
		const racine = await dossierTemporaire();
		expect(lireReglagesDuDossier(racine)).toEqual({ reglages: REGLAGES_PAR_DEFAUT, avertissements: [] });
		expect(existsSync(join(racine, '.mnemo'))).toBe(false);
	});

	it('JSON illisible : les défauts et un avertissement qui nomme le fichier', async () => {
		const racine = await dossierTemporaire();
		mkdirSync(join(racine, '.mnemo'));
		writeFileSync(fichier(racine), '{ "projets": ');
		const r = lireReglagesDuDossier(racine);
		expect(r.reglages).toEqual(REGLAGES_PAR_DEFAUT);
		expect(r.avertissements).toEqual([expect.stringMatching(/\.mnemo\/reglages\.json.*JSON.*défaut/u)]);
	});

	it('écriture atomique : seulement les écarts au défaut, droits 0600, aucun fichier provisoire laissé ; .mnemo/ préparé', async () => {
		const racine = await dossierTemporaire();
		const reglages = { ...REGLAGES_PAR_DEFAUT, modeles: { inactiviteMinutes: 30 } };
		ecrireReglagesDuDossier(racine, reglages);
		expect(JSON.parse(readFileSync(fichier(racine), 'utf8'))).toEqual({ modeles: { inactiviteMinutes: 30 } });
		if (process.platform !== 'win32') expect(statSync(fichier(racine)).mode & 0o777).toBe(0o600);
		expect(readdirSync(join(racine, '.mnemo')).sort()).toEqual(['.gitignore', 'reglages.json']);
		expect(lireReglagesDuDossier(racine).reglages).toEqual(reglages);
	});

	it('écriture en échec : l’ancien fichier reste intact, le provisoire est retiré', async () => {
		const racine = await dossierTemporaire();
		ecrireReglagesDuDossier(racine, { ...REGLAGES_PAR_DEFAUT, modeles: { inactiviteMinutes: 20 } });
		const avant = readFileSync(fichier(racine), 'utf8');
		// une valeur qui ne se sérialise pas fait échouer l'écriture avant le remplacement
		const casse = { ...REGLAGES_PAR_DEFAUT, modeles: { inactiviteMinutes: 10n as unknown as number } };
		expect(() => ecrireReglagesDuDossier(racine, casse)).toThrow();
		expect(readFileSync(fichier(racine), 'utf8')).toBe(avant);
		expect(readdirSync(join(racine, '.mnemo')).sort()).toEqual(['.gitignore', 'reglages.json']);
	});

	it('reglagesDuDossier suit le fichier (relu quand il change) ; dependancesReelles le branche', async () => {
		const racine = await dossierTemporaire();
		const lire = reglagesDuDossier(racine);
		expect(lire()).toEqual(REGLAGES_PAR_DEFAUT);
		ecrireReglagesDuDossier(racine, { ...REGLAGES_PAR_DEFAUT, contexte: { ...REGLAGES_PAR_DEFAUT.contexte, cartesNommees: 7 } });
		expect(lire().contexte.cartesNommees).toBe(7);
		expect(dependancesReelles(racine).reglages().contexte.cartesNommees).toBe(7);
	});
});
