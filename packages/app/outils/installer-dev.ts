/** `pnpm installer-dev [<dossier Mnemo>] [--retirer]` à la racine du dépôt : voir `installation-dev.ts`. */
import { homedir } from 'node:os';
import { ErreurInstallation, installerDev } from './installation-dev.ts';

try {
	// pnpm lance le script depuis la racine du dépôt ; `INIT_CWD` : le dossier d'où il a été appelé
	await installerDev(process.argv.slice(2), { home: homedir(), dossierCourant: process.env['INIT_CWD'] ?? process.cwd(), env: process.env, ecrire: (ligne) => console.log(ligne) });
} catch (erreur) {
	if (!(erreur instanceof ErreurInstallation)) throw erreur;
	console.error(erreur.message);
	process.exitCode = erreur.code;
}
