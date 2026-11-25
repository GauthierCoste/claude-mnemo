/**
 * Version lue dans la sortie de `<moteur> --version` (« codex-cli 0.171.0-alpha.13 », « vibe 3.1.5 », « GitHub Copilot CLI
 * 1.0.116. », point final de la phrase écarté) ; null si elle est illisible.
 */
export function versionDans(sortie: string): string | null {
	return /(?:^|\s)v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]*[0-9A-Za-z])?)\.?(?:\s|$)/u.exec(sortie.trim())?.[1] ?? null;
}

/** `[majeure, mineure, correctif]` d'une version ; une préversion (`0.171.0-alpha.N`) compte comme sa version (0.171.0). */
function nombres(version: string): [number, number, number] | null {
	const m = /^(\d+)\.(\d+)\.(\d+)/u.exec(version);
	return m === null ? null : [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** La version minimale telle qu'on l'écrit : sans « .0 » final (« 0.171 », « 3.1.5 »). */
const versionMinimaleLisible = (minimale: string): string => minimale.replace(/\.0$/u, '');

/**
 * Motif de refus d'un moteur (`nom`) trop ancien, sous `minimale` ; null s'il est assez récent, ou si sa version est inconnue
 * ou illisible (rien n'est empêché).
 */
export function refusDeVersion(nom: string, minimale: string, version: string | null): string | null {
	const lue = version === null ? null : nombres(version);
	const min = nombres(minimale)!;
	if (lue === null) return null;
	for (let i = 0; i < 3; i++) {
		if (lue[i]! > min[i]!) return null;
		if (lue[i]! < min[i]!) return `${nom} ${version} trop ancien, ${versionMinimaleLisible(minimale)} ou plus requis`;
	}
	return null;
}
