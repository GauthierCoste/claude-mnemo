import { estFil } from '../../domaine/moteurs/fil.ts';
import { effetDuHook, hooksDuTexte } from '../../domaine/moteurs/hooks-du-profil.ts';
import type { IdMoteur } from '../../domaine/moteurs/moteur.ts';
import { estSourceDeDebut, estUuid } from '../../domaine/session.ts';
import type { EvenementHook } from '../../domaine/session.ts';
import { estObjet, objetJson } from '../../domaine/valeurs.ts';
import type { EntreeHook, ReponseHook } from '../evenements.ts';
import type { AppelHook, HooksDuMoteur } from '../ports.ts';

/** Options permises après l'événement, une fois chacune (celles de Claude Code). */
const OPTIONS: Partial<Record<EvenementHook, readonly string[]>> = { arret: ['--notification'], debut: ['--sans-contexte'], message: ['--sans-contexte'], apres_outil: ['--sans-contexte'] };

/**
 * Ce qui distingue les hooks d'un moteur qui les prend d'un fichier commun à tout le poste (Codex, Mistral Vibe) :
 * - `evenements` : événement Mnemo de chaque nom accepté en argument (nom Mnemo ou nom du moteur) ; `notifications` : les noms
 *   du moteur qui valent `arret --notification` (un dialogue est ouvert) ;
 * - `raisonsIgnorees` : raisons d'une fin de conversation qui ne termine pas la session (`/clear`…) ;
 * - `arret` : ce qu'est un arrêt d'après son entrée (null : ignoré) ; par défaut, `notification` sur `--notification` ;
 * - `sortie`, `echeancesMs`, `finIgnoreeSiVivante` : ceux de `HooksDuMoteur`.
 */
export type ReglagesHooksGardes = {
	moteur: IdMoteur;
	evenements: Readonly<Record<string, EvenementHook>>;
	notifications: ReadonlySet<string>;
	raisonsIgnorees: ReadonlySet<string>;
	arret?(champs: Record<string, unknown>, options: ReadonlySet<string>): 'notification' | 'stop' | null;
	sortie(evenement: EvenementHook, reponse: ReponseHook): string;
	echeancesMs: Record<EvenementHook, number>;
	finIgnoreeSiVivante: boolean;
};

const arretParDefaut = (_champs: Record<string, unknown>, options: ReadonlySet<string>): 'notification' | 'stop' => (options.has('--notification') ? 'notification' : 'stop');

/**
 * Hooks installés pour tout le poste chez un moteur, inertes hors d'une session Mnemo de ce moteur : `MNEMO_SESSION` (uuid) et
 * `MNEMO_MOTEUR` égal au moteur, posées au lancement. `MNEMO_SESSION` seule ne suffit pas : tout processus lancé depuis une
 * session d'un autre moteur en hérite (avec son `MNEMO_MOTEUR`), un agent lancé par l'agent compris.
 *
 * Entrée traduite (champs mesurés chez Codex et Mistral Vibe : `session_id`, `transcript_path`, `cwd`, puis `source`,
 * `prompt`, `tool_name`, `tool_input`, `reason`…). Session : `MNEMO_SESSION` seulement — le `session_id` du moteur est son
 * propre identifiant (`fil`). Null hors d'une session Mnemo, pour un hook que le profil de la session ne demande pas
 * (`MNEMO_HOOKS` : `outil`, `apres_outil` ; `debut` et `message` y passent sans contexte), pour une fin ou un arrêt ignorés,
 * ou une entrée illisible hors `outil` (qui doit décider : son action est alors « non lue »).
 */
export function hooksGardes(r: ReglagesHooksGardes): HooksDuMoteur {
	const sessionMnemo = (env: Record<string, string | undefined>): string | null => {
		const session = env.MNEMO_SESSION;
		return env.MNEMO_MOTEUR === r.moteur && session !== undefined && estUuid(session) ? session : null;
	};
	const arretDe = r.arret ?? arretParDefaut;

	function traduire({ evenement, options, lecture, env, maintenantMs, cwdProcessus, reel }: AppelHook): { entree: EntreeHook; transcription?: string } | null {
		const session = sessionMnemo(env);
		if (session === null) return null;
		// hooks communs à toutes les sessions : le profil de celle-ci dit ce que chacun fait (`MNEMO_HOOKS`, posée au lancement)
		const demandes = hooksDuTexte(env.MNEMO_HOOKS);
		const effet = demandes === null ? 'actif' : effetDuHook(evenement, demandes);
		if (effet === 'absent') return null;
		const lu = 'texte' in lecture ? objetJson(lecture.texte) : null;
		if (lu === null && evenement !== 'outil') return null;
		const champs = lu ?? {};
		if (evenement === 'fin' && typeof champs.reason === 'string' && r.raisonsIgnorees.has(champs.reason)) return null;
		const arret = evenement === 'arret' ? arretDe(champs, options) : null;
		if (evenement === 'arret' && arret === null) return null;
		// le moteur lance le hook dans le dossier de la session : la meilleure position connue quand l'entrée n'en donne pas
		const entree: EntreeHook = { evenement, session, horodatageMs: maintenantMs, cwd: reel(typeof champs.cwd === 'string' && champs.cwd !== '' ? champs.cwd : cwdProcessus) };
		if (estFil(champs.session_id)) entree.fil = champs.session_id;
		if (typeof champs.prompt === 'string') entree.prompt = champs.prompt;
		if (evenement === 'debut' && estSourceDeDebut(champs.source)) entree.source = champs.source;
		// une entrée d'outil en texte (patch brut de Codex) est gardée sous `input`, où les outils du moteur la lisent
		if (typeof champs.tool_name === 'string') entree.outil = { nom: champs.tool_name, entree: estObjet(champs.tool_input) ? champs.tool_input : typeof champs.tool_input === 'string' ? { input: champs.tool_input } : {} };
		else if (evenement === 'outil') entree.outil = { nonLue: 'nonLue' in lecture ? lecture.nonLue : 'entree_illisible' };
		if (arret !== null) entree.arret = arret;
		if (options.has('--sans-contexte') || effet === 'sans_contexte') entree.sansContexte = true;
		return typeof champs.transcript_path === 'string' && champs.transcript_path !== '' ? { entree, transcription: champs.transcript_path } : { entree };
	}

	/** `<événement> [options]` : nom Mnemo ou du moteur, puis ses options permises, une fois chacune. */
	function lireArguments(args: string[]): { evenement: EvenementHook; options: Set<string> } | null {
		const [nom, ...reste] = args;
		const evenement = nom === undefined || !Object.hasOwn(r.evenements, nom) ? undefined : r.evenements[nom];
		if (evenement === undefined) return null;
		const options = new Set(reste);
		if (options.size !== reste.length || !reste.every((o) => (OPTIONS[evenement] ?? []).includes(o))) return null;
		if (r.notifications.has(nom!)) options.add('--notification');
		return { evenement, options };
	}

	return { lireArguments, inerte: (env) => sessionMnemo(env) === null, traduire, sortie: r.sortie, echeancesMs: r.echeancesMs, finIgnoreeSiVivante: r.finIgnoreeSiVivante };
}
