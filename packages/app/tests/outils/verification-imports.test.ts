import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ErreurConstruction } from '../../outils/erreur.ts';
import { modulesAVerifier, scriptVerification, specificateursNus, verifierImports } from '../../outils/verification-imports.ts';

describe('vérification des imports du code emporté', () => {
	it('spécificateurs nus : statiques, réexports, effets de bord, dynamiques ; ni types, ni relatifs, ni node:', () => {
		const source = [
			"import { a, type B } from '@mnemo/commun';",
			"import type { C } from 'unpdf/pdfjs';",
			"export type { D } from 'seulement-types';",
			"export * from '@mnemo/contrat';",
			"import {\n\tstemmer,\n} from '@orama/stemmers/french';",
			"import 'effet';",
			"const m = await import('dynamique');",
			"import { join } from 'node:path';",
			"import { x } from './local.ts';",
		].join('\n');
		expect(specificateursNus([source, "import { a } from '@mnemo/commun';"])).toEqual(['@mnemo/commun', '@mnemo/contrat', '@orama/stemmers/french', 'dynamique', 'effet']);
	});

	it('dépendances couvertes par un import (elles-mêmes ou un sous-chemin) non reprises ; les autres ajoutées', () => {
		expect(modulesAVerifier(['@orama/stemmers/french', 'ws'], ['@orama/stemmers', 'ws', 'node-pty'])).toEqual(['@orama/stemmers/french', 'node-pty', 'ws']);
	});

	it('script : importe chaque module, échoue en les nommant', () => {
		const script = scriptVerification(['a', 'b/c']);
		expect(script).toContain('["a","b/c"]');
		expect(script).toContain('process.exit(1)');
	});

	it('avec un vrai Node : passe si tout se charge ; sinon la construction s’arrête en nommant le module ; script retiré', () => {
		const mnemo = mkdtempSync(join(tmpdir(), 'mnemo-imports-'));
		try {
			mkdirSync(join(mnemo, 'src'));
			mkdirSync(join(mnemo, 'node_modules', 'present'), { recursive: true });
			writeFileSync(join(mnemo, 'node_modules', 'present', 'package.json'), JSON.stringify({ name: 'present', type: 'module', exports: './index.js' }));
			writeFileSync(join(mnemo, 'node_modules', 'present', 'index.js'), 'export const x = 1;\n');
			writeFileSync(join(mnemo, 'package.json'), JSON.stringify({ dependencies: { present: '1.0.0' } }));
			writeFileSync(join(mnemo, 'src', 'main.ts'), "import { x } from 'present';\n");
			verifierImports(process.execPath, mnemo);
			writeFileSync(join(mnemo, 'src', 'autre.ts'), "import { y } from 'absent';\n");
			expect(() => verifierImports(process.execPath, mnemo)).toThrow(ErreurConstruction);
			expect(() => verifierImports(process.execPath, mnemo)).toThrow(/absent/u);
			expect(readdirSync(mnemo)).not.toContain('.verification-imports.mjs');
		} finally {
			rmSync(mnemo, { recursive: true, force: true });
		}
	});
});
