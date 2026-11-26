import type { Requete } from './chercher.ts';
import type { DemandeSource } from './extraire-source.ts';
import type { TypeSource } from '../domaine/regles.ts';
import { tronquerTexte } from '../domaine/texte.ts';
import { positionValide } from './position.ts';
import type { Demande } from './proposer.ts';
import type { DemandeEntretien } from './entretenir.ts';
import { DOSSIER_MEMOIRE } from '../domaine/dossier-memoire.ts';
import { RUBRIQUES } from '../domaine/diagnostic.ts';
import type { Rubrique } from '../domaine/diagnostic.ts';
import { LIMITE_PAR_RUBRIQUE } from '../domaine/rapport-diagnostic.ts';
import { GENRES_DE_PORTEE, PORTEE_GLOBALE } from '../domaine/portee.ts';
import { FORME_TYPE_FICHE, TYPES_RESERVES } from '../domaine/fiche.ts';
import { ABSORBEES_MAX, GENRES_LOT, LIGNES_MAX_LOT } from '../domaine/lot.ts';
import type { GenreLot, LigneDeLot } from '../domaine/lot.ts';

/**
 * Validation de la FORME des demandes reçues de l'extérieur (serveur MCP : JSON non fiable). Les règles métier (format
 * d'un fait, chemins, titres…) restent dans `proposer` : ici, seulement types, longueurs, bornes et champs connus.
 */
export type Valide<T> = { ok: true; valeur: T } | { ok: false; motif: string };

/** Longueur maximale (en caractères) de toute chaîne reçue. */
export const LONGUEUR_MAX_ENTREE = 20000;
/** Nombre maximal d'éléments de tout tableau reçu (et de clés d'un objet libre). */
export const LONGUEUR_MAX_TABLEAU = 1000;
const NOEUDS_MAX_LIBRE = 10000;
const PROFONDEUR_MAX_LIBRE = 8;

type Genre = Demande['genre'];
export type Sorte =
	| 'chaine'
	| 'booleen'
	| 'libre' // objet JSON quelconque (données d'une fiche) : seules les longueurs de chaînes et la profondeur sont bornées
	| { choix: readonly string[] }
	| { entier: readonly [number, number] }
	| { liste: readonly string[] } // tableau de valeurs prises dans une liste
	| { textes: readonly [number, number] } // tableau de chaînes, de min à max éléments
	| { objets: Table; nombre: readonly [number, number] } // tableau d'objets de la table, de min à max éléments
	| { objet: Table };
/** `description` : courte aide en français, reprise dans le schéma JSON des outils (pour Claude). */
type Champ = { sorte: Sorte; requis: boolean; description?: string };
export type Table = Readonly<Record<string, Champ>>;

/** Table attendue pour un type d'objet : un champ par clé (sauf `genre`), `requis` fidèle à l'optionnalité du type. */
type TableDe<T> = { readonly [K in keyof T]-?: { sorte: Sorte; requis: undefined extends T[K] ? false : true; description?: string } };
type DemandeDeGenre<G extends Genre> = Demande extends infer D ? (D extends Demande ? (G extends D['genre'] ? D : never) : never) : never;
type TableDeGenre<G extends Genre> = TableDe<Omit<DemandeDeGenre<G>, 'genre'>>;

const GENRES_ELEMENT = ['fiche', 'fait', 'consigne', 'passage'];
const TYPE_FICHE = `Type de la fiche, libre (${FORME_TYPE_FICHE}) ; réservés : ${TYPES_RESERVES.join(', ')}.`;
const TYPES_SOURCE = ['utilisateur', 'contrat', 'spec_validee', 'compte_rendu', 'email', 'note', 'session', 'deduction', 'inconnue'];
const SOURCE: Sorte = {
	objet: {
		ref: { sorte: 'chaine', requis: true, description: 'D\'où vient l\'information. Un document (type hors utilisateur, session, deduction) se cite par un lien « [[sources/nom]] ».' },
		type: { sorte: { choix: TYPES_SOURCE }, requis: true },
	},
};
const FICHE = 'Chemin de la fiche dans la mémoire, ex. « projets/alpha/alpha.md ».';
const ANCRE = 'Information visée : « f-0001 », « ^f-0001 » ou l\'identifiant affiché « chemin#^f-0001 » (même fiche).';
const DATE = 'Date AAAA-MM-JJ.';
const REGLE: Sorte = {
	objet: {
		type: { sorte: { choix: ['chemins_interdits', 'commandes_interdites'] }, requis: true, description: 'chemins_interdits : globs (*, **, ?) des chemins que Write/Edit/MultiEdit/NotebookEdit ne doivent pas écrire, relatifs à la racine du dossier Mnemo (absolus hors d\'elle) ; commandes_interdites : début des commandes Bash refusées (glob, ex. « git push --force* »).' },
		motifs: { sorte: { textes: [1, 20] }, requis: true, description: '1 à 20 motifs de 1 à 200 caractères, sans caractère de contrôle.' },
	},
};
const DECISION = { fiche: { sorte: 'chaine', requis: true, description: FICHE }, ancre: { sorte: 'chaine', requis: true, description: ANCRE } } as const;

