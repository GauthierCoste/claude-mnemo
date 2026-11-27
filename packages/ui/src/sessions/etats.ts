/** Gestes permis par l'état d'une session, et durées affichées sur les cartes (libellés : `t.sessions.etats`). */
import type { EtatSessionVue } from '@mnemo/contrat';
import { TEXTES, type Textes } from '../langue/textes.ts';

const MINUTE = 60_000;
const HEURE = 60 * MINUTE;
const JOUR = 24 * HEURE;

/**
 * Temps écoulé depuis `ms` : « 18 min », « 1 h 10 », « 1 j 4 h ». En pause, l'unité la plus grosse seulement, suivie de
 * « sans activité » (« 3 j sans activité »).
 */
export function dureeDepuis(ms: number, maintenant: number, etat?: EtatSessionVue, t: Textes['sessions'] = TEXTES.fr.sessions): string {
	const d = t.formats.duree;
	const ecart = Math.max(0, maintenant - ms);
	const jours = Math.floor(ecart / JOUR);
	const heures = Math.floor((ecart % JOUR) / HEURE);
	const minutes = Math.floor((ecart % HEURE) / MINUTE);
	if (etat === 'en_pause') {
		return d.sansActivite(jours > 0 ? d.jours(jours) : heures > 0 ? d.heures(heures) : d.minutes(minutes));
	}
	if (jours > 0) return heures > 0 ? d.joursHeures(jours, heures) : d.jours(jours);
	if (heures > 0) return minutes > 0 ? d.heuresMinutes(heures, minutes) : d.heures(heures);
	return d.minutes(minutes);
}

/** Durée affichée d'une session : depuis sa création, ou depuis sa dernière activité si elle est en pause. */
export function dureeSession(s: { etat: EtatSessionVue; creeeMs: number; majMs: number }, maintenant: number, t: Textes['sessions'] = TEXTES.fr.sessions): string {
	return s.etat === 'en_pause' ? dureeDepuis(s.majMs, maintenant, 'en_pause', t) : dureeDepuis(s.creeeMs, maintenant, undefined, t);
}

/** « Terminer avec bilan » est permis : session active, ou en pause (le service la reprend avant son bilan, jalon 6). */
export function bilanPermis(etat: EtatSessionVue): boolean {
	return etat === 'travaille' || etat === 'attend' || etat === 'en_pause';
}
