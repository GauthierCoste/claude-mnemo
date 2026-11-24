import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const PAQUETS = join(import.meta.dirname, '../..');
const RE_IMPORTS = [/^\s*(?:import|export)\b[^'"]*?\bfrom\s+['"]([^'"]+)['"]/gmu, /^\s*import\s+['"]([^'"]+)['"]/gmu, /\bimport\(\s*['"]([^'"]+)['"]\s*\)/gmu];

type Import = { fichier: string; module: string; cible: string | null };

/** Imports de chaque fichier `.ts` / `.tsx` d'un dossier (récursif), statiques, sans `from` et dynamiques ; `cible` : le chemin relatif aux paquets d'un import relatif. */
async function imports(dossier: string): Promise<Import[]> {
	const sortie: Import[] = [];
	for (const fichier of await readdir(join(PAQUETS, dossier), { recursive: true })) {
		if (!/\.tsx?$/u.test(fichier)) continue;
		const texte = await readFile(join(PAQUETS, dossier, fichier), 'utf8');
		for (const re of RE_IMPORTS) {
			for (const m of texte.matchAll(re)) {
				const module = m[1]!;
				const cible = module.startsWith('.') ? relative(PAQUETS, join(PAQUETS, dossier, dirname(fichier), module)).split(sep).join('/') : null;
				sortie.push({ fichier: `${dossier}/${fichier}`, module, cible });
			}
		}
	}
	return sortie;
}

const hors = (dossier: string) => (i: Import) => i.cible !== null && !i.cible.startsWith(`${dossier}/`);
const texte = (i: Import) => `${i.fichier} → ${i.module}`;

describe('règle des couches', () => {
	it('@mnemo/commun n’importe rien hors de lui-même', async () => {
		const tous = await imports('commun/src');
		expect(tous.length).toBeGreaterThan(0);
		expect(tous.filter((i) => i.cible === null || hors('commun/src')(i)).map(texte)).toEqual([]);
	});

	it('domaine/ n’importe ni une autre couche, ni node:, ni un paquet Mnemo autre que @mnemo/commun', async () => {
		const domaine = await imports('mnemo/src/domaine');
		// bibliothèques pures (yaml, racinisation) admises
		expect(domaine.filter((i) => hors('mnemo/src/domaine')(i) || i.module.startsWith('node:') || (i.module.startsWith('@mnemo/') && i.module !== '@mnemo/commun')).map(texte)).toEqual([]);
	});

	it('application/ n’importe ni @mnemo/contrat, ni node:, ni infra/, ni adaptateurs/', async () => {
		const application = await imports('mnemo/src/application');
		expect(application.some((i) => i.cible?.startsWith('mnemo/src/domaine/'))).toBe(true);
		const interdit = (i: Import) => i.module === '@mnemo/contrat' || i.module.startsWith('node:') || /^mnemo\/src\/(?:infra|adaptateurs)\//u.test(i.cible ?? '');
		expect(application.filter(interdit).map(texte)).toEqual([]);
	});
});
