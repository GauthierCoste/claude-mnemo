import { homedir } from 'node:os';
import { extname, join, resolve, sep } from 'node:path';
import { fenetreDeContexte } from '../../../domaine/moteurs/claude-code/fenetre-contexte.ts';
import type { FenetreDeContexte } from '../../../domaine/moteurs/moteur.ts';
import { lignesDeLaFin } from '../../fin-de-fichier.ts';
import { seuilDeResumeAuto } from './reglage-resume-auto.ts';

/**
 * Lecture de la transcription Claude Code d'une session (`transcript_path`) pour la seule jauge de la fenêtre de contexte : seule
 * sa fin est lue, et seul l'usage en tokens de la dernière réponse en est tiré. Le contexte injecté ne la lit jamais.
 */

/** La dernière réponse de Claude est dans la fin du fichier, même pour une session de plusieurs heures. */
export const OCTETS_LUS = 512 * 1024;

/** Le chemin vient d'une entrée HTTP du service : seule une transcription de Claude Code (`~/.claude/projects/`) est lue. */
export type LectureTranscription = { lire(chemin: string, dossier?: string | null): Promise<FenetreDeContexte | null> };

export function fenetreDeTranscription(racinePermise: string = join(homedir(), '.claude', 'projects'), octetsLus: number = OCTETS_LUS, accueil: string = homedir()): LectureTranscription {
	const racine = resolve(racinePermise);
	return {
		async lire(chemin, dossier = null) {
			const lignes = await lireFin(racine, chemin, octetsLus);
			return lignes === null ? null : fenetreDeContexte(lignes, await seuilDeResumeAuto(dossier, accueil));
		},
	};
}

/** Lignes de la fin du fichier ; null si le chemin est refusé ou illisible. */
async function lireFin(racine: string, chemin: string, octetsLus: number): Promise<string[] | null> {
	const absolu = resolve(chemin);
	if (!absolu.startsWith(racine + sep) || extname(absolu) !== '.jsonl') return null;
	return lignesDeLaFin(absolu, octetsLus);
}