/** Ajouter un champ à une `Demande` ou à `Requete` : une ligne ici (le compilateur refuse toute dérive). */
export const TABLES_DEMANDE = {
	fait: {
		fiche: { sorte: 'chaine', requis: true, description: FICHE },
		titreSiNouvelle: { sorte: 'chaine', requis: false },
		typeSiNouvelle: { sorte: 'chaine', requis: false, description: `${TYPE_FICHE} Sujet par défaut ; ni consigne ni profil.` },
		texte: { sorte: 'chaine', requis: true },
		categorie: { sorte: 'chaine', requis: false },
		nature: { sorte: { choix: ['declare', 'observe', 'infere'] }, requis: true },
		source: { sorte: SOURCE, requis: true },
		citation: { sorte: 'chaine', requis: false },
		valideDebut: { sorte: 'chaine', requis: false, description: `Début de validité de l\'information (incluse). ${DATE}` },
		valideFin: { sorte: 'chaine', requis: false, description: `Fin de validité de l\'information (exclue). ${DATE}` },
		remplace: { sorte: 'chaine', requis: false, description: `Information que celle-ci remplace. ${ANCRE}` },
		annuleEtRemplace: { sorte: 'booleen', requis: false },
		apresProches: { sorte: 'booleen', requis: false },
	},
	fiche: {
		chemin: { sorte: 'chaine', requis: true, description: FICHE },
		type: { sorte: 'chaine', requis: true, description: `${TYPE_FICHE} Ni consigne ni profil.` },
		titre: { sorte: 'chaine', requis: true },
		synthese: { sorte: 'chaine', requis: false },
		donnees: { sorte: 'libre', requis: false },
	},
	relation: {
		fiche: { sorte: 'chaine', requis: true, description: FICHE },
		verbe: { sorte: 'chaine', requis: true },
		cible: { sorte: 'chaine', requis: true },
	},
	consigne: {
		fiche: { sorte: 'chaine', requis: false, description: FICHE },
		texte: { sorte: 'chaine', requis: true },
		portee: { sorte: { objet: { genre: { sorte: { choix: [PORTEE_GLOBALE, ...GENRES_DE_PORTEE] }, requis: true }, nom: { sorte: 'chaine', requis: false } } }, requis: true },
		source: { sorte: SOURCE, requis: true },
		apresProches: { sorte: 'booleen', requis: false },
	},
	niveau: {
		fiche: { sorte: 'chaine', requis: true, description: 'Fiche de la consigne. ' + FICHE },
		niveau: { sorte: { choix: ['rappelee', 'toujours', 'verifiee'] }, requis: false, description: 'Niveau voulu ; « verifiee » exige une règle (donnée ici ou déjà portée).' },
		regle: { sorte: REGLE, requis: false, description: 'Règle déclarative appliquée au niveau « verifiee » par le hook outil.' },
		retirerProposition: { sorte: 'booleen', requis: false, description: 'Rejette la proposition en attente (utilisateur seulement).' },
		source: { sorte: SOURCE, requis: true },
	},
	episode: {
		titre: { sorte: 'chaine', requis: true, description: 'Titre de l\'épisode : ce que la session a fait, en quelques mots.' },
		synthese: { sorte: 'chaine', requis: true, description: 'Ce qui s\'est passé dans la session, en quelques phrases.' },
		decisions: { sorte: { textes: [0, 50] }, requis: false, description: 'Décisions prises et leur raison, une par élément (une ligne).' },
		resultat: { sorte: 'chaine', requis: false, description: 'Où en est le travail à la fin de la session.' },
		fichiers: { sorte: { textes: [0, 50] }, requis: false, description: 'Fichiers touchés (50 au plus), relatifs au dépôt.' },
	},
	confirmer: DECISION,
	rejeter: DECISION,
	supprimer: DECISION,
	modification: {
		fiche: { sorte: 'chaine', requis: true, description: 'Fiche existante à modifier. ' + FICHE },
		synthese: { sorte: 'chaine', requis: false, description: 'Remplace le texte avant la première section (sans titre « # » ni « ## »).' },
		sections: { sorte: 'libre', requis: false, description: 'Sections libres, { « Titre » : « texte » } : remplacée, créée si absente, retirée si texte vide. Jamais Informations ni Relations.' },
		type: { sorte: 'chaine', requis: false, description: `Nouveau type. ${TYPE_FICHE} Ni consigne ni profil.` },
		titre: { sorte: 'chaine', requis: false, description: 'Nouveau titre (ligne « # »).' },
		alias: { sorte: { textes: [0, 50] }, requis: false, description: 'Remplace la liste des alias.' },
		traitee: { sorte: 'booleen', requis: false, description: 'true : la fiche source a été traitée, son marqueur « à traiter » (a_traiter) est retiré.' },
		dossier_projet: {
			sorte: 'chaine',
			requis: false,
			description: `Fiche de lieu (ni consigne, ni profil, ni source, ni episode) : le dossier de projet Claude Code (relatif à la racine du dossier Mnemo) que ce lieu couvre, sous-dossiers compris ; vide pour le retirer.`,
		},
		portee: { sorte: 'chaine', requis: false, description: `Portée que ce lieu déclare (${GENRES_DE_PORTEE.map((g) => `« ${g}:nom »`).join(', ')}) ; vide pour la retirer.` },
		perime_le: {
			sorte: 'chaine',
			requis: false,
			description: 'Fiche temporaire (un état d\'avancement) : jour AAAA-MM-JJ où elle cesse d\'être vraie ; ensuite elle n\'est plus injectée ni cherchée par défaut, et `diagnostiquer` propose de la supprimer. Vide pour le retirer.',
		},
		appliquerProposition: { sorte: 'booleen', requis: false, description: 'Applique la modification proposée par une session (utilisateur seulement).' },
		retirerProposition: { sorte: 'booleen', requis: false, description: 'Rejette la modification proposée par une session (utilisateur seulement).' },
		source: { sorte: SOURCE, requis: true },
	},
	retirer_relation: {
		fiche: { sorte: 'chaine', requis: true, description: FICHE },
		verbe: { sorte: 'chaine', requis: true },
		cible: { sorte: 'chaine', requis: true },
	},
	retirer_dossier: {
		dossier: { sorte: 'chaine', requis: true, description: 'Dossier vide à retirer, ex. « clients » : refusé s\'il contient une fiche ou un autre fichier (hors .DS_Store).' },
	},
} as const satisfies { readonly [G in Genre]: TableDeGenre<G> };

