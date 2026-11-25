import type { AvancementModele, NiveauModeles, OperationModele, RaisonCarte } from '@mnemo/commun';
import type { RaisonMuet } from '../domaine/message-muet.ts';
import type { CauseArret, EvenementHook, Session } from '../domaine/session.ts';
import type { ElementIndexe, GenreElement, Lien, StatutElement } from '../domaine/elements.ts';
import type { TypeFiche } from '../domaine/fiche.ts';
import type { Passage, PassageCompact } from '../domaine/passages.ts';
import type { Reglages } from '../domaine/reglages.ts';
import type { InjectionManuelle } from '../domaine/signal-injection.ts';
import type { DecisionLot, Lot, LotDecide } from '../domaine/lot.ts';
import type { EtatIndicateur } from '../domaine/refus-outil.ts';
import type { Geste, GesteCompte, NoteDuGeste, OrigineGeste } from '../domaine/gestes.ts';
import type { SignauxBruts } from '../domaine/signaux-de-note.ts';
import type { TypeSource } from '../domaine/regles.ts';
import type { FichierPlugin } from './plugin.ts';
import type { AppelPlugin } from './plugin.ts';

export interface Coffre {
	/** Contenu du fichier, ou null s'il n'existe pas. */
	lire(chemin: string): Promise<string | null>;
	/** Crée les dossiers manquants et écrit en LF. */
	ecrire(chemin: string, texte: string): Promise<void>;
	/** Sans erreur si le fichier n'existe pas. */
	supprimer(chemin: string): Promise<void>;
	/**
	 * Retire le dossier `dossier` (relatif à `_mnemo/`) s'il est vide : il ne contient que des `.DS_Store` et des sous-dossiers
	 * eux-mêmes vides (retirés avec lui). Sans erreur ; rend ce qui a été fait : `racine` (jamais retirée), `lien` (un segment
	 * du chemin est un lien symbolique), `absent`, `pas_un_dossier`, `non_vide` (rien n'est touché).
	 */
	retirerDossierVide(dossier: string): Promise<RetraitDossier>;
	/**
	 * Fiches `.md` et sous-dossiers directs de `dossier` (« » = racine), sans les entrées cachées (« . »).
	 * Chemins RELATIFS à `_mnemo/` (pas à `dossier`), séparés par « / », triés. Dossier absent : listes vides.
	 * Liens symboliques jamais suivis : ni listés, ni parcourus (`dossier` atteint par un lien : listes vides).
	 */
	lister(dossier: string): Promise<{ fiches: string[]; dossiers: string[] }>;
	/** Tous les .md, chemins relatifs à la mémoire, séparés par « / », triés. */
	toutesLesFiches(): Promise<string[]>;
	/** Tous les .md non cachés avec date de modification et taille ; chemins relatifs à la mémoire, séparés par « / », triés. */
	etats(): Promise<EtatFichier[]>;
}

export type RetraitDossier = 'retire' | 'racine' | 'lien' | 'absent' | 'pas_un_dossier' | 'non_vide';
export type EtatFichier = { chemin: string; mtimeMs: number; taille: number };
export type FicheIndexee = { chemin: string; empreinte: string; mtimeMs: number; taille: number };
/** Une fiche telle que l'index la connaît : `anomalies`, ce que sa lecture a contourné (`elementsDeFiche`), en français. */
export type FicheIndexeeLue = FicheIndexee & { anomalies: string[] };
/** `chemins` : seulement les éléments de ces fiches (passages : de ces fiches sources). */
export type FiltreIndex = { perimetre?: string; statuts?: StatutElement[]; genres?: GenreElement[]; typesFiche?: TypeFiche[]; typesFicheExclus?: TypeFiche[]; chemins?: string[] };

/**
 * Un passage à indexer : celui du découpage (section = rang dans les sections du document), avec le type et la date de sa
 * source ; `ligneContexte` : résumé du document (synthèse de sa fiche, sinon ses premières lignes utiles), cherché et
 * vectorisé avec le préfixe, jamais servi.
 */
export type PassageIndexe = PassageCompact & { typeSource: TypeSource; date: string | null; ligneContexte?: string };
/** Passages d'une même section, dans l'ordre ; `cle` : la même pour tous les passages de la section. */
export type SectionDePassage = { cle: string; passages: { id: string; texte: string }[] };
/** Un passage lu dans l'index ; `id` = `<fiche source>#<ancre>`, `statut` dérivé (`ancienne_version` si une autre source le remplace). */
export type PassageLu = Passage & { typeSource: TypeSource; date: string | null; id: string; ficheSource: string; statut: StatutElement };

/**
 * `indexee` : passages à jour ; `disparue` : le fichier n'existe plus (passages retirés, faits citants `source_disparue`) ;
 * `illisible` : l'extraction a échoué (anciens passages gardés, réessayée quand le fichier change) ; `sans_document` :
 * fiche sans fichier ni contenu.
 */
export type EtatPassages = 'indexee' | 'disparue' | 'illisible' | 'sans_document';
/** Ce que l'index sait d'une fiche `source` et de son document. `descripteur` : celui de la fiche, en JSON. */
export type EtatSource = {
	fiche: string;
	descripteur: string;
	versionDe: string | null;
	/** Source parente (fiche d'un fichier à plusieurs fils, ou d'une pièce jointe) : remplacée par une version, elle entraîne ses filles. */
	parente?: string | null;
	mtimeMs: number | null;
	taille: number | null;
	empreinteFichier: string | null;
	etat: EtatPassages;
	/** Secrets masqués lors de la dernière indexation des passages. */
	secrets: number;
	/**
	 * Ce que la dernière indexation n'a pas pu faire comme prévu, en français : avertissements de l'extraction (texte coupé,
	 * pages sans texte, encodage supposé…), ou le motif de son échec (`illisible`). Montrés sur la fiche de la source.
	 */
	avertissements: string[];
};

/** Un élément ou passage dont le vecteur de sens manque ou n'est plus à jour. */
export type AVectoriser = { id: string; texte: string; empreinte: string };

