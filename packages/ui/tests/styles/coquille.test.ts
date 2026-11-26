/**
 * App de bureau (`data-coquille="app"`) : la fenêtre devient l'app. Les règles existent ; le rendu du navigateur n'est
 * touché par aucune (toutes sont sous le marqueur).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(import.meta.dirname, '..', '..', 'src');
const lire = (chemin: string) => readFileSync(join(SRC, chemin), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

function fichiers(dossier: string): string[] {
	return readdirSync(dossier).flatMap((n) => {
		const c = join(dossier, n);
		return statSync(c).isDirectory() ? fichiers(c) : c.endsWith('.css') ? [c] : [];
	});
}

/** Corps du bloc dont le sélecteur est exactement `selecteur`. */
function bloc(css: string, selecteur: string): string {
	const trouve = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].find((m) => m[1]!.trim().replace(/\s+/g, ' ') === selecteur);
	if (!trouve) throw new Error(`bloc absent : ${selecteur}`);
	return trouve[2]!;
}

/** Le sélecteur sans le contenu des `:is(...)` (dont les virgules ne séparent pas les sélecteurs de la liste). */
const horsParentheses = (selecteur: string) => selecteur.replace(/:is\([^()]*\)/g, ':is()');

const SOUS =":global([data-coquille='app'])";

describe('coquille de l’app de bureau (styles)', () => {
	it('pas de marge autour de l’app', () => {
		expect(bloc(lire('styles/coquille.css'), ":root[data-coquille='app'] body")).toMatch(/padding:\s*0/);
	});

	it('ni bordure, ni arrondi, ni ombre', () => {
		const corps = bloc(lire('composants/Application.module.css'), `${SOUS} .app`);
		expect(corps).toMatch(/border:\s*none/);
		expect(corps).toMatch(/border-radius:\s*0/);
		expect(corps).toMatch(/box-shadow:\s*none/);
	});

	it('la barre de titre est la poignée de la fenêtre, avec la place des boutons de macOS', () => {
		const css = lire('composants/BarreTitre.module.css');
		const titre = bloc(css, `${SOUS} .titre`);
		expect(titre).toMatch(/-webkit-app-region:\s*drag/);
		expect(titre).toMatch(/(^|[;\s])app-region:\s*drag/);
		expect(titre).toMatch(/(^|[;\s])user-select:\s*none/);
		expect(titre).toMatch(/padding-left:\s*78px/);
		const interactifs = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].find((m) => m[1]!.includes(`${SOUS} .titre :is(`));
		expect(interactifs?.[2]).toMatch(/-webkit-app-region:\s*no-drag/);
		for (const s of ['button', 'a', 'input', "[role='button']", "[role='menu']"]) expect(interactifs?.[1]).toContain(s);
	});

	it('sous Windows, pas de retrait à gauche mais la place des boutons du système à droite', () => {
		const titre = bloc(lire('composants/BarreTitre.module.css'), ":global([data-coquille='app'][data-plateforme='windows']) .titre");
		expect(titre).toMatch(/padding-left:\s*14px/);
		// la largeur des boutons vient de la zone de titre du système, avec un repli fixe (3 × 46 px)
		const droite = /padding-right:\s*([^;]+);/.exec(titre)?.[1] ?? '';
		expect(droite).toContain('env(titlebar-area-x');
		expect(droite).toContain('env(titlebar-area-width');
		expect(droite).toContain('138px');
	});

	it('ce qui recouvre la barre de titre reste cliquable', () => {
		const sansDrag = (corps: string) => /-webkit-app-region:\s*no-drag/.test(corps) && /(^|[;\s])app-region:\s*no-drag/.test(corps);
		expect(sansDrag(bloc(lire('styles/coquille.css'), ":root[data-coquille='app'] :is(dialog, [role='dialog'], [role='alertdialog'], [role='menu'], [role='listbox'])"))).toBe(true);
		expect(sansDrag(bloc(lire('composants/Palette.module.css'), `${SOUS} :is(.fond, .palette, .cadreChamp, .menu)`))).toBe(true);
		expect(sansDrag(bloc(lire('composants/Toast.module.css'), `${SOUS} :is(.toast, .pile)`))).toBe(true);
		expect(sansDrag(bloc(lire('composants/sessions/FermerSession.module.css'), `${SOUS} .menu`))).toBe(true);
		expect(sansDrag(bloc(lire('composants/sessions/NouvelleSession.module.css'), `${SOUS} .dialogue, ${SOUS} .dialogue::backdrop`))).toBe(true);
	});

	it('aucune règle de poignée hors du marqueur (le navigateur ne change pas)', () => {
		const fautes: string[] = [];
		for (const f of fichiers(SRC))
			for (const m of readFileSync(f, 'utf8')
				.replace(/\/\*[\s\S]*?\*\//g, '')
				.matchAll(/([^{}]+)\{([^{}]*)\}/g))
				if (/app-region/.test(m[2]!) && !horsParentheses(m[1]!)
						.split(',')
						.every((s) => /^\s*(:root\[data-coquille='app'\]|:global\(\[data-coquille='app'\]\))\s/.test(s))) fautes.push(`${f} ${m[1]!.trim()}`);
		expect(fautes).toEqual([]);
	});
});
