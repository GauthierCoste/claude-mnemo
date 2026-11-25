import { commandeGardee, estCommandeDeHookMnemo, lanceCeNodeEtCeMain } from '../commande-de-hook.ts';
import { avecBlocALaFin, sansPlages } from '../toml-edition.ts';
import { elementsDuTableau, entreesToml } from '../toml-lecture.ts';
import type { ElementDeTableau } from '../toml-lecture.ts';
import { valeurToml } from '../toml.ts';

/**
 * Hooks de Mnemo dans `hooks.toml` de Mistral Vibe : un élément `[[hooks]]` par événement Vibe (`name` unique, `type`,
 * `command`, `timeout` en secondes, `match`), une commande `mnemo hook <événement> --moteur mistral-vibe`.
 * - `pre_agent` et `post_agent` : `match = "main"`, l'agent de la session seulement (son alias, mesuré avec `--agent
 *   mnemo-<uuid>`) ; jamais un sous-agent, dont le tour n'est ni un message de l'utilisateur ni la fin du tour ;
 * - `pre_tool` sans `match` (tous les outils, sous-agents compris), sans `strict` : un hook qui dépasse son délai laisse
 *   passer l'outil, comme chez Claude Code et Codex ; 10 s, loin de l'échéance de Mnemo (`refusDelai`, 2 s, comptée depuis
 *   le démarrage du hook : un Node lent à démarrer ne fait pas passer l'outil), qui décide lui-même : une panne de Mnemo ne
 *   bloque pas chaque outil de la session ;
 * - `post_tool` sans `match` : après chaque outil, il efface le dialogue ouvert (l'outil approuvé a tourné), même pour un
 *   profil qui ne demande pas `apres_outil` (l'état seulement : `apresOutilDEtat`) ; seuls les outils qui lisent ou
 *   écrivent une fiche y en notent une ;
 * - `notification` : `arret --notification`, son type dit s'il ouvre un dialogue ;
 * - `session_end` : 2 s au plus (Vibe n'attend pas plus, à la fermeture, l'ensemble des hooks en cours).
 */
export const HOOKS_MISTRAL_VIBE_INSTALLES: readonly { type: string; args: readonly string[]; timeout: number; match?: string }[] = [
	{ type: 'session_start', args: ['debut'], timeout: 10 },
	{ type: 'pre_agent', args: ['message'], timeout: 5, match: 'main' },
	{ type: 'pre_tool', args: ['outil'], timeout: 10 },
	{ type: 'post_tool', args: ['apres_outil'], timeout: 3 },
	{ type: 'post_agent', args: ['arret'], timeout: 3, match: 'main' },
	{ type: 'notification', args: ['arret', '--notification'], timeout: 3 },
	{ type: 'session_end', args: ['fin'], timeout: 2 },
];

/**
 * Commande d'un hook (`commandeGardee`) : Vibe la lance par `/bin/sh -c` (mesuré sous macOS), et sous Windows par
 * `cmd.exe` (lu : `create_subprocess_shell`, sauf `command_environment` réglé sur PowerShell ou Git Bash ; non mesuré).
 */
export function commandeDuHook(node: string, main: string, args: readonly string[], plateforme: string): string {
	return commandeGardee('mistral-vibe', plateforme === 'win32' ? 'cmd' : 'posix', node, main, args);
}

/** Blocs attendus, dans l'ordre, pour ce Node et ce `main.ts`. */
export function blocsAttendus(node: string, main: string, plateforme: string): string[] {
	return HOOKS_MISTRAL_VIBE_INSTALLES.map(({ type, args, timeout, match }) =>
		[
			'[[hooks]]',
			`name = "mnemo-${type}"`,
			`type = "${type}"`,
			`command = ${valeurToml(commandeDuHook(node, main, args, plateforme))}`,
			`timeout = ${timeout}`,
			...(match === undefined ? [] : [`match = ${valeurToml(match)}`]),
			'',
		].join('\n'),
	);
}

/** Une commande de hook de Mnemo pour Mistral Vibe (n'importe quelle installation) dans un élément `[[hooks]]`. */
const commandeMnemo = (e: ElementDeTableau): string | null => {
	const commande = e.valeurs['command'];
	return typeof commande === 'string' && estCommandeDeHookMnemo(commande, 'mistral-vibe') ? commande : null;
};

/** Hooks de Mnemo lus dans le texte de `hooks.toml` : leurs éléments, ou pourquoi Mnemo ne le lit pas. */
export function hooksDeMnemo(texte: string | null): { elements: ElementDeTableau[] } | { echec: string } {
	if (texte === null) return { elements: [] };
	const entrees = entreesToml(texte);
	const lu = entrees === null ? null : elementsDuTableau(entrees, 'hooks');
	if (lu === null) return { echec: 'TOML que Mnemo ne lit pas' };
	if (lu.enLigne) return { echec: '« hooks » écrit en tableau en ligne, forme que Mnemo ne réécrit pas' };
	return { elements: lu.elements.filter((e) => commandeMnemo(e) !== null) };
}

const normalise = (bloc: string): string => bloc.replace(/\r\n/gu, '\n').trimEnd();

/**
 * État des hooks de Mnemo pour ce Node et ce `main.ts` : `a_jour` (chaque bloc attendu, tel quel, une fois, et aucun autre
 * hook de Mnemo), `perime` (des hooks de Mnemo, mais pas ceux-là), `absent`. `autres` : des hooks d'une autre installation de
 * Mnemo (autre Node, autre `main.ts`) existent.
 */
export function etatDesHooksMistralVibe(texte: string, elements: readonly ElementDeTableau[], node: string, main: string, plateforme: string): { etat: 'a_jour' | 'perime' | 'absent'; autres: boolean } {
	if (elements.length === 0) return { etat: 'absent', autres: false };
	const autres = elements.some((e) => !lanceCeNodeEtCeMain(commandeMnemo(e)!, node, main));
	const lus = elements.map((e) => normalise(e.plages.map((p) => texte.slice(p.debut, p.fin)).join('\n')));
	const attendus = blocsAttendus(node, main, plateforme).map(normalise);
	const aJour = lus.length === attendus.length && attendus.every((a) => lus.filter((l) => l === a).length === 1);
	return { etat: aJour ? 'a_jour' : 'perime', autres };
}

/**
 * Le texte sans les hooks de Mnemo que `aRetirer` désigne (par leur commande), puis, si `blocs` n'est pas vide, avec ces blocs
 * à la fin ; tout le reste tel quel.
 */
export function texteAvecHooks(texte: string | null, elements: readonly ElementDeTableau[], blocs: readonly string[], aRetirer: (commande: string) => boolean = () => true): string {
	const reste = sansPlages(texte ?? '', elements.filter((e) => aRetirer(commandeMnemo(e)!)).flatMap((e) => e.plages));
	return blocs.length === 0 ? reste : avecBlocALaFin(reste, blocs.join('\n'));
}
