import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from 'vitest';

test('le socle tourne sous Node 24 ou plus', () => {
	expect(Number(process.versions.node.split('.')[0])).toBeGreaterThanOrEqual(24);
});

test('les messages des outils tutoient (application/, adaptateurs/mcp/)', async () => {
	const racine = join(import.meta.dirname, '../src');
	const fautifs: string[] = [];
	for (const dossier of ['application', 'adaptateurs/mcp', 'domaine']) {
		for (const fichier of await readdir(join(racine, dossier), { recursive: true })) {
			// requete.ts : liste de mots vides, pas des messages
			if (!fichier.endsWith('.ts') || fichier === 'requete.ts') continue;
			const texte = await readFile(join(racine, dossier, fichier), 'utf8');
			for (const [n, ligne] of texte.split('\n').entries()) {
				// chaînes seulement : entre apostrophes ou accents graves
				for (const chaine of ligne.match(/'(?:[^'\\]|\\.)*'|`[^`]*`/gu) ?? []) {
					if (/\b(?:vous|votre|vos|[A-Za-zéèê]{3,}ez)\b/u.test(chaine.replace(/\bchez\b|\bassez\b/gu, ''))) fautifs.push(`${dossier}/${fichier}:${n + 1} ${chaine}`);
				}
			}
		}
	}
	expect(fautifs).toEqual([]);
});
