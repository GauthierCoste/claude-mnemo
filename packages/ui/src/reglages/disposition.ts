/**
 * Disposition des réglages (route `reglages`, `ReglagesVue`) dans l'onglet Réglages : quelle carte, quel groupe, quel libellé
 * court (l'explication du service passe en infobulle) et quelle forme pour chaque champ. Mémoire : cartes Rappel (ce qui est
 * injecté dans les sessions, et le réapprentissage de la note de confiance), Recherche (l'outil chercher et la recherche de l'interface) et Confiance ;
 * Système : une carte. Un champ que cette disposition ne connaît pas va dans « Réglages fins » de Rappel, sous son libellé du
 * service : rien de ce que le service rend n'est caché.
 */
import type { ChampReglageVue } from '@mnemo/contrat';

/**
 * Forme d'un champ : `curseur` (libellé, valeur à droite, phrase d'effet), `barre` (compacte, sur une ligne), `nombre`,
 * `choix` (liste déroulante), `interrupteur` (oui ou non), `interrupteurs` (un par choix ; `inverse` : allumé = choix absent de
 * la valeur), `puces`, `couleur`.
 */
export type FormeChamp = 'curseur' | 'barre' | 'nombre' | 'choix' | 'interrupteur' | 'interrupteurs' | 'puces' | 'couleur';

export type ChampDispose = {
	cle: string;
	libelle: string;
	forme: FormeChamp;
	/** Petite ligne sous le libellé (lignes à interrupteur ou à liste). */
	aide?: string;
	/** `interrupteurs` : allumé quand le choix n'est pas dans la valeur. */
	inverse?: boolean;
	/** Valeur montrée, quand l'unité du service ne convient pas (« 2× »). */
	format?(valeur: number): string;
};

/** `repli` : groupe replié sous « titre · N » ; `etatService` : la ligne d'état du service en tête ; `ton` : couleur des barres. */
export type GroupeDispose = { titre: string | null; champs: readonly ChampDispose[]; repli?: boolean; etatService?: boolean; ton?: 'accent' };

export type CarteDisposee = { cle: string; titre: string; sous: string; groupes: readonly GroupeDispose[] };

const barre = (cle: string, libelle: string): ChampDispose => ({ cle, libelle, forme: 'barre' });

const RAPPEL: CarteDisposee = {
	cle: 'rappel',
	titre: 'Rappel',
	sous: 'Ce que Mnemo injecte dans les sessions, et ce qu’il propose en pistes.',
	groupes: [
		{
			titre: null,
			champs: [
				{ cle: 'contexte.seuilInjection', libelle: 'Seuil d’injection', forme: 'curseur' },
				{ cle: 'contexte.injectionsParMessage', libelle: 'Fiches injectées', forme: 'curseur' },
				{ cle: 'contexte.seuilPiste', libelle: 'Seuil des pistes', forme: 'curseur' },
				{ cle: 'contexte.pistesParMessage', libelle: 'Pistes proposées', forme: 'curseur' },
			],
		},
		// la note de confiance décide des injections et des pistes ci-dessus : son réapprentissage en fond (`entrainement.automatique`)
		{
			titre: 'Note de confiance',
			champs: [{ cle: 'entrainement.automatique', libelle: 'Réapprentissage automatique', aide: 'en fond, au plus une fois par jour', forme: 'interrupteur' }],
		},
		// les marqueurs ne servent qu'au lancement d'une session : ◆ sur les dossiers-projets de l'arbre où l'on choisit son dossier
		{ titre: 'Un projet, c’est un dossier avec…', champs: [{ cle: 'projets.marqueurs', libelle: 'Marqueurs de projet', forme: 'puces' }] },
		{
			titre: 'Réglages fins',
			repli: true,
			ton: 'accent',
			champs: [
				barre('contexte.similariteRecherche', 'Similarité min.'),
				barre('contexte.poidsInjection', 'Poids d’une injection à la main'),
				barre('contexte.demiVieInjection', 'Demi-vie'),
				barre('contexte.cartesNommees', 'Fiches nommées'),
			],
		},
	],
};

/** Réglages qui ne jouent que sur la recherche (`application/chercher.ts`) : l'outil chercher et la recherche de l'interface. */
const RECHERCHE: CarteDisposee = {
	cle: 'recherche',
	titre: 'Recherche',
	sous: 'Ce que remontent l’outil chercher et la recherche de l’interface, et dans quel ordre.',
	groupes: [
		{
			titre: 'Ce qui passe devant',
			ton: 'accent',
			champs: [
				barre('recherche.poidsPosition', 'Projet en cours'),
				barre('recherche.poidsConfiance', 'Confiance'),
				barre('recherche.poidsMemoire', 'Fiches de la mémoire'),
				barre('recherche.poidsFraicheur', 'Fraîcheur'),
			],
		},
		{
			titre: 'Réglages fins',
			repli: true,
			ton: 'accent',
			champs: [
				barre('recherche.resultats', 'Résultats / recherche'),
				barre('memoire.seuilRappel', 'Seuil de rappel'),
				barre('recherche.chronologie', 'Chronologie'),
				barre('recherche.graphe', 'Graphe'),
				barre('recherche.reranker', 'Reranker'),
			],
		},
	],
};

