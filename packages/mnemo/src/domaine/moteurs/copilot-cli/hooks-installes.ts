import { estObjet } from '../../valeurs.ts';
import { commandeGardee, estCommandeDeHookMnemo, lanceCeNodeEtCeMain } from '../commande-de-hook.ts';

/**
 * Hooks de Mnemo chez GitHub Copilot CLI : un fichier propre à Mnemo, `hooks/mnemo.json` (`{ "version": 1, "hooks": { … } }`,
 * lu par Copilot avec tout fichier `*.json` de ce dossier, sans approbation), une commande par événement Copilot (noms en
 * camelCase : entrée en camelCase, mesuré), `mnemo hook <événement> --moteur copilot-cli`, `timeoutSec` en secondes :
 * - `preToolUse` sans `matcher` (tous les outils, sous-agents compris ; un par appel, appels parallèles d'une même réponse
 *   compris, mesuré) : un hook qui dépasse son délai laisse passer l'outil (mesuré) ; 10 s, loin de l'échéance de Mnemo
 *   (`refusDelai`, 2 s), qui décide lui-même : une panne de Mnemo ne bloque pas chaque outil ;
 * - `postToolUse` sans `matcher` : après chaque outil, il efface le dialogue ouvert (l'outil approuvé a tourné), même pour
 *   un profil qui ne demande pas `apres_outil` (l'état seulement : `apresOutilDEtat`) ; seuls les outils de Mnemo y notent
 *   une fiche lue ou écrite ;
 * - `notification` : `arret --notification`, son type dit s'il montre un dialogue (`permission_prompt`) ; jamais
 *   `permissionRequest`, appelé pour tout outil évalué, dialogue affiché ou non (mesuré) ;
 * - `userPromptSubmitted` seulement (pas `userPromptTransformed`, qui suit le même message) ; `sessionStart` n'arrive qu'avec
 *   le premier message d'un lancement (mesuré), en même temps que lui.
 */
export const HOOKS_COPILOT_CLI_INSTALLES: readonly { evenement: string; args: readonly string[]; timeoutSec: number }[] = [
	{ evenement: 'sessionStart', args: ['debut'], timeoutSec: 10 },
	{ evenement: 'userPromptSubmitted', args: ['message'], timeoutSec: 5 },
	{ evenement: 'preToolUse', args: ['outil'], timeoutSec: 10 },
	{ evenement: 'postToolUse', args: ['apres_outil'], timeoutSec: 3 },
	{ evenement: 'agentStop', args: ['arret'], timeoutSec: 3 },
	{ evenement: 'notification', args: ['arret', '--notification'], timeoutSec: 3 },
	{ evenement: 'sessionEnd', args: ['fin'], timeoutSec: 3 },
];

/** Clés d'une commande que Mnemo écrit (`matcher` : dans un fichier d'avant) ; une autre (`env`, `cwd`, `windows`…) vient de l'utilisateur. */
const CLES_D_UNE_COMMANDE = new Set(['type', 'bash', 'powershell', 'timeoutSec', 'matcher']);
/** Clés du fichier que Mnemo écrit. */
const CLES_DU_FICHIER = new Set(['version', 'hooks']);

/**
 * Commandes d'un hook (`commandeGardee`) : `bash`, que Copilot lance par `/bin/bash --norc --noprofile -c` sous macOS et Linux
 * (mesuré), et `powershell` sous Windows (lu, non mesuré).
 */
export function commandesDuHook(node: string, main: string, args: readonly string[]): { bash: string; powershell: string } {
	return { bash: commandeGardee('copilot-cli', 'posix', node, main, args), powershell: commandeGardee('copilot-cli', 'powershell', node, main, args) };
}

/** Contenu attendu de `hooks/mnemo.json` pour ce Node et ce `main.ts`. */
export function fichierDeHooksAttendu(node: string, main: string): { version: 1; hooks: Record<string, unknown[]> } {
	const hooks: Record<string, unknown[]> = {};
	for (const { evenement, args, timeoutSec } of HOOKS_COPILOT_CLI_INSTALLES) {
		hooks[evenement] = [{ type: 'command', ...commandesDuHook(node, main, args), timeoutSec }];
	}
	return { version: 1, hooks };
}