const TABLE_REQUETE = {
	texte: { sorte: 'chaine', requis: true },
	perimetre: { sorte: 'chaine', requis: false },
	position: { sorte: 'chaine', requis: false },
	inclureInvalides: { sorte: 'booleen', requis: false },
	inclureAConfirmer: { sorte: 'booleen', requis: false },
	genres: { sorte: { liste: GENRES_ELEMENT }, requis: false },
	typesFiche: { sorte: { textes: [0, 50] }, requis: false },
	typesFicheExclus: { sorte: { textes: [0, 50] }, requis: false },
	limite: { sorte: { entier: [1, 50] }, requis: false },
	sansSeuil: { sorte: 'booleen', requis: false },
} as const satisfies TableDe<Omit<Requete, 'variante' | 'dedoublonner'>>; // la variante sert au banc, le dédoublonnage aux proches : jamais aux outils

const TABLE_SOURCE = {
	chemin: { sorte: 'chaine', requis: true, description: `Chemin du document, relatif à la racine du dossier Mnemo (hors ${DOSSIER_MEMOIRE}/), ex. « docs/cdc.pdf » ou « Projets/P/.claude/CLAUDE.md ».` },
	type: { sorte: { choix: TYPES_SOURCE }, requis: false, description: 'Type du document : email par défaut pour .eml/.mbox, inconnue sinon (utilisateur, session, deduction refusés).' },
	version_de: { sorte: 'chaine', requis: false, description: 'Fiche source dont ce document est la nouvelle version : « chemin » ou « [[chemin]] » de sa fiche.' },
	apresProches: { sorte: 'booleen', requis: false, description: 'Écrire même si une quasi-copie existe (après avoir vu les proches).' },
} as const satisfies TableDe<DemandeSource>;

/** Arguments des outils MCP autres que `proposer` (dont l'unique argument `demande` passe par `validerDemande`). */
export type ArgumentsDesOutils = {
	chercher: { requete: string; dossier?: string; tout?: boolean; limite?: number };
	lister: { dossier?: string; aTraiter?: boolean };
	lire: { id: string };
	voisins: { id: string };
	chronologie: { sujet: string; limite?: number };
	contexte: { question?: string };
	diagnostiquer: { rubriques?: Rubrique[]; limite?: number };
	deplacer: { id: string; dossier: string; nom?: string };
	extraire_source: { chemin: string; type?: TypeSource; version_de?: string; apres_proches?: boolean };
	entretenir: {
		action: DemandeEntretien['action'];
		id: string;
		redirection?: string;
		dans?: string;
		ancien?: string;
		nouveau?: string;
		ancre?: string;
		ancres?: string[];
		titreSiNouvelle?: string;
		source?: { ref: string; type: TypeSource };
		citation?: string;
		texte?: string;
		categorie?: string;
		genre?: GenreLot;
		lignes?: { ancre?: string; garder?: string; absorber?: string[] }[];
		motif?: string;
	};
};
export type OutilSimple = keyof ArgumentsDesOutils;

const ACTIONS_ENTRETIEN = ['supprimer', 'fusionner', 'corriger_lien', 'corroborer', 'retoucher_information', 'deplacer_informations', 'proposer_lot'] as const satisfies readonly DemandeEntretien['action'][];
/** Champs facultatifs de l'outil `entretenir`, chacun propre à certaines actions. */
const CHAMPS_FACULTATIFS_ENTRETIEN = ['redirection', 'dans', 'ancien', 'nouveau', 'ancre', 'ancres', 'titreSiNouvelle', 'source', 'citation', 'texte', 'categorie', 'genre', 'lignes', 'motif'] as const;
/** Champs propres à chaque action de `entretenir` : obligatoires (`requis`) ou permis. */
const CHAMPS_ENTRETIEN: Record<DemandeEntretien['action'], { requis: readonly string[]; permis: readonly string[] }> = {
	supprimer: { requis: [], permis: ['redirection'] },
	fusionner: { requis: ['dans'], permis: ['dans'] },
	corriger_lien: { requis: ['ancien'], permis: ['ancien', 'nouveau'] },
	corroborer: { requis: ['ancre', 'source'], permis: ['ancre', 'source', 'citation'] },
	retoucher_information: { requis: ['ancre'], permis: ['ancre', 'texte', 'categorie'] },
	deplacer_informations: { requis: ['ancres', 'dans'], permis: ['ancres', 'dans', 'titreSiNouvelle'] },
	proposer_lot: { requis: ['genre', 'lignes', 'motif'], permis: ['genre', 'lignes', 'motif'] },
};