/** Index de recherche jetable (reconstructible depuis les fiches). */
export interface Index {
	fiches(): Promise<FicheIndexeeLue[]>;
	/** Remplace tout le contenu de la fiche en une transaction. `titre` sert à relier titre et alias. */
	remplacer(fiche: FicheIndexee, contenu: { titre: string; elements: ElementIndexe[]; liens: Lien[]; alias: string[]; anomalies: string[] }): Promise<void>;
	retirer(chemin: string): Promise<void>;
	/** Vide l'index sur place (schéma recréé, même fichier : une connexion ouverte ailleurs reste valide) ; à resynchroniser ensuite. */
	vider(): Promise<void>;
	/** `expression` : expression FTS5 déjà construite ; résultats par pertinence (bm25) décroissante. */
	chercher(expression: string, filtre: FiltreIndex, limite: number): Promise<ElementIndexe[]>;
	elements(filtre: FiltreIndex): Promise<ElementIndexe[]>;
	element(id: string): Promise<ElementIndexe | null>;
	/** Éléments et passages (comme `chercher` les rend) de ces ids, dans l'ordre des ids ; un id inconnu est omis. */
	elementsParId(ids: string[]): Promise<ElementIndexe[]>;
	liens(chemin: string): Promise<{ sortants: Lien[]; entrants: Lien[] }>;
	/** Tous les liens de l'index, par fiche d'origine puis dans l'ordre de la fiche. */
	tousLesLiens(): Promise<Lien[]>;
	/** Titre et alias de chaque fiche indexée, par chemin. */
	titres(): Promise<{ chemin: string; titre: string; alias: string[] }[]>;
	/** Mot normalisé (titre ou alias) → autres formes de la même fiche. */
	alias(): Promise<Map<string, string[]>>;
	/** État de chaque fiche `source` connue, avec son nombre de passages. */
	sources(): Promise<(EtatSource & { passages: number })[]>;
	/** Remplace les passages d'une source (et ses sections) et note son état, en une transaction ; libère sa réservation. */
	remplacerPassages(ficheSource: string, passages: PassageIndexe[], sections: string[], etat: Omit<EtatSource, 'fiche'>): Promise<void>;
	/**
	 * Réserve des sources pour les extraire (une transaction courte) : rend celles obtenues. Une source réservée par un autre
	 * jeton depuis moins de `perimeMs` est refusée ; une réservation plus ancienne est reprise. Écrire l'état la libère.
	 */
	reserverSources(fiches: string[], jeton: string, maintenantMs: number, perimeMs: number): Promise<string[]>;
	/** Libère les réservations de ce jeton (sources réservées mais pas écrites). */
	libererSources(fiches: string[], jeton: string): Promise<void>;
	/** Retire les passages d'une source ; avec `etat`, le note dans la même transaction, sans, oublie la source. */
	retirerPassages(ficheSource: string, etat?: Omit<EtatSource, 'fiche'>): Promise<void>;
	/** Note l'état d'une source sans toucher à ses passages ; libère sa réservation. */
	noterSource(ficheSource: string, etat: Omit<EtatSource, 'fiche'>): Promise<void>;
	/** Passage par identifiant `<fiche source>#p-…`, ou null. */
	passage(id: string): Promise<PassageLu | null>;
	/**
	 * Passages de la section d'un passage (lui compris), dans l'ordre : pour un document, ceux du même rang de section
	 * (même titre le plus profond) ; pour une fiche, ceux du même contexte (titre › titres). Null pour un id qui n'est pas
	 * un passage connu.
	 */
	passagesDeSection(id: string): Promise<SectionDePassage | null>;
	/**
	 * Parmi `ids` (éléments et passages de document), ceux dont le texte même correspond à `expression` (FTS5 : formes
	 * exactes ou racines), sans compter le contexte ni la ligne de contexte.
	 */
	correspondParLeTexte(expression: string, ids: string[]): Promise<Set<string>>;
	/** Sources qui ont des passages d'ancre parmi `ancres`, avec le nombre d'ancres distinctes en commun (quasi-copies). */
	ancresCommunes(ancres: string[]): Promise<{ fiche: string; communes: number }[]>;
	/**
	 * Éléments (hors `invalide`) puis passages, par id, sans vecteur à jour pour `modele` (absent, d'un autre modèle ou d'un
	 * autre texte). `texte` : celui à vectoriser (`texteAVectoriser` : titre de la fiche ou préfixe du passage, puis texte) ;
	 * `empreinte` : la sienne (FNV-1a).
	 */
	aVectoriser(modele: string, limite: number): Promise<AVectoriser[]>;
	/** Nombre de ceux que rendrait `aVectoriser` sans limite. */
	nombreAVectoriser(modele: string): Promise<number>;
	/** Enregistre des vecteurs (une transaction) ; un id qui n'est plus dans l'index est ignoré. */
	enregistrerVecteurs(modele: string, dimension: number, vecteurs: { id: string; empreinte: string; vecteur: Float32Array }[]): Promise<void>;
	/**
	 * Les `limite` éléments et passages les plus proches de `requete` (cosinus), parmi ceux que `filtre` retient (comme
	 * `chercher`) et qui ont un vecteur à jour de `modele`, de la dimension de la requête ; du plus proche au moins proche
	 * (égalités : id croissant), chacun avec son genre. `parGenre` : la limite vaut pour chaque genre (les `limite` plus
	 * proches de chacun, dans un même parcours) ; les premiers d'un sous-ensemble de genres s'en tirent sans nouveau parcours.
	 */
	plusProches(
		modele: string,
		requete: Float32Array,
		filtre: FiltreIndex,
		limite: number,
		options?: { parGenre?: boolean },
	): Promise<{ id: string; similarite: number; genre: GenreElement }[]>;
	/**
	 * État du cache des vecteurs de `modele` dans ce processus, sans aucun accès disque : `chaud` s'il a déjà été chargé (un
	 * parcours ne relit que les vecteurs écrits depuis), `froid` sinon (le premier parcours les décode tous).
	 */
	cacheVecteurs(modele: string): 'chaud' | 'froid';
	/** Nombre de vecteurs enregistrés pour `modele` (à jour ou non). */
	nombreVecteurs(modele: string): Promise<number>;
	fermer(): void;
}

export interface Historique {
	initialiser(): Promise<void>;
	modificationsEnCours(): Promise<string[]>;
	/** Hash court du commit créé, ou null s'il n'y avait rien à commiter. `session` (uuid) : écrite en trailer `Mnemo-Session`, ignorée si ce n'est pas un uuid. */
	commit(message: string, chemins: string[] | 'tout', session?: string): Promise<string | null>;
	/**
	 * Commits depuis minuit local du jour `AAAA-MM-JJ` (jusqu'à minuit local du jour `jusqua`, s'il est donné), du plus récent au plus ancien (500 au plus), avec leurs fichiers et
	 * la session lue dans le trailer `Mnemo-Session` (uuid), ou null.
	 */
	journal(depuis: string, limite: number, jusqua?: string): Promise<{ hash: string; dateMs: number; message: string; fichiers: string[]; session: string | null }[]>;
}

export interface Verrou {
	avec<T>(action: () => Promise<T>): Promise<T>;
}

export interface Systeme {
	maintenant(): Date;
	/** Identifiant ULID. */
	nouvelId(): string;
	/** Identifiant UUID (session). */
	nouvelUuid(): string;
}

