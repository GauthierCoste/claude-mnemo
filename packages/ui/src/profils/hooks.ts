/**
 * Événements de hook de Mnemo qu'un profil déclare, dans l'ordre canonique (celui du service) : libellé court et effet (Nouvelle
 * session), et leur nom de capacité, leur symbole et leur effet dans le créateur d'agent (Réglages › Agents). `toujours` : un hook
 * qui tient l'état de la session (début, arrêt, fin), actif quel que soit l'agent (le service le garde : `HOOKS_D_ETAT`).
 */
import type { EvenementHookVue } from '@mnemo/contrat';

export const HOOKS_PROFIL: readonly { cle: EvenementHookVue; libelle: string; detail: string; capacite: string; symbole: string; effet: string; toujours: boolean }[] = [
	{ cle: 'debut', libelle: 'Début', detail: 'note la session au démarrage', capacite: 'Éveil', symbole: '✦', effet: 'au démarrage : la session apparaît dans Sessions', toujours: true },
	{
		cle: 'message',
		libelle: 'Message',
		detail: 'injecte les consignes et la fiche de position, propose des pistes à chaque message',
		capacite: 'Souffle',
		symbole: '◎',
		effet: 'à chaque message : injecte les consignes et propose des pistes',
		toujours: false,
	},
	{ cle: 'outil', libelle: 'Outil', detail: 'refuse une action contraire à une consigne vérifiée', capacite: 'Bouclier', symbole: '⛨', effet: 'avant une action : la bloque si elle viole une consigne vérifiée', toujours: false },
	{ cle: 'apres_outil', libelle: 'Après outil', detail: 'note les fiches lues ou écrites (rien n’est injecté)', capacite: 'Carnet', symbole: '✎', effet: 'après une action : retient les fiches lues ou écrites', toujours: false },
	{ cle: 'arret', libelle: 'Arrêt', detail: 'tient l’état de la session (attend, à relire)', capacite: 'Veille', symbole: '◷', effet: 'quand l’agent s’arrête : la session attend une réponse', toujours: true },
	{ cle: 'fin', libelle: 'Fin', detail: 'termine la session ; épisode minimal sans bilan', capacite: 'Récit', symbole: '❖', effet: 'à la fermeture : termine la session, épisode minimal sans bilan', toujours: true },
];

/** Hooks toujours actifs (tiennent l'état de la session). */
export const HOOKS_TOUJOURS: readonly EvenementHookVue[] = HOOKS_PROFIL.filter((h) => h.toujours).map((h) => h.cle);

/** Capacités actives d'un agent : les toujours actifs, et ceux qu'il demande parmi les autres. */
export const capacitesActives = (hooks: readonly EvenementHookVue[]): number => HOOKS_PROFIL.filter((h) => h.toujours || hooks.includes(h.cle)).length;
