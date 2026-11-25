/** Libellés des états des sessions, gestes permis par l'état, et durées affichées sur les cartes. */
import type { AttentePremierMessage, EtatSessionVue, SessionVue } from '@mnemo/contrat';

export const LIBELLES_ETATS: Record<EtatSessionVue, string> = {
	attend: 'Attend ta réponse',
	travaille: 'Travaille',
	a_relire: 'Terminée, à relire',
	en_pause: 'En pause',
	terminee: 'Terminée',
};

/** Ce qu'attend une session pas encore commencée chez son moteur : un premier message, ou la réponse à sa question de confiance. */
export const LIBELLES_ATTENTE: Record<AttentePremierMessage, string> = {
	message: 'Attend ton premier message',
	confiance: 'Attend ta réponse à la question de confiance',
};

/**
 * Libellé de l'état d'une session : celui de son état, sauf quand elle tourne sans avoir commencé chez un moteur qui attend
 * le premier message (`attentePremierMessage`) : ce qu'elle attend alors.
 */
export const libelleEtat = (s: Pick<SessionVue, 'etat' | 'attentePremierMessage'>): string => (s.attentePremierMessage === undefined ? LIBELLES_ETATS[s.etat] : LIBELLES_ATTENTE[s.attentePremierMessage]);

/** « 1 terminée », « 3 terminées » (lien vers l'historique). */
export const libelleTerminees = (n: number): string => `${n} terminée${n > 1 ? 's' : ''}`;

const MINUTE = 60_000;
const HEURE = 60 * MINUTE;
const JOUR = 24 * HEURE;

/**
 * Temps écoulé depuis `ms` : « 18 min », « 1 h 10 », « 1 j 4 h ». En pause, l'unité la plus grosse seulement, suivie de
 * « sans activité » (« 3 j sans activité »).
 */
export function dureeDepuis(ms: number, maintenant: number, etat?: EtatSessionVue): string {
	const ecart = Math.max(0, maintenant - ms);
	const jours = Math.floor(ecart / JOUR);
	const heures = Math.floor((ecart % JOUR) / HEURE);
	const minutes = Math.floor((ecart % HEURE) / MINUTE);
	if (etat === 'en_pause') {
		const grosse = jours > 0 ? `${jours} j` : heures > 0 ? `${heures} h` : `${minutes} min`;
		return `${grosse} sans activité`;
	}
	if (jours > 0) return heures > 0 ? `${jours} j ${heures} h` : `${jours} j`;
	if (heures > 0) return minutes > 0 ? `${heures} h ${String(minutes).padStart(2, '0')}` : `${heures} h`;
	return `${minutes} min`;
}

/** Durée affichée d'une session : depuis sa création, ou depuis sa dernière activité si elle est en pause. */
export function dureeSession(s: { etat: EtatSessionVue; creeeMs: number; majMs: number }, maintenant: number): string {
	return s.etat === 'en_pause' ? dureeDepuis(s.majMs, maintenant, 'en_pause') : dureeDepuis(s.creeeMs, maintenant);
}

/** « Terminer avec bilan » est permis : session active, ou en pause (le service la reprend avant son bilan, jalon 6). */
export function bilanPermis(etat: EtatSessionVue): boolean {
	return etat === 'travaille' || etat === 'attend' || etat === 'en_pause';
}
