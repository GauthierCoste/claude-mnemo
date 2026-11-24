import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(import.meta.dirname, '..', '..', 'src');
const JETONS = join(SRC, 'styles', 'jetons.css');

function fichiers(dossier: string): string[] {
	return readdirSync(dossier).flatMap((n) => {
		const c = join(dossier, n);
		return statSync(c).isDirectory() ? fichiers(c) : [c];
	});
}

const MOTIFS_COULEUR = [/#[0-9a-f]{3,8}\b/i, /rgba?\(/i, /hsla?\(/i, /0x[0-9a-f]{6}/i];

describe('jetons de couleur', () => {
	it('aucune couleur écrite en dur hors de jetons.css', () => {
		const fautes: string[] = [];
		for (const f of fichiers(SRC)) {
			if (f === JETONS) continue;
			readFileSync(f, 'utf8')
				.split('\n')
				.forEach((ligne, i) => {
					for (const m of MOTIFS_COULEUR) if (m.test(ligne)) fautes.push(`${relative(SRC, f)}:${i + 1} ${ligne.trim()}`);
				});
		}
		expect(fautes).toEqual([]);
	});

	it('chaque var(--x) utilisée est définie dans jetons.css', () => {
		const definis = new Set([...readFileSync(JETONS, 'utf8').matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));
		const manquants = new Set<string>();
		for (const f of fichiers(SRC)) for (const m of readFileSync(f, 'utf8').matchAll(/var\(\s*(--[\w-]+)/g)) if (!definis.has(m[1]!)) manquants.add(`${relative(SRC, f)} ${m[1]}`);
		expect([...manquants]).toEqual([]);
	});

	it("les jetons de l'interface et des états sont définis", () => {
		const css = readFileSync(JETONS, 'utf8');
		const attendus = ['--bg', '--s1', '--s2', '--s3', '--bd', '--bd2', '--tx', '--mu', '--dim', '--ac', '--vert', '--violet', '--blue', '--amber', '--pink', '--red', '--mono', '--sans',
			'--fond-page', '--fond-terminal', '--sur-accent', '--sur-badge', '--sur-toast', '--ombre', '--etat-attend', '--etat-travaille', '--etat-a-relire', '--etat-en-pause',
			'--branche-1', '--branche-10', '--graphe-lien', '--graphe-parente', '--graphe-eclaire', '--graphe-survol', '--graphe-lueur', '--graphe-lumiere', '--graphe-axe',
			'--terminal-fond', '--terminal-texte', '--terminal-curseur', '--terminal-selection', '--terminal-noir', '--terminal-blanc-vif', '--r-1', '--r-4'];
		for (const j of attendus) expect(css, j).toMatch(new RegExp(`${j}\\s*:`));
	});
});
