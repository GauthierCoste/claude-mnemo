/** Sessions de la grille, rangées par dossier : une ligne par dossier, dans l'ordre de création. */
import type { SessionVue } from '@mnemo/contrat';
import { PROFIL_ARCHIVISTE } from '@mnemo/commun';

export type GroupeSessions = { cle: string; titre: string; sessions: SessionVue[] };

/** Où une session s'affiche : la grille, le tiroir des terminées, ou le tiroir de l'archiviste. */
export type DestinationSession = 'grille' | 'terminees' | 'archiviste';

/** Une session terminée (archiviste compris) va au tiroir des terminées ; l'archiviste vivant, à son tiroir ; les autres, à la grille. */
export function destinationDeSession(s: Pick<SessionVue, 'etat' | 'profil'>): DestinationSession {
	if (s.etat === 'terminee') return 'terminees';
	if (s.profil === PROFIL_ARCHIVISTE) return 'archiviste';
	return 'grille';
}

/** Sessions montrées dans la grille et l'arbre des dossiers (`destinationDeSession` : `grille`). */
export function sessionsVisibles(sessions: readonly SessionVue[]): SessionVue[] {
	return sessions.filter((s) => destinationDeSession(s) === 'grille');
}

/**
 * Groupes par `dossier` (clé), titrés par le dossier ou, pour la racine (`''`), par `nomRacine`. Les sessions terminées
 * et l'archiviste (tiroir à part) sont exclus. Sessions et groupes suivent l'ordre de création.
 */
export function grouperSessions(sessions: SessionVue[], nomRacine: string): GroupeSessions[] {
	const groupes = new Map<string, GroupeSessions>();
	const visibles = sessionsVisibles(sessions).sort((a, b) => a.creeeMs - b.creeeMs);
	for (const s of visibles) {
		const g = groupes.get(s.dossier) ?? { cle: s.dossier, titre: s.dossier || nomRacine, sessions: [] };
		g.sessions.push(s);
		groupes.set(s.dossier, g);
	}
	return [...groupes.values()];
}
