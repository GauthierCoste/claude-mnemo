import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { COEFFICIENTS_NOTE } from '../../src/domaine/coefficients-note.ts';
import { jsonDeCoefficients, modeleNonAppris } from '../../src/domaine/modele-de-note.ts';
import type { CoefficientsNote } from '../../src/domaine/modele-de-note.ts';
import { fichierDesCoefficients, ggufInstalles, lireCoefficientsDuDossier, noteDuDossier } from '../../src/infra/coefficients-note-fichier.ts';
import { dependancesReelles } from '../../src/infra/systeme.ts';
import { dossierTemporaire } from '../aides/dossier-temporaire.ts';

const INSTALLES = { sens: 'sens.gguf@aaaaaaaaaaaa', reranker: 'reranker.gguf@bbbbbbbbbbbb' };
const appris = (biais: number): CoefficientsNote => ({
	complets: modeleNonAppris(),
	sens: { ...modeleNonAppris(), apprisLe: '2026-11-25', accepte: true, refus: [], biais, poids: { cosinusRelatif: 3 }, gguf: INSTALLES },
});
const ecrire = (racine: string, texte: string) => {
	mkdirSync(join(racine, '.mnemo'), { recursive: true });
	writeFileSync(fichierDesCoefficients(racine), texte);
};

describe('.mnemo/coefficients-note.json', () => {
	it('absent : le module du dépôt, sans avertissement', async () => {
		expect(lireCoefficientsDuDossier(await dossierTemporaire())).toEqual({ coefficients: COEFFICIENTS_NOTE, avertissement: null });
	});

	it('présent et valide : chargé en priorité', async () => {
		const racine = await dossierTemporaire();
		ecrire(racine, jsonDeCoefficients(appris(-1)));
		expect(lireCoefficientsDuDossier(racine)).toEqual({ coefficients: appris(-1), avertissement: null });
	});

	it('illisible ou invalide : le module du dépôt, avec un avertissement', async () => {
		const racine = await dossierTemporaire();
		ecrire(racine, '{ "sens": ');
		expect(lireCoefficientsDuDossier(racine)).toEqual({ coefficients: COEFFICIENTS_NOTE, avertissement: expect.stringContaining('invalide') });
		ecrire(racine, JSON.stringify({ sens: appris(-1).sens }));
		expect(lireCoefficientsDuDossier(racine).coefficients).toBe(COEFFICIENTS_NOTE);
	});

	it('service : relu quand le fichier change (un nouvel apprentissage vaut au message suivant), avertissement une fois par version', async () => {
		const racine = await dossierTemporaire();
		const avertissements: string[] = [];
		const note = noteDuDossier(racine, (a) => avertissements.push(a), INSTALLES);
		expect(note()).toEqual({ coefficients: COEFFICIENTS_NOTE, installes: INSTALLES });
		ecrire(racine, jsonDeCoefficients(appris(-1)));
		expect(note().coefficients).toEqual(appris(-1));
		ecrire(racine, `${jsonDeCoefficients(appris(-2.5))}\n`);
		expect(note().coefficients.sens.biais).toBe(-2.5);
		ecrire(racine, 'pas du json');
		note();
		note();
		expect(avertissements).toHaveLength(1);
		expect(note().coefficients).toBe(COEFFICIENTS_NOTE);
	});

	it('identité des modèles installés de la plateforme ; les dépendances réelles chargent la note', async () => {
		const gguf = ggufInstalles('darwin', 'arm64');
		expect(gguf.sens).toMatch(/\.gguf@[0-9a-f]{12}$/u);
		expect(gguf.reranker).toMatch(/\.gguf@[0-9a-f]{12}$/u);
		const racine = await dossierTemporaire();
		ecrire(racine, jsonDeCoefficients(appris(-1)));
		const dep = dependancesReelles(racine);
		expect(dep.note?.().coefficients).toEqual(appris(-1));
	});
});
