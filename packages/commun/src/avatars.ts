/** Formes d'avatar d'un profil : petites créatures, choisies indépendamment de la couleur. */
export const FORMES_AVATAR = ['robot', 'chouette', 'renard', 'fantome', 'chat', 'goutte', 'lapin', 'grenouille', 'pingouin', 'escargot', 'champignon', 'nuage'] as const;

export type FormeAvatar = (typeof FORMES_AVATAR)[number];

/** Couleurs d'avatar : celles des thèmes de l'interface. */
export const COULEURS_AVATAR = ['vert', 'violet', 'bleu', 'ambre', 'rouge'] as const;

export type CouleurAvatar = (typeof COULEURS_AVATAR)[number];

export type Avatar = { forme: FormeAvatar; couleur: CouleurAvatar };

/** Avatar lu dans une valeur inconnue : un objet dont `forme` et `couleur` sont valides, sinon `null`. */
export function lireAvatar(valeur: unknown): Avatar | null {
	if (typeof valeur !== 'object' || valeur === null) return null;
	const { forme, couleur } = valeur as Record<string, unknown>;
	const formeValide = FORMES_AVATAR.find((f) => f === forme);
	const couleurValide = COULEURS_AVATAR.find((c) => c === couleur);
	return formeValide && couleurValide ? { forme: formeValide, couleur: couleurValide } : null;
}
