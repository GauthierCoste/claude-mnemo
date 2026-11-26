/**
 * Où trouver le Node et le `main.ts` de Mnemo. L'app empaquetée (`pnpm construire-app`) les porte dans son dossier de
 * ressources (`Contents/Resources` sous macOS, `resources\` sous Windows) : `node/bin/node` (Windows : `node\node.exe`) et
 * `mnemo/src/adaptateurs/cli/main.ts` (l'interface construite est dans `ui/dist`, là où le service la cherche). En
 * développement (Electron lancé depuis le dépôt), rien : ils viennent de la configuration (`pnpm installer-dev`).
 */
import { basename, delimiter, dirname, join } from 'node:path';
import type { Lancement } from '../domaine/configuration.ts';

/**
 * Le lancement du paquet si l'app est empaquetée (`app.isPackaged`), d'après son dossier de ressources
 * (`process.resourcesPath`) ; sinon `undefined` (la configuration les donne).
 */
export function lancementDuPaquet(empaquetee: boolean, ressources: string, plateforme: NodeJS.Platform = process.platform): Lancement | undefined {
	if (!empaquetee) return undefined;
	const node = plateforme === 'win32' ? join(ressources, 'node', 'node.exe') : join(ressources, 'node', 'bin', 'node');
	return { node, main: join(ressources, 'mnemo', 'src', 'adaptateurs', 'cli', 'main.ts') };
}

/**
 * Dossier `.app` de l'app empaquetée, d'après son dossier de ressources (`<…>/Mnemo.app/Contents/Resources`) ; null si ce
 * dossier n'a pas cette forme (disposition inattendue), hors de macOS (pas de paquet `.app` : sous Windows, l'app se retire
 * par son désinstalleur) ou si l'app tourne depuis un emplacement provisoire : rien n'est alors mis à la corbeille (jamais
 * un chemin calculé faux).
 */
export function paquetDeLApp(ressources: string, plateforme: NodeJS.Platform = process.platform): string | null {
	if (plateforme !== 'darwin') return null;
	const contents = dirname(ressources);
	const paquet = dirname(contents);
	if (basename(ressources) !== 'Resources' || basename(contents) !== 'Contents' || !basename(paquet).endsWith('.app') || basename(paquet) === '.app') return null;
	return emplacementProvisoire(ressources) ? null : paquet;
}

/**
 * L'app tourne-t-elle depuis un emplacement provisoire : l'image disque montée (`/Volumes/…`, retirée à l'éjection) ou une
 * copie de translocation de macOS (`…/AppTranslocation/…`, app en quarantaine ouverte sans avoir été déplacée : chemin
 * aléatoire, effacé à la fermeture) ? Rien n'est alors refait pour pointer vers elle, ni mis à la corbeille.
 */
export function emplacementProvisoire(ressources: string): boolean {
	return ressources.startsWith('/Volumes/') || ressources.includes('/AppTranslocation/');
}

/**
 * `PATH` de repli quand celui du terminal n'a pas pu être lu (`lirePathTerminal`) : ouverte depuis le Finder, l'app reçoit
 * le `PATH` minimal de macOS, sans `claude` ni le `git` de Homebrew ; les dossiers habituels sont donc ajoutés devant
 * (`~/.local/bin`, celui de la commande `mnemo` et de l'installateur de Claude Code ; Homebrew), sans doublon.
 */
export function pathParDefaut(home: string, path: string | undefined): string {
	const dossiers = [join(home, '.local', 'bin'), '/opt/homebrew/bin', '/usr/local/bin', ...(path ?? '').split(delimiter), '/usr/bin', '/bin', '/usr/sbin', '/sbin'];
	return [...new Set(dossiers.filter((d) => d !== ''))].join(delimiter);
}