/**
 * Texte extrait et indexé d'un seul document, au plus (en caractères) : 32 Mi. Au-delà, le texte est coupé et l'extraction
 * le signale (`DocumentExtrait.avertissements`, repris dans le bilan de `extraire_source` et de la synchronisation).
 */
export const TEXTE_MAX_DOCUMENT = 32 * 1024 * 1024;

/**
 * Texte de toutes les pièces jointes d'un même fichier (une boîte `.mbox`), au plus (caractères) : deux fois
 * `TEXTE_MAX_DOCUMENT`. Au-delà, les pièces suivantes ne sont pas extraites, seulement nommées (avertissement).
 */
export const TEXTE_MAX_PIECES = 2 * TEXTE_MAX_DOCUMENT;

/** Contenu d'un document, lu par morceaux : jamais chargé d'un bloc sans le vouloir. */
export interface Contenu {
	/** Taille en octets, constatée à l'ouverture. */
	readonly taille: number;
	/** Jusqu'à `longueur` octets à partir de `position` (moins en fin de contenu, vide au-delà). */
	lire(position: number, longueur: number): Promise<Uint8Array>;
}

/** Un document ouvert : à fermer après usage. Une lecture échoue si le fichier a changé depuis l'ouverture. */
export interface DocumentOuvert extends Contenu {
	fermer(): Promise<void>;
}

/**
 * Documents du dossier Mnemo, en lecture seule. Chemins relatifs à la racine du dossier, séparés par « / ». Refusés (erreur
 * `ErreurFichier`) : hors de la racine, dans `_mnemo/` ou `.mnemo/`, segment caché, lien symbolique, autre chose qu'un fichier ;
 * `ouvrir` refuse aussi un fichier de plus de `TAILLE_MAX_DOCUMENT`.
 */
export interface Fichiers {
	/** Le document ouvert (lu par morceaux), ou null s'il n'existe pas. */
	ouvrir(chemin: string): Promise<DocumentOuvert | null>;
	/** Date de modification et taille, ou null si le fichier n'existe pas. */
	etat(chemin: string): Promise<{ mtimeMs: number; taille: number } | null>;
	/**
	 * Le chemin tel qu'il est écrit sur le disque (casse de chaque segment), ou null si le fichier n'existe pas. Sur un disque
	 * insensible à la casse, « Docs/CDC.md » désigne « docs/cdc.md » : la fiche garde le second.
	 */
	cheminReel(chemin: string): Promise<string | null>;
}

/** Ce qu'un dossier de la racine contient : ses sous-dossiers (liens symboliques exclus) et le nom de chaque entrée. */
export type ContenuDossier = { dossiers: string[]; entrees: string[] };

/** Les dossiers sous la racine du dossier Mnemo, lus sur le disque. */
export interface DossiersRacine {
	/** `chemin` : relatif à la racine, en « / », déjà validé (« » = la racine). Lève (message lisible) si le dossier est absent, illisible ou atteint par un lien symbolique. */
	lire(chemin: string): Promise<ContenuDossier>;
}

/** Chemin de document refusé (motif lisible, en français). */
export class ErreurFichier extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'ErreurFichier';
	}
}

export type IndicateurConsignes = { noter(presentes: boolean, horodatageMs: number): Promise<void>; marquerIllisible(horodatageMs: number): Promise<void>; lire(): Promise<EtatIndicateur> };

export type Dependances = {
	coffre: Coffre;
	historique: Historique;
	verrou: Verrou;
	systeme: Systeme;
	index: Index;
	/** Documents du dossier Mnemo (hors mémoire), en lecture seule. */
	documents: Fichiers;
	extraction: Extraction;
	/** Vecteurs de sens (modèle local) ; `null` dès que le modèle manque, tarde ou répond mal : la recherche se fait par les mots. */
	sens: Sens;
	/** Notes du reranker (modèle local) ; `null` dans les mêmes cas. */
	reranker: Reranker;
	/** Réglages du dossier (`.mnemo/reglages.json`), lus à chaque usage : une modification vaut dès l'appel suivant. */
	reglages(): Reglages;
	/** La mémoire contient-elle des consignes vérifiées ? Noté à chaque synchronisation, lu sans ouvrir l'index. */
	indicateur: IndicateurConsignes;
	/** Écriture venue d'une session Mnemo : sa session et son dossier d'épisodes. */
	origine?: { session: string; projet: string };
	/** État des sessions : l'épisode d'une session (`origine`) y prend son début, son profil, sa branche ; l'outil `contexte` y lit ses fiches servies et injectées à la main, note les cartes proposées et journalise son appel. */
	sessions?: Pick<EtatSessions, 'lire' | 'fichesServiesLuesOuEcrites' | 'noterFicheServieLueOuEcrite' | 'noterCarteProposee' | 'journaliser' | 'injectionsManuelles'>;
	/** Extraction des documents en arrière-plan (processus qui durent : service, serveur MCP) ; la recherche la réveille. */
	extractionDifferee?: ExtractionDifferee;
	/** Plugins Claude Code installés et skills personnelles de l'utilisateur, en lecture seule. */
	pluginsClaude: PluginsClaude;
	/** Lots d'informations proposés par l'archiviste, en attente de l'utilisateur (état local, hors mémoire). */
	lots: Lots;
};

/**
 * Lots d'informations (`domaine/lot.ts`) : enregistrés par l'archiviste (`entretenir` › `proposer_lot`), décidés par
 * l'utilisateur (service HTTP). Gardés dans l'état local (`.mnemo/etat.sqlite`) : un lot survit au redémarrage du service
 * et n'écrit rien dans la mémoire tant qu'il n'est pas validé. Partagé entre processus (serveurs MCP, service).
 */
export interface Lots {
	enregistrer(lot: Lot): Promise<void>;
	/** Lots en attente, les plus anciens d'abord. */
	enAttente(): Promise<Lot[]>;
	/** Le lot en attente `id`, ou null (inconnu ou déjà décidé). */
	lire(id: string): Promise<Lot | null>;
	/** Note la décision d'un lot en attente ; false : inconnu ou déjà décidé (rien ne change). Garde les 200 derniers décidés. */
	decider(id: string, decision: DecisionLot, decideMs: number): Promise<boolean>;
	/** Lots décidés après `depuisMs` (exclu), les plus récents d'abord, `limite` au plus. */
	decides(depuisMs: number, limite: number): Promise<LotDecide[]>;
	/** Signature qui change à chaque proposition ou décision : la diffusion aux clients la sonde. */
	version(): Promise<string>;
	fermer(): void;
}

export type SkillInstallee = { nom: string; description: string };

/** Un plugin Claude Code installé : `id` (`nom@place`), `portee` (`scope` de l'installation, vide si absente). */
export type PluginInstalle = { id: string; nom: string; version: string; portee: string; skills: SkillInstallee[]; hooks: boolean };