/** Une ligne d'un lot (`proposer_lot`) : `{ garder, absorber }` pour fusionner, `{ ancre }` sinon. */
const LIGNE_DE_LOT: Table = {
	ancre: { sorte: 'chaine', requis: false, description: 'supprimer, confirmer : l\'information visée.' },
	garder: { sorte: 'chaine', requis: false, description: 'fusionner : l\'information gardée, qui reçoit les sources des absorbées.' },
	absorber: { sorte: { textes: [1, ABSORBEES_MAX] }, requis: false, description: 'fusionner : les doublons qui disparaissent, leurs sources versées à `garder`.' },
};

const ID: Champ = { sorte: 'chaine', requis: true, description: 'Identifiant : chemin de fiche, chemin#^ancre d\'une information, chemin#section d\'un passage de fiche, ou chemin#p-… d\'un passage de document.' };
const LIMITE = (defaut: number): Champ => ({ sorte: { entier: [1, 50] }, requis: false, description: `Nombre de résultats (${defaut} par défaut).` });

/** Une table par outil : la validation et le schéma JSON de `tools/list` en sont tirés (une seule source). */
export const TABLES_ARGUMENTS = {
	chercher: {
		requete: { sorte: 'chaine', requis: true, description: 'Mots cherchés.' },
		dossier: { sorte: 'chaine', requis: false, description: 'Limite la recherche à ce dossier de la mémoire.' },
		tout: { sorte: 'booleen', requis: false, description: 'Inclut les informations barrées et à confirmer.' },
		limite: { ...LIMITE(10), requis: false },
	},
	lister: {
		dossier: { sorte: 'chaine', requis: false, description: 'Dossier de la mémoire, ex. « projets/alpha » ; « » = racine.' },
		aTraiter: { sorte: 'booleen', requis: false, description: 'true : toutes les fiches sources « à traiter » de la mémoire, où qu\'elles soient (dossier ignoré).' },
	},
	lire: { id: { ...ID, requis: true } },
	voisins: { id: { ...ID, requis: true } },
	chronologie: {
		sujet: { sorte: 'chaine', requis: true, description: 'Sujet cherché.' },
		limite: { ...LIMITE(30), requis: false },
	},
	contexte: { question: { sorte: 'chaine', requis: false, description: 'La tâche ou la question en cours.' } },
	diagnostiquer: {
		rubriques: { sorte: { liste: RUBRIQUES }, requis: false, description: 'Rubriques à rendre (toutes par défaut).' },
		limite: { sorte: { entier: [1, 200] }, requis: false, description: `Entrées montrées par rubrique (${LIMITE_PAR_RUBRIQUE} par défaut) ; les comptes sont toujours entiers.` },
	},
	deplacer: {
		id: { sorte: 'chaine', requis: true, description: 'Chemin de la fiche à déplacer.' },
		dossier: { sorte: 'chaine', requis: true, description: 'Dossier d\'arrivée, ex. « clients/acme » ; « » = racine.' },
		nom: { sorte: 'chaine', requis: false, description: 'Nouveau nom (sans .md) : renomme la fiche, ou le dossier entier si c\'est la fiche d\'un dossier.' },
	},
	extraire_source: {
		chemin: TABLE_SOURCE.chemin,
		type: TABLE_SOURCE.type,
		version_de: TABLE_SOURCE.version_de,
		apres_proches: TABLE_SOURCE.apresProches,
	},
	entretenir: {
		action: {
			sorte: { choix: ACTIONS_ENTRETIEN },
			requis: true,
			description: 'supprimer : la fiche `id` ; fusionner : `id` dans `dans` (informations, sections, relations, alias versés, liens réécrits, `id` supprimée) ; corriger_lien : dans la fiche `id`, `ancien` → `nouveau` ; corroborer : ajoute `source` (et `citation`) à l\'information `ancre` de `id` ; retoucher_information : corrige la forme (`texte`, `categorie`) de l\'information `ancre` de `id`, sans en changer le sens ; deplacer_informations : les informations `ancres` de `id` vers `dans` (liées par un renvoi comprises, liens réécrits) ; proposer_lot : un lot (`genre`, `lignes`, `motif`) d\'informations de `id` à fusionner, supprimer ou confirmer, que l\'utilisateur valide ; rien n\'est écrit avant.',
		},
		id: { sorte: 'chaine', requis: true, description: 'Chemin de la fiche visée (supprimée, absorbée, dont un lien est corrigé, ou qui porte l\'information).' },
		redirection: { sorte: 'chaine', requis: false, description: 'supprimer : fiche vers laquelle réécrire les liens qui citent `id` (obligatoire si elle est citée).' },
		dans: { sorte: 'chaine', requis: false, description: 'fusionner : fiche qui reçoit le contenu de `id` et garde son chemin ; deplacer_informations : fiche qui reçoit les informations.' },
		ancien: { sorte: 'chaine', requis: false, description: 'corriger_lien : le lien à corriger, tel qu\'écrit (« sources/doc » ou « [[sources/doc]] »).' },
		nouveau: { sorte: 'chaine', requis: false, description: 'corriger_lien : la nouvelle cible (une fiche existante) ; absent ou « » : le lien perd ses crochets.' },
		ancre: { sorte: 'chaine', requis: false, description: `corroborer, retoucher_information : ${ANCRE}` },
		ancres: { sorte: { textes: [1, 200] }, requis: false, description: 'deplacer_informations : les informations à déplacer, chacune « f-0001 », « ^f-0001 » ou « chemin#^f-0001 ».' },
		titreSiNouvelle: { sorte: 'chaine', requis: false, description: 'deplacer_informations : titre de `dans` à créer si elle n\'existe pas (type de `id`).' },
		source: { sorte: SOURCE, requis: false, description: 'corroborer : la source ajoutée, d\'une autre référence que celles de l\'information ; la confiance est recalculée (sources cumulées).' },
		citation: { sorte: 'chaine', requis: false, description: 'corroborer : passage cité de la source ajoutée (une ligne, 500 caractères au plus).' },
		texte: { sorte: 'chaine', requis: false, description: 'retoucher_information : le texte corrigé (coquille, nom, ponctuation) ; un nombre, une date, une durée ou un montant changé est refusé : `proposer` avec `remplace`.' },
		categorie: { sorte: 'chaine', requis: false, description: 'retoucher_information : la nouvelle catégorie ; entrer dans montant, echeance ou perimetre, ou en sortir, est refusé.' },
		genre: { sorte: { choix: GENRES_LOT }, requis: false, description: 'proposer_lot : fusionner (doublons), supprimer ou confirmer des informations de la fiche `id`. Rien n\'est écrit : l\'utilisateur valide le lot dans Mnemo ; seul lui supprime ou confirme.' },
		lignes: { sorte: { objets: LIGNE_DE_LOT, nombre: [1, LIGNES_MAX_LOT] }, requis: false, description: 'proposer_lot : fusionner { garder, absorber[] } ; supprimer, confirmer { ancre }. Ancres « f-0001 » ou « ^f-0001 ».' },
		motif: { sorte: 'chaine', requis: false, description: 'proposer_lot : pourquoi ce lot, en une ligne (montré à l\'utilisateur).' },
	},
} as const satisfies { readonly [O in OutilSimple]: TableDe<ArgumentsDesOutils[O]> };

