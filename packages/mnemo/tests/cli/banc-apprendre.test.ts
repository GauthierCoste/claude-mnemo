import { mkdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { apprendreAuBanc, ggufInstalles, rapportEnTexte, verifierCheminDuModule } from '../../src/adaptateurs/cli/banc-apprendre.ts';
import type { CasContexte } from '../../src/application/banc-contexte.ts';
import { jsonDeCoefficients, moduleDeCoefficients } from '../../src/domaine/modele-de-note.ts';
import { GGUF_DE_TEST } from '../aides/banc-synthetique.ts';
import { dossierTemporaire } from '../aides/dossier-temporaire.ts';

const cas = (session: string, rang: number): CasContexte => ({
	nom: `${session}#${rang}`,
	position: 'projets/Corvel',
	message: 'le devis du vitrail de la chapelle',
	premier: rang === 1,
	attendues: [],
	interdites: [],
	silence: false,
	session,
	rang,
	gguf: GGUF_DE_TEST,
	candidates: [
		{ chemin: 'projets/Corvel/Devis.md', titre: 'Devis', ligne: 'Devis du vitrail', listes: ['sens'], signaux: { seule: { logit: 5, cosinus: 0.9, cosinusRelatif: 0.25, bm25Relatif: 1 } } },
		{ chemin: 'notes/Atelier Vitrail.md', titre: 'Atelier', ligne: 'Atelier', listes: ['mots'], signaux: { seule: { logit: -3, cosinus: 0.7, cosinusRelatif: 0.05, bm25Relatif: 0.2 } } },
	],
	jugements: { 'projets/Corvel/Devis.md': 'pertinente', 'notes/Atelier Vitrail.md': 'non_pertinente' },
});

describe('mnemo banc contexte --apprendre', () => {
	it('écrit les coefficients de la mémoire et le rapport, sans aucun texte de fiche ni de message ; le module seulement sur demande', async () => {
		const racine = await dossierTemporaire();
		await mkdir(join(racine, '.mnemo'));
		const lot = ['S1', 'S2', 'S3', 'S4', 'S5', 'S6'].flatMap((s) => [cas(s, 1), cas(s, 2)]);
		const sansModule = await apprendreAuBanc(racine, lot, { empreinteDe: null, empreintes: 'exclure', date: '2026-11-25', installes: GGUF_DE_TEST, graines: [1] });
		const coefficients = await readFile(join(racine, '.mnemo', 'coefficients-note.json'), 'utf8');
		expect(coefficients).toBe(jsonDeCoefficients(sansModule.rapport.coefficients));
		await expect(stat(join(racine, 'coefficients-note.ts'))).rejects.toThrow();

		const module = join(racine, 'coefficients-note.ts');
		const { rapport, texte } = await apprendreAuBanc(racine, lot, { empreinteDe: null, empreintes: 'exclure', date: '2026-11-25', installes: GGUF_DE_TEST, module, graines: [1] });
		const ecrit = await readFile(module, 'utf8');
		expect(ecrit).toBe(moduleDeCoefficients(rapport.coefficients));
		// trop peu de sessions : refusé, avec ses raisons
		expect(rapport.coefficients.complets.accepte).toBe(false);
		expect(texte).toContain('Complets : refusé');
		const json = await readFile(join(racine, '.mnemo', 'apprentissage-note.json'), 'utf8');
		expect(JSON.parse(json).messages).toBe(12);
		expect(await readFile(join(racine, '.mnemo', 'apprentissage-note.txt'), 'utf8')).toBe(`${texte}\n`);
		// paires implicites des gestes : dites seulement s'il y en a
		expect(texte).not.toContain('paires implicites');
		const avecImplicites = { ...rapport, niveaux: rapport.niveaux.map((n) => ({ ...n, implicites: { utilisees: 7, ecartees: 2 } })) };
		expect(rapportEnTexte(avecImplicites, []).match(/paires implicites des gestes : 7 apprises, 2 laissées/gu)).toHaveLength(2);
		for (const contenu of [ecrit, coefficients, json, texte]) {
			expect(contenu).not.toContain('Atelier');
			expect(contenu).not.toContain('Devis');
			expect(contenu).not.toContain('vitrail');
		}
	});

	it('refuse d’écrire le module sous node_modules', () => {
		expect(() => verifierCheminDuModule('/opt/mnemo/node_modules/mnemo/src/domaine/coefficients-note.ts')).toThrow('node_modules');
		expect(verifierCheminDuModule('/tmp/coefficients-note.ts')).toBe('/tmp/coefficients-note.ts');
	});

	it('identifie les fichiers GGUF par leur nom et le début de leur SHA-256', () => {
		const gguf = ggufInstalles();
		if (gguf.sens !== null) expect(gguf.sens).toMatch(/^bge-m3.*\.gguf@[0-9a-f]{12}$/u);
		if (gguf.reranker !== null) expect(gguf.reranker).toMatch(/^bge-reranker.*\.gguf@[0-9a-f]{12}$/u);
	});
});
