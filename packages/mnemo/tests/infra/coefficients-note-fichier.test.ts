import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { COEFFICIENTS_NOTE } from '../../src/domaine/coefficients-note.ts';
import { echelleDesSignaux, jsonDeCoefficients, modeleNonAppris } from '../../src/domaine/modele-de-note.ts';
import { REGLAGES_PAR_DEFAUT } from '../../src/domaine/reglages.ts';
import { modelesDeNote, noteApprise } from '../../src/domaine/note-de-confiance.ts';
import type { CoefficientsNote } from '../../src/domaine/modele-de-note.ts';
import { fichierDesCoefficients, ggufInstalles, lireCoefficientsDuDossier, noteAvecJournal, noteDuDossier } from '../../src/infra/coefficients-note-fichier.ts';
import { dependancesReelles } from '../../src/infra/systeme.ts';
import { dossierTemporaire } from '../aides/dossier-temporaire.ts';

const INSTALLES = { sens: 'sens.gguf@aaaaaaaaaaaa', reranker: 'reranker.gguf@bbbbbbbbbbbb' };
const appris = (biais: number): CoefficientsNote => ({
	complets: modeleNonAppris(),
	sens: { ...modeleNonAppris(), apprisLe: '2026-11-25', accepte: true, refus: [], biais, poids: { cosinusRelatif: 3 }, gguf: INSTALLES, echelle: echelleDesSignaux(REGLAGES_PAR_DEFAUT.contexte) },
});
const ecrire = (racine: string, texte: string) => {
	mkdirSync(join(racine, '.mnemo'), { recursive: true });
	writeFileSync(fichierDesCoefficients(racine), texte);
};

describe('.mnemo/coefficients-note.json', () => {
	it('absent : le module du dépôt, sans avertissement', async () => {
		expect(lireCoefficientsDuDossier(await dossierTemporaire())).toEqual({ coefficients: COEFFICIENTS_NOTE, avertissement: null });
	});

	it('installation neuve : les modèles de départ du module ordonnent (sans % ni injection) ; un fichier appris, même refusé, prime', async () => {
		const racine = await dossierTemporaire();
		const echelle = echelleDesSignaux(REGLAGES_PAR_DEFAUT.contexte);
		const neuve = modelesDeNote(lireCoefficientsDuDossier(racine).coefficients, INSTALLES, echelle);
		expect(noteApprise(neuve)).toBe(true);
		expect([neuve.complets.etat, neuve.sens.etat].every((e) => e === 'depart' || e === 'non_appris')).toBe(true);
		expect([neuve.complets.etat, neuve.sens.etat]).toContain('depart');
		const refuse = appris(-1);
		refuse.sens = { ...refuse.sens, accepte: false, refus: ['trop peu d’injections'] };
		ecrire(racine, jsonDeCoefficients(refuse));
		const apprise = modelesDeNote(lireCoefficientsDuDossier(racine).coefficients, INSTALLES, echelle);
		expect([apprise.complets.etat, apprise.sens.etat]).toEqual(['non_appris', 'refuse']);
	});

	it('présent et valide : chargé en priorité', async () => {
		const racine = await dossierTemporaire();
		ecrire(racine, jsonDeCoefficients(appris(-1)));
		expect(lireCoefficientsDuDossier(racine)).toEqual({ coefficients: appris(-1), avertissement: null });
	});

	it('présent mais illisible ou invalide : aucun modèle appris (pas le module du dépôt), avec un avertissement', async () => {
		const racine = await dossierTemporaire();
		const aucun = { complets: modeleNonAppris(), sens: modeleNonAppris() };
		ecrire(racine, '{ "sens": ');
		expect(lireCoefficientsDuDossier(racine)).toEqual({ coefficients: aucun, avertissement: expect.stringContaining('invalide') });
		ecrire(racine, JSON.stringify({ sens: appris(-1).sens }));
		expect(lireCoefficientsDuDossier(racine).coefficients).toEqual(aucun);
		// accepté avec des refus : incohérent, invalide
		ecrire(racine, jsonDeCoefficients({ ...appris(-1), sens: { ...appris(-1).sens, refus: ['trop peu d’injections'] } }));
		expect(lireCoefficientsDuDossier(racine).coefficients).toEqual(aucun);
	});

	it('service : les avertissements vont à son journal ; un lecteur qui ne vient pas d’un dossier reste tel quel', async () => {
		const racine = await dossierTemporaire();
		ecrire(racine, 'abîmé');
		const journal: string[] = [];
		const note = noteAvecJournal(noteDuDossier(racine, () => {}, INSTALLES), (m) => journal.push(m))!;
		expect(note().coefficients.sens.apprisLe).toBeNull();
		expect(journal).toEqual([expect.stringContaining('coefficients-note.json invalide')]);
		const autre = () => ({ coefficients: appris(-1), installes: INSTALLES });
		expect(noteAvecJournal(autre, () => {})).toBe(autre);
		expect(noteAvecJournal(undefined, () => {})).toBeUndefined();
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
		expect(note().coefficients.sens.apprisLe).toBeNull();
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
