/**
 * « Quitter Mnemo » : le service vit hors de l'app ; en quittant, l'arrêter (lui et ses sessions) ou le laisser tourner.
 * La question est posée par une boîte, sauf si un choix a été retenu (« Ne plus demander »), ou s'il n'y a pas de service
 * vivant à arrêter.
 */
import type { SessionVue } from '@mnemo/contrat';
import type { ChoixQuitter } from './preferences.ts';
import { sessionsActives } from './sessions.ts';
import type { EtatVie } from './vie-service.ts';

export type SuiteQuitter = 'quitter' | 'arreterPuisQuitter' | 'demander';

/** Ce que fait « Quitter Mnemo » selon le choix retenu et la vie du service. */
export function suiteQuitter(choix: ChoixQuitter, vie: EtatVie): SuiteQuitter {
	if (vie !== 'vivant') return 'quitter';
	if (choix === 'arreter') return 'arreterPuisQuitter';
	if (choix === 'laisser') return 'quitter';
	return 'demander';
}

/** Boutons de la boîte, dans l'ordre (indices de la réponse). */
export const BOUTONS_QUITTER = ['Arrêter le service et ses sessions', 'Laisser tourner', 'Annuler'] as const;
export const BOUTON_QUITTER_DEFAUT = 1;
export const BOUTON_QUITTER_ANNULER = 2;
export const CASE_NE_PLUS_DEMANDER = 'Ne plus demander';

export type QuestionQuitter = { message: string; detail: string };

/** Texte de la boîte : ce qu'arrêter le service emporte (les sessions actives). */
export function questionQuitter(sessions: readonly SessionVue[]): QuestionQuitter {
	const n = sessionsActives(sessions).length;
	const sessionsTexte = n === 0 ? 'Aucune session n’est active.' : n === 1 ? 'Une session est active : elle s’arrêtera avec lui.' : `${n} sessions sont actives : elles s’arrêteront avec lui.`;
	return {
		message: 'Arrêter aussi le service Mnemo ?',
		detail: `${sessionsTexte} Laissé tournant, le service les garde, et l’app s’y rattachera à sa prochaine ouverture.`,
	};
}

/** Suite donnée à la réponse de la boîte, et le choix à retenir (« Ne plus demander » cochée, sauf pour Annuler). */
export function reponseQuitter(bouton: number, nePlusDemander: boolean): { suite: 'arreterPuisQuitter' | 'quitter' | 'annuler'; retenir: ChoixQuitter | null } {
	if (bouton === 0) return { suite: 'arreterPuisQuitter', retenir: nePlusDemander ? 'arreter' : null };
	if (bouton === 1) return { suite: 'quitter', retenir: nePlusDemander ? 'laisser' : null };
	return { suite: 'annuler', retenir: null };
}
