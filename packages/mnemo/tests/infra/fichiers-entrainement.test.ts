import { existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { modeleNonAppris } from '../../src/domaine/modele-de-note.ts';
import { fichierAvant, fichierHistorique, fichiersDeLaNote, historiqueDuDossier } from '../../src/infra/fichiers-entrainement.ts';
import { fichierDesCoefficients } from '../../src/infra/coefficients-note-fichier.ts';
import { dossierTemporaire } from '../aides/dossier-temporaire.ts';

const COEFFICIENTS = (biais: number) => ({ complets: { ...modeleNonAppris(), biais }, sens: modeleNonAppris() });

async function racine(): Promise<string> {
	const r = await dossierTemporaire();
	await mkdir(join(r, '.mnemo'), { recursive: true });
	return r;
}

describe("fichiers de l'entraînement de la note", () => {
	it("écrire garde le modèle actuel comme modèle d'avant ; revenir les échange, aller-retour", async () => {
		const r = await racine();
		const f = fichiersDeLaNote(r);
		await f.ecrire(COEFFICIENTS(1));
		expect(JSON.parse(readFileSync(fichierAvant(r), 'utf8'))).toEqual({ aucun: true });
		await f.ecrire(COEFFICIENTS(2));
		const biais = (fichier: string) => (JSON.parse(readFileSync(fichier, 'utf8')) as { complets: { biais: number } }).complets.biais;
		expect(biais(fichierDesCoefficients(r))).toBe(2);
		expect(biais(fichierAvant(r))).toBe(1);
		expect(await f.revenir()).toBe(true);
		expect(biais(fichierDesCoefficients(r))).toBe(1);
		expect(biais(fichierAvant(r))).toBe(2);
		expect(await f.revenir()).toBe(true);
		expect(biais(fichierDesCoefficients(r))).toBe(2);
		expect(await f.avant()).toBe(true);
	});

	it("sans modèle d'avant : revenir rend faux ; le marqueur « aucun » : revenir retire le fichier (le module livré revaut)", async () => {
		const r = await racine();
		const f = fichiersDeLaNote(r);
		expect(await f.avant()).toBe(false);
		expect(await f.revenir()).toBe(false);
		await f.ecrire(COEFFICIENTS(1));
		expect(await f.revenir()).toBe(true);
		expect(existsSync(fichierDesCoefficients(r))).toBe(false);
	});

	it('rapport illisible ou d’une autre forme : null ; historique illisible : vide, lignes mal formées laissées', async () => {
		const r = await racine();
		const f = fichiersDeLaNote(r);
		expect(await f.rapport()).toBeNull();
		await writeFile(join(r, '.mnemo', 'apprentissage-note.json'), JSON.stringify({ date: 'x', niveaux: [{ niveau: 'sens' }] }));
		expect(await f.rapport()).toBeNull();
		const h = historiqueDuDossier(r);
		expect(await h.lire()).toEqual([]);
		await writeFile(fichierHistorique(r), 'pas du JSON');
		expect(await h.lire()).toEqual([]);
		const ligne = { date: '2026-11-26', origine: 'manuel' as const, verdicts: { complets: 'refuse' as const, sens: 'accepte' as const }, remplace: true };
		await writeFile(fichierHistorique(r), JSON.stringify([ligne, { date: 3 }, { ...ligne, verdicts: { complets: 'peut-être' } }]));
		expect(await h.lire()).toEqual([ligne]);
		await h.ecrire([ligne]);
		expect(await h.lire()).toEqual([ligne]);
	});
});
