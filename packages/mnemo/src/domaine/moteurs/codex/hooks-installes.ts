import { estObjet } from '../../valeurs.ts';
import { commandeGardee, estCommandeDeHookMnemo, lanceCeNodeEtCeMain } from '../commande-de-hook.ts';
import { sansBom } from './json-texte.ts';
import { OUTILS_CODEX } from './outils.ts';

/**
 * Hooks de Mnemo dans `hooks.json` de Codex : un groupe par événement Codex, une commande `mnemo hook <événement> --moteur
 * codex`. `timeout` en secondes ; `SessionEnd` : 3 s au plus chez Codex. `PreToolUse` sans `matcher` : tous les outils ; 3 s
 * (Mnemo décide en 2 s depuis le démarrage du hook), gardées : chez Mistral Vibe, 10 s, mais changer une
 * commande déjà approuvée la fait redemander par Codex (`/hooks`) sur chaque poste, et les hooks non approuvés ne tournent pas.
 */
export const HOOKS_CODEX_INSTALLES: readonly { evenement: string; args: readonly string[]; timeout: number; matcher?: string }[] = [
	{ evenement: 'SessionStart', args: ['debut'], timeout: 10 },
	{ evenement: 'UserPromptSubmit', args: ['message'], timeout: 5 },
	{ evenement: 'PreToolUse', args: ['outil'], timeout: 3 },
	{ evenement: 'PostToolUse', args: ['apres_outil'], timeout: 3, matcher: OUTILS_CODEX.motifApresOutil },
	{ evenement: 'Stop', args: ['arret'], timeout: 3 },
	{ evenement: 'PermissionRequest', args: ['arret', '--notification'], timeout: 3 },
	{ evenement: 'SessionEnd', args: ['fin'], timeout: 3 },
];

/** Un groupe de `hooks.json` : `matcher` facultatif, ses commandes. */
type Groupe = Record<string, unknown> & { hooks: unknown[] };

/**
 * Commande d'un hook (`commandeGardee`). Codex lance `command` par le shell de connexion de l'utilisateur, `<shell> -c`
 * (mesuré, Codex 0.171 : `/bin/zsh -c`, même avec `SHELL=/bin/bash`) ; `commandWindows` par PowerShell (Codex l'exige pour
 * les hooks sous Windows).
 */
export function commandesDuHook(node: string, main: string, args: readonly string[]): { command: string; commandWindows: string } {
	return { command: commandeGardee('codex', 'posix', node, main, args), commandWindows: commandeGardee('codex', 'powershell', node, main, args) };
}

/** Groupes attendus, par événement Codex, pour ce Node et ce `main.ts`. */
export function hooksAttendus(node: string, main: string): Map<string, Groupe> {
	const attendus = new Map<string, Groupe>();
	for (const { evenement, args, timeout, matcher } of HOOKS_CODEX_INSTALLES) {
		attendus.set(evenement, { ...(matcher === undefined ? {} : { matcher }), hooks: [{ type: 'command', ...commandesDuHook(node, main, args), timeout }] });
	}
	return attendus;
}

/** Une commande de hook posée par Mnemo (n'importe quelle installation) ; jamais celle d'un autre outil. */
export function estHookMnemo(commande: unknown): boolean {
	return estObjet(commande) && commande.type === 'command' && typeof commande.command === 'string' && estCommandeDeHookMnemo(commande.command, 'codex');
}

/** Une commande de Mnemo qui lance ce Node et ce `main.ts` (cette installation), quels que soient sa garde et son événement. */
export function estHookDe(commande: unknown, node: string, main: string): boolean {
	return estHookMnemo(commande) && lanceCeNodeEtCeMain((commande as { command: string }).command, node, main);
}

const estGroupe = (g: unknown): g is Groupe => estObjet(g) && Array.isArray(g.hooks);

/**
 * Texte de `hooks.json` lu (null : absent ; BOM retiré) : sa racine, ou pourquoi on n'y touche pas. Seuls la racine et `hooks` doivent
 * être des tables, et chaque événement une liste ; le reste est gardé tel quel, sans être interprété.
 */
export function lireHooksJson(texte: string | null): { racine: Record<string, unknown> } | { echec: string } {
	const json = texte === null ? '' : sansBom(texte);
	if (json.trim() === '') return { racine: {} };
	let brut: unknown;
	try {
		brut = JSON.parse(json);
	} catch (erreur) {
		return { echec: `JSON illisible (${erreur instanceof Error ? erreur.message : String(erreur)})` };
	}
	if (!estObjet(brut)) return { echec: 'la racine n’est pas un objet JSON' };
	if (brut.hooks === undefined) return { racine: brut };
	if (!estObjet(brut.hooks)) return { echec: '« hooks » n’est pas un objet JSON' };
	for (const [evenement, groupes] of Object.entries(brut.hooks)) {
		if (!Array.isArray(groupes)) return { echec: `« hooks.${evenement} » n’est pas une liste` };
	}
	return { racine: brut };
}