/** Ce que Claude Code a installé pour l'utilisateur. Ne lève jamais : ce qui ne se lit pas devient un avertissement. */
export interface PluginsClaude {
	installes(): Promise<{ plugins: PluginInstalle[]; avertissements: string[] }>;
	/** Noms des skills personnelles (`<dossier Claude>/skills/<nom>/SKILL.md`). */
	skillsPersonnelles(): Promise<string[]>;
};

/**
 * File d'extraction des documents, à part de la recherche (voir `extractionDifferee`) : la recherche ne l'attend jamais.
 * `avis` : ceux de ses synchronisations pas encore lus (documents à compléter : fils nouveaux d'un `.mbox`), rendus une fois.
 */
export interface ExtractionDifferee {
	reveiller(): void;
	avis(): Record<string, string>;
}

/**
 * `budgetMs` : temps total accordé à l'appel (démarrage compris) ; au-delà, `null`. `demarrer` : sans serveur en marche,
 * en lancer un (en arrière-plan : un premier chargement plus long que le budget rend `null` maintenant, les appels suivants
 * le trouveront prêt) ; `false` (« si en marche » : hooks, recherche de l'interface) : rendre `null` aussitôt, en lançant
 * les modèles sans les attendre (l'appel suivant les trouvera prêts). `activite` : ce que l'appel fait, pour l'afficher
 * (jamais de texte) ; sans opération, elle est déduite (le sens sur plusieurs textes : vectorisation ; sinon : recherche) ;
 * sans session, celle de l'enveloppe de session (`modelesDeSession`), sinon aucune ; `avancement` : celui de la passe de
 * vectorisation entière.
 */
export type OptionsModele = { budgetMs: number; demarrer: boolean; activite?: ActiviteModele };

export type ActiviteModele = { operation?: OperationModele; session?: string | null; avancement?: AvancementModele };

export interface Sens {
	/** Identité du modèle de sens installé (`bge-m3@<empreinte courte>`), ou null s'il n'est pas installé. Sans attente. */
	modele(): string | null;
	/** Un vecteur par texte, dans l'ordre ; null en cas d'absence, de délai dépassé ou de réponse invalide. */
	vecteurs(textes: string[], options: OptionsModele): Promise<Float32Array[] | null>;
}

/**
 * Un modèle local : `absent` (lui ou le moteur non installé), `exclu` (par le niveau de la machine), `arrete` (permis, aucun
 * serveur prêt), `pret` (servi, identité du serveur vérifiée).
 */
export type EtatModele = 'absent' | 'exclu' | 'arrete' | 'pret';
/** Un modèle installé : son identité, la taille de son fichier, le début de son SHA-256. */
export type PieceModele = { modele: string; editeur: string; quantification: string; octets: number; empreinte: string };
/** Un appel en cours aux modèles (n'importe quel dossier Mnemo de la machine) ; `ceDossier` : fait pour celui du service. Jamais de texte. */
export type ActiviteEnCours = { operation: OperationModele; session: string | null; ceDossier: boolean; depuisMs: number; avancement: AvancementModele | null };

/** Bilan d'un arrêt demandé : `arrete`, `rien` (rien en marche), ou des serveurs encore en chargement, à arrêter dans un instant. */
export type ArretModeles = 'arrete' | 'rien' | { enChargement: number };

/**
 * Les modèles locaux de la machine, vus du service : `installes` (le moteur et au moins un modèle), `niveau` de la machine,
 * `gardien` (`arrete` : aucun en marche ; `demarrage` ; `pret` ; `echec` : dernier démarrage en échec il y a moins d'une
 * minute), état de chaque modèle, pièces installées, appels en cours (du plus ancien au plus récent).
 */
export type EtatModeles = {
	installes: boolean;
	niveau: NiveauModeles;
	gardien: 'arrete' | 'demarrage' | 'pret' | 'echec';
	/** Arrêt après tant de minutes sans requête, celui du gardien en marche ; null quand il est arrêté (ou pas encore publié). */
	inactiviteMinutes: number | null;
	sens: EtatModele;
	reranker: EtatModele;
	pieces: { sens: PieceModele | null; reranker: PieceModele | null; moteur: { version: string; plateforme: string } | null };
	activites: ActiviteEnCours[];
};

/**
 * Les modèles locaux vus du service : leur état (lecture brève, ne lance rien) ; `demarrer` (geste de l'utilisateur : les
 * modèles permis, sans attendre leur chargement, même juste après un échec) ; `arreter` (sans changer le niveau) ; `changerNiveau` (celui de la machine :
 * retirer un modèle arrête les modèles en marche) ; `surveiller` : `rappel` est appelé quand l'état a pu changer (fichiers
 * d'état, de niveau, d'activité), sans garantie qu'il ait changé ni que chaque changement soit vu (un sondage complète) ;
 * rend la fonction qui arrête la surveillance.
 */
export interface Modeles {
	etat(): Promise<EtatModeles>;
	demarrer(): Promise<void>;
	arreter(): Promise<ArretModeles>;
	/** Rend l'arrêt qu'a causé un modèle retiré ; null : aucun (le niveau n'en retire pas). */
	changerNiveau(niveau: NiveauModeles): Promise<ArretModeles | null>;
	surveiller(rappel: () => void): () => void;
}

export interface Reranker {
	/** Une note de pertinence par texte, dans l'ordre ; null en cas d'absence, de délai dépassé ou de réponse invalide. */
	noter(requete: string, textes: string[], options: OptionsModele): Promise<number[] | null>;
}

/**
 * Une note de la mémoire native de Claude Code. `cle` : nom du dossier de projet de Claude Code (`-Users-a-Projets-X`, le
 * chemin du projet encodé), pour une note de `projects/<cle>/memory/` : sert à la rattacher à un dossier du dossier Mnemo.
 */
export type NoteClaude = { projet: string; nom: string; texte: string; origine: 'memoire' | 'claude_md'; cle?: string };

/** Un fichier vu mais écarté, et pourquoi (en français). */
export type FichierIgnore = { chemin: string; raison: string };

export interface MemoireClaude {
	/** Les notes, et les fichiers vus mais écartés (trop gros, liens symboliques…) par cette lecture-ci. */
	lire(): Promise<{ notes: NoteClaude[]; ignores: FichierIgnore[] }>;
}

/**
 * Un dossier du dossier Mnemo vu de Claude Code : `dossier` relatif à la racine (« / ») ; `cle` : son chemin absolu encodé
 * comme Claude Code nomme ses dossiers de projet ; `nom` : le dossier des fiches importées (`sources/claude-code/<nom>/`).
 */
export type DossierClaude = { dossier: string; cle: string; nom: string };

