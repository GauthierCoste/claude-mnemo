import { citerPosix, citerPowerShell } from '../../citer.ts';
import { estObjet } from '../../valeurs.ts';
import { estLancementDeMnemo, lanceCeMnemo as lanceCeMnemoMcp } from '../declaration-mnemo.ts';
import { listeValeursToml, valeurToml } from '../toml.ts';

/**
 * Déclaration `mnemo` telle que `codex mcp get mnemo --json` la rend (Codex 0.171 : `{ name, enabled, transport: { type,
 * command, args, env, env_vars, cwd }, enabled_tools, disabled_tools, startup_timeout_sec, tool_timeout_sec }`) : `stdio`
 * avec sa commande et ses arguments, ou un autre transport (`url` : streamable HTTP). `active` : `enabled` (vrai s'il
 * manque) ; `reglages` : ce qu'elle porte que Mnemo ne pose pas (Mnemo n'écrit que `command` et `args`). Null : une sortie
 * qui n'a pas cette forme.
 */
export type DeclarationCodex = { stdio: true; commande: string; args: string[]; active: boolean; reglages: string[] } | { stdio: false; active: boolean; reglages: string[] };

const renseigne = (v: unknown): boolean => v !== undefined && v !== null && !(Array.isArray(v) && v.length === 0) && !(estObjet(v) && Object.keys(v).length === 0);

export function lireDeclarationCodex(sortie: string): DeclarationCodex | null {
	let brut: unknown;
	try {
		brut = JSON.parse(sortie);
	} catch {
		return null;
	}
	if (!estObjet(brut) || !estObjet(brut.transport)) return null;
	const active = brut.enabled !== false;
	const { type, command, args } = brut.transport;
	const reglages: string[] = [];
	if (!active) reglages.push('enabled = false');
	for (const cle of ['env', 'env_vars', 'cwd'] as const) if (renseigne(brut.transport[cle])) reglages.push(cle);
	for (const cle of ['enabled_tools', 'disabled_tools', 'startup_timeout_sec', 'tool_timeout_sec'] as const) if (renseigne(brut[cle])) reglages.push(cle);
	if (type !== 'stdio') return { stdio: false, active, reglages };
	if (typeof command !== 'string' || !Array.isArray(args) || !args.every((a) => typeof a === 'string')) return null;
	return { stdio: true, commande: command, args, active, reglages };
}

/** Clé TOML sans guillemets ni espaces autour des points : `"mcp_servers" . "mnemo"` → `mcp_servers.mnemo`. */
const cleNue = (cle: string): string =>
	cle
		.split('.')
		.map((p) => p.trim().replace(/^"(.*)"$/u, '$1').replace(/^'(.*)'$/u, '$1'))
		.join('.');

/**
 * Réglages du serveur `mnemo` dans le texte de `config.toml` que `codex mcp get --json` ne montre pas (approbation des
 * outils : `default_tools_approval_mode`, `[mcp_servers.mnemo.tools.<outil>]`…) : toute clé autre que `command` et
 * `args`, en table ou en clé pointée. Lecture par lignes, sans interpréter le reste du fichier.
 */
export function reglagesDansConfig(texte: string): string[] {
	const reglages = new Set<string>();
	let table = '';
	for (const brute of texte.split(/\r?\n/u)) {
		const ligne = brute.trim();
		if (ligne === '' || ligne.startsWith('#')) continue;
		const entete = /^\[\[?([^\]]+)\]\]?/u.exec(ligne);
		if (entete !== null) {
			table = cleNue(entete[1]!);
			continue;
		}
		const affectation = /^((?:"[^"]*"|'[^']*'|[^=])+?)\s*=/u.exec(ligne);
		if (affectation === null) continue;
		const complete = cleNue([table, affectation[1]!].filter((p) => p !== '').join('.'));
		// une table en ligne (`mnemo = { … }`) n'est jamais écrite par `codex mcp add` : on ne lit pas dedans
		if (complete === 'mcp_servers.mnemo') reglages.add('mnemo = { … }');
		if (!complete.startsWith('mcp_servers.mnemo.')) continue;
		const cle = complete.slice('mcp_servers.mnemo.'.length);
		if (cle !== 'command' && cle !== 'args') reglages.add(cle);
	}
	return [...reglages];
}

/** Elle lance exactement `<node> <main> mcp`. */
export function lanceCeMnemo(d: DeclarationCodex, node: string, main: string): boolean {
	return d.stdio && lanceCeMnemoMcp(d, node, main);
}

/** Une déclaration de Mnemo, quel que soit son chemin : `<…>/adaptateurs/cli/main.ts mcp`. */
export function estDeclarationMnemo(d: DeclarationCodex): boolean {
	return d.stdio && estLancementDeMnemo(d);
}

/** Commande à copier-coller : chaque chemin entre apostrophes (POSIX ou PowerShell). */
export function commandeManuelleCodex(node: string, main: string, plateforme: string): string {
	const citer = plateforme === 'win32' ? citerPowerShell : citerPosix;
	return `codex mcp add mnemo -- ${citer(node)} ${citer(main)} mcp`;
}

/**
 * Lignes à mettre à la main dans `[mcp_servers.mnemo]` de `config.toml` (chaînes TOML par `valeurToml` : littérales quand
 * c'est possible, ce qui garde lisibles les chemins Windows), les autres réglages gardés.
 */
export function lignesTomlCodex(node: string, main: string): string {
	return `command = ${valeurToml(node)} et args = ${listeValeursToml([main, 'mcp'])}`;
}
