/**
 * Les gestes de l'utilisateur sur les fiches proposées à ses sessions, gardés entre les sessions (journal durable des
 * gestes) : matière de l'a priori par fiche et des paires réelles du banc.
 */

/**
 * `injectee_main` : fiche demandée (➤), partie au message ; `ecartee_ici` : ✗ pour la session ; `ecartee_toujours` : écartée
 * pour toutes les sessions ; `retablie` : un écart annulé ; `lue_apres_carte` : lue par l'outil `lire` après une carte qui la
 * proposait ; `injectee_auto` : injectée par Mnemo sans geste de l'utilisateur.
 */
export const GESTES = ['injectee_main', 'ecartee_ici', 'ecartee_toujours', 'retablie', 'lue_apres_carte', 'injectee_auto'] as const;
export type Geste = (typeof GESTES)[number];

/** Qui a fait le geste : l'utilisateur (`manuelle`) ou Mnemo (`auto`). */
export type OrigineGeste = 'manuelle' | 'auto';

export function origineDe(geste: Geste): OrigineGeste {
	return geste === 'injectee_auto' ? 'auto' : 'manuelle';
}

/** Un geste du journal, sans le vecteur ni le texte du message : ce qu'un décompte lit. */
export type GesteCompte = { geste: Geste; fiche: string };

/** Nombre de gestes de chaque sorte, en tout et par fiche (fiches par nombre total décroissant, puis par chemin). */
export type ComptesDesGestes = {
	total: number;
	parGeste: Record<Geste, number>;
	parFiche: { fiche: string; total: number; parGeste: Partial<Record<Geste, number>> }[];
};

export function compterGestes(gestes: readonly GesteCompte[]): ComptesDesGestes {
	const parGeste = Object.fromEntries(GESTES.map((g) => [g, 0])) as Record<Geste, number>;
	const parFiche = new Map<string, { fiche: string; total: number; parGeste: Partial<Record<Geste, number>> }>();
	for (const { geste, fiche } of gestes) {
		parGeste[geste] += 1;
		const f = parFiche.get(fiche) ?? { fiche, total: 0, parGeste: {} };
		f.total += 1;
		f.parGeste[geste] = (f.parGeste[geste] ?? 0) + 1;
		parFiche.set(fiche, f);
	}
	return {
		total: gestes.length,
		parGeste,
		parFiche: [...parFiche.values()].sort((a, b) => b.total - a.total || a.fiche.localeCompare(b.fiche)),
	};
}

/**
 * Instant de la dernière carte qui a proposé `chemin` dans la session (même avant un /clear), ou null s'il n'a jamais été
 * proposé. `actions` : journal des actions de la session.
 */
export function derniereProposition(actions: readonly { chemin: string; action: string; horodatageMs: number }[], chemin: string): number | null {
	let ms: number | null = null;
	for (const a of actions) if (a.chemin === chemin && a.action === 'proposee' && (ms === null || a.horodatageMs > ms)) ms = a.horodatageMs;
	return ms;
}