/** Un fichier d'instructions de Claude Code d'un projet : `chemin` relatif à la racine, `dossier` : le projet, `nom` : chemin dans le projet. */
export type InstructionClaude = { chemin: string; dossier: string; nom: string };

/** Les dossiers du dossier Mnemo, et les instructions de Claude Code (CLAUDE.md, `.claude/*.md`) de ses projets. */
export interface ProjetsClaude {
	lister(): Promise<{ dossiers: DossierClaude[]; instructions: InstructionClaude[]; ignores: FichierIgnore[] }>;
}

/** Un document converti en Markdown structuré, prêt à être découpé en passages. */
export type DocumentExtrait = {
	format: string;
	titre: string | null;
	markdown: string;
	/** Positions (dans `markdown`) du début de chaque page, ou null si le format n'a pas de pages. */
	pages: number[] | null;
	date: string | null;
	auteur: string | null;
	pieces: PieceJointe[];
	/** Un fil de courriels : sa clé stable (`cleDeFil` : Message-ID de son premier message, ou empreinte sujet + date). */
	cle?: string;
	/** Un fil de courriels : instant (ms) de son premier message, s'il est lisible. */
	debut?: number;
	/** Ce qui manque à l'extraction sans l'empêcher (texte coupé à `TEXTE_MAX_DOCUMENT`, message trop gros écarté…). */
	avertissements?: string[];
};
/**
 * Une pièce jointe : son contenu n'est décodé qu'à la demande (`contenu()`), une pièce à la fois ; une boîte de plusieurs Go
 * ne garde jamais toutes ses pièces en mémoire.
 */
export type PieceJointe = {
	nom: string;
	type: string;
	taille: number;
	repere: ReperePiece;
	/**
	 * Pourquoi elle n'est pas extraite (trop volumineuse, ou pas cherchable d'après `estCherchable` à la lecture du message),
	 * ou null ; écartée, elle garde sa place parmi les pièces.
	 */
	ecartee: string | null;
	contenu(): Promise<Uint8Array>;
};
/**
 * Où retrouver une pièce jointe sans relire tout son fichier : la plage d'octets de son message (`debut`, `fin`) et son rang
 * parmi les pièces de ce message. Sérialisable : la pièce peut être extraite à part, dans un autre fil (`Extracteur.piece`).
 */
export type ReperePiece = { debut: number; fin: number; rang: number };

export interface Extracteur {
	/** Le fichier entier comme UN document (pour un `.mbox` : tous les fils, sous des titres `# <sujet>`). */
	extraire(chemin: string, contenu: Contenu): Promise<DocumentExtrait>;
	/** Pour les fichiers qui contiennent plusieurs documents (un `.mbox` : un par fil). L'appelant la préfère à `extraire` quand elle existe. */
	extraireTout?(chemin: string, contenu: Contenu): Promise<DocumentExtrait[]>;
	/** Formats à pièces jointes : les octets d'une pièce retrouvée par son repère (son message relu, une seule fois pour ses pièces). */
	piece?(contenu: Contenu, repere: ReperePiece): Promise<Uint8Array>;
}
/**
 * Une partie d'un fichier à découper en passages : le fichier entier, un fil (`fil`, pour un fichier à plusieurs documents)
 * ou une pièce jointe (`piece`). `titre`, `date`, `auteur` : ceux de la fiche source, préférés à ceux du document.
 */
export type CibleExtraction = {
	fiche: string;
	/** Clé du fil (`DocumentExtrait.cle`) ; un nombre : son rang (fiches d'avant les clés). */
	fil: number | string | null;
	piece: string | null;
	/** Pièce jointe : sa position dans le fichier (`positionDeLaPiece`) ; null : la première de ce nom (fiche d'avant les positions). */
	positionPiece: number | null;
	titre: string;
	date: string | null;
	auteur: string | null;
	typeSource: TypeSource;
	/** Résumé de la source (synthèse de sa fiche, en ligne de contexte) ; null : les premières lignes du document en tiennent lieu. */
	resume: string | null;
};
/** Passages d'une cible (métadonnées déjà masquées ; `secrets` : nombre masqué, texte et métadonnées), ou le motif de l'échec. */
export type ResultatCible =
	/** `fils` : clés de tous les fils du fichier, s'il en a (pour signaler ceux qui n'ont pas encore de fiche). */
	/** `avertissements` : ceux de l'extraction (texte coupé…), à montrer dans le bilan. */
	| { ok: true; passages: PassageIndexe[]; sections: string[]; secrets: number; fils?: string[]; avertissements?: string[] }
	| { ok: false; motif: string };

/**
 * Extraction et découpage d'un fichier, bornés en mémoire et en temps (hors du processus principal en vrai). Une cible en
 * échec rend son motif, jamais une exception. Le contenu est lu par morceaux, à la demande de l'extraction ; l'appelant le
 * ferme après.
 */
export interface Extraction {
	extraire(chemin: string, contenu: Contenu, cibles: CibleExtraction[]): Promise<ResultatCible[]>;
	/**
	 * Un fichier neuf (`extraireSource`), avant que ses fiches aient un nom : ses parties (le fichier entier, ou chacun de ses
	 * fils s'il en a plusieurs ; chaque pièce jointe de format pris en charge), découpées en passages dont le préfixe reste à
	 * faire (`passagesDePartie`). Même isolement que `extraire` ; un échec rend son motif, jamais une exception.
	 */
	decouper(chemin: string, contenu: Contenu): Promise<FichierDecoupe>;
}

/**
 * Une partie d'un fichier neuf : `fil` (rang du fil), `piece` (nom de la pièce jointe) et `position` (sa position dans
 * le fichier, à partir de 1 ; null hors pièce jointe), comme dans `CibleExtraction` ;
 * métadonnées du document extrait, NON masquées ; passages sans préfixe (fiche pas encore nommée) ; `secrets` : ceux du texte.
 */
export type PartieDecoupee = {
	/** Clé du fil (fichier à plusieurs fils), sinon null. */
	fil: string | null;
	piece: string | null;
	position: number | null;
	format: string;
	titre: string | null;
	date: string | null;
	auteur: string | null;
	passages: PassageCompact[];
	sections: string[];
	secrets: number;
	/** Avertissements de l'extraction de cette partie (texte coupé…). */
	avertissements?: string[];
};
/**
 * `parties` : d'abord le contenu (une partie `fil: null`, ou une par fil quand il y en a plusieurs), puis les pièces jointes.
 * `autresPieces` : pièces jointes non indexées (binaires sans extracteur, illisibles, trop grosses).
 */
export type FichierDecoupe = { ok: true; format: string; parties: PartieDecoupee[]; autresPieces: string[] } | { ok: false; motif: string };

export interface Extracteurs {
	/** Extracteur dédié au format du fichier (extension en minuscules), sinon celui du texte (qui refuse un binaire). */
	pour(chemin: string): Extracteur;
}

