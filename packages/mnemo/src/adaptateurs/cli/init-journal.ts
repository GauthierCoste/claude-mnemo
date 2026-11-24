import type { EtapeInit, EvenementInit, LigneInit, MotifEchecInit } from '@mnemo/contrat';

/** Écart minimal entre deux lignes de progression d'une même pièce. */
export const PAS_PROGRESSION_MS = 1000;

/**
 * Sortie de `mnemo init` : en texte, les lignes pour un humain ; en JSON (`--json`), une ligne `LigneInit` par événement
 * et rien d'autre. Chaque méthode ne fait rien dans l'autre mode.
 */
export type JournalInit = {
	readonly json: boolean;
	/** Ligne pour un humain (mode texte seulement). */
	texte(ligne: string): void;
	/** Événement d'une étape (mode JSON seulement) ; `motif` : la cause d'un échec qui se reprend (`perime`). */
	evenement(etape: EtapeInit, etat: EvenementInit['etat'], message: string, motif?: MotifEchecInit): void;
	/** Progression d'un téléchargement (mode JSON seulement) : au plus une ligne par `PAS_PROGRESSION_MS` et par pièce. */
	progression(piece: { nom: string; libelle: string }, recu: number, total: number | null): void;
	/** Dernière ligne (mode JSON seulement). */
	fin(racine: string, ok: boolean): void;
};

export function journalInit(ecrire: (ligne: string) => void, json: boolean, maintenant: () => number = Date.now): JournalInit {
	const emettre = (ligne: LigneInit) => {
		if (json) ecrire(JSON.stringify(ligne));
	};
	const derniere = new Map<string, number>();
	return {
		json,
		texte: (ligne) => {
			if (!json) ecrire(ligne);
		},
		evenement: (etape, etat, message, motif) => emettre(motif === undefined ? { etape, etat, message } : { etape, etat, message, motif }),
		progression: (piece, recu, total) => {
			if (!json) return;
			const t = maintenant();
			const avant = derniere.get(piece.nom);
			if (avant !== undefined && t - avant < PAS_PROGRESSION_MS) return;
			derniere.set(piece.nom, t);
			emettre({ etape: 'modeles', etat: 'progression', piece: piece.nom, libelle: piece.libelle, recu, total });
		},
		fin: (racine, ok) => emettre({ fin: true, racine, ok }),
	};
}
