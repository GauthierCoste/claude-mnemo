import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { modeleNonAppris } from '../../src/domaine/modele-de-note.ts';
import type { RapportDApprentissage } from '../../src/application/apprendre-note.ts';
import type { CasContexte } from '../../src/application/banc-contexte.ts';
import { enregistrerCas, fichierBancContexte } from '../../src/infra/banc-contexte-fichier.ts';
import { bancDuService, fichierAvant, fichierHistorique, fichiersDeLaNote, historiqueDuDossier } from '../../src/infra/fichiers-entrainement.ts';
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

	it("écrire puis revenir ne laissent aucun fichier provisoire ni d'échange ; le marqueur « aucun » sans modèle à retirer n'est pas un modèle d'avant", async () => {
		const r = await racine();
		const f = fichiersDeLaNote(r);
		await f.ecrire(COEFFICIENTS(1));
		await f.ecrire(COEFFICIENTS(2));
		expect(await f.revenir()).toBe(true);
		expect(readdirSync(join(r, '.mnemo')).sort()).toEqual(['coefficients-note.avant.json', 'coefficients-note.json']);
		// le modèle retiré à la main : « aucun » d'avant n'a plus rien à rendre
		const vide = await racine();
		const g = fichiersDeLaNote(vide);
		await g.ecrire(COEFFICIENTS(1));
		expect(await g.avant()).toBe(true);
		await rm(fichierDesCoefficients(vide));
		expect(await g.avant()).toBe(false);
		expect(await g.revenir()).toBe(false);
	});

	it("le rapport garde s'il a remplacé le modèle ; un rapport d'avant (sans ce champ, écrit par le CLI) l'a remplacé ; le texte dit quand l'actuel est gardé", async () => {
		const r = await racine();
		const f = fichiersDeLaNote(r);
		const rapport = { date: '2026-11-26T10:00:00.000Z', messages: 1, sessions: 1, niveaux: [{ niveau: 'sens', fiabilite: [], modele: { ...modeleNonAppris(), refus: [], accepte: false, poids: {} } }] };
		await writeFile(join(r, '.mnemo', 'apprentissage-note.json'), JSON.stringify(rapport));
		expect(await f.rapport()).toEqual({ rapport, remplace: true });
		const complet = { ...rapport, messagesManuels: 0, paires: { pertinentes: 0, nonPertinentes: 0 }, indecises: 0, empreintesChangees: 0, horsPile: { pertinentes: 0, jugees: 0 }, identite: { manquante: 0, differente: 0 }, zApproche: false, niveaux: [{ ...rapport.niveaux[0]!, retenue: null }] } as unknown as RapportDApprentissage;
		await f.ecrireRapport(complet, false);
		expect((await f.rapport())?.remplace).toBe(false);
		expect(readFileSync(join(r, '.mnemo', 'apprentissage-note.txt'), 'utf8')).toContain('Modèle non écrit : le modèle actuel est gardé.');
	});

	it('le fichier des jugements du service : relu seulement s’il a changé (une réécriture, ici ou par le CLI, est vue) ; absent : aucun cas', async () => {
		const r = await racine();
		const banc = bancDuService(r);
		expect(await banc.lire()).toEqual([]);
		const cas = (nom: string): CasContexte => ({ nom, position: 'p', message: nom, premier: false, attendues: [], interdites: [], silence: false });
		await enregistrerCas(fichierBancContexte(r), [cas('a')]);
		const premiere = await banc.lire();
		expect(premiere.map((c) => c.nom)).toEqual(['a']);
		expect(await banc.lire()).toBe(premiere);
		await enregistrerCas(fichierBancContexte(r), [cas('a'), cas('b')]);
		expect((await banc.lire()).map((c) => c.nom)).toEqual(['a', 'b']);
		await banc.ecrire([cas('c')]);
		expect((await banc.lire()).map((c) => c.nom)).toEqual(['c']);
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
