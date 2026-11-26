/**
 * Ouverte à l'ouverture de session, l'app ne montre que la barre des menus. L'élément d'ouverture est inscrit avec
 * l'argument `--ouverture-session` ; Electron ne transmet cet argument que sous Windows (sous macOS, l'élément est un
 * `SMAppService` sans arguments) : sous macOS, `wasOpenedAtLogin` d'Electron reste donc pris en compte aussi.
 */

export const ARGUMENT_OUVERTURE_SESSION = '--ouverture-session';

/** Lancée par l'ouverture de session : l'argument dans la ligne de commande, ou ce que dit le système. */
export function ouverteParLaSession(argv: readonly string[], ditParLeSysteme: boolean): boolean {
	return argv.includes(ARGUMENT_OUVERTURE_SESSION) || ditParLeSysteme;
}