/** Échec d'extraction : message lisible en français, qui nomme le format. */
export class ErreurExtraction extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'ErreurExtraction';
	}
}

/**
 * Une fiche du classement d'un message (`rang` à partir de 1, dans l'ordre du classement) : `note` : la note provisoire qui
 * ordonne (sens du message plus les poids des signaux ; null sans modèle du sens ; dans les entrées anciennes, celle du
 * reranker) ; `servi` : la fiche est déjà injectée dans la session (ou, entrée ancienne, son id est parmi ceux servis).
 * Champs du classement vivant, absents des entrées anciennes : `p` (probabilité de la note apprise ; null tant qu'aucun modèle
 * n'est accepté), `signaux` (bruts, pour l'apprentissage), `deja` (déjà injectée, lue ou proposée dans la session : classée,
 * jamais reproposée), `piste` (proposée en piste à ce message), `raison` (de la carte proposée à ce message, piste ou fiche
 * nommée), `coupees` (sur la dernière ligne gardée seulement : nombre de candidates coupées au-delà de `CLASSEMENT_MAX`).
 */
export type Classe = {
	id: string;
	titre: string;
	note: number | null;
	servi: boolean;
	rang: number;
	p?: number | null;
	signaux?: SignauxBruts;
	deja?: DejaDansLaSession;
	piste?: boolean;
	raison?: RaisonCarte;
	coupees?: number;
};

/** Ce que la session a déjà fait d'une fiche classée : injectée (à cette empreinte), lue, ou proposée en carte (à cette empreinte). */
export type DejaDansLaSession = 'injectee' | 'lue' | 'proposee';

/**
 * Ce que Mnemo a servi à une session (journal borné : les 200 dernières entrées par session). `demande` : la question
 * (prompt, ou objectif au début), non coupée ; `classement` : les candidats de la recherche.
 */
export type EntreeServie = {
	session: string;
	/** `debut` : entrées écrites avant le 2026-11-23, quand le début de session servait un contexte. */
	moment: 'debut' | 'message' | 'apres_outil' | 'contexte';
	horodatageMs: number;
	ids: string[];
	texte: string;
	ms: number;
	sens: boolean;
	demande: string | null;
	classement: Classe[];
	/** Pourquoi le message n'a servi aucun contexte (balise, sans contenu) ; null si le message n'était pas muet. */
	muet: RaisonMuet | null;
	/** Cartes proposées à ce moment, avec la raison de chacune ; `depuis` (raison `liee`) : la fiche injectée à la main d'où vient le poids. */
	cartes: CarteJournalisee[];
	/** Position de la session (relative à `_mnemo/`) à ce moment ; null si inconnue. */
	position: string | null;
	/** Rang du message dans la session, écrit par `journaliser` pour un message porteur ; absent sinon (et dans les entrées anciennes). */
	rangMessage?: number | null;
};
export type { RaisonCarte };
/** Une carte du journal : `depuis` (raison `liee`) : chemin de la fiche injectée à la main d'où vient le poids ; absent sinon (et des entrées anciennes). */
/** `note` : note de la piste quand le sens l'a notée, fiche nommée comprise (absente sans modèle et dans les entrées anciennes). */
export type CarteJournalisee = { chemin: string; raison: RaisonCarte; depuis?: string; note?: number };

/** Un élément écarté par l'utilisateur pour une session (« ne plus suggérer ») : id (une fiche emporte ses éléments), titre. */
export type Ecarte = { id: string; titre: string; horodatageMs: number };

/** `proposee` : une carte de la fiche a été proposée (la fiche n'est ni servie, ni lue, ni écrite). */
export type ActionSurFiche = 'servie' | 'proposee' | 'lue' | 'ecrite';
/**
 * `empreinteInjectee` : empreinte de la fiche lors de sa dernière injection dans la session ; null si jamais injectée (ou après /clear).
 * `empreinteLue` : empreinte de la fiche lors de sa dernière lecture ; null si elle n'a pas été lue, si l'empreinte était inconnue ou si
 * la session l'a écrite depuis (une fiche lue dont l'empreinte est inconnue compte comme vue, quelle que soit sa version).
 */
export type FicheServieLueOuEcrite = {
	chemin: string;
	premiereAction: ActionSurFiche;
	premiereMs: number;
	derniereAction: ActionSurFiche;
	derniereMs: number;
	empreinteInjectee: string | null;
	empreinteLue: string | null;
};

/** Vecteur d'un message par le modèle de sens (`modele` : son identité, `bge-m3@…`). */
export type VecteurDuMessage = { modele: string; valeurs: Float32Array };

/** Le message porteur d'un geste : son texte (coupé à `DEMANDE_MAX` ; null s'il n'est pas connu) et son rang dans la session (`messages_porteurs` à ce message ; 0 : aucun). */
export type MessagePorteur = { texte: string | null; rang: number };

/** Le vecteur du message porteur de rang `rang` : gardé avec un geste seulement si le geste porte ce même message. */
export type VecteurDuPorteur = { rang: number; vecteur: VecteurDuMessage };

/**
 * Un geste à noter au journal durable des gestes. Le reste du contexte est lu dans la session au moment de l'écriture :
 * dossier et position. `porteur` : le message qui porte le geste ; absent : le dernier message porteur de la session (texte
 * et rang gardés ensemble par `noterMessagePorteur`). `note` : ce que Mnemo savait de la fiche ; absente : la note de sa
 * dernière carte notée dans le journal servi de la session. `vecteur` : celui d'un message déjà calculé (jamais calculé pour
 * le geste), écrit seulement s'il est du message porteur du geste. `lue_apres_carte` n'est écrit que si une carte a proposé
 * la fiche dans la session (même avant un /clear) et que la session ne l'a pas déjà lue depuis cette proposition.
 */
export type GesteANoter = {
	geste: Geste;
	session: string;
	fiche: string;
	empreinte: string | null;
	horodatageMs: number;
	porteur?: MessagePorteur;
	note?: NoteDuGeste | null;
	vecteur?: VecteurDuPorteur | null;
};

/**
 * Un geste du journal durable (`rang` : ordre d'écriture). `message` et `vecteur` : null s'il n'y en avait pas, ou si la
 * session a été supprimée ; `rangMessage` : rang du message porteur dans la session.
 */
export type GesteNote = {
	rang: number;
	horodatageMs: number;
	geste: Geste;
	origine: OrigineGeste;
	session: string;
	dossier: string;
	position: string | null;
	fiche: string;
	empreinte: string | null;
	message: string | null;
	rangMessage: number;
	note: NoteDuGeste | null;
	vecteur: VecteurDuMessage | null;
};

