import { posix, win32 } from 'node:path';

/**
 * Cache des pièces, par utilisateur : `MNEMO_MODELES`, sinon macOS `~/Library/Caches/mnemo`, Windows
 * `%LOCALAPPDATA%\mnemo\cache`, Linux et autres `$XDG_CACHE_HOME/mnemo` (s'il est absolu) ou `~/.cache/mnemo`.
 * Les chemins suivent la plateforme demandée, pas celle qui exécute (testable partout).
 */
export function dossierModeles(env: NodeJS.ProcessEnv, plateforme: NodeJS.Platform, home: string): string {
	const chemins = plateforme === 'win32' ? win32 : posix;
	const impose = env['MNEMO_MODELES'];
	if (impose !== undefined && impose !== '') return chemins.resolve(impose);
	if (plateforme === 'darwin') return chemins.join(home, 'Library', 'Caches', 'mnemo');
	if (plateforme === 'win32') {
		const local = env['LOCALAPPDATA'];
		return chemins.join(local !== undefined && win32.isAbsolute(local) ? local : chemins.join(home, 'AppData', 'Local'), 'mnemo', 'cache');
	}
	const xdg = env['XDG_CACHE_HOME'];
	return chemins.join(xdg !== undefined && posix.isAbsolute(xdg) ? xdg : chemins.join(home, '.cache'), 'mnemo');
}
