/**
 * Circuit de liaison d'un moteur (Réglages › Système › Moteurs), tiré de ses points vérifiés sur le poste : une étape par
 * point (Installé, Version, Mémoire, Suivi, Approbation), la première cassée, le statut du moteur en un mot, et l'action qui
 * la débloque (le motif et le geste : lier à Mnemo, ou copier la commande).
 */
import type { MoteurVue, PointMoteurVue } from '@mnemo/contrat';

type CleEtape = PointMoteurVue['cle'];

/** `casse` : la première étape non satisfaite (celle à régler d'abord) ; `attente` : une suivante non satisfaite ; `inconnu` : non vérifiable. */
export type EtatEtape = 'ok' | 'casse' | 'attente' | 'inconnu';

export type EtapeCircuit = { cle: CleEtape; nom: string; valeur: string; infobulle: string; etat: EtatEtape };

export type CleStatut = 'pret' | 'a-lier' | 'a-approuver' | 'a-verifier' | 'a-mettre-a-jour' | 'a-regler' | 'introuvable' | 'pas-installe';
export type StatutMoteur = { cle: CleStatut; libelle: string };

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

const NOMS_ETAPES: Readonly<Record<CleEtape, string>> = {
	commande: 'Installé',
	version: 'Version',
	mcp: 'Mémoire',
	hooks: 'Suivi',
	approbation: 'Approbation',
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

export function etapesDuCircuit(m: MoteurVue): EtapeCircuit[] {
	const points = m.poste ?? [];
	const casse = indiceCasse(points);
	return points.map((x, i) => ({
		cle: x.cle,
		nom: NOMS_ETAPES[x.cle],
		// l'étape « Installé » satisfaite montre où est la commande ; les autres, leur état court
		valeur: x.cle === 'commande' && x.ok === true ? (x.detail ?? x.etat) : x.etat,
		infobulle: `${x.libelle} : ${x.etat}${x.detail === undefined ? '' : `. ${x.detail}`}`,
		etat: i === casse ? 'casse' : x.ok === true ? 'ok' : x.ok === null ? 'inconnu' : 'attente',
	}));
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
