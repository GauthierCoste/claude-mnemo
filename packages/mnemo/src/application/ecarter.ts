import type { EtatSessions, MessagePorteur } from './ports.ts';

/** Entrées servies récentes où chercher l'élément à écarter (le panneau montre la dernière ; une course en tolère d'autres). */
export const ENTREES_CONSULTEES = 20;

/** Extrait de la demande gardé dans la trace d'un écarté. */
export const TRACE_DEMANDE_MAX = 300;

/**
 * « Ne plus suggérer » : écarte un élément du classement de la session pour ses prochains calculs de `servir`. L'élément doit
 * figurer dans le dernier classement ou parmi les cartes récentes de la session : son titre et la demande qui l'a classé en sont repris (trace).
 * `resultat` : `ecarte`, `deja_ecarte` (rien n'a changé), `introuvable` (absent des classements récents) ou `terminee` (session
 * terminée ou disparue entre-temps). `porteur` : le message porteur de l'entrée où l'élément a été trouvé, s'il est connu.
 */
export async function ecarterDuClassement(
	etat: Pick<EtatSessions, 'servis' | 'ecarter'>,
	session: { id: string; dossier: string },
	id: string,
	maintenantMs = Date.now(),
	titreDe: (chemin: string) => string = (chemin) => chemin,
): Promise<{ resultat: 'ecarte' | 'deja_ecarte' | 'introuvable' | 'terminee'; porteur?: MessagePorteur }> {
	// le classement de la dernière entrée seulement (celui que montre le panneau), les cartes des autres
	for (const entree of await etat.servis(session.id, ENTREES_CONSULTEES, undefined, { classement: 'dernier' })) {
		const classee = entree.classement.find((c) => c.id === id);
		// une ligne du classement vivant n'a pas de titre : il se relit dans l'index
		const titre = classee !== undefined ? (classee.titre ?? titreDe(id)) : entree.cartes.some((c) => c.chemin === id) ? titreDe(id) : undefined;
		if (titre === undefined) continue;
		const resultat = await etat.ecarter(session.id, { id, titre }, { dossier: session.dossier, demande: entree.demande?.slice(0, TRACE_DEMANDE_MAX) ?? null, horodatageMs: maintenantMs });
		const rang = entree.rangMessage ?? null;
		return rang === null ? { resultat } : { resultat, porteur: { texte: entree.demande, rang } };
	}
	return { resultat: 'introuvable' };
}
