import { normaliser } from '../domaine/sens.ts';
import type { Dependances } from './ports.ts';

/** Taille d'un lot : un appel au modèle, une transaction. */
const LOT = 64;
/**
 * Budget d'un appel au modèle quand le budget total est plus large (`mnemo index`, sans limite) : de quoi attendre le
 * démarrage du serveur, puis calculer un lot.
 */
const APPEL_MAX_MS = 120_000;

export type OptionsVectoriser = {
	/** Temps total accordé (démarrage du modèle compris) ; `Infinity` : jusqu'au bout. */
	budgetMs: number;
	/** Sans serveur de sens en marche, en lancer un (sinon : s'arrêter aussitôt). */
	demarrer: boolean;
	/** Après chaque lot enregistré : vecteurs calculés par cet appel, et total à calculer au départ. */
	progression?: (faits: number, total: number) => void;
	/**
	 * `false` : le reste n'est pas compté à la fin (`restants` : null), pour un appelant qui ne le lit pas (un comptage parcourt
	 * l'index). Le total d'une passe de plus d'un lot est compté une fois quand même, après le premier lot réussi : l'avancement
	 * affiché porte sur lui (une passe d'un seul lot, le cas d'une recherche, ne compte rien).
	 */
	compter?: boolean;
};

/**
 * Calcule les vecteurs de sens qui manquent ou ne sont plus à jour (éléments, puis passages), par lots de 64, chacun
 * enregistré en une transaction ; s'arrête au budget ou dès que le modèle ne répond pas (sans erreur) : le prochain appel
 * reprend où celui-ci s'est arrêté. Modèle absent : rien à faire. `restants` : ce qui reste à calculer (null si `compter`
 * est faux et que l'appel s'est arrêté avant la fin).
 */
export async function vectoriser(dep: Dependances, options: OptionsVectoriser): Promise<{ faits: number; restants: number | null }> {
	const modele = dep.sens.modele();
	if (modele === null) return { faits: 0, restants: 0 };
	const fin = Date.now() + options.budgetMs;
	let faits = 0;
	let total: number | null = null;
	/** Déjà calculés par cet appel : les revoir dans un lot (texte changé entre-temps par un autre processus) arrête l'appel. */
	const calcules = new Set<string>();
	const restants = async (): Promise<number | null> => (options.compter === false ? null : dep.index.nombreAVectoriser(modele));

	for (;;) {
		const lot = await dep.index.aVectoriser(modele, LOT);
		if (lot.length === 0) return { faits, restants: 0 };
		if (lot.some((a) => calcules.has(a.id))) return { faits, restants: await restants() };
		// total de la passe compté une fois, après un premier lot réussi (avant : inconnu) ; l'avancement affiché porte sur lui
		if (total === null && faits > 0) total = faits + (await dep.index.nombreAVectoriser(modele));
		const reste = fin - Date.now();
		if (reste <= 0) return { faits, restants: await restants() };
		const vecteurs = await dep.sens.vecteurs(
			lot.map((a) => a.texte),
			{ budgetMs: Math.min(reste, APPEL_MAX_MS), demarrer: options.demarrer, activite: { operation: 'vectorisation', avancement: { faits, total: total === null ? null : Math.max(total, faits) } } },
		);
		// Absent, trop lent ou réponse inutilisable (nombre ou dimensions incohérents) : la recherche se fera par les mots.
		const dimension = vecteurs?.[0]?.length ?? 0;
		if (vecteurs === null || vecteurs.length !== lot.length || dimension === 0 || vecteurs.some((v) => v.length !== dimension)) {
			return { faits, restants: await restants() };
		}
		await dep.index.enregistrerVecteurs(
			modele,
			dimension,
			lot.map((a, i) => ({ id: a.id, empreinte: a.empreinte, vecteur: normaliser(vecteurs[i]!) })),
		);
		for (const a of lot) calcules.add(a.id);
		faits += lot.length;
		if (options.progression !== undefined) {
			total ??= faits + (await dep.index.nombreAVectoriser(modele));
			options.progression(faits, Math.max(total, faits));
		}
	}
}
