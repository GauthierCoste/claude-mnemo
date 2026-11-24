// Les couleurs de three.js sont celles des jetons, jamais écrites dans le code ; un jeton absent est une erreur qui le nomme.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { JETONS_BRANCHES, JETONS_ETATS, JETONS_GRAPHE, lireCouleursGraphe } from '../../src/graphe/couleurs.ts';
import { jetonsDeLaFeuille, styleDesJetons } from '../aides/couleurs-graphe.ts';

const tousLesJetons = () => [...Object.values(JETONS_GRAPHE), ...JETONS_BRANCHES, ...Object.values(JETONS_ETATS)];

describe('couleurs du graphe', () => {
	it('chaque jeton lu par le graphe est défini dans jetons.css, en couleur hexadécimale', () => {
		const jetons = jetonsDeLaFeuille();
		for (const jeton of tousLesJetons()) expect(jetons.get(jeton), jeton).toMatch(/^#(?:[0-9a-f]{3}){1,2}$/i);
	});

	it('chaque jeton --graphe-* de jetons.css est lu par le graphe', () => {
		const css = readFileSync(join(import.meta.dirname, '..', '..', 'src', 'styles', 'jetons.css'), 'utf8');
		const lus = new Set(tousLesJetons());
		const definis = [...css.matchAll(/(--graphe-[\w-]+)\s*:/g)].map((m) => m[1]!);
		expect(definis.length).toBeGreaterThan(0);
		for (const jeton of definis) expect(lus.has(jeton), jeton).toBe(true);
	});

	it('les couleurs lues sont celles des jetons, en minuscules et à six chiffres', () => {
		const jetons = jetonsDeLaFeuille();
		const couleurs = lireCouleursGraphe(styleDesJetons(jetons));
		expect(couleurs.branches).toEqual(JETONS_BRANCHES.map((j) => jetons.get(j)!.toLowerCase()));
		expect(couleurs.lien).toBe(jetons.get(JETONS_GRAPHE.lien)!.toLowerCase());
		expect(couleurs.etats['a_confirmer']).toBe(jetons.get(JETONS_ETATS.a_confirmer)!.toLowerCase());
		const court = new Map(jetons);
		court.set(JETONS_GRAPHE.survol, ' #FFF ');
		expect(lireCouleursGraphe(styleDesJetons(court)).survol).toBe(['#', 'ff', 'ff', 'ff'].join(''));
	});

	it('jeton absent → erreur qui nomme le jeton ; valeur illisible → erreur aussi', () => {
		const jetons = jetonsDeLaFeuille();
		const sansLueur = new Map(jetons);
		sansLueur.delete('--graphe-lueur');
		expect(() => lireCouleursGraphe(styleDesJetons(sansLueur))).toThrow(/--graphe-lueur/);
		const sansBranche = new Map(jetons);
		sansBranche.delete('--branche-7');
		expect(() => lireCouleursGraphe(styleDesJetons(sansBranche))).toThrow(/--branche-7/);
		const illisible = new Map(jetons);
		illisible.set('--graphe-axe', 'color-mix(in srgb, red 10%, transparent)');
		expect(() => lireCouleursGraphe(styleDesJetons(illisible))).toThrow(/--graphe-axe/);
	});

	it('contraste AA du texte sur le fond du graphe (étiquettes, graduations, lueur)', () => {
		const luminance = (hex: string) => {
			const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
			return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
		};
		const contraste = (a: string, b: string) => (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05);
		const couleurs = lireCouleursGraphe(styleDesJetons());
		// Les étiquettes prennent la couleur de leur nœud : branches, états, liens cassés ; les graduations celle de l'axe.
		const textes = { lueur: couleurs.lueur, eclaire: couleurs.eclaire, survol: couleurs.survol, axe: couleurs.axe, texteSecondaire: couleurs.texteSecondaire, discret: couleurs.discret, ...Object.fromEntries(couleurs.branches.map((c, i) => [`branche-${i + 1}`, c])), ...couleurs.etats };
		for (const [nom, couleur] of Object.entries(textes)) expect(contraste(couleur, couleurs.fond), `${nom} ${couleur}`).toBeGreaterThanOrEqual(4.5);
	});
});
