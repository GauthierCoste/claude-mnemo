// Barre de titre de l'assistant (`src/assistant/assistant.css`) : sous macOS, 78 px à gauche pour les boutons incrustés ;
// sous Windows (`data-plateforme="windows"`, posé par la page), la place des boutons du système à droite.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';

const css = readFileSync(join(import.meta.dirname, '../src/assistant/assistant.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** Corps du bloc dont le sélecteur est exactement `selecteur`. */
function bloc(selecteur: string): string {
	const trouve = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].find((m) => m[1]!.trim().replace(/\s+/g, ' ') === selecteur);
	if (!trouve) throw new Error(`bloc absent : ${selecteur}`);
	return trouve[2]!;
}

it('barre de titre de l’assistant : poignée de la fenêtre, 78 px à gauche sous macOS, la place des boutons à droite sous Windows', () => {
	const titre = bloc('.titre');
	expect(titre).toMatch(/padding:\s*0 var\(--esp-4\) 0 78px/);
	expect(titre).toMatch(/-webkit-app-region:\s*drag/);
	const windows = bloc(":root[data-plateforme='windows'] .titre");
	expect(windows).toMatch(/padding-left:\s*var\(--esp-4\)/);
	const droite = /padding-right:\s*([^;]+);/.exec(windows)?.[1] ?? '';
	expect(droite).toContain('env(titlebar-area-x');
	expect(droite).toContain('env(titlebar-area-width');
	expect(droite).toContain('138px');
});
