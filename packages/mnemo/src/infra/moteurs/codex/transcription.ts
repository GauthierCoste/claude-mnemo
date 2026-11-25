import { readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { LectureFenetre } from '../../../application/ports.ts';
import { telemetrieDeCodex } from '../../../domaine/moteurs/codex/telemetrie.ts';
import { RE_FIL_SUR } from '../../../domaine/moteurs/fil.ts';
import { cheminReelPermis, racinesReelles } from '../../chemin-permis.ts';
import { lignesDeLaFin } from '../../fin-de-fichier.ts';
import { dossierCodex } from './dossier-codex.ts';

/**
 * Lecture de la transcription Codex d'une session (rollout `sessions/AAAA/MM/JJ/rollout-<date>-<fil>.jsonl`) pour la jauge de
 * la fenêtre de contexte et les quotas de l'abonnement ChatGPT : seule sa fin est lue. Le contexte injecté ne la lit jamais.
 */

/** Le dernier `token_count` suit la dernière réponse du modèle : dans la fin du fichier, même pour une longue session. */
export const OCTETS_LUS_CODEX = 512 * 1024;
/** Jours parcourus, du lendemain (fuseau) en remontant, pour retrouver une transcription par son `fil`. */
export const JOURS_CHERCHES = 7;

export type ReglagesTranscriptionCodex = {
	/** Environnement du service, relu à chaque lecture (`CODEX_HOME`). */
	env?: () => Record<string, string | undefined>;
	accueil?: string;
	octetsLus?: number;
	maintenant?: () => number;
};

const deuxChiffres = (n: number): string => String(n).padStart(2, '0');

/**
 * Lecture Codex : le chemin donné par les hooks, accepté seulement s'il est (liens résolus) sous `$CODEX_HOME/sessions` ou
 * `~/.codex/sessions` ; à défaut (absent, refusé, illisible), la transcription cherchée par le `fil` dans les dossiers des
 * `JOURS_CHERCHES` derniers jours.
 */
export function lectureTranscriptionCodex(r: ReglagesTranscriptionCodex = {}): LectureFenetre {
	const env = r.env ?? (() => process.env);
	const accueil = r.accueil ?? homedir();
	const octetsLus = r.octetsLus ?? OCTETS_LUS_CODEX;
	const maintenant = r.maintenant ?? Date.now;

	/** Dossiers des transcriptions, chemins réels ; ceux qui n'existent pas sont omis. */
	const racines = (): Promise<string[]> => racinesReelles([join(dossierCodex(env()), 'sessions'), join(accueil, '.codex', 'sessions')]);

	/** Le chemin réel du fichier s'il est une transcription permise ; null sinon. */
	const permis = (chemin: string, permises: readonly string[]): Promise<string | null> => cheminReelPermis(chemin, permises, '.jsonl');

	/** La transcription du `fil`, la plus récente des jours parcourus ; null si introuvable. */
	async function parFil(fil: string, permises: readonly string[]): Promise<string | null> {
		if (!RE_FIL_SUR.test(fil)) return null;
		const fin = `-${fil}.jsonl`;
		for (let jour = -1; jour < JOURS_CHERCHES; jour += 1) {
			const date = new Date(maintenant() - jour * 86_400_000);
			const sousDossier = [String(date.getFullYear()), deuxChiffres(date.getMonth() + 1), deuxChiffres(date.getDate())];
			for (const racine of permises) {
				const dossier = join(racine, ...sousDossier);
				const noms = await readdir(dossier).catch(() => [] as string[]);
				const nom = noms.filter((n) => n.startsWith('rollout-') && n.endsWith(fin)).sort().at(-1);
				if (nom === undefined) continue;
				const reel = await permis(join(dossier, nom), permises);
				if (reel !== null) return reel;
			}
		}
		return null;
	}

	return {
		async lire({ chemin, fil }) {
			const permises = await racines();
			if (permises.length === 0) return null;
			if (chemin !== undefined) {
				const reel = await permis(chemin, permises);
				const lignes = reel === null ? null : await lignesDeLaFin(reel, octetsLus);
				if (lignes !== null) return telemetrieDeCodex(lignes);
			}
			const trouve = fil === undefined ? null : await parFil(fil, permises);
			const lignes = trouve === null ? null : await lignesDeLaFin(trouve, octetsLus);
			return lignes === null ? null : telemetrieDeCodex(lignes);
		},
	};
}
