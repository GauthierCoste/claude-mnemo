/** Un argument entre apostrophes pour un shell POSIX, apostrophes échappées. */
export function citerPosix(chemin: string): string {
	return `'${chemin.replaceAll("'", "'\\''")}'`;
}

/** Un argument entre apostrophes pour PowerShell : PowerShell lit aussi ’ ‘ ‚ ‛ comme `'`, chacune est doublée. */
export function citerPowerShell(chemin: string): string {
	return `'${chemin.replace(/['‘’‚‛]/gu, '$&$&')}'`;
}
