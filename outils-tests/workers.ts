/**
 * Plafond de workers de chaque suite vitest : un quart des cœurs.
 *
 * Par défaut, vitest prend tous les cœurs moins un ; avec ce défaut, un `pnpm test` montait à ~65 processus `node` et
 * ~10 Go (mesuré le 24/11/2026 sur 18 cœurs). Plusieurs suites lancées en même temps par des sessions ou des sous-agents
 * dans des worktrees différents ont saturé la mémoire et le processeur jusqu'au gel puis au redémarrage de la machine.
 * `MNEMO_TESTS_WORKERS` remplace le plafond (nombre ou pourcentage).
 */
export const MAX_WORKERS: number | string = lirePlafond(process.env['MNEMO_TESTS_WORKERS']);

function lirePlafond(valeur: string | undefined): number | string {
	if (valeur === undefined || valeur === '') return '25%';
	return /^\d+$/.test(valeur) ? Number(valeur) : valeur;
}