/** Dossier de la mémoire (« » = racine), « / » final toléré ; null s'il n'est pas un chemin valide (absolu, « .. »…). */
function dossierValide(brut: string): string | null {
	return positionValide(brut.replace(/\/+$/u, ''));
}

/**
 * Valide les arguments d'un outil MCP (hors `proposer`) : champs connus, requis, types, longueurs, bornes ; dossiers
 * valides (rendus sans « / » final) ; `deplacer` ne vise qu'une fiche entière.
 */
export function validerArguments<O extends OutilSimple>(outil: O, brut: unknown): Valide<ArgumentsDesOutils[O]> {
	const r = valider<ArgumentsDesOutils[O]>(brut, TABLES_ARGUMENTS[outil], '');
	if (!r.ok) return r;
	const valeur = r.valeur as { dossier?: string; id?: string };
	if (valeur.dossier !== undefined) {
		const dossier = dossierValide(valeur.dossier);
		if (dossier === null) return { ok: false, motif: `dossier invalide : « ${valeur.dossier} ».` };
		valeur.dossier = dossier;
	}
	if (outil === 'deplacer' && valeur.id!.includes('#')) {
		return { ok: false, motif: `deplacer range une fiche entière : « ${valeur.id!} » désigne un élément (sans « #… » attendu).` };
	}
	return r;
}