/** Une commande de hook posée par Mnemo pour Copilot (n'importe quelle installation) : `bash` le dit, `powershell` aussi s'il est là. */
function estCommandeMnemo(commande: unknown): commande is Record<string, unknown> & { bash: string } {
	if (!estObjet(commande) || commande.type !== 'command' || typeof commande.bash !== 'string' || !estCommandeDeHookMnemo(commande.bash, 'copilot-cli')) return false;
	return commande.powershell === undefined || (typeof commande.powershell === 'string' && estCommandeDeHookMnemo(commande.powershell, 'copilot-cli'));
}

/**
 * `hooks/mnemo.json` lu (texte JSON déjà analysé ; null : absent) : `etat` des hooks de ce Node et ce `main.ts` (`a_jour` :
 * exactement le fichier attendu ; `perime` : des hooks de Mnemo, mais pas ceux-là ; `absent`), `autres` (des hooks d'une autre
 * installation de Mnemo), `deCetteInstallation` (au moins un) ; `personnels` : ce que le fichier porte et que Mnemo n'écrit
 * pas (autres commandes, clés ajoutées) : Mnemo ne le réécrit ni ne le supprime alors.
 */
export function etatDuFichierDeHooks(
	racine: unknown,
	node: string,
	main: string,
): { etat: 'a_jour' | 'perime' | 'absent'; autres: boolean; deCetteInstallation: boolean; personnels: string[] } {
	if (racine === null) return { etat: 'absent', autres: false, deCetteInstallation: false, personnels: [] };
	if (!estObjet(racine)) return { etat: 'perime', autres: false, deCetteInstallation: false, personnels: ['la racine n’est pas un objet JSON'] };
	const personnels = Object.keys(racine).filter((cle) => !CLES_DU_FICHIER.has(cle));
	let mnemo = 0;
	let autres = false;
	let deCetteInstallation = false;
	const hooks = racine.hooks;
	if (hooks !== undefined && !estObjet(hooks)) personnels.push('hooks');
	for (const [evenement, commandes] of Object.entries(estObjet(hooks) ? hooks : {})) {
		if (!Array.isArray(commandes)) {
			personnels.push(`hooks.${evenement}`);
			continue;
		}
		commandes.forEach((commande, rang) => {
			if (!estCommandeMnemo(commande)) {
				personnels.push(`hooks.${evenement}[${rang}]`);
				return;
			}
			mnemo++;
			for (const cle of Object.keys(commande)) if (!CLES_D_UNE_COMMANDE.has(cle)) personnels.push(`hooks.${evenement}[${rang}].${cle}`);
			if (lanceCeNodeEtCeMain(commande.bash, node, main)) deCetteInstallation = true;
			else autres = true;
		});
	}
	if (mnemo === 0 && personnels.length === 0) return { etat: 'absent', autres, deCetteInstallation, personnels };
	const aJour = personnels.length === 0 && JSON.stringify(racine) === JSON.stringify(fichierDeHooksAttendu(node, main));
	return { etat: aJour ? 'a_jour' : 'perime', autres, deCetteInstallation, personnels };
}

/**
 * Le fichier sans les commandes de ce Node et ce `main.ts` (chaque autre commande de Mnemo gardée telle quelle, un événement
 * vidé retiré) ; null s'il n'en reste aucune : le fichier, propre à Mnemo, est à supprimer.
 */
export function fichierSansCetteInstallation(racine: Record<string, unknown>, node: string, main: string): Record<string, unknown> | null {
	const hooks: Record<string, unknown[]> = {};
	for (const [evenement, commandes] of Object.entries(estObjet(racine.hooks) ? racine.hooks : {})) {
		if (!Array.isArray(commandes)) continue;
		const gardees = commandes.filter((c) => !(estCommandeMnemo(c) && lanceCeNodeEtCeMain(c.bash, node, main)));
		if (gardees.length > 0) hooks[evenement] = gardees;
	}
	return Object.keys(hooks).length === 0 ? null : { ...racine, hooks };
}
