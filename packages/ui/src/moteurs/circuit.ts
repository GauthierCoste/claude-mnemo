/**
 * Liaison d'un moteur à Mnemo (Réglages › Branchements, Nouvelle session), tirée de ses points vérifiés sur le poste
 * (Installé, Version, Mémoire, Suivi, Approbation) : le premier qui bloque, le statut du moteur en un mot, et l'action qui
 * le débloque (le motif et le geste : lier à Mnemo, ou copier la commande).
 */
import type { MoteurVue, PointMoteurVue } from '@mnemo/contrat';

type CleEtape = PointMoteurVue['cle'];

type CleStatut = 'pret' | 'a-lier' | 'a-approuver' | 'a-verifier' | 'a-mettre-a-jour' | 'a-regler' | 'introuvable' | 'pas-installe';
type StatutMoteur = { cle: CleStatut; libelle: string };

/**
 * Ce qui bloque, pour la première étape cassée : `titre` et `motif` à dire ; `geste` : « Lier à Mnemo » (`lier`), copier la
 * commande (`copier`) ou rien ; `commande` : celle à lancer soi-même (repli discret sous « Lier à Mnemo »).
 */
export type ActionMoteur = {
	etape: CleEtape;
	titre: string;
	motif: string | null;
	geste: 'lier' | 'copier' | null;
	commande: NonNullable<PointMoteurVue['remede']> | null;
};

const LIBELLES_STATUTS: Readonly<Record<CleStatut, string>> = {
	pret: 'Prêt',
	'a-lier': 'À lier',
	'a-approuver': 'À approuver',
	'a-verifier': 'À vérifier',
	'a-mettre-a-jour': 'À mettre à jour',
	'a-regler': 'À régler',
	introuvable: 'Introuvable',
	'pas-installe': 'Pas installé',
};

/**
 * Indice du point qui bloque : le premier non satisfait (`ok` faux) ; à défaut, le premier inconnu qui a un remède (à
 * vérifier dans le moteur) ; -1 : aucun.
 */
function indiceCasse(points: readonly PointMoteurVue[]): number {
	const faux = points.findIndex((x) => x.ok === false);
	return faux >= 0 ? faux : points.findIndex((x) => x.ok === null && x.remede !== undefined);
}

/** Point mcp ou hooks que « Lier à Mnemo » règle : non satisfait, avec un remède à lancer dans un terminal. */
const liable = (x: PointMoteurVue): boolean => (x.cle === 'mcp' || x.cle === 'hooks') && x.ok !== true && x.remede?.dans === 'terminal';

export function statutDuMoteur(m: MoteurVue): StatutMoteur {
	const points = m.poste ?? [];
	const statut = (cle: CleStatut): StatutMoteur => ({ cle, libelle: LIBELLES_STATUTS[cle] });
	if (points.length === 0) return statut(m.indisponible === null ? 'pret' : 'pas-installe');
	const x = points[indiceCasse(points)];
	if (x === undefined) return statut('pret');
	// introuvable maintenant : le service lance encore la commande trouvée à son démarrage
	if (x.cle === 'commande') return statut(x.etat === 'introuvable' ? 'pas-installe' : 'introuvable');
	if (x.cle === 'version') return statut('a-mettre-a-jour');
	if (x.cle === 'approbation') return statut(x.ok === null ? 'a-verifier' : 'a-approuver');
	return statut(points.some(liable) ? 'a-lier' : 'a-regler');
}

/**
 * Vrai si le moteur attend un geste de l'utilisateur (lier, approuver, mettre à jour…) : la pastille ambre de Réglages ›
 * Branchements. Un moteur prêt n'en attend pas, ni un moteur pas installé (rien à faire dans Mnemo tant qu'on ne l'installe pas).
 */
export function attendUnGeste(m: MoteurVue): boolean {
	const cle = statutDuMoteur(m).cle;
	return cle !== 'pret' && cle !== 'pas-installe';
}

/** Ce que dit l'absence de liaison, d'après les points mcp et hooks non satisfaits. */
function motifNonLie(points: readonly PointMoteurVue[]): string {
	const memoire = points.some((x) => x.cle === 'mcp' && liable(x));
	const suivi = points.some((x) => x.cle === 'hooks' && liable(x));
	if (memoire && suivi) return 'Ses sessions lancées hors de Mnemo ne lisent pas la mémoire, et Mnemo ne suit pas ses sessions.';
	return memoire ? 'Ses sessions lancées hors de Mnemo ne lisent pas la mémoire.' : 'Mnemo ne suit pas ses sessions.';
}

/** L'action de la première étape cassée ; null : rien ne bloque. */
export function actionDuMoteur(m: MoteurVue): ActionMoteur | null {
	const points = m.poste ?? [];
	const x = points[indiceCasse(points)];
	if (x === undefined) return null;
	const commande = x.remede ?? null;
	const base = { etape: x.cle, commande };
	// Mémoire ou Suivi : « Lier à Mnemo » dès que l'un des deux est à lier (l'autre, déclaration de l'utilisateur, est laissé)
	const aLier = points.find(liable);
	if ((x.cle === 'mcp' || x.cle === 'hooks') && aLier !== undefined) {
		const perime = aLier.etat.startsWith('périm');
		const titre = !liable(x) ? `${x.libelle} : ${x.etat}.` : perime ? `La liaison de ${m.nom} à Mnemo est périmée.` : `${m.nom} n’est pas lié à Mnemo.`;
		return { ...base, titre, motif: !liable(x) || perime ? (x.detail ?? null) : motifNonLie(points), geste: 'lier', commande: aLier.remede ?? null };
	}
	if (x.cle === 'commande') return { ...base, titre: x.etat === 'introuvable' ? 'Pas installé sur ce poste.' : `${m.nom} introuvable maintenant.`, motif: x.detail ?? null, geste: null };
	if (x.cle === 'approbation') {
		return {
			...base,
			titre: x.ok === null ? `Approbation des hooks inconnue dans ${m.nom}.` : `Hooks à approuver dans ${m.nom}.`,
			motif: 'Tant qu’ils ne le sont pas, Mnemo ne suit pas ses sessions.',
			geste: commande === null ? null : 'copier',
		};
	}
	return { ...base, titre: `${x.libelle} : ${x.etat}.`, motif: x.detail ?? null, geste: commande === null ? null : 'copier' };
}