/** Demande d'entretien tirée des arguments validés de l'outil : champs de l'action seulement, `id` sans « #… ». */
export function demandeDEntretien(a: ArgumentsDesOutils['entretenir']): Valide<DemandeEntretien> {
	const champs = CHAMPS_ENTRETIEN[a.action];
	for (const nom of CHAMPS_FACULTATIFS_ENTRETIEN) {
		if (a[nom] !== undefined && !champs.permis.includes(nom)) return { ok: false, motif: `champ « ${nom} » : sans objet pour l'action ${a.action}.` };
	}
	for (const nom of champs.requis) {
		if ((a as Record<string, unknown>)[nom] === undefined) return { ok: false, motif: `champ « ${nom} » : obligatoire pour l'action ${a.action}.` };
	}
	if (a.id.includes('#')) {
		const champ = a.action === 'deplacer_informations' ? 'ancres' : a.action === 'proposer_lot' ? 'lignes' : a.action === 'corroborer' || a.action === 'retoucher_information' ? 'ancre' : null;
		return { ok: false, motif: champ !== null ? `« ${a.id} » : la fiche attendue dans \`id\` et ${champ === 'ancre' ? 'l\'information' : 'les informations'} dans \`${champ}\` (sans « #… » dans \`id\`).` : `entretenir vise une fiche entière : « ${a.id} » désigne un élément (sans « #… » attendu).` };
	}
	switch (a.action) {
		case 'supprimer':
			return { ok: true, valeur: { action: 'supprimer', id: a.id, ...(a.redirection !== undefined ? { redirection: a.redirection } : {}) } };
		case 'fusionner':
			return { ok: true, valeur: { action: 'fusionner', id: a.id, dans: a.dans! } };
		case 'corriger_lien':
			return { ok: true, valeur: { action: 'corriger_lien', id: a.id, ancien: a.ancien!, nouveau: a.nouveau === undefined || a.nouveau.trim() === '' ? null : a.nouveau } };
		case 'corroborer':
			return { ok: true, valeur: { action: 'corroborer', id: a.id, ancre: a.ancre!, source: a.source!, ...(a.citation !== undefined ? { citation: a.citation } : {}) } };
		case 'retoucher_information':
			if (a.texte === undefined && a.categorie === undefined) return { ok: false, motif: 'champ « texte » ou « categorie » : au moins un est obligatoire pour l\'action retoucher_information.' };
			return { ok: true, valeur: { action: 'retoucher_information', id: a.id, ancre: a.ancre!, ...(a.texte !== undefined ? { texte: a.texte } : {}), ...(a.categorie !== undefined ? { categorie: a.categorie } : {}) } };
		case 'deplacer_informations':
			return { ok: true, valeur: { action: 'deplacer_informations', id: a.id, ancres: a.ancres!, dans: a.dans!, ...(a.titreSiNouvelle !== undefined ? { titreSiNouvelle: a.titreSiNouvelle } : {}) } };
		case 'proposer_lot': {
			const lignes: LigneDeLot[] = [];
			for (const [i, l] of a.lignes!.entries()) {
				const fusion = a.genre === 'fusionner';
				if (fusion ? l.garder === undefined || l.absorber === undefined || l.ancre !== undefined : l.ancre === undefined || l.garder !== undefined || l.absorber !== undefined) {
					return { ok: false, motif: `champ « lignes[${i}] » : ${fusion ? '{ garder, absorber } attendu pour fusionner' : `{ ancre } attendu pour ${a.genre!}`}.` };
				}
				lignes.push(fusion ? { garder: l.garder!, absorber: l.absorber! } : { ancre: l.ancre! });
			}
			return { ok: true, valeur: { action: 'proposer_lot', id: a.id, genre: a.genre!, lignes, motif: a.motif! } };
		}
	}
}

function nomDuType(valeur: unknown): string {
	if (valeur === null) return 'null';
	if (Array.isArray(valeur)) return 'tableau';
	switch (typeof valeur) {
		case 'string':
			return 'chaîne';
		case 'number':
			return 'nombre';
		case 'boolean':
			return 'booléen';
		case 'object':
			return 'objet';
		default:
			return typeof valeur;
	}
}

const estObjetSimple = (valeur: unknown): valeur is Record<string, unknown> => typeof valeur === 'object' && valeur !== null && [Object.prototype, null].includes(Object.getPrototypeOf(valeur));
const liste = (valeurs: readonly string[]) => valeurs.map((v) => `« ${v} »`).join(', ');

function motifChaineTropLongue(chemin: string, texte: string): string | null {
	return texte.length > LONGUEUR_MAX_ENTREE ? `champ « ${chemin} » : ${texte.length} caractères, ${LONGUEUR_MAX_ENTREE} au plus.` : null;
}

const CLES_INTERDITES = ['__proto__', 'constructor', 'prototype'];

/** Parcours des données libres : `noeuds` compte tous les éléments visités, pour borner le total. */
function motifLibre(chemin: string, valeur: unknown, profondeur: number, noeuds: { n: number }): string | null {
	noeuds.n += 1;
	if (noeuds.n > NOEUDS_MAX_LIBRE) return `champ « ${chemin} » : plus de ${NOEUDS_MAX_LIBRE} éléments au total dans les données.`;
	if (typeof valeur === 'string') return motifChaineTropLongue(chemin, valeur);
	if (valeur === null || typeof valeur === 'number' || typeof valeur === 'boolean') return null;
	if (profondeur > PROFONDEUR_MAX_LIBRE) return `champ « ${chemin} » : imbrication de plus de ${PROFONDEUR_MAX_LIBRE} niveaux.`;
	if (Array.isArray(valeur)) {
		if (valeur.length > LONGUEUR_MAX_TABLEAU) return `champ « ${chemin} » : ${valeur.length} éléments, ${LONGUEUR_MAX_TABLEAU} au plus.`;
		for (const [i, element] of valeur.entries()) {
			const motif = motifLibre(`${chemin}[${i}]`, element, profondeur + 1, noeuds);
			if (motif !== null) return motif;
		}
		return null;
	}
	if (estObjetSimple(valeur)) {
		const cles = Object.keys(valeur);
		if (cles.length > LONGUEUR_MAX_TABLEAU) return `champ « ${chemin} » : ${cles.length} clés, ${LONGUEUR_MAX_TABLEAU} au plus.`;
		for (const cle of cles) {
			if (CLES_INTERDITES.includes(cle)) return `champ « ${chemin}.${cle} » : clé réservée interdite.`;
			const motif = motifLibre(`${chemin}.${cle}`, valeur[cle], profondeur + 1, noeuds);
			if (motif !== null) return motif;
		}
		return null;
	}
	return `champ « ${chemin} » : valeur de type ${nomDuType(valeur)} non acceptée.`;
}