export interface EtatSessions {
	creer(s: Session): Promise<void>;
	lire(id: string): Promise<Session | null>;
	/** Les sessions terminées ne sont rendues qu'avec `archivees: true`. */
	lister(options?: { archivees?: boolean }): Promise<Session[]>;
	/**
	 * Applique l'événement seulement si `horodatageMs` > `majMs` ; rend la session après (inchangée si ignoré), null si inconnue.
	 * Le premier `message` après `bilanDemandeMs` d'une session en bilan note `bilanLuMs`. `arret` note `dernierArret`
	 * (`complement.arret`, `stop` par défaut) ; `debut`, `message` et `outil` l'effacent.
	 */
	appliquer(
		id: string,
		e: EvenementHook,
		horodatageMs: number,
		complement?: { objectif?: string; commitDebut?: string | null; branche?: string | null; arret?: CauseArret },
	): Promise<Session | null>;
	/**
	 * Une session `terminee` garde son `etat` et son `arretAttendu` (les autres champs restent modifiables). `niveauModeles` :
	 * null le retire (la session suit le niveau de la machine) ; une valeur qui n'est pas un niveau est ignorée.
	 */
	modifier(
		id: string,
		champs: Partial<
			Pick<
				Session,
				'etat' | 'arretAttendu' | 'pid' | 'bilanDemandeMs' | 'bilanLuMs' | 'commitDebut' | 'branche' | 'demarrageMachineMs' | 'lanceMs' | 'vuVivantMs' | 'episodeMs' | 'position' | 'projet' | 'dossierNonRattache'
			>
		> & { niveauModeles?: NiveauModeles | null },
	): Promise<Session | null>;
	/** Battement : `vuVivantMs` de ces sessions, en une écriture courte ; ne compte pas comme une modification (`derniereModificationMs`). */
	battre(ids: string[], vuVivantMs: number): Promise<void>;
	/** Garde les 200 dernières entrées par session. */
	journaliser(entree: EntreeServie): Promise<void>;
	/**
	 * Remplace le classement de l'entrée de message de la session à cet horodatage (affinage en arrière-plan : mêmes candidates,
	 * notes complétées) ; sans effet si l'entrée n'existe plus. Rend vrai si une entrée a été mise à jour.
	 */
	completerClassement(session: string, horodatageMs: number, classement: Classe[]): Promise<boolean>;
	/** Les `limite` dernières entrées de la session, les plus récentes d'abord ; `moment` : celles de ce moment seulement. */
	servis(session: string, limite: number, moment?: EntreeServie['moment']): Promise<EntreeServie[]>;
	/**
	 * Écarte un élément des prochains calculs de `servir` pour la session (sans effet s'il l'est déjà) et note la trace du
	 * geste (dossier, extrait de la demande, élément, date), gardée après la session, même s'il l'était déjà. `deja_ecarte` :
	 * rien n'a changé ; `terminee` : session inconnue ou terminée.
	 */
	ecarter(session: string, ecarte: { id: string; titre: string }, trace: { dossier: string; demande: string | null; horodatageMs: number }): Promise<'ecarte' | 'deja_ecarte' | 'terminee'>;
	/** Rétablit un écarté ; `non_ecarte` : il ne l'était pas ; `terminee` : session inconnue ou terminée (rien à rétablir). */
	retablir(session: string, id: string): Promise<'retabli' | 'non_ecarte' | 'terminee'>;
	/** Écartés de la session, dans l'ordre où ils l'ont été ; effacés quand elle se termine. */
	ecartes(session: string): Promise<Ecarte[]>;
	/** Note une fiche servie, lue ou écrite par la session ; sans effet pour une session inconnue. `empreinte` : celle de la fiche à l'injection (`servie`) ou à la lecture (`lue`) ; ignorée pour `ecrite`. */
	noterFicheServieLueOuEcrite(session: string, f: { chemin: string; action: Exclude<ActionSurFiche, 'proposee'>; horodatageMs: number; empreinte: string | null }): Promise<void>;
	/** Fiches servies, lues ou écrites par la session, dans l'ordre de leur entrée. */
	fichesServiesLuesOuEcrites(session: string): Promise<FicheServieLueOuEcrite[]>;
	/**
	 * Après /clear ou /compact, Claude n'a plus les fiches injectées : elles redeviennent à servir, et les fiches injectées à la main
	 * ne pèsent plus sur leurs voisines.
	 */
	oublierInjections(session: string): Promise<void>;
	/**
	 * Un message porteur (non muet) de la session : les fiches injectées à la main vieillissent d'un message ; son texte (coupé à
	 * `DEMANDE_MAX`) et son rang sont gardés comme dernier message porteur (gestes). Rend son rang ; null pour une session inconnue.
	 */
	noterMessagePorteur(session: string, texte: string): Promise<number | null>;
	/** Note une fiche injectée à la main au message courant de la session (âge 0 ; réinjectée : son âge repart de 0) ; sans effet pour une session inconnue. */
	noterInjectionManuelle(session: string, chemin: string): Promise<void>;
	/** Fiches injectées à la main depuis le dernier /clear ou /compact, avec leur âge en messages porteurs (0 : injectée au message courant). */
	injectionsManuelles(session: string): Promise<InjectionManuelle[]>;
	/** Note une carte proposée à la session (l'empreinte est celle de la fiche) et l'ajoute au journal des actions ; sans effet pour une session inconnue. */
	noterCarteProposee(session: string, c: { chemin: string; empreinte: string; horodatageMs: number }): Promise<void>;
	/** Cartes proposées à la session depuis le dernier /clear ou /compact : chemin → empreinte. */
	cartesProposees(session: string): Promise<Map<string, string>>;
	/** Instant où les cartes du périmètre ont été proposées depuis le dernier /clear ou /compact ; null sinon. */
	perimetrePropose(session: string): Promise<number | null>;
	noterPerimetrePropose(session: string, horodatageMs: number): Promise<void>;
	/** Journal des actions sur les fiches de la session (proposée, servie, lue, écrite), dans l'ordre où elles ont eu lieu. */
	actions(session: string): Promise<{ chemin: string; action: ActionSurFiche; horodatageMs: number }[]>;
	/**
	 * Sessions encore connues à qui la fiche `chemin` (ou un de ses éléments, ids `chemin#…`) a été servie, avec l'instant du
	 * dernier service ; les plus récentes d'abord, `limite` au plus (null : toutes) ; `total` les compte toutes.
	 */
	sessionsAyantServi(chemin: string, limite: number | null): Promise<{ sessions: { session: Session; horodatageMs: number }[]; total: number }>;
	/**
	 * Retire de l'historique une session terminée : elle, ses entrées servies, ses écartés et leurs traces, en une transaction ;
	 * ses gestes restent au journal durable, sans le texte ni le vecteur de leur message. `non_terminee` : rien n'est supprimé.
	 */
	supprimer(id: string): Promise<'supprimee' | 'inconnue' | 'non_terminee'>;
	/**
	 * Note un geste au journal durable des gestes (sans limite de nombre, gardé après /clear, /compact et la fin de la
	 * session ; `supprimer` n'en efface que le texte et le vecteur du message) ; sans effet pour une session inconnue.
	 */
	noterGeste(geste: GesteANoter): Promise<void>;
	/** Nombre de gestes par sorte et par fiche, sans lire messages ni vecteurs. */
	comptesGestes(): Promise<GesteCompte[]>;
	/** Gestes du journal durable, les plus récents d'abord : ceux de `fiche`, depuis `depuisMs` (inclus), `limite` au plus (null : tous). */
	gestes(filtre: { fiche?: string; depuisMs?: number; limite: number | null }): Promise<GesteNote[]>;
	/** Instant de la dernière écriture, toutes sessions confondues (0 si aucune). */
	derniereModificationMs(): Promise<number>;
	/**
	 * Dossiers de projet (relatifs à la racine) vus sans lien vers la mémoire : `rattache` faux l'ajoute (premier `vuMs` gardé),
	 * vrai le retire. N'écrit que si la liste change.
	 */
	noterRattachement(dossier: string, rattache: boolean, vuMs: number): Promise<void>;
	/** Dossiers notés sans lien, les plus anciens d'abord. */
	dossiersNonRattaches(): Promise<{ dossier: string; vuMs: number }[]>;
	fermer(): void;
}

