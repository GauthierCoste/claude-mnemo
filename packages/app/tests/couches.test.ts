// Règle de dépendance du paquet : `domaine/` n'importe que `domaine/`, `@mnemo/commun` et `@mnemo/contrat` (aucun `node:`,
// aucun `electron`) ; seuls `electron/` et le preload de l'assistant importent `electron` ; la page de l'assistant n'importe
// ni Node, ni l'infra, ni Electron ; rien n'importe le code du service (paquet `mnemo`).
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from 'vitest';

const SRC = join(import.meta.dirname, '../src');

/** Modules importés par chaque fichier de `src/` (chemin relatif à `src/`, en `/`). */
async function imports(): Promise<{ fichier: string; module: string }[]> {
	const trouves: { fichier: string; module: string }[] = [];
	for (const fichier of await readdir(SRC, { recursive: true })) {
		if (!fichier.endsWith('.ts')) continue;
		const texte = await readFile(join(SRC, fichier), 'utf8');
		for (const m of texte.matchAll(/^\s*(?:import|export)\b[^'"]*?\bfrom\s+['"]([^'"]+)['"]|^\s*import\s+['"]([^'"]+)['"]|\bimport\(\s*['"]([^'"]+)['"]/gmu)) {
			trouves.push({ fichier: fichier.split('\\').join('/'), module: (m[1] ?? m[2] ?? m[3])! });
		}
	}
	return trouves;
}

test('le domaine est pur ; seuls electron/ et le preload importent electron ; la page reste une page ; personne n’importe le service', async () => {
	const tous = await imports();
	expect(tous.some((i) => i.fichier.startsWith('domaine/'))).toBe(true);
	const fautifs = tous.filter(({ fichier, module }) => {
		if (fichier.startsWith('domaine/') && !(module.startsWith('./') || module === '@mnemo/commun' || module === '@mnemo/contrat')) return true;
		if (module === 'electron' && !fichier.startsWith('electron/') && fichier !== 'assistant/preload.ts') return true;
		// la page de l'assistant ne parle qu'au preload : ni Node, ni infra, ni Electron
		if (fichier.startsWith('assistant/') && fichier !== 'assistant/preload.ts' && (module.startsWith('node:') || module.includes('/infra/') || module.includes('/electron/'))) return true;
		return module === 'mnemo' || module.includes('packages/mnemo') || module.includes('../mnemo/');
	});
	expect(fautifs).toEqual([]);
});