const CONFIANCE: CarteDisposee = {
	cle: 'confiance',
	titre: 'Confiance',
	sous: 'À qui Mnemo fait confiance, et ce que l’archiviste écrit sans confirmation.',
	groupes: [
		{
			titre: 'Fiabilité des sources',
			champs: [
				barre('memoire.fiabilite_utilisateur', 'Toi'),
				barre('memoire.fiabilite_contrat', 'Contrat'),
				barre('memoire.fiabilite_spec_validee', 'Spéc. validée'),
				barre('memoire.fiabilite_compte_rendu', 'Compte rendu'),
				barre('memoire.fiabilite_email', 'E-mail'),
				barre('memoire.fiabilite_note', 'Note'),
				barre('memoire.fiabilite_session', 'Session'),
				barre('memoire.fiabilite_deduction', 'Déduction'),
				barre('memoire.fiabilite_inconnue', 'Inconnue'),
			],
		},
		{
			titre: 'Un fait vaut…',
			champs: [
				barre('memoire.poids_declare', 'Déclaré'),
				barre('memoire.poids_observe', 'Observé'),
				barre('memoire.poids_infere', 'Inféré'),
				{ cle: 'memoire.repetitions', libelle: 'Redites avant de proposer une consigne', forme: 'curseur', format: (n) => `${n}×` },
			],
		},
		{ titre: 'L’archiviste écrit seul…', champs: [{ cle: 'archiviste.typesAConfirmer', libelle: 'Types de fiche', forme: 'interrupteurs', inverse: true }] },
	],
};

const SYSTEME: CarteDisposee = {
	cle: 'systeme',
	titre: 'Système',
	sous: 'Mnemo qui tourne ici, et sa tête.',
	groupes: [
		{
			titre: 'Service',
			etatService: true,
			champs: [
				{ cle: 'service.navigateur', libelle: 'S’ouvre dans', aide: 'au lancement de Mnemo', forme: 'choix' },
				{ cle: 'service.port', libelle: 'Port', aide: 'l’adresse de l’interface', forme: 'nombre' },
			],
		},
		{ titre: 'Modèles locaux', champs: [{ cle: 'modeles.inactiviteMinutes', libelle: 'S’endorment après', forme: 'curseur' }] },
		{ titre: 'Couleur', champs: [{ cle: 'interface.accent', libelle: 'Couleur de l’interface', forme: 'couleur' }] },
	],
};

/** Les cartes de chaque section de l'onglet Réglages (Branchements n'a pas de réglage de `ReglagesVue`). */
export const CARTES_REGLAGES = { memoire: [RAPPEL, RECHERCHE, CONFIANCE], systeme: [SYSTEME] } as const;

const clesDe = (cartes: readonly CarteDisposee[]): Set<string> => new Set(cartes.flatMap((c) => c.groupes.flatMap((g) => g.champs.map((x) => x.cle))));
const CLES_DISPOSEES = clesDe([RAPPEL, RECHERCHE, CONFIANCE, SYSTEME]);
const CLES_SYSTEME = clesDe([SYSTEME]);

/** Section où se règle un champ : Système pour les siens, Mémoire pour tous les autres (non disposés compris). */
export const sectionDuChamp = (cle: string): 'memoire' | 'systeme' => (CLES_SYSTEME.has(cle) ? 'systeme' : 'memoire');

const FORME_PAR_GENRE: Readonly<Record<ChampReglageVue['genre'], FormeChamp>> = {
	entier: 'barre',
	decimal: 'barre',
	liste: 'puces',
	choix: 'choix',
	'choix-multiple': 'interrupteurs',
	couleur: 'couleur',
	booleen: 'interrupteur',
};

/** Les champs du service que la disposition ne connaît pas, sous leur libellé du service, dans une forme selon leur genre. */
export function champsNonDisposes(champs: readonly ChampReglageVue[]): ChampDispose[] {
	return champs.filter((c) => !CLES_DISPOSEES.has(c.cle)).map((c) => ({ cle: c.cle, libelle: c.libelle, forme: FORME_PAR_GENRE[c.genre] }));
}
