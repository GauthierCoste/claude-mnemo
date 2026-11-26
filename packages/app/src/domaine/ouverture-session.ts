/**
 * Ouverte à l'ouverture de session, l'app ne montre que la barre des menus. L'élément d'ouverture est inscrit avec
 * l'argument `--ouverture-session` ; Electron ne transmet cet argument que sous Windows (sous macOS, l'élément est un
 * `SMAppService` sans arguments) : sous macOS, `wasOpenedAtLogin` d'Electron reste donc pris en compte aussi.
 */
import type { PlateformeApp } from './plateforme.ts';

export const ARGUMENT_OUVERTURE_SESSION = '--ouverture-session';

/**
 * Options de l'élément d'ouverture, les mêmes pour l'inscrire, le retirer et le lire : sous Windows, l'élément est une
 * valeur du registre identifiée par l'exécutable et ses arguments ; lu ou retiré avec d'autres, il n'est pas trouvé
 * (`openAtLogin` toujours faux, jamais retiré). `executable` : `app.getPath('exe')`. Sous macOS, l'argument seul (ignoré).
 */
export function optionsOuvertureSession(plateforme: PlateformeApp, executable: string): { path?: string; args: string[] } {
	return plateforme === 'win32' ? { path: executable, args: [ARGUMENT_OUVERTURE_SESSION] } : { args: [ARGUMENT_OUVERTURE_SESSION] };
}

/** Lancée par l'ouverture de session : l'argument dans la ligne de commande, ou ce que dit le système. */
export function ouverteParLaSession(argv: readonly string[], ditParLeSysteme: boolean): boolean {
	return argv.includes(ARGUMENT_OUVERTURE_SESSION) || ditParLeSysteme;
}
