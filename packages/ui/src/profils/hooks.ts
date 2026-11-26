/**
 * Événements de hook de Mnemo qu'un profil déclare, dans l'ordre canonique (celui du service) : libellé court et effet (Nouvelle
 * session), et leur nom de pouvoir, leur rune et leur effet dans le créateur d'agent (Réglages › Agents).
 */
import type { EvenementHookVue } from '@mnemo/contrat';

export const HOOKS_PROFIL: readonly { cle: EvenementHookVue; libelle: string; detail: string; pouvoir: string; rune: string; effet: string }[] = [
	{ cle: 'debut', libelle: 'Début', detail: 'note la session au démarrage', pouvoir: 'Éveil', rune: '✦', effet: 'au démarrage : la session apparaît dans Sessions' },
	{
		cle: 'message',
		libelle: 'Message',
		detail: 'injecte les consignes et la fiche de position, propose des pistes à chaque message',
		pouvoir: 'Souffle',
		rune: '◎',
		effet: 'à chaque message : injecte tes consignes et propose des pistes',
	},
	{ cle: 'outil', libelle: 'Outil', detail: 'refuse une action contraire à une consigne vérifiée', pouvoir: 'Bouclier', rune: '⛨', effet: 'avant une action : la bloque si elle viole une consigne vérifiée' },
	{ cle: 'apres_outil', libelle: 'Après outil', detail: 'note les fiches lues ou écrites (rien n’est injecté)', pouvoir: 'Carnet', rune: '✎', effet: 'après une action : retient les fiches lues ou écrites' },
	{ cle: 'arret', libelle: 'Arrêt', detail: 'tient l’état de la session (attend, à relire)', pouvoir: 'Veille', rune: '◷', effet: 'quand l’agent s’arrête : la session attend ta réponse' },
	{ cle: 'fin', libelle: 'Fin', detail: 'termine la session ; épisode minimal sans bilan', pouvoir: 'Récit', rune: '❖', effet: 'à la fermeture : termine la session, épisode minimal sans bilan' },
];