const hooksDe = (racine: Record<string, unknown>): Record<string, unknown[]> => (estObjet(racine.hooks) ? (racine.hooks as Record<string, unknown[]>) : {});

/** `PreToolUse` → `pre_tool_use` : le nom de l'événement dans la clé d'approbation de Codex. */
export function nomDansLaCle(evenement: string): string {
	return evenement.replace(/(?<=[a-z0-9])([A-Z])/gu, '_$1').toLowerCase();
}

/**
 * État des hooks de Mnemo pour ce Node et ce `main.ts` : `a_jour` (chaque événement attendu a exactement un groupe, celui
 * attendu, et aucun autre hook de Mnemo n'existe), `perime` (des hooks de Mnemo, mais pas ceux-là), `absent`. `autres` : des
 * hooks d'une autre installation de Mnemo (autre Node, autre `main.ts`) existent. `cles` : `<événement>:<groupe>:<commande>`
 * de chaque hook de Mnemo, la fin de la clé d'approbation de Codex (`<chemin de hooks.json>:<événement>:<groupe>:<commande>`).
 */
export function etatDesHooks(racine: Record<string, unknown>, node: string, main: string): { etat: 'a_jour' | 'perime' | 'absent'; autres: boolean; cles: string[] } {
	const attendus = hooksAttendus(node, main);
	const cles: string[] = [];
	let conformes = 0;
	let ecarts = 0;
	let autres = false;
	for (const [evenement, groupes] of Object.entries(hooksDe(racine))) {
		const attendu = attendus.get(evenement);
		groupes.forEach((groupe, g) => {
			if (!estGroupe(groupe)) return;
			groupe.hooks.forEach((commande, c) => {
				if (!estHookMnemo(commande)) return;
				cles.push(`${nomDansLaCle(evenement)}:${g}:${c}`);
				if (!estHookDe(commande, node, main)) autres = true;
				if (attendu !== undefined && JSON.stringify(groupe) === JSON.stringify(attendu)) conformes++;
				else ecarts++;
			});
		});
	}
	if (cles.length === 0) return { etat: 'absent', autres, cles };
	// un événement attendu présent deux fois, ou absent, n'est pas à jour
	const parEvenement = new Set(cles.map((cle) => cle.split(':')[0]));
	const aJour = ecarts === 0 && conformes === attendus.size && parEvenement.size === attendus.size;
	return { etat: aJour ? 'a_jour' : 'perime', autres, cles };
}

/**
 * Racine où les commandes `aRetirer` (par défaut : toute commande de Mnemo) sont remplacées par `attendus` (vide : retirées),
 * sans toucher aucune autre commande : dans chaque groupe, elles sont ôtées ; un groupe qui ne contenait qu'elles devient la
 * place du groupe attendu de son événement (gardant son rang, donc sa clé d'approbation), ou disparaît ; un événement sans
 * place reçoit son groupe à la fin. Une liste vidée par ce retrait disparaît ; tout le reste est gardé, dans son ordre.
 */
export function remplacerHooks(racine: Record<string, unknown>, attendus: Map<string, Groupe>, aRetirer: (commande: unknown) => boolean = estHookMnemo): Record<string, unknown> {
	const avant = hooksDe(racine);
	const hooks: Record<string, unknown[]> = {};
	const places = new Set<string>();
	for (const [evenement, groupes] of Object.entries(avant)) {
		const attendu = attendus.get(evenement);
		const gardes: unknown[] = [];
		let retire = false;
		for (const groupe of groupes) {
			if (!estGroupe(groupe) || !groupe.hooks.some(aRetirer)) {
				gardes.push(groupe);
				continue;
			}
			retire = true;
			const autres = groupe.hooks.filter((c) => !aRetirer(c));
			if (autres.length > 0) gardes.push({ ...groupe, hooks: autres });
			else if (attendu !== undefined && !places.has(evenement)) {
				places.add(evenement);
				gardes.push(attendu);
			}
		}
		if (attendu !== undefined && !places.has(evenement)) {
			places.add(evenement);
			gardes.push(attendu);
		}
		if (gardes.length > 0 || !retire) hooks[evenement] = gardes;
	}
	for (const [evenement, attendu] of attendus) if (!places.has(evenement)) hooks[evenement] = [attendu];
	return { ...racine, hooks };
}