/** Motif du premier défaut de la valeur au regard de la sorte, sinon null. */
function motifDeSorte(chemin: string, sorte: Sorte, valeur: unknown): string | null {
	const recu = (attendu: string) => `champ « ${chemin} » : ${attendu}${attendu === 'chaîne' ? ' attendue' : ' attendu'}, reçu ${nomDuType(valeur)}.`;
	if (sorte === 'chaine') return typeof valeur === 'string' ? motifChaineTropLongue(chemin, valeur) : recu('chaîne');
	if (sorte === 'booleen') return typeof valeur === 'boolean' ? null : recu('booléen');
	if (sorte === 'libre') return estObjetSimple(valeur) ? motifLibre(chemin, valeur, 0, { n: 0 }) : recu('objet');
	if ('choix' in sorte) {
		if (typeof valeur !== 'string') return recu('chaîne');
		return sorte.choix.includes(valeur) ? null : `champ « ${chemin} » : valeur « ${Array.from(valeur).length > 40 ? `${tronquerTexte(valeur, 40)}…` : valeur} » inconnue, attendu l'une de ${liste(sorte.choix)}.`;
	}
	if ('entier' in sorte) {
		if (typeof valeur !== 'number') return recu('entier');
		const [min, max] = sorte.entier;
		return Number.isInteger(valeur) && valeur >= min && valeur <= max ? null : `champ « ${chemin} » : entier de ${min} à ${max} attendu, reçu ${valeur}.`;
	}
	if ('textes' in sorte) {
		if (!Array.isArray(valeur)) return recu('tableau');
		const [min, max] = sorte.textes;
		if (valeur.length < min || valeur.length > max) return `champ « ${chemin} » : de ${min} à ${max} éléments attendus, reçu ${valeur.length}.`;
		for (const [i, element] of valeur.entries()) {
			const motif = motifDeSorte(`${chemin}[${i}]`, 'chaine', element);
			if (motif !== null) return motif;
		}
		return null;
	}
	if ('objets' in sorte) {
		if (!Array.isArray(valeur)) return recu('tableau');
		const [min, max] = sorte.nombre;
		if (valeur.length < min || valeur.length > max) return `champ « ${chemin} » : de ${min} à ${max} éléments attendus, reçu ${valeur.length}.`;
		for (const [i, element] of valeur.entries()) {
			const motif = estObjetSimple(element) ? motifDeTable(element, sorte.objets, `${chemin}[${i}]`, '') : `champ « ${chemin}[${i}] » : objet attendu, reçu ${nomDuType(element)}.`;
			if (motif !== null) return motif;
		}
		return null;
	}
	if ('liste' in sorte) {
		if (!Array.isArray(valeur)) return recu('tableau');
		if (valeur.length > LONGUEUR_MAX_TABLEAU) return `champ « ${chemin} » : ${valeur.length} éléments, ${LONGUEUR_MAX_TABLEAU} au plus.`;
		if (new Set(valeur).size !== valeur.length) return `champ « ${chemin} » : valeurs en double.`;
		for (const [i, element] of valeur.entries()) {
			const motif = motifDeSorte(`${chemin}[${i}]`, { choix: sorte.liste }, element);
			if (motif !== null) return motif;
		}
		return null;
	}
	return estObjetSimple(valeur) ? motifDeTable(valeur, sorte.objet, chemin, '') : recu('objet');
}

/** Premier défaut d'un objet au regard d'une table : champs inconnus, champs requis, puis chaque champ présent. */
/** `noms` : nom sous lequel l'appelant connaît un champ de premier niveau (motifs écrits avec ce nom). */
function motifDeTable(objet: Record<string, unknown>, table: Table, prefixe: string, contexte: string, noms: Readonly<Record<string, string>> = {}): string | null {
	const chemin = (nom: string) => (prefixe === '' ? (Object.hasOwn(noms, nom) ? noms[nom]! : nom) : `${prefixe}.${nom}`);
	for (const nom of Object.keys(objet)) {
		if (!Object.hasOwn(table, nom)) return `champ inconnu « ${chemin(nom)} »${contexte}.`;
	}
	for (const [nom, champ] of Object.entries(table)) {
		const valeur = Object.hasOwn(objet, nom) ? objet[nom] : undefined;
		if (valeur === undefined) {
			if (champ.requis) return `champ « ${chemin(nom)} » : obligatoire${contexte}.`;
			continue;
		}
		const motif = motifDeSorte(chemin(nom), champ.sorte, valeur);
		if (motif !== null) return motif;
	}
	return null;
}

