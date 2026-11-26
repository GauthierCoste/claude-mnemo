/**
 * Écrit à la main la configuration minimale de l'app installée (`%APPDATA%\Mnemo\config.json` : le dossier Mnemo et le
 * `Path` du processus ; `node` et `main` viennent de l'app empaquetée), pour qu'elle ouvre sa fenêtre principale au lieu de
 * l'assistant. Le dossier doit déjà avoir une mémoire (`_mnemo/SCHEMA.md`). Windows seulement.
 *
 * Usage : node packages/app/outils/ci/configuration-essai.ts <dossier Mnemo>
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { echouer, etape, executer } from './commun.ts';

await executer(async () => {
	const [racine] = process.argv.slice(2);
	if (racine === undefined || !isAbsolute(racine)) echouer('Usage : node configuration-essai.ts <dossier Mnemo absolu>');
	if (!existsSync(join(racine, '_mnemo', 'SCHEMA.md'))) echouer(`aucune mémoire dans ${racine}`);
	const appdata = process.env['APPDATA'];
	if (process.platform !== 'win32' || appdata === undefined) echouer('Windows seulement (APPDATA).');
	const dossier = join(appdata, 'Mnemo');
	mkdirSync(dossier, { recursive: true });
	const chemin = join(dossier, 'config.json');
	writeFileSync(chemin, `${JSON.stringify({ racine, path: process.env['PATH'] ?? '' }, null, '\t')}\n`);
	etape(`configuration écrite : ${chemin}`);
});
