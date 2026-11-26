/**
 * Vie du service vue par l'app, et la règle de relance : une seule relance automatique après une chute, puis l'erreur
 * (jamais de relance en boucle). Après `DUREE_STABLE_MS` de vie depuis cette relance, une nouvelle chute y a droit de
 * nouveau. Un démarrage demandé par l'utilisateur remet le compte à zéro. Un arrêt demandé passe par `arret` jusqu'à la mort
 * confirmée du processus : pendant ce temps, ni réponse tardive du service ni chute ne changent l'état (pas de relance).
 */

export type EtatVie = 'arrete' | 'demarrage' | 'vivant' | 'arret' | 'erreur';

/**
 * `relanceMs` : instant de la dernière relance automatique (null : aucune depuis le dernier démarrage demandé) ; `vivantDepuisMs` :
 * instant où le service a répondu pour la dernière fois après un démarrage ; `raison` : pourquoi le service est en erreur.
 */
export type VieService = { etat: EtatVie; relanceMs: number | null; vivantDepuisMs: number | null; raison: string | null };

export type EvenementService =
	/** L'utilisateur (ou l'ouverture de l'app) demande le démarrage. */
	| { type: 'demarrageDemande' }
	/** Le service répond (rattachement ou fin du démarrage). */
	| { type: 'vivant'; maintenantMs: number }
	/** Le démarrage a échoué (le service n'a pas répondu à temps, ou la commande a échoué). */
	| { type: 'echecDemarrage'; raison: string }
	/** Le service vivant ne répond plus. */
	| { type: 'tombe'; maintenantMs: number }
	/** L'app a demandé l'arrêt du service vivant (`POST /api/arret`) : attendre la mort de son processus. */
	| { type: 'arretDemande' }
	/** L'arrêt demandé n'a pas abouti (refusé, ou le processus vit encore) : le service est toujours là. */
	| { type: 'arretEchoue' }
	/** Le service est arrêté (arrêt confirmé, arrêt propre venu d'ailleurs, ou aucun service à l'ouverture de l'app). */
	| { type: 'arrete' };

/** Ce que l'infrastructure doit faire après l'événement : lancer le service, ou rien. */
export type ActionService = 'demarrer' | null;

/** Durée de vie après une relance automatique au-delà de laquelle une nouvelle chute est relancée de nouveau. */
export const DUREE_STABLE_MS = 10 * 60_000;

export const RAISON_TOMBE = 'Le service s’est arrêté et n’a pas pu être relancé.';

export const VIE_INITIALE: VieService = { etat: 'arrete', relanceMs: null, vivantDepuisMs: null, raison: null };

/** Vie du service après un événement, et l'action qui en découle. */
export function evoluerVie(vie: VieService, evenement: EvenementService): { vie: VieService; action: ActionService } {
	switch (evenement.type) {
		case 'demarrageDemande':
			if (vie.etat === 'demarrage' || vie.etat === 'vivant' || vie.etat === 'arret') return { vie, action: null };
			return { vie: { etat: 'demarrage', relanceMs: null, vivantDepuisMs: null, raison: null }, action: 'demarrer' };
		case 'vivant':
			// en arrêt, une réponse tardive du service ne le fait pas revivre
			if (vie.etat === 'vivant' || vie.etat === 'arret') return { vie, action: null };
			return { vie: { ...vie, etat: 'vivant', vivantDepuisMs: evenement.maintenantMs, raison: null }, action: null };
		case 'echecDemarrage':
			return { vie: { ...vie, etat: 'erreur', vivantDepuisMs: null, raison: evenement.raison }, action: null };
		case 'tombe': {
			if (vie.etat !== 'vivant') return { vie, action: null };
			if (relancePermise(vie, evenement.maintenantMs)) {
				return { vie: { etat: 'demarrage', relanceMs: evenement.maintenantMs, vivantDepuisMs: null, raison: null }, action: 'demarrer' };
			}
			return { vie: { ...vie, etat: 'erreur', vivantDepuisMs: null, raison: RAISON_TOMBE }, action: null };
		}
		case 'arretDemande':
			if (vie.etat !== 'vivant') return { vie, action: null };
			return { vie: { ...vie, etat: 'arret' }, action: null };
		case 'arretEchoue':
			if (vie.etat !== 'arret') return { vie, action: null };
			return { vie: { ...vie, etat: 'vivant' }, action: null };
		case 'arrete':
			return { vie: { ...vie, etat: 'arrete', vivantDepuisMs: null, raison: null }, action: null };
	}
}

/** Une relance automatique est permise si aucune n'a eu lieu, ou si le service vit depuis assez longtemps depuis la dernière. */
function relancePermise(vie: VieService, maintenantMs: number): boolean {
	if (vie.relanceMs === null) return true;
	return vie.vivantDepuisMs !== null && maintenantMs - vie.vivantDepuisMs >= DUREE_STABLE_MS;
}
