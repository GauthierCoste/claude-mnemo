/**
 * Les sessions vues par l'app : la liste tenue à jour par les messages du service, et ce qu'elle en retient (qui attend une
 * réponse, qui est active, comment la nommer).
 */
import { PROFIL_ARCHIVISTE } from '@mnemo/commun';
import type { EtatSessionVue, MessageServeur, SessionVue } from '@mnemo/contrat';

/** Longueur au-delà de laquelle un libellé de session est abrégé (menu, notification). */
export const LIBELLE_SESSION_MAX = 60;

/** Libellés des états, comme ceux de l'interface. */
export const LIBELLES_ETATS: Record<EtatSessionVue, string> = {
	attend: 'Attend ta réponse',
	travaille: 'Travaille',
	a_relire: 'Terminée, à relire',
	en_pause: 'En pause',
	terminee: 'Terminée',
};

/**
 * Liste des sessions après un message du service : `sessions` la remplace, `session` remplace ou ajoute la session de même
 * id ; tout autre message la laisse telle quelle. `null` : aucune liste reçue encore (`session` seul n'en fait pas une).
 */
export function appliquerMessage(sessions: readonly SessionVue[] | null, message: MessageServeur): readonly SessionVue[] | null {
	if (message.type === 'sessions') return message.sessions;
	if (message.type !== 'session' || sessions === null) return sessions;
	const i = sessions.findIndex((s) => s.id === message.session.id);
	return i === -1 ? [...sessions, message.session] : sessions.map((s, j) => (j === i ? message.session : s));
}

/**
 * Vrai si la session attend une réponse de l'utilisateur. L'archiviste attend aussi quand il est seulement à l'écoute :
 * il n'attend une réponse que si un dialogue est ouvert (comme le bouton de l'archiviste dans l'interface).
 */
export function attendReponse(s: SessionVue): boolean {
	return s.etat === 'attend' && (s.profil !== PROFIL_ARCHIVISTE || s.dialogueOuvert);
}

/** Vrai si la session travaille ou attend une réponse (une session en pause, à relire ou terminée ne l'est pas). */
export function estActive(s: SessionVue): boolean {
	return s.etat === 'travaille' || attendReponse(s);
}

/** Sessions actives : celles qui attendent d'abord, puis celles qui travaillent, chaque groupe de la plus ancienne à la plus récente. */
export function sessionsActives(sessions: readonly SessionVue[]): SessionVue[] {
	const rang = (s: SessionVue): number => (attendReponse(s) ? 0 : 1);
	return sessions.filter(estActive).sort((a, b) => rang(a) - rang(b) || a.creeeMs - b.creeeMs);
}

/** Texte abrégé à `max` caractères au plus, points de suspension compris. */
export function abreger(texte: string, max: number = LIBELLE_SESSION_MAX): string {
	const caracteres = [...texte];
	return caracteres.length <= max ? texte : `${caracteres.slice(0, max - 1).join('').trimEnd()}…`;
}

/**
 * Nom d'une session : « Archiviste » pour l'archiviste (son objectif est sa consigne, et il tourne à la racine), comme
 * l'interface ; sinon son objectif (première ligne), sinon son dossier, sinon « Session à la racine » ; abrégé.
 */
export function libelleSession(s: SessionVue): string {
	if (s.profil === PROFIL_ARCHIVISTE) return 'Archiviste';
	const objectif = s.objectif?.split('\n')[0]?.trim() ?? '';
	return abreger(objectif !== '' ? objectif : s.dossier !== '' ? s.dossier : 'Session à la racine');
}

/** Dossier d'une session tel qu'on le montre : « racine » pour la racine du dossier Mnemo. */
export function dossierAffiche(s: SessionVue): string {
	return s.dossier === '' ? 'racine' : s.dossier;
}