/** Copie de l'objet limitée aux champs de la table (les sous-objets sont copiés de même ; `libre` et listes tels quels). */
function copie(objet: Record<string, unknown>, table: Table): Record<string, unknown> {
	const sortie: Record<string, unknown> = {};
	for (const [nom, champ] of Object.entries(table)) {
		if (!Object.hasOwn(objet, nom) || objet[nom] === undefined) continue;
		const valeur = objet[nom];
		const sorte = champ.sorte;
		if (typeof sorte === 'object' && 'objet' in sorte && estObjetSimple(valeur)) sortie[nom] = copie(valeur, sorte.objet);
		else if (typeof sorte === 'object' && 'objets' in sorte && Array.isArray(valeur)) sortie[nom] = valeur.map((v) => (estObjetSimple(v) ? copie(v, sorte.objets) : v));
		else sortie[nom] = valeur;
	}
	return sortie;
}

function valider<T>(brut: unknown, table: Table, contexte: string, noms: Readonly<Record<string, string>> = {}): Valide<T> {
	if (!estObjetSimple(brut)) return { ok: false, motif: `un objet est attendu, reçu ${nomDuType(brut)}.` };
	const motif = motifDeTable(brut, table, '', contexte, noms);
	return motif === null ? { ok: true, valeur: copie(brut, table) as T } : { ok: false, motif };
}

/** Valide la forme d'une demande d'écriture (`proposer`) reçue de l'extérieur. */
export function validerDemande(brut: unknown): Valide<Demande> {
	if (!estObjetSimple(brut)) return { ok: false, motif: `un objet est attendu, reçu ${nomDuType(brut)}.` };
	const genre = Object.hasOwn(brut, 'genre') ? brut.genre : undefined;
	if (genre === undefined) return { ok: false, motif: 'champ « genre » : obligatoire.' };
	if (typeof genre !== 'string' || !Object.hasOwn(TABLES_DEMANDE, genre)) {
		return { ok: false, motif: `champ « genre » : valeur inconnue, attendu l'une de ${liste(Object.keys(TABLES_DEMANDE))}.` };
	}
	const { genre: _genre, ...reste } = brut;
	const r = valider<Omit<Demande, 'genre'>>(reste, TABLES_DEMANDE[genre as Genre], ` pour le genre « ${genre} »`);
	return r.ok ? { ok: true, valeur: { genre, ...r.valeur } as Demande } : r;
}

/** Valide la forme d'une demande d'extraction de source (`extraire_source`) reçue de l'extérieur. */
export function validerDemandeSource(brut: unknown): Valide<DemandeSource> {
	return valider<DemandeSource>(brut, TABLE_SOURCE, ' pour une source');
}

/**
 * Valide la forme d'une requête de recherche reçue de l'extérieur. `noms` : nom public d'un champ quand l'appelant l'expose
 * sous un autre nom (outil MCP : `texte` → `requete`) ; les motifs emploient ce nom.
 */
export function validerRequete(brut: unknown, noms: Partial<Record<keyof Requete, string>> = {}): Valide<Requete> {
	return valider<Requete>(brut, TABLE_REQUETE, ' pour une recherche', noms);
}

/** Paramètres de `GET recherche` (interface) : `genre` borne aux fiches (hors documents) ou aux documents. */
export type ParametresRecherche = { q: string; dossier?: string; limite?: number; rapide?: boolean; genre?: 'fiche' | 'document' };

const TABLE_PARAMETRES_RECHERCHE = {
	q: { sorte: 'chaine', requis: true, description: 'Mots cherchés.' },
	dossier: { sorte: 'chaine', requis: false, description: 'Limite la recherche à ce dossier de la mémoire.' },
	limite: { ...LIMITE(10), requis: false },
	rapide: { sorte: 'booleen', requis: false, description: '1 : les mots seuls, sans modèle.' },
	genre: { sorte: { choix: ['fiche', 'document'] }, requis: false, description: 'fiche : hors documents ; document : les documents seuls.' },
} as const satisfies TableDe<ParametresRecherche>;

/**
 * Paramètres d'une requête HTTP (du texte) mis à la sorte de leur champ — entier écrit en chiffres, booléen « 1 » ou
 * « 0 » —, une valeur mal écrite restant du texte que la table refuse ; les paramètres hors table sont ignorés.
 */
function depuisParametres(params: URLSearchParams, table: Table): Record<string, unknown> {
	const sortie: Record<string, unknown> = {};
	for (const [nom, champ] of Object.entries(table)) {
		const v = params.get(nom);
		if (v === null) continue;
		const sorte = champ.sorte;
		if (sorte === 'booleen' && (v === '1' || v === '0')) sortie[nom] = v === '1';
		else if (typeof sorte === 'object' && 'entier' in sorte && /^\d{1,9}$/u.test(v)) sortie[nom] = Number(v);
		else sortie[nom] = v;
	}
	return sortie;
}

/** Valide les paramètres de `GET recherche` par leur table (dossier valide, rendu sans « / » final). */
export function validerParametresRecherche(params: URLSearchParams): Valide<ParametresRecherche> {
	const r = valider<ParametresRecherche>(depuisParametres(params, TABLE_PARAMETRES_RECHERCHE), TABLE_PARAMETRES_RECHERCHE, '');
	if (!r.ok || r.valeur.dossier === undefined) return r;
	const dossier = dossierValide(r.valeur.dossier);
	if (dossier === null) return { ok: false, motif: `dossier invalide : « ${r.valeur.dossier} ».` };
	return { ok: true, valeur: { ...r.valeur, dossier } };
}
