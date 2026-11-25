/** Ce qu'une déclaration MCP `stdio` lance : la commande et ses arguments. */
export type LancementMcp = { commande: string; args: readonly string[] };

/** Elle lance exactement `<node> <main> mcp` (ce Node, ce Mnemo). */
export function lanceCeMnemo(l: LancementMcp, node: string, main: string): boolean {
	return l.commande === node && l.args.length === 2 && l.args[0] === main && l.args[1] === 'mcp';
}

/** Une déclaration de Mnemo, quels que soient le Node et le chemin : `<…>/adaptateurs/cli/main.ts mcp`. */
export function estLancementDeMnemo(l: Pick<LancementMcp, 'args'>): boolean {
	return l.args.length === 2 && /adaptateurs[\\/]cli[\\/]main\.ts$/u.test(l.args[0]!) && l.args[1] === 'mcp';
}
