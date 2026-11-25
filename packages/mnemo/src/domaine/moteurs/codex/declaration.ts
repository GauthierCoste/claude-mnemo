import { citerPosix, citerPowerShell } from '../../citer.ts';
import { estObjet } from '../../valeurs.ts';

/**
 * Déclaration `mnemo` telle que `codex mcp get mnemo --json` la rend (Codex 0.171 : `{ name, enabled, transport: { type,
 * command, args, … }, … }`) : `stdio` avec sa commande et ses arguments, ou un autre transport (`url` : streamable HTTP).
 * Null : une sortie qui n'a pas cette forme.
 */
export type DeclarationCodex = { stdio: true; commande: string; args: string[] } | { stdio: false };

export function lireDeclarationCodex(sortie: string): DeclarationCodex | null {
	let brut: unknown;
	try {
		brut = JSON.parse(sortie);
	} catch {
		return null;
	}
	if (!estObjet(brut) || !estObjet(brut.transport)) return null;
	const { type, command, args } = brut.transport;
	if (type !== 'stdio') return { stdio: false };
	if (typeof command !== 'string' || !Array.isArray(args) || !args.every((a) => typeof a === 'string')) return null;
	return { stdio: true, commande: command, args };
}

/** Elle lance exactement `<node> <main> mcp`. */
export function lanceCeMnemo(d: DeclarationCodex, node: string, main: string): boolean {
	return d.stdio && d.commande === node && d.args.length === 2 && d.args[0] === main && d.args[1] === 'mcp';
}

/** Une déclaration de Mnemo, quel que soit son chemin : `<…>/adaptateurs/cli/main.ts mcp`. */
export function estDeclarationMnemo(d: DeclarationCodex): boolean {
	return d.stdio && d.args.length === 2 && /adaptateurs[\\/]cli[\\/]main\.ts$/u.test(d.args[0]!) && d.args[1] === 'mcp';
}

/** Commande à copier-coller : chaque chemin entre apostrophes (POSIX ou PowerShell). */
export function commandeManuelleCodex(node: string, main: string, plateforme: string): string {
	const citer = plateforme === 'win32' ? citerPowerShell : citerPosix;
	return `codex mcp add mnemo -- ${citer(node)} ${citer(main)} mcp`;
}
