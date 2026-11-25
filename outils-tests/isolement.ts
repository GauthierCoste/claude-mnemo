import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/**
 * Isolement des tests (packages/mnemo et packages/ui) : aucun test ne doit découvrir une vraie mémoire (`_mnemo/SCHEMA.md`
 * en remontant depuis le dossier courant, `HOME` ou une variable d'environnement) — un test qui oublie `cwd` ou `racine`
 * agirait sinon sur la mémoire de l'utilisateur (le dossier du dépôt est lui-même souvent sous une mémoire).
 */

/**
 * Variables qui désignent une mémoire, une session (et son moteur), un projet ou la configuration d'un moteur (Codex, Mistral
 * Vibe, GitHub Copilot CLI) : vidées avant tout test.
 */
export const VARIABLES_NEUTRALISEES = ['MNEMO_RACINE', 'MNEMO_SESSION', 'MNEMO_MOTEUR', 'MNEMO_PROJET', 'CLAUDE_PROJECT_DIR', 'CODEX_HOME', 'VIBE_HOME', 'COPILOT_HOME'] as const;

/** Le premier dossier, en remontant depuis `dossier` (compris), qui contient `_mnemo/SCHEMA.md` ; null s'il n'y en a pas. */
export function memoireAuDessus(dossier: string): string | null {
	let d = resolve(dossier);
	for (;;) {
		if (existsSync(join(d, '_mnemo', 'SCHEMA.md'))) return d;
		const parent = dirname(d);
		if (parent === d) return null;
		d = parent;
	}
}

/** Lève si une mémoire est trouvée au-dessus du dossier courant ou de `HOME`, ou si une variable neutralisée est posée. */
export function verifierIsolement(cwd: string, home: string, env: Record<string, string | undefined>): void {
	for (const [nom, dossier] of [
		['dossier courant', cwd],
		['HOME', home],
	] as const) {
		const trouvee = memoireAuDessus(dossier);
		if (trouvee !== null) throw new Error(`Tests non isolés : une mémoire Mnemo (${trouvee}) est au-dessus du ${nom} (${dossier}).`);
	}
	for (const nom of VARIABLES_NEUTRALISEES) {
		if (env[nom] !== undefined && env[nom] !== '') throw new Error(`Tests non isolés : ${nom} est posée.`);
	}
}
