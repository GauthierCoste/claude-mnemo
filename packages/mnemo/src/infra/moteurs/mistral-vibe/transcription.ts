import { readdir, readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { LectureFenetre } from '../../../application/ports.ts';
import type { FenetreDeContexte } from '../../../domaine/moteurs/moteur.ts';
import { fenetreDansEtatDuMoteur, fenetreMistralVibe, generationCourante, tokensDansLaProjection, tokensDansLeJournal } from '../../../domaine/moteurs/mistral-vibe/telemetrie.ts';
import { cheminReelPermis, racinesReelles } from '../../chemin-permis.ts';
import { lignesDeLaFin } from '../../fin-de-fichier.ts';
import { dossierVibe } from './dossier-vibe.ts';

/**
 * Lecture du dossier de session de Mistral Vibe (`logs/session/unified/<id>/`) pour la jauge de la fenêtre de contexte : la fin
 * du dernier journal, sinon l'état de la génération courante, et la taille de la fenêtre dans l'état du moteur. Jamais le
 * contexte injecté ; jamais de quota (Vibe ne l'écrit pas).
 */

/** Le dernier `contextUsage` suit le dernier appel au modèle : dans la fin du journal. */
export const OCTETS_LUS_MISTRAL_VIBE = 512 * 1024;
/** Un fichier d'état (`CURRENT`, `projection-state.json`, `runtime-state.json`) : quelques Kio ; au-delà, il n'est pas lu. */
const ETAT_MAX_OCTETS = 4 * 1024 * 1024;
/** Un `fil` de Vibe (forme d'uuid) : rien qui puisse sortir d'un nom de dossier. */
const FIL = /^[A-Za-z0-9-]{1,200}$/u;

export type ReglagesTranscriptionMistralVibe = {
	/** Environnement du service, relu à chaque lecture (`VIBE_HOME`). */
	env?: () => Record<string, string | undefined>;
	accueil?: string;
	octetsLus?: number;
};

/** Texte d'un petit fichier ordinaire ; null s'il manque, est trop gros ou n'est pas un fichier. */
async function petitFichier(chemin: string): Promise<string | null> {
	const infos = await stat(chemin).catch(() => null);
	if (infos === null || !infos.isFile() || infos.size > ETAT_MAX_OCTETS) return null;
	return readFile(chemin, 'utf8').catch(() => null);
}

/** Journaux de la session (`journal/<n>.jsonl`), du plus récent au plus ancien. */
async function journaux(dossier: string): Promise<string[]> {
	const noms = await readdir(join(dossier, 'journal')).catch(() => [] as string[]);
	return noms
		.filter((n) => /^\d{1,32}\.jsonl$/u.test(n))
		.sort((a, b) => b.length - a.length || (a < b ? 1 : a > b ? -1 : 0))
		.map((n) => join(dossier, 'journal', n));
}

/** Fenêtre lue dans un dossier de session (réel, permis) ; null si rien n'y est lisible. */
async function fenetreDuDossier(dossier: string, octetsLus: number): Promise<{ fenetre: FenetreDeContexte } | null> {
	const courant = await petitFichier(join(dossier, 'CURRENT'));
	const generation = courant === null ? null : generationCourante(courant);
	const etats = generation === null ? null : join(dossier, 'generations', generation);
	let utilises: number | null = null;
	// le journal d'après la génération courante est souvent vide : on remonte au précédent
	for (const journal of (await journaux(dossier)).slice(0, 2)) {
		const lignes = await lignesDeLaFin(journal, octetsLus);
		utilises = lignes === null ? null : tokensDansLeJournal(lignes);
		if (utilises !== null) break;
	}
	if (utilises === null && etats !== null) {
		const projection = await petitFichier(join(etats, 'projection-state.json'));
		utilises = projection === null ? null : tokensDansLaProjection(projection);
	}
	const runtime = etats === null ? null : await petitFichier(join(etats, 'runtime-state.json'));
	const fenetre = fenetreMistralVibe(utilises, runtime === null ? null : fenetreDansEtatDuMoteur(runtime));
	return fenetre === null ? null : { fenetre };
}

/**
 * Lecture Mistral Vibe : le dossier donné par les hooks (`transcript_path`), accepté seulement s'il est (liens résolus) sous
 * `$VIBE_HOME/logs/session/unified` ou `~/.vibe/logs/session/unified` ; à défaut, celui du `fil`.
 */
export function lectureTranscriptionMistralVibe(r: ReglagesTranscriptionMistralVibe = {}): LectureFenetre {
	const env = r.env ?? (() => process.env);
	const accueil = r.accueil ?? homedir();
	const octetsLus = r.octetsLus ?? OCTETS_LUS_MISTRAL_VIBE;
	const sessions = (racine: string) => join(racine, 'logs', 'session', 'unified');
	return {
		async lire({ chemin, fil }) {
			const permises = await racinesReelles([sessions(dossierVibe(env())), sessions(join(accueil, '.vibe'))]);
			if (permises.length === 0) return null;
			const candidats = [...(chemin === undefined ? [] : [chemin]), ...(fil !== undefined && FIL.test(fil) ? permises.map((p) => join(p, fil)) : [])];
			for (const candidat of candidats) {
				const reel = await cheminReelPermis(candidat, permises);
				const lu = reel === null ? null : await fenetreDuDossier(reel, octetsLus);
				if (lu !== null) return lu;
			}
			return null;
		},
	};
}
