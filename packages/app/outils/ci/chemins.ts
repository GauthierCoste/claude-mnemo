/**
 * Chemins de l'essai de l'app Windows dans la CI : l'installeur construit, l'app installée par utilisateur
 * (`%LOCALAPPDATA%\Programs\Mnemo`, où l'installeur NSIS la met par défaut), son Node et son Mnemo, son désinstalleur, le
 * raccourci du menu Démarrer, le dossier Mnemo jetable et celui des captures (sous `RUNNER_TEMP`).
 */
import { join } from 'node:path';
import { NOM_APP } from '../../src/domaine/identite-app.ts';
import { lancementDuPaquet, NOM_DESINSTALLEUR } from '../../src/infra/emplacement.ts';
import { nomInstalleur } from '../installeur.ts';

export type CheminsEssai = {
	version: string;
	installeur: string;
	installe: string;
	exe: string;
	node: string;
	main: string;
	desinstalleur: string;
	raccourci: string;
	essai: string;
	captures: string;
};

/** `depot` : la racine du dépôt ; `env` : celui du job (`LOCALAPPDATA`, `APPDATA`, `RUNNER_TEMP` exigés). */
export function cheminsEssai(depot: string, version: string, env: NodeJS.ProcessEnv): CheminsEssai {
	const exige = (cle: string): string => {
		const v = env[cle];
		if (v === undefined || v === '') throw new Error(`${cle} manque dans l’environnement.`);
		return v;
	};
	const installe = join(exige('LOCALAPPDATA'), 'Programs', NOM_APP);
	const paquet = lancementDuPaquet(true, join(installe, 'resources'), 'win32')!;
	return {
		version,
		installeur: join(depot, 'packages', 'app', 'dist', nomInstalleur(version)),
		installe,
		exe: join(installe, `${NOM_APP}.exe`),
		node: paquet.node,
		main: paquet.main,
		desinstalleur: join(installe, NOM_DESINSTALLEUR),
		raccourci: join(exige('APPDATA'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', `${NOM_APP}.lnk`),
		essai: join(exige('RUNNER_TEMP'), 'mnemo-essai'),
		captures: join(exige('RUNNER_TEMP'), 'captures'),
	};
}
