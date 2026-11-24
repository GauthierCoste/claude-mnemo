import type { EtatSessions } from './ports.ts';

/** Entrées servies récentes où chercher l'élément à écarter (le panneau montre la dernière ; une course en tolère d'autres). */
export const ENTREES_CONSULTEES = 20;

/** Extrait de la demande gardé dans la trace d'un écarté. */
export const TRACE_DEMANDE_MAX = 300;

/**
 * « Ne plus suggérer » : écarte un élément du classement de la session pour ses prochains calculs de `servir`. L'élément doit
 * figurer dans un classement ou parmi les cartes récentes de la session : son titre et la demande qui l'a classé en sont repris (trace). Rend
 * `ecarte`, `introuvable` (absent des classements récents) ou `terminee` (session terminée ou disparue entre-temps).
 */
export async function ecarterDuClassement(
	etat: Pick<EtatSessions, 'servis' | 'ecarter'>,
	session: { id: string; dossier: string },
	id: string,
	maintenantMs = Date.now(),
	titreDe: (chemin: string) => string = (chemin) => chemin,
): Promise<'ecarte' | 'introuvable' | 'terminee'> {
	for (const entree of await etat.servis(session.id, ENTREES_CONSULTEES)) {
		const titre = entree.classement.find((c) => c.id === id)?.titre ?? (entree.cartes.some((c) => c.chemin === id) ? titreDe(id) : undefined);
		if (titre === undefined) continue;
		const fait = await etat.ecarter(session.id, { id, titre }, { dossier: session.dossier, demande: entree.demande?.slice(0, TRACE_DEMANDE_MAX) ?? null, horodatageMs: maintenantMs });
		return fait ? 'ecarte' : 'terminee';
	}
	return 'introuvable';
}
