/**
 * Le juge du banc par Claude Code (spec « entraîner la note », D4) : un `claude -p` par message, sur l'abonnement de
 * l'utilisateur (jamais une clé d'API), sans aucun outil ni serveur MCP.
 *
 * Options vérifiées dans l'aide de Claude Code 2.1.332 (`claude --help`, 26/11/2026) :
 * - `-p, --print` : répond et sort ; sans argument de prompt, le texte est lu sur l'entrée (le message à juger y passe : pas de
 *   limite de longueur de ligne de commande, Windows compris) ;
 * - `--output-format json` : un seul objet JSON (« single result ») ; le texte de la réponse est son champ `result`, et
 *   `is_error` vrai dit une erreur (forme connue de la sortie de Claude Code, non mesurée ici : aucun appel réel) ;
 * - `--tools ""` : « "" for none », aucun outil intégré ; option à plusieurs valeurs, suivie d'une autre option ;
 * - `--strict-mcp-config` sans `--mcp-config` : « Only use MCP servers from --mcp-config » : aucun serveur MCP ;
 * - `--system-prompt` : la consigne du juge remplace celle d'agent de code ;
 * - `--no-session-persistence` (« only works with --print ») : la conversation n'est pas gardée sur le disque ;
 * - `--disable-slash-commands` : ni skills ni commandes ;
 * - `--model` laissé au défaut de l'utilisateur.
 * Non retenues : `--bare` (n'accepte que `ANTHROPIC_API_KEY`, jamais l'abonnement) ; `--json-schema` (champ de sortie non
 * documenté dans l'aide). Les hooks de Mnemo installés pour tout le poste restent inertes : l'environnement n'a aucune
 * variable `MNEMO_*` (`environnementClaudeHorsSession`).
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { environnementClaudeHorsSession } from '../application/moteurs/claude-code/plugin.ts';
import type { CommandeMoteur, Executer } from '../application/ports.ts';
import type { Prejugement } from '../application/banc-contexte.ts';
import type { Juge } from '../application/prejuger.ts';
import { CONSIGNE_JUGE, lireReponseDuJuge, ReponseDuJugeIllisible, texteAJuger } from '../domaine/consigne-juge.ts';
import type { MessageAJuger, ReponseDuJuge } from '../domaine/consigne-juge.ts';
import { EchecClaudePrint, executerClaudePrint, extraitDeSortie } from './moteurs/claude-code/claude-print.ts';

/** Un message se juge en moins de deux minutes ; au-delà, l'appel est tué. */
export const DELAI_JUGE_MS = 120_000;
/** Une réponse illisible ou incomplète est redemandée une fois. */
const TENTATIVES = 2;

/** Arguments du `claude -p` du juge (après `claude.avant`) ; le message à juger passe sur l'entrée. */
export function argumentsDuJuge(): string[] {
	return ['-p', '--output-format', 'json', '--tools', '', '--strict-mcp-config', '--no-session-persistence', '--disable-slash-commands', '--system-prompt', CONSIGNE_JUGE];
}

/**
 * Le texte de la réponse dans la sortie de `--output-format json` (champ `result`) ; `ReponseDuJugeIllisible` si la sortie
 * n'a pas cette forme ; `EchecClaudePrint` si Claude Code dit une erreur (`is_error`).
 */
export function resultatDeClaude(sortie: string): string {
	let brut: unknown;
	try {
		brut = JSON.parse(sortie);
	} catch {
		throw new ReponseDuJugeIllisible('sortie de claude -p illisible : JSON attendu.');
	}
	if (typeof brut !== 'object' || brut === null || Array.isArray(brut)) throw new ReponseDuJugeIllisible('sortie de claude -p illisible : objet attendu.');
	const o = brut as Record<string, unknown>;
	if (o['is_error'] === true) throw new EchecClaudePrint(`claude -p a répondu par une erreur : ${extraitDeSortie(typeof o['result'] === 'string' ? o['result'] : '') || 'sans message'}`);
	if (typeof o['result'] !== 'string') throw new ReponseDuJugeIllisible('sortie de claude -p illisible : champ « result » attendu.');
	return o['result'];
}

/**
 * `claude` : la commande trouvée (`trouverClaude`) ; `env` : l'environnement de l'utilisateur ; `cwd` : dossier courant, neutre
 * (par défaut, un dossier vide créé pour chaque message dans le dossier temporaire et retiré après : jamais le dossier
 * temporaire lui-même, partagé sous Linux, où un `.claude/settings.json` ou un `CLAUDE.md` déposé par un autre compte serait
 * lu comme réglages et consigne du projet) ; `delaiMs` : par appel.
 */
export type OptionsJugeClaude = { executer: Executer; claude: CommandeMoteur; env: Record<string, string | undefined>; cwd?: string; delaiMs?: number };

/**
 * Le juge : un `claude -p` par message (`argumentsDuJuge`, texte à juger sur l'entrée). Une réponse illisible ou qui oublie des
 * candidates est redemandée une fois ; la plus complète des deux est rendue, ou l'erreur si aucune ne se lit. Un `claude -p` en
 * échec (délai, abandon, code de sortie) n'est pas relancé.
 */
export function jugeClaude(o: OptionsJugeClaude): Juge {
	const env = environnementClaudeHorsSession(o.env);
	const delaiMs = o.delaiMs ?? DELAI_JUGE_MS;
	return {
		async juger(message, signal) {
			const cwd = o.cwd ?? (await mkdtemp(join(tmpdir(), 'mnemo-juge-')));
			try {
				return await jugerDans(cwd, message, signal);
			} finally {
				if (o.cwd === undefined) await rm(cwd, { recursive: true, force: true }).catch(() => {});
			}
		},
	};

	async function jugerDans(cwd: string, message: MessageAJuger, signal: AbortSignal | undefined): Promise<Record<string, Prejugement>> {
		const chemins = message.candidates.map((c) => c.chemin);
		const entree = texteAJuger(message);
		let meilleure: ReponseDuJuge | null = null;
		let illisible: ReponseDuJugeIllisible | null = null;
		for (let tentative = 0; tentative < TENTATIVES; tentative++) {
			const { sortie } = await executerClaudePrint(o.executer, o.claude, { args: argumentsDuJuge(), cwd, env, delaiMs, entree, ...(signal === undefined ? {} : { signal }) });
			let reponse: ReponseDuJuge;
			try {
				reponse = lireReponseDuJuge(resultatDeClaude(sortie), chemins);
			} catch (e) {
				if (!(e instanceof ReponseDuJugeIllisible)) throw e;
				illisible = e;
				continue;
			}
			if (reponse.manquants.length === 0) return reponse.propositions;
			if (meilleure === null || reponse.manquants.length < meilleure.manquants.length) meilleure = reponse;
		}
		if (meilleure !== null && Object.keys(meilleure.propositions).length > 0) return meilleure.propositions;
		throw illisible ?? new ReponseDuJugeIllisible('le juge n\'a proposé aucune candidate.');
	}
}
