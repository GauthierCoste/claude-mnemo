import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import type { LectureFenetre } from '../../../application/ports.ts';
import { fenetreDansLeJournal } from '../../../domaine/moteurs/copilot-cli/telemetrie.ts';
import { RE_FIL_SUR } from '../../../domaine/moteurs/fil.ts';
import { cheminReelPermis, racinesReelles } from '../../chemin-permis.ts';
import { lignesDeLaFin } from '../../fin-de-fichier.ts';
import { dossierCopilot, dossierSessionsCopilot } from './dossier-copilot.ts';

/** Le dernier `session.usage_record` suit le dernier appel au modèle : dans la fin du journal. */
export const OCTETS_LUS_COPILOT_CLI = 512 * 1024;

/** Journal d'une session de Copilot, dans son dossier `session-state/<id>/`. */
const JOURNAL = 'events.jsonl';

export type ReglagesTranscriptionCopilotCli = {
	/** Environnement du service, relu à chaque lecture (`COPILOT_HOME`). */
	env?: () => Record<string, string | undefined>;
	accueil?: string;
	octetsLus?: number;
};

/**
 * Lecture GitHub Copilot CLI pour la jauge de la fenêtre de contexte : la fin de `session-state/<fil>/events.jsonl`, sous
 * `$COPILOT_HOME` ou `~/.copilot`. Le chemin donné par les hooks (`transcriptPath`) n'est lu que s'il est (liens résolus) ce
 * journal-là, dans le dossier du `fil` de la session ; à défaut, celui du `fil`. Jamais de quota (Copilot n'en écrit aucun
 * hors de son API).
 */
export function lectureTranscriptionCopilotCli(r: ReglagesTranscriptionCopilotCli = {}): LectureFenetre {
	const env = r.env ?? (() => process.env);
	const accueil = r.accueil ?? homedir();
	const octetsLus = r.octetsLus ?? OCTETS_LUS_COPILOT_CLI;
	return {
		async lire({ chemin, fil }) {
			if (fil === undefined || !RE_FIL_SUR.test(fil)) return null;
			const permises = await racinesReelles([dossierSessionsCopilot(dossierCopilot(env())), dossierSessionsCopilot(join(accueil, '.copilot'))]);
			const candidats = [...(chemin === undefined ? [] : [chemin]), ...permises.map((p) => join(p, fil, JOURNAL))];
			for (const candidat of candidats) {
				const reel = await cheminReelPermis(candidat, permises, '.jsonl');
				if (reel === null || basename(reel) !== JOURNAL || basename(dirname(reel)) !== fil || !permises.includes(dirname(dirname(reel)))) continue;
				const lignes = await lignesDeLaFin(reel, octetsLus);
				const fenetre = lignes === null ? null : fenetreDansLeJournal(lignes);
				if (fenetre !== null) return { fenetre };
			}
			return null;
		},
	};
}
