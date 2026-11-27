/**
 * `setupFiles` de vitest (packages/mnemo et packages/ui), exécuté avant chaque fichier de test : vide les variables qui
 * désignent une mémoire, place `HOME` et le dossier courant dans un dossier temporaire neuf, puis fait échouer la suite si
 * une mémoire est encore trouvable (voir isolement.ts). Le dossier courant de départ (le dépôt) n'est plus jamais utilisé.
 */
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll } from 'vitest';
import { VARIABLES_NEUTRALISEES, verifierIsolement } from './isolement.ts';

for (const nom of VARIABLES_NEUTRALISEES) delete process.env[nom];

const isole = realpathSync(mkdtempSync(join(tmpdir(), 'mnemo-tests-isole-')));
process.env['HOME'] = isole;
// Sous Windows, `os.homedir()` lit USERPROFILE, pas HOME.
if (process.platform === 'win32') process.env['USERPROFILE'] = isole;
process.chdir(isole);

verifierIsolement(process.cwd(), process.env['HOME'], process.env);

afterAll(() => {
	// Windows refuse de supprimer le dossier courant d'un processus : on en sort d'abord.
	process.chdir(tmpdir());
	try {
		rmSync(isole, { recursive: true, force: true, maxRetries: 3 });
	} catch (e) {
		// Windows refuse aussi de supprimer le dossier courant d'un processus enfant encore vivant : le service esbuild que
		// lance `build` de vite hérite du dossier courant (isole) et ne s'arrête qu'avec vitest. Le dossier, temporaire,
		// est laissé au système ; ailleurs, l'erreur reste une erreur.
		if (process.platform !== 'win32' || !['EPERM', 'EBUSY'].includes((e as NodeJS.ErrnoException).code ?? '')) throw e;
	}
});
