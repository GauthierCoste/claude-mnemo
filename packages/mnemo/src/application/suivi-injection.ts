/**
 * Suivi des injections automatiques (spec classement vivant § 6.4) : les coupures se déduisent du journal des gestes à chaque
 * lecture (`domaine/suivi-injection.ts`), et la réactivation par l'utilisateur est un geste noté (`injection_reactivee`).
 */
import { AUCUNE_COUPURE, avecLesCoupures, coupuresDesNiveaux, GESTES_DU_SUIVI, instantDApprentissage } from '../domaine/suivi-injection.ts';
import type { CoupuresDInjection, GesteDuSuivi } from '../domaine/suivi-injection.ts';
import type { ModelesDeNote } from '../domaine/note-de-confiance.ts';
import type { NiveauDeNote } from '../domaine/modele-de-note.ts';
import { noterGeste } from './gestes.ts';
import type { Dependances, EtatSessions, GesteNote } from './ports.ts';

const NIVEAUX: readonly NiveauDeNote[] = ['complets', 'sens'];

const niveauDe = (g: GesteNote): NiveauDeNote | null => {
	const n = g.note?.['niveau'];
	return n === 'complets' || n === 'sens' ? n : null;
};

/**
 * Les coupures des niveaux dont le modèle est accepté, lues dans le journal des gestes depuis le plus ancien apprentissage en
 * service (sans les vecteurs) ; aucune lecture si aucun modèle n'est accepté. Journal illisible : aucune coupure (le suivi est
 * un filet sur 100 injections ; un message sans lui n'en change pas l'issue).
 */
export async function coupuresDesInjections(etat: Pick<EtatSessions, 'gestes'>, modeles: ModelesDeNote): Promise<CoupuresDInjection> {
	const acceptes = NIVEAUX.filter((n) => modeles[n].etat === 'accepte');
	if (acceptes.length === 0) return AUCUNE_COUPURE;
	const references = acceptes.map((n) => instantDApprentissage(modeles[n].modele.apprisLe));
	const depuisMs = references.some((r) => r === null) ? undefined : Math.min(...(references as number[]));
	try {
		const lus = await etat.gestes({ sortes: GESTES_DU_SUIVI, sansVecteur: true, limite: null, ...(depuisMs === undefined ? {} : { depuisMs }) });
		const gestes: GesteDuSuivi[] = lus.map((g) => ({ rang: g.rang, horodatageMs: g.horodatageMs, geste: g.geste, session: g.session, fiche: g.fiche, niveau: niveauDe(g) }));
		return coupuresDesNiveaux(gestes, modeles);
	} catch {
		return AUCUNE_COUPURE;
	}
}

/** Les modèles du message, avec les coupures du suivi appliquées (un niveau coupé : ni % ni injection). */
export async function modelesSuivis(etat: Pick<EtatSessions, 'gestes'>, modeles: ModelesDeNote): Promise<ModelesDeNote> {
	return avecLesCoupures(modeles, await coupuresDesInjections(etat, modeles));
}

/**
 * Réactive l'injection automatique des niveaux coupés (`niveau` : celui-là seulement) : un geste `injection_reactivee` par
 * niveau, noté dans `session` (vide : hors session). Rend les niveaux réactivés (aucun : rien n'était coupé).
 */
export async function reactiverInjection(
	dep: Pick<Dependances, 'index'>,
	etat: Pick<EtatSessions, 'gestes' | 'noterGeste'>,
	modeles: ModelesDeNote,
	o: { session: string; horodatageMs: number; niveau?: NiveauDeNote },
): Promise<NiveauDeNote[]> {
	const coupures = await coupuresDesInjections(etat, modeles);
	const reactives = NIVEAUX.filter((n) => coupures[n] !== null && (o.niveau === undefined || o.niveau === n));
	for (const niveau of reactives) {
		await noterGeste(dep, etat, { geste: 'injection_reactivee', session: o.session, fiche: '', empreinte: null, horodatageMs: o.horodatageMs, note: { niveau, motif: coupures[niveau]!.motif } });
	}
	return reactives;
}
