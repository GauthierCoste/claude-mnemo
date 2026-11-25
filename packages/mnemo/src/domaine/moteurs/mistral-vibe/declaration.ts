import { citerPosix, citerPowerShell } from '../../citer.ts';
import type { LancementMcp } from '../declaration-mnemo.ts';
import { avecBlocALaFin, elementsDuTableau, entreesToml, sansPlages } from '../toml-lecture.ts';
import type { ValeurToml } from '../toml-lecture.ts';
import { listeValeursToml, valeurToml } from '../toml.ts';

/**
 * Déclaration du serveur `mnemo` dans `config.toml` de Mistral Vibe (Vibe 3.1.5 : un élément `[[mcp_servers]]` de
 * `name = "mnemo"`, `transport = "stdio"`, `command` en chaîne ou en liste, `args`, puis `env`, `cwd`, `disabled`,
 * `disabled_tools`, `startup_timeout_sec`…). `lancement` : null pour un autre transport ou une commande illisible ;
 * `active` : `disabled` n'est pas vrai ; `reglages` : ce qu'elle porte que Mnemo ne pose pas ; `plage` : sa place dans le texte.
 */
export type DeclarationMistralVibe = { lancement: LancementMcp | null; active: boolean; reglages: string[]; plage: { debut: number; fin: number } };

/** Clés que Mnemo écrit dans sa déclaration. */
const CLES_DE_MNEMO = new Set(['name', 'transport', 'command', 'args']);

const estListeDeChaines = (v: ValeurToml | undefined): v is string[] => Array.isArray(v) && v.every((a) => typeof a === 'string');

/**
 * La déclaration `mnemo` du texte de `config.toml` (null : absent), ou pourquoi Mnemo ne le lit pas (TOML qu'il ne suit pas,
 * `mcp_servers` en tableau en ligne). Lecture seulement.
 */
export function declarationDansConfig(texte: string | null): { declaration: DeclarationMistralVibe | null } | { echec: string } {
	if (texte === null) return { declaration: null };
	const entrees = entreesToml(texte);
	const lu = entrees === null ? null : elementsDuTableau(entrees, 'mcp_servers');
	if (lu === null) return { echec: 'TOML que Mnemo ne lit pas' };
	if (lu.enLigne) return { echec: '« mcp_servers » écrit en tableau en ligne, forme que Mnemo ne réécrit pas' };
	const element = lu.elements.find((e) => e.valeurs['name'] === 'mnemo');
	if (element === undefined) return { declaration: null };
	const v = element.valeurs;
	const reglages = Object.keys(v).filter((cle) => !CLES_DE_MNEMO.has(cle));
	const active = v['disabled'] !== true;
	const commande = typeof v['command'] === 'string' ? [v['command']] : estListeDeChaines(v['command']) ? v['command'] : null;
	const args = v['args'] === undefined ? [] : estListeDeChaines(v['args']) ? v['args'] : null;
	const stdio = v['transport'] === 'stdio' && commande !== null && commande.length > 0 && args !== null;
	const lancement = stdio ? { commande: commande[0]!, args: [...commande.slice(1), ...args] } : null;
	return { declaration: { lancement, active, reglages, plage: { debut: element.debut, fin: element.fin } } };
}

/** Bloc écrit par Mnemo : chaînes TOML littérales quand c'est possible (chemins Windows lisibles). */
export function blocDeDeclaration(node: string, main: string): string {
	return `[[mcp_servers]]\nname = "mnemo"\ntransport = "stdio"\ncommand = ${valeurToml(node)}\nargs = ${listeValeursToml([main, 'mcp'])}\n`;
}

/** Le texte avec la déclaration de Mnemo à la place de `remplacee` (sa plage), ou ajoutée à la fin ; le reste tel quel. */
export function texteAvecDeclaration(texte: string | null, node: string, main: string, remplacee?: { debut: number; fin: number }): string {
	const bloc = blocDeDeclaration(node, main);
	if (texte === null) return bloc;
	if (remplacee === undefined) return avecBlocALaFin(texte, bloc);
	return `${texte.slice(0, remplacee.debut)}${bloc}${texte.slice(remplacee.fin)}`;
}

/** Le texte sans la déclaration (sa plage) ; le reste tel quel. */
export const texteSansDeclaration = (texte: string, plage: { debut: number; fin: number }): string => sansPlages(texte, [plage]);

/**
 * Commande à copier-coller (chemins cités pour POSIX ou PowerShell) : `vibe mcp add`, qui réécrit tout `config.toml` (ses
 * commentaires sont perdus) ; Mnemo, lui, n'y écrit que son bloc.
 */
export function commandeManuelleMistralVibe(node: string, main: string, plateforme: string): string {
	const citer = plateforme === 'win32' ? citerPowerShell : citerPosix;
	return `vibe mcp add mnemo --transport stdio --command ${citer(node)} --arg ${citer(main)} --arg mcp`;
}

/** Lignes à mettre à la main dans le bloc `[[mcp_servers]]` `name = "mnemo"` de `config.toml`, les autres réglages gardés. */
export function lignesTomlMistralVibe(node: string, main: string): string {
	return `command = ${valeurToml(node)} et args = ${listeValeursToml([main, 'mcp'])}`;
}
