/** Un argument entre apostrophes pour un shell POSIX, apostrophes échappées. */
export function citerPosix(chemin: string): string {
	return `'${chemin.replaceAll("'", "'\\''")}'`;
}

/** Un argument entre apostrophes pour PowerShell : PowerShell lit aussi ’ ‘ ‚ ‛ comme `'`, chacune est doublée. */
export function citerPowerShell(chemin: string): string {
	return `'${chemin.replace(/['‘’‚‛]/gu, '$&$&')}'`;
}

/** Un chemin entre guillemets pour `cmd.exe` (un chemin Windows ne contient jamais de guillemet). */
export function citerCmd(chemin: string): string {
	return `"${chemin}"`;
}