/**
 * Le dépôt git d'un dossier de session, en lecture. `dossier` : relatif à la racine du dossier Mnemo (« / »), ou absolu.
 * Jamais de shell ; chaque appel est borné dans le temps (au-delà, ou sur toute erreur de git : rejeté).
 */
export interface Depot {
	/** Branche courante (null : tête détachée) et commit de tête (null : dépôt sans commit) ; null : pas un dépôt git. */
	etat(dossier: string): Promise<{ branche: string | null; commit: string | null } | null>;
	/**
	 * Fichiers suivis modifiés depuis le commit `depuis` (null : depuis la tête), validés ou non, puis fichiers non suivis
	 * (hors ignorés) ; relatifs à la racine du dépôt, en « / », sans doublon ; `fichiers` : `limite` au plus, `total` : leur
	 * nombre réel. Pas un dépôt : aucun fichier.
	 */
	fichiersModifies(dossier: string, depuis: string | null, limite: number): Promise<{ fichiers: string[]; total: number }>;
	/**
	 * État de l'arbre de travail (`git status --porcelain=v1 -z`) limité à `dossier` : chemins relatifs à `dossier` (« / »),
	 * `M` modifié, `A` ajouté ou non suivi, `D` supprimé ; `fichiers` : `limite` au plus, `total` : leur nombre réel. Null : pas un dépôt.
	 */
	statuts(dossier: string, limite: number): Promise<{ fichiers: { chemin: string; statut: 'M' | 'A' | 'D' }[]; total: number } | null>;
}

/** Lancement d'un processus dans un pseudo-terminal : jamais par un shell. `dossier` : absolu. */
export type OptionsTerminal = { commande: string; args: string[]; dossier: string; env: Record<string, string>; colonnes: number; lignes: number };

/** Un processus dans un pseudo-terminal (il mène son groupe de processus sous POSIX). */
export interface Terminal {
	pid: number;
	ecrire(d: string): void;
	redimensionner(c: number, l: number): void;
	/** Rend la fonction qui désabonne. */
	surSortie(f: (d: string) => void): () => void;
	/** `code` : null si le processus a été tué par un signal. Appelée aussitôt s'il est déjà fini. */
	surFin(f: (code: number | null) => void): void;
	/**
	 * Ctrl-U puis `/exit`, puis SIGTERM au groupe après `delaiMs`, puis SIGKILL 3 s plus tard ; résout quand le processus est
	 * mort. `echap` (un dialogue de permission est peut-être ouvert) : Échap d'abord, puis `PAUSE_APRES_ECHAP_MS`.
	 */
	arreter(delaiMs?: number, options?: { echap?: boolean }): Promise<void>;
}

/**
 * Après un Échap envoyé pour fermer un dialogue de Claude Code (permission), avant toute autre touche. Un seul Échap, et
 * seulement quand le dernier arrêt est une `Notification` : deux Échap de suite ouvrent le retour arrière de Claude Code.
 */
export const PAUSE_APRES_ECHAP_MS = 150;

export interface Terminaux {
	/** `ok: false` : mode dégradé (node-pty absent ou illoadable), avec le motif lisible. */
	disponibles(): { ok: true } | { ok: false; motif: string };
	lancer(o: OptionsTerminal): Terminal;
}

/**
 * Ce que le service pilote. `plugin` : écriture du plugin d'une session (rend son dossier absolu), son retrait (session
 * retirée de l'historique ; absent : rien à faire), appel des hooks
 * (`<node> <main.ts> hook …`), commande de `claude` (null : introuvable), racine absolue du dossier Mnemo. `hote` : ce que
 * l'application ne peut pas lire elle-même — l'environnement de l'utilisateur, la plateforme (ligne de commande manuelle),
 * un dossier relatif à la racine (`absolu`, et `reel` : son chemin réel, liens résolus, relatif à la racine réelle, en « / » ;
 * null s'il n'existe pas ou sort de la racine), l'état d'un pid enregistré (`mort`, `session` : vivant et lancé pour cette
 * session, `autre` : vivant mais pas à nous ou invérifiable), le démarrage de la machine, et le nettoyage des restes prouvés
 * d'un pid mort.
 */

export type Pilotage = {
	etat: EtatSessions;
	terminaux: Terminaux;
	/** Dépôt git des dossiers de session : branche et commit au début, fichiers modifiés à la fin (épisode minimal). */
	depot: Depot;
	plugin: {
		ecrire(session: string, f: FichierPlugin[]): Promise<string>;
		retirer(session: string): Promise<void>;
		appel: AppelPlugin;
		claude: { commande: string; avant: string[] } | null;
		racine: string;
	};
	hote: {
		env: Record<string, string | undefined>;
		plateforme: string;
		dossier(relatif: string): Promise<{ absolu: string; reel: string } | null>;
		processus(pid: number, session: string): Promise<'mort' | 'session' | 'autre'>;
		/** Démarrage de la machine (ms, à la seconde) : enregistré au lancement, comparé au nettoyage. */
		demarrageMachineMs(): number;
		/**
		 * Restes prouvés d'une session dont le chef est mort (plantage du service) : seulement les membres de son groupe nés
		 * entre son lancement et son dernier battement, sur la même machine depuis le même démarrage ; signalés un par un.
		 */
		nettoyerRestes(s: Session): Promise<void>;
	};
};
