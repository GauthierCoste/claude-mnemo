import { LONGUEUR_MAX_CHEMIN, LONGUEUR_MAX_COMMANDE } from './regles-verifiees.ts';
import type { Verdict } from './regles-verifiees.ts';
import { messageDErreur } from './texte.ts';

/** Entrée JSON d'un hook (stdin) gardée pour être traduite ; au-delà, elle est lue jusqu'au bout puis écartée. */
export const ENTREE_HOOK_MAX_OCTETS = 1024 * 1024;

/** Pourquoi une action d'outil n'a pas pu être vérifiée contre les consignes vérifiées (refus, ou accord selon `selonIndicateur`). */
export const CAUSES_NON_VERIFIEE = ['entree_trop_grosse', 'entree_illisible', 'chemin_trop_long', 'commande_trop_longue', 'consigne_illisible', 'delai_depasse', 'erreur_interne'] as const;
export type CauseNonVerifiee = (typeof CAUSES_NON_VERIFIEE)[number];

export const estCauseNonVerifiee = (valeur: unknown): valeur is CauseNonVerifiee => (CAUSES_NON_VERIFIEE as readonly unknown[]).includes(valeur);

/** Par cause : ce qui a empêché la vérification, et ce que Claude peut faire. */
const LIBELLES: Record<CauseNonVerifiee, { raison: string; suite: string }> = {
	entree_trop_grosse: { raison: `son entrée dépasse ${ENTREE_HOOK_MAX_OCTETS / (1024 * 1024)} Mo`, suite: 'Découpe-la en actions plus petites.' },
	entree_illisible: { raison: 'son entrée n\'est pas un JSON lisible qui nomme l\'outil', suite: 'Réessaie-la ou demande à l\'utilisateur.' },
	chemin_trop_long: { raison: `un chemin dépasse ${LONGUEUR_MAX_CHEMIN} caractères`, suite: 'Utilise un chemin plus court.' },
	commande_trop_longue: { raison: `la commande dépasse ${LONGUEUR_MAX_COMMANDE} caractères`, suite: 'Découpe-la en commandes plus courtes.' },
	consigne_illisible: { raison: 'une consigne vérifiée ne peut pas être appliquée', suite: 'Demande à l\'utilisateur de réparer cette consigne dans la mémoire.' },
	delai_depasse: { raison: 'la vérification n\'a pas fini dans son délai', suite: 'Réessaie-la dans un instant.' },
	erreur_interne: { raison: 'erreur interne', suite: 'Réessaie-la ou demande à l\'utilisateur.' },
};

export type Refus = Extract<Verdict, { refus: true }>;

/** Refus d'une action dont la vérification n'a pas fini avant l'échéance. */
export function refusDelai(): RefusNonVerifie {
	return { refus: true, cause: 'delai_depasse', detail: null };
}

/** Refus d'une action dont la vérification a levé une erreur. */
export function refusSurErreur(erreur: unknown): RefusNonVerifie {
	return { refus: true, cause: 'erreur_interne', detail: messageDErreur(erreur) };
}

/** Début commun des messages d'une action non vérifiée : la raison et son détail. */
function entete(v: { cause: CauseNonVerifiee; detail: string | null }): string {
	return `Mnemo n'a pas pu vérifier cette action : ${LIBELLES[v.cause].raison}${v.detail === null ? '' : ` (${v.detail})`}`;
}

/** Texte d'un refus, montré à Claude et à l'utilisateur. */
export function texteDuRefus(verdict: Refus): string {
	if ('consigne' in verdict) return `Mnemo : consigne vérifiée « ${verdict.consigne} » (motif « ${verdict.motif} »).`;
	return `${entete(verdict)} ; des consignes vérifiées peuvent s'appliquer ici, l'action est donc refusée. ${LIBELLES[verdict.cause].suite}`;
}

/** Refus d'une action qui n'a pas pu être vérifiée ; l'accord donné à sa place quand la mémoire n'a aucune consigne vérifiée. */
export type RefusNonVerifie = Extract<Refus, { cause: CauseNonVerifiee }>;
export type AccordNonVerifie = Omit<RefusNonVerifie, 'refus'> & { refus: false };

/**
 * Ce que l'état local (`.mnemo/`) dit des consignes vérifiées, lu sans ouvrir l'index : la dernière synchronisation l'a noté,
 * le fichier est illisible, ou il est absent (installation neuve si l'index l'est aussi).
 */
export type EtatIndicateur = { genre: 'note'; presentes: boolean; horodatageMs: number } | { genre: 'illisible' } | { genre: 'absent'; indexExiste: boolean };

/** La mémoire peut-elle contenir des consignes vérifiées ? Seuls une note « aucune » et une installation neuve disent non. */
export function consignesVerifieesPossibles(indicateur: EtatIndicateur): boolean {
	if (indicateur.genre === 'note') return indicateur.presentes;
	if (indicateur.genre === 'absent') return indicateur.indexExiste;
	return true;
}

/** Vérification impossible (délai, index illisible, erreur) : refus si la mémoire peut contenir des consignes vérifiées, accord sinon. */
export function selonIndicateur(refus: RefusNonVerifie, indicateur: EtatIndicateur): RefusNonVerifie | AccordNonVerifie {
	return consignesVerifieesPossibles(indicateur) ? refus : { ...refus, refus: false };
}

/** Réponse au hook : le texte d'un refus (pour Claude et l'utilisateur), l'avis d'un accord non vérifié (pour le journal). */
export function reponseDe(verdict: Verdict | AccordNonVerifie): { refus?: string; avis?: string } {
	if (verdict.refus) return { refus: texteDuRefus(verdict) };
	if (!('cause' in verdict)) return {};
	return { avis: `${entete(verdict)} ; la mémoire ne contient aucune consigne vérifiée, l'action est permise.` };
}
