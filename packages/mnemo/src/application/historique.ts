import type { Fiche } from '../domaine/fiche.ts';
import type { Session } from '../domaine/session.ts';
import { episodesDuProjet } from './episode.ts';
import type { Dependances, EtatSessions } from './ports.ts';

export type SessionTerminee = { session: Session; episode: { chemin: string; fiche: Fiche } | null };

/**
 * Historique des sessions : les terminées, plus récentes d'abord (dernière activité), chacune avec son épisode s'il est
 * dans la mémoire. Une lecture du dossier d'épisodes par projet ; un dossier illisible : pas d'épisode.
 */
export async function historiqueDesSessions(dep: Dependances, etat: Pick<EtatSessions, 'lister'>): Promise<SessionTerminee[]> {
	const terminees = (await etat.lister({ archivees: true })).filter((s) => s.etat === 'terminee').sort((a, b) => b.majMs - a.majMs || a.id.localeCompare(b.id));
	const parProjet = new Map<string, Map<string, { chemin: string; fiche: Fiche }>>();
	const sortie: SessionTerminee[] = [];
	for (const session of terminees) {
		let episodes = parProjet.get(session.projet);
		if (episodes === undefined) {
			episodes = await episodesDuProjet(dep, session.projet).catch(() => new Map());
			parProjet.set(session.projet, episodes);
		}
		sortie.push({ session, episode: episodes.get(session.id) ?? null });
	}
	return sortie;
}
