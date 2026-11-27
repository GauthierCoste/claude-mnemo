/**
 * Événements de hook de Mnemo qu'un profil déclare, dans l'ordre canonique (celui du service) : libellé court et effet (Nouvelle
 * session), et leur nom de capacité, leur symbole et leur effet dans le créateur d'agent (Réglages › Agents). `toujours` : un hook
 * qui tient l'état de la session (début, arrêt, fin), actif quel que soit l'agent (le service le garde : `HOOKS_D_ETAT`). Les
 * textes viennent de la liste `agents.hooks` de la langue courante.
 */
import type { EvenementHookVue } from '@mnemo/contrat';
import { TEXTES, type Textes } from '../langue/textes.ts';

export type HookProfil = { cle: EvenementHookVue; libelle: string; detail: string; capacite: string; symbole: string; effet: string; toujours: boolean };

const ORDRE: readonly { cle: EvenementHookVue; symbole: string; toujours: boolean }[] = [
	{ cle: 'debut', symbole: '✦', toujours: true },
	{ cle: 'message', symbole: '◎', toujours: false },
	{ cle: 'outil', symbole: '⛨', toujours: false },
	{ cle: 'apres_outil', symbole: '✎', toujours: false },
	{ cle: 'arret', symbole: '◷', toujours: true },
	{ cle: 'fin', symbole: '❖', toujours: true },
];

/** Les hooks d'un profil, avec les textes d'une langue (le français par défaut). */
export const hooksProfil = (t: Textes['agents']['hooks'] = TEXTES.fr.agents.hooks): readonly HookProfil[] => ORDRE.map((h) => ({ ...h, ...t[h.cle] }));

/** Les hooks avec leurs textes français, pour un appelant qui n'a pas la langue. */
export const HOOKS_PROFIL: readonly HookProfil[] = hooksProfil();

/** Hooks toujours actifs (tiennent l'état de la session). */
export const HOOKS_TOUJOURS: readonly EvenementHookVue[] = ORDRE.filter((h) => h.toujours).map((h) => h.cle);

/** Capacités actives d'un agent : les toujours actifs, et ceux qu'il demande parmi les autres. */
export const capacitesActives = (hooks: readonly EvenementHookVue[]): number => ORDRE.filter((h) => h.toujours || hooks.includes(h.cle)).length;
