export const LONGUEUR_MAX_TITRE = 200;

/** Motif de refus d'un titre (rogné, une ligne, `LONGUEUR_MAX_TITRE` caractères au plus, sans « # » initial), sinon null ; `quoi` nomme le titre dans le message. */
export function motifTitre(quoi: string, titre: string): string | null {
	const rogne = titre.trim();
	if (rogne === '') return `${quoi} est vide.`;
	if (rogne.length > LONGUEUR_MAX_TITRE) return `${quoi} dépasse ${LONGUEUR_MAX_TITRE} caractères.`;
	if (/[\r\n]/u.test(titre)) return `${quoi} doit tenir sur une seule ligne.`;
	if (rogne.startsWith('#')) return `${quoi} ne doit pas commencer par « # ».`;
	return null;
}
