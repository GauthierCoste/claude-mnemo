/** Événements de hook de Mnemo qu'un profil déclare : libellé court et effet, dans l'ordre canonique (celui du service). */
import type { EvenementHookVue } from '@mnemo/contrat';

export const HOOKS_PROFIL: readonly { cle: EvenementHookVue; libelle: string; detail: string }[] = [
	{ cle: 'debut', libelle: 'Début', detail: 'note la session au démarrage' },
	{ cle: 'message', libelle: 'Message', detail: 'injecte les consignes et la fiche de position, propose des pistes à chaque message' },
	{ cle: 'outil', libelle: 'Outil', detail: 'refuse une action contraire à une consigne vérifiée' },
	{ cle: 'apres_outil', libelle: 'Après outil', detail: 'note les fiches lues ou écrites (rien n’est injecté)' },
	{ cle: 'arret', libelle: 'Arrêt', detail: 'tient l’état de la session (attend, à relire)' },
	{ cle: 'fin', libelle: 'Fin', detail: 'termine la session ; épisode minimal sans bilan' },
];
