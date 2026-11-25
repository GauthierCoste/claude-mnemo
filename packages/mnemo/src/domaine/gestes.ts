/**
 * Les gestes de l'utilisateur sur les fiches proposées à ses sessions, gardés entre les sessions (journal durable des
 * gestes) : matière de l'a priori par fiche et des paires réelles du banc.
 */

/**
 * `injectee_main` : fiche demandée (➤), partie au message ; `ecartee_ici` : ✗ pour la session ; `ecartee_toujours` : écartée
 * pour toutes les sessions ; `retablie` : un écart annulé ; `lue_apres_carte` : lue par l'outil `lire` après une carte qui la
 * proposait ; `injectee_auto` : injectée par Mnemo sans geste de l'utilisateur (sa note dit le niveau du modèle) ;
 * `injection_reactivee` : l'utilisateur réactive l'injection automatique coupée par le suivi (pas un geste sur une fiche :
 * `fiche` vide, le niveau dans la note ; session vide si fait hors session).
 */
export const GESTES = ['injectee_main', 'ecartee_ici', 'ecartee_toujours', 'retablie', 'lue_apres_carte', 'injectee_auto', 'injection_reactivee'] as const;
export type Geste = (typeof GESTES)[number];

/** Qui a fait le geste : l'utilisateur (➤, ✗, rétablir), Claude (lecture après une carte) ou Mnemo seul (`auto`). */
export type OrigineGeste = 'utilisateur' | 'claude' | 'auto';

export function origineDe(geste: Geste): OrigineGeste {
	if (geste === 'injectee_auto') return 'auto';
	return geste === 'lue_apres_carte' ? 'claude' : 'utilisateur';
}

/**
 * Ce que Mnemo savait de la fiche au moment du geste (JSON) : pour l'instant `note`, celle de sa carte dans le journal servi ;
 * d'autres champs viendront (probabilité, signaux bruts).
 */
export type NoteDuGeste = { note?: number } & Record<string, unknown>;

/**
 * La note d'un geste tirée de la ligne de la fiche dans un classement (rang, note, `p`, signaux bruts…) : la ligne sans son id ni
 * son titre ; `note` gardée seulement si elle est un nombre.
 */
export function noteDeLigne(ligne: Readonly<Record<string, unknown>>): NoteDuGeste {
	const { id: _id, titre: _titre, note, ...reste } = ligne;
	return { ...(typeof note === 'number' ? { note } : {}), ...reste };
}

/** Nombre de gestes d'une sorte sur une fiche : ce que le décompte du journal rend. */
export type GesteCompte = { geste: Geste; fiche: string; nombre: number };

/** Nombre de gestes de chaque sorte, en tout et par fiche (fiches par nombre total décroissant, puis par chemin). */
export type ComptesDesGestes = {
	total: number;
	parGeste: Record<Geste, number>;
	parFiche: { fiche: string; total: number; parGeste: Partial<Record<Geste, number>> }[];
};

export function compterGestes(comptes: readonly GesteCompte[]): ComptesDesGestes {
	const parGeste = Object.fromEntries(GESTES.map((g) => [g, 0])) as Record<Geste, number>;
	const parFiche = new Map<string, { fiche: string; total: number; parGeste: Partial<Record<Geste, number>> }>();
	let total = 0;
	for (const { geste, fiche, nombre } of comptes) {
		total += nombre;
		parGeste[geste] += nombre;
		const f = parFiche.get(fiche) ?? { fiche, total: 0, parGeste: {} };
		f.total += nombre;
		f.parGeste[geste] = (f.parGeste[geste] ?? 0) + nombre;
		parFiche.set(fiche, f);
	}
	return {
		total,
		parGeste,
		parFiche: [...parFiche.values()].sort((a, b) => b.total - a.total || a.fiche.localeCompare(b.fiche)),
	};
}
