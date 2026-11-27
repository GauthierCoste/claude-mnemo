/**
 * « Quitter Mnemo » : le service vit hors de l'app ; en quittant, l'arrêter (lui et ses sessions) ou le laisser tourner.
 * La question est posée par une boîte, sauf si un choix a été retenu (« Ne plus demander »), ou s'il n'y a pas de service
 * vivant à arrêter.
 */
import type { SessionVue } from '@mnemo/contrat';
import { TEXTES_FR, type TextesApp } from './langue/textes.ts';
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

/** Boutons de la boîte dans une langue, dans l'ordre (indices de la réponse). */
export function boutonsQuitter(t: TextesApp = TEXTES_FR): string[] {
	return [t.quitter.arreter, t.quitter.laisser, t.quitter.annuler];
}
/** Les boutons en français. */
export const BOUTONS_QUITTER = boutonsQuitter();
export const BOUTON_QUITTER_DEFAUT = 1;
export const BOUTON_QUITTER_ANNULER = 2;
export const CASE_NE_PLUS_DEMANDER = TEXTES_FR.quitter.nePlusDemander;

/** `case` : le libellé de « Ne plus demander ». */
export type QuestionQuitter = { message: string; detail: string; boutons: string[]; case: string };

/** Texte de la boîte : ce qu'arrêter le service emporte (les sessions actives). */
export function questionQuitter(sessions: readonly SessionVue[], t: TextesApp = TEXTES_FR): QuestionQuitter {
	const q = t.quitter;
	return { message: q.message, detail: q.detail(q.sessions(sessionsActives(sessions).length)), boutons: boutonsQuitter(t), case: q.nePlusDemander };
}

/** Suite donnée à la réponse de la boîte, et le choix à retenir (« Ne plus demander » cochée, sauf pour Annuler). */
export function reponseQuitter(bouton: number, nePlusDemander: boolean): { suite: 'arreterPuisQuitter' | 'quitter' | 'annuler'; retenir: ChoixQuitter | null } {
	if (bouton === 0) return { suite: 'arreterPuisQuitter', retenir: nePlusDemander ? 'arreter' : null };
	if (bouton === 1) return { suite: 'quitter', retenir: nePlusDemander ? 'laisser' : null };
	return { suite: 'annuler', retenir: null };
}
