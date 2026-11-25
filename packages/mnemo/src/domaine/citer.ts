/** Un argument entre apostrophes pour un shell POSIX, apostrophes échappées. */
export function citerPosix(chemin: string): string {
	return `'${chemin.replaceAll("'", "'\\''")}'`;
}

/** Un argument entre apostrophes pour PowerShell, apostrophes doublées. */
export function citerPowerShell(chemin: string): string {
	return `'${chemin.replaceAll("'", "''")}'`;
}
