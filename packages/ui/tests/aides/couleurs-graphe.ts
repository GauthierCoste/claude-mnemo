/** Couleurs du graphe lues dans `jetons.css` (sans navigateur) : les tests utilisent les vrais jetons. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { lireCouleursGraphe, type CouleursGraphe } from '../../src/graphe/couleurs.ts';

const JETONS = join(import.meta.dirname, '..', '..', 'src', 'styles', 'jetons.css');

/** Jetons de `:root`, `var(--x)` résolus. */
export function jetonsDeLaFeuille(): Map<string, string> {
	const css = readFileSync(JETONS, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
	const brut = new Map([...css.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1]!, m[2]!.trim()]));
	const resoudre = (v: string, profondeur = 0): string =>
		profondeur > 10 ? v : v.replace(/var\(\s*(--[\w-]+)\s*\)/g, (_, nom: string) => resoudre(brut.get(nom) ?? '', profondeur + 1));
	return new Map([...brut].map(([k, v]) => [k, resoudre(v)]));
}

/** Un style factice qui répond comme `getComputedStyle(document.documentElement)`. */
export function styleDesJetons(jetons: Map<string, string> = jetonsDeLaFeuille()): Pick<CSSStyleDeclaration, 'getPropertyValue'> {
	return { getPropertyValue: (nom: string) => jetons.get(nom) ?? '' };
}

export function couleursDeTest(): CouleursGraphe {
	return lireCouleursGraphe(styleDesJetons());
}
