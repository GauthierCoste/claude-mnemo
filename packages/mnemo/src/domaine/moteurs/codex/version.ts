/** Plus ancienne version de Codex mesurée avec Mnemo (lot 0 et lot 5 : 0.171.0-alpha.13). */
export const VERSION_MIN_CODEX = '0.171.0';

/** Version lue dans la sortie de `codex --version` (« codex-cli 0.171.0-alpha.13 ») ; null si elle est illisible. */
export function versionDeCodex(sortie: string): string | null {
	return /(?:^|\s)v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)(?:\s|$)/u.exec(sortie.trim())?.[1] ?? null;
}

/** `[majeure, mineure, correctif]` d'une version ; une préversion (`0.171.0-alpha.N`) compte comme sa version (0.171.0). */
function nombres(version: string): [number, number, number] | null {
	const m = /^(\d+)\.(\d+)\.(\d+)/u.exec(version);
	return m === null ? null : [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** Motif de refus d'un Codex trop ancien ; null s'il est assez récent, ou si sa version est inconnue ou illisible (rien n'est empêché). */
export function refusDeVersionCodex(version: string | null): string | null {
	const lue = version === null ? null : nombres(version);
	const min = nombres(VERSION_MIN_CODEX)!;
	if (lue === null) return null;
	for (let i = 0; i < 3; i++) {
		if (lue[i]! > min[i]!) return null;
		if (lue[i]! < min[i]!) return `Codex ${version} trop ancien, ${VERSION_MIN_CODEX.replace(/\.0$/u, '')} ou plus requis`;
	}
	return null;
}
