/**
 * Contrat de l'API du service Mnemo : types et constantes seulement, ne dépend que de `@mnemo/commun`. L'application ne
 * l'importe pas ; seuls l'adaptateur HTTP du service et ses clients (interface web) s'y réfèrent, et, pour les sorties
 * `--json` de `mnemo init`, `mnemo verifier-poste` et `mnemo declarer`, la CLI et les programmes qui les lisent.
 */
import type { AvancementModele, AvecAvertissements, Avatar, GroupeReglage, IdMoteur, LanceurDeProfil, NiveauModeles, OperationModele, RaisonCarte } from '@mnemo/commun';

export type EtatSessionVue = 'travaille' | 'attend' | 'a_relire' | 'en_pause' | 'terminee';

export type SessionVue = {
	id: string;
	profil: string;
	/** Relatif à la racine du dossier Mnemo ; '' = la racine. */
	dossier: string;
	position: string;
	/** Dossier d'épisodes. */
	projet: string;
	/** Dossier qu'aucune fiche ne couvre (`dossier_projet`) : le texte qui le dit, rédigé par le service ; null s'il est rattaché. */
	dossierNonRattache: string | null;
	objectif: string | null;
	etat: EtatSessionVue;
	creeeMs: number;
	majMs: number;
	bilanDemandeMs: number | null;
	commitDebut: string | null;
	branche: string | null;
	/** Vrai si un terminal est attaché à la session dans le service. */
	terminal: boolean;
	/** Vrai si un dialogue de Claude Code (permission) attend l'utilisateur ; `attend` seul est aussi l'état de repos. */
	dialogueOuvert: boolean;
	/** Niveau des modèles propre à la session ; null : elle suit le niveau de la machine (le plus restrictif des deux s'applique). */
	niveauModeles: NiveauModeles | null;
};

/**
 * Un profil de session qui peut être lancé : `description`, première ligne de sa consigne ; `lancement` : `projet` (dans le
 * dossier choisi) ou `memoire` (dans `_mnemo/`, quel que soit le dossier) ; `lanceur` : `dialogue` (choix de Nouvelle
 * session) ou `propre` (son propre chemin, montré à part) ; `moteur` et `modele` (« » : celui par défaut du moteur) de ses
 * sessions.
 */
export type ProfilVue = { nom: string; description: string; lancement: 'projet' | 'memoire'; lanceur: LanceurDeProfil; avatar: Avatar; personnalise: boolean; moteur: IdMoteur; modele: string };

/**
 * Ce qui se règle d'un profil dans Réglages › Profils ; `consigne` : `null` = la consigne par défaut du code ; `moteur` : l'agent
 * de code de ses sessions ; `modele` : « » = le modèle par défaut du moteur ; `plugins` (Claude Code) : vide avec un autre moteur.
 */
export type ProfilEditableVue = {
	avatar: Avatar;
	consigne: string | null;
	lancement: 'projet' | 'memoire';
	hooks: EvenementHookVue[];
	skillsMemoire: 'tous' | string[];
	plugins: string[];
	moteur: IdMoteur;
	modele: string;
};

/** Événement de hook de Mnemo qu'un profil peut déclarer. */
export type EvenementHookVue = 'debut' | 'message' | 'outil' | 'apres_outil' | 'arret' | 'fin';

/** Une skill (de la mémoire, d'un profil ou d'un plugin) : son nom et sa description. */
export type SkillVue = { nom: string; description: string };

/** Un plugin Claude Code installé ; `hooks` : il déclare ses propres hooks. */
export type PluginInstalleVue = { id: string; nom: string; version: string; portee: string; skills: SkillVue[]; hooks: boolean };

/**
 * Réponse de `profil` GET : ce qui se règle, la consigne effective et celle par défaut, ce qui peut être choisi (skills,
 * plugins installés). `empreinte` : à renvoyer au `PUT` (null : la fiche n'existe pas encore).
 */
export type ProfilDetailVue = {
	nom: string;
	editable: ProfilEditableVue;
	consigneEffective: string;
	consigneParDefaut: string;
	supprimable: boolean;
	lancementModifiable: boolean;
	empreinte: string | null;
	skillsMemoireDisponibles: SkillVue[];
	skillsDuProfil: SkillVue[];
	pluginsInstalles: PluginInstalleVue[];
	avertissements: string[];
};

/** Corps de `profil` PUT : le profil réglé et l'empreinte de la fiche lue. */
export type EnregistrementProfil = { editable: ProfilEditableVue; empreinte: string | null };

/** Réponse d'une écriture de profil réussie ; `commit` null quand rien n'a changé. */
export type ReponseEcritureProfil = { commit: string | null };

/** Refus d'une écriture de profil (400) : un motif par champ. */
export type RefusProfil = { erreur: string; motifs: Record<string, string> };

/** Bloc de l'aperçu d'un profil : origine, titre, texte reçu tel quel ou liste d'éléments ; `reglable` : il se règle dans le profil. */
export type BlocApercuVue = {
	origine: 'profil' | 'mnemo' | 'memoire' | 'plugin' | 'hors_mnemo' | 'systeme';
	titre: string;
	reglable: boolean;
	texte?: string;
	elements?: { nom: string; detail: string; actif: boolean }[];
};

/** Remplissage de la fenêtre de contexte de Claude Code d'une session (tokens), lu dans sa transcription. */
/** `avantResume` : `max` est le seuil de résumé automatique de Claude Code. */
export type FenetreVue = { utilises: number; max: number; avantResume?: true };

/** Réponse de `fenetres` GET : la fenêtre connue de chaque session (id → fenêtre), depuis le démarrage du service. */
export type ReponseFenetres = { fenetres: Record<string, FenetreVue> };

/** Une fenêtre de quota du compte Claude : part consommée (0 à 100) et instant de sa remise à zéro (ms depuis l'époque). */
export type QuotaVue = { pourcentage: number; remiseMs: number };

/**
 * Quotas du compte Claude (abonnement Pro, Max ou Ultra), tels que la dernière ligne d'état d'une session les a transmis :
 * communs à toutes les sessions. Une fenêtre absente est inconnue (pas encore de réponse de Claude, ou compte sans quota).
 */
export type QuotasVue = { cinqHeures?: QuotaVue; semaine?: QuotaVue };

/** Réponse de `quotas` GET : les derniers quotas reçus depuis le démarrage du service, null avant. */
export type ReponseQuotas = { quotas: QuotasVue | null };

/** Fiches demandées à injecter dans une session (« Injecter dans la session »), injectées au prochain message de la session. */
export type ReponseAServir = { chemins: string[] };

/** Réponse de `profilApercu` GET : ce que reçoit une session du profil, bloc par bloc. */
export type ApercuProfilVue = { blocs: BlocApercuVue[]; avertissements: string[] };

/**
 * Réponse de `profils` : les profils triés par nom ; les dossiers de `profils/` dont le nom est refusé, avec le motif ; les
 * profils lus autrement qu'ils ne se déclarent (`avertissements`), avec le motif.
 */
export type ReponseProfils = { profils: ProfilVue[]; ignores: { nom: string; motif: string }[]; avertissements: { nom: string; motif: string }[] };

/**
 * Une session terminée, dans l'historique : la vue de la session, et son `episode` dans la mémoire (bilan de Claude, ou
 * épisode minimal écrit sans IA : `minimal`) s'il existe.
 */
export type SessionTermineeVue = SessionVue & { episode: { chemin: string; titre: string; minimal: boolean } | null };

/**
 * Un document référencé dans la mémoire : fiche `source`, où qu'elle soit rangée (`chemin`, `titre`), fichier qu'elle décrit
 * (`document`, relatif à la racine du dossier Mnemo ; null : note importée sans fichier), `date` de la fiche (AAAA-MM-JJ),
 * `aTraiter` : marquée « à traiter » (l'archiviste ne l'a pas encore traitée).
 */
export type DocumentVue = { chemin: string; titre: string; document: string | null; date: string; aTraiter: boolean };

/**
 * Un dossier de projet (relatif à la racine du dossier Mnemo) où une session a tourné sans qu'aucune fiche le couvre
 * (`dossier_projet`), et le texte qui le dit, rédigé par le service.
 */
export type DossierNonRattacheVue = { dossier: string; texte: string };

/**
 * Réponse de `documents` : les documents récents (`DOCUMENTS_MAX` au plus) et les fiches « à traiter » (`A_TRAITER_MAX` au
 * plus), tous avec `PARAMETRES_TOUT` ; `totalDocuments`, `totalATraiter` : combien il y en a, listés ou non ; les dossiers
 * non rattachés, les plus anciens d'abord ; les `avertissements` de ce qui n'a pas pu être lu (texte du service).
 */
export type ReponseDocuments = {
	documents: DocumentVue[];
	aTraiter: DocumentVue[];
	totalDocuments: number;
	totalATraiter: number;
	dossiersNonRattaches: DossierNonRattacheVue[];
	avertissements: string[];
};


/**
 * Une fiche du classement d'un calcul de `servir` (une ligne par fiche ; `id` : son chemin) : `rang` à partir de 1 ; `note`
 * du reranker dans [0, 1] (meilleure de ses éléments) quand il a tourné, sinon null ;
 * `servi` : elle ou un de ses éléments a été servi à Claude (sinon seulement classée).
 */
export type ClassementVue = { id: string; titre: string; note: number | null; servi: boolean; rang: number };

/** Sous cette note, un candidat noté n'est pas affiché. */
export const SEUIL_NOTE_CLASSEMENT = 0.05;

/** Pourquoi une carte est proposée : fiche du périmètre de la position, fiche nommée dans le message, fiche proche de la question, fiche liée à une fiche injectée à la main. */
export type RaisonCarteVue = RaisonCarte;

/**
 * Une carte proposée (◇) : `id` (chemin de la fiche), `titre`, `raison` ; `depuis` (raison `liee`) : la fiche injectée à la main
 * d'où vient le poids qui l'a fait proposer (absent des entrées anciennes) ; `note` : note de la piste quand le sens l'a notée (sens ou
 * reranker plus les poids, peut dépasser 1 ; une fiche nommée a la sienne ; absente sans modèle et dans les entrées anciennes ; `sens` faux
 * de l'entrée : calcul sans modèle du sens, que le panneau Contexte signale).
 */
export type CarteVue = { id: string; titre: string; raison: RaisonCarteVue; depuis?: { id: string; titre: string }; note?: number };

/**
 * Ce que Mnemo a servi à une session : `ids` servis (la fiche de position, ◆), `cartes` proposées (◇) avec leur raison, `muet` (pourquoi
 * le message n'a rien proposé : `balise` message système, `sans_contenu` message sans contenu ; null sinon), `texte` rendu. `classement`
 * ne sert plus qu'aux entrées anciennes (vide aujourd'hui) ; `moment` `apres_outil` et `debut` aussi. Une entrée peut être rediffusée
 * (`servi`), même `horodatageMs`.
 */
export type EntreeServieVue = {
	session: string;
	/** `debut` : entrées écrites avant le 2026-11-23, quand le début de session servait un contexte. */
	moment: 'debut' | 'message' | 'apres_outil' | 'contexte';
	horodatageMs: number;
	ids: string[];
	texte: string;
	ms: number;
	sens: boolean;
	classement: ClassementVue[];
	muet: 'balise' | 'sans_contenu' | null;
	cartes: CarteVue[];
	/** Titre des fiches de `ids` (chemin → titre) ; absent des entrées anciennes. */
	titres?: Record<string, string>;
};

/** Une fiche lue par la session (outil `lire`) : son chemin et l'heure de sa dernière lecture. */
export type LueVue = { chemin: string; horodatageMs: number };

/**
 * Un modèle local : `absent` (lui ou le moteur non installé), `exclu` (installé, mais exclu par le niveau de la machine),
 * `arrete` (permis, aucun serveur prêt : en veille ou en chargement), `pret` (servi, et le serveur a prouvé son identité).
 */
export type EtatModeleVue = 'absent' | 'exclu' | 'arrete' | 'pret';

/** Un modèle installé : nom, éditeur, quantification, taille du fichier, début (8 caractères) de son SHA-256. */
export type PieceModeleVue = { modele: string; editeur: string; quantification: string; octets: number; empreinte: string };

/**
 * Un appel en cours aux modèles, sur toute la machine : ce qu'il fait, sa session (null : hors session, ou inconnue),
 * `ceDossier` (fait pour le dossier Mnemo de ce service, ou pour un autre), son début, et l'avancement d'une vectorisation
 * (`total` null : pas encore compté).
 */
export type ActiviteModeleVue = { operation: OperationModele; session: string | null; ceDossier: boolean; depuisMs: number; avancement: AvancementModele | null };

/**
 * Réponse de `modelesArreter` : la vue, et ce que l'arrêt a fait : `arrete`, `rien` (rien en marche), ou `{ enChargement }`
 * (des serveurs chargeaient encore : laissés, à arrêter de nouveau dans un instant).
 */
export type ReponseArretModeles = EtatModelesVue & { arret: 'arrete' | 'rien' | { enChargement: number } };

/** Réponse de `modelesNiveau` : la vue, et l'arrêt qu'a causé un modèle retiré (null : aucun, le niveau n'en retire pas). */
export type ReponseNiveauModeles = EtatModelesVue & { arret: ReponseArretModeles['arret'] | null };

/**
 * Les modèles locaux de la machine (partagés par tous les dossiers Mnemo) : `installes` (le moteur et au moins un modèle),
 * `niveau` de la machine, `gardien` (`arrete` : aucun ; `demarrage` : modèles en chargement ; `pret` ; `echec` : le dernier
 * démarrage a échoué, il y a moins d'une minute), l'état de chaque modèle, les pièces installées (null : absente), et les
 * appels en cours, du plus ancien au plus récent.
 */
export type EtatModelesVue = {
	installes: boolean;
	niveau: NiveauModeles;
	gardien: 'arrete' | 'demarrage' | 'pret' | 'echec';
	/** Arrêt après tant de minutes sans requête, celui du gardien en marche ; null quand il est arrêté (ou pas encore publié). */
	inactiviteMinutes: number | null;
	sens: EtatModeleVue;
	reranker: EtatModeleVue;
	pieces: { sens: PieceModeleVue | null; reranker: PieceModeleVue | null; moteur: { version: string; plateforme: string } | null };
	activites: ActiviteModeleVue[];
};

/** Un élément écarté pour une session (« ne plus suggérer ») : une fiche emporte ses éléments. Effacé à la fin de la session. */
export type EcarteVue = { id: string; titre: string; horodatageMs: number };

/** Du service vers le client (WebSocket). */
export type MessageServeur =
	| { type: 'session'; session: SessionVue }
	| { type: 'sessions'; sessions: SessionVue[] }
	| { type: 'sortie'; session: string; donnees: string }
	| { type: 'relecture'; session: string; donnees: string }
	| { type: 'servi'; entree: EntreeServieVue }
	| { type: 'ecartes'; session: string; ecartes: EcarteVue[] }
	| { type: 'aServir'; session: string; chemins: string[] }
	/** Fiches lues par la session (après un outil qui en a lu une) : la liste entière, comme `lues` de la route `servis`. */
	| { type: 'lues'; session: string; lues: LueVue[] }
	| { type: 'fenetre'; session: string; fenetre: FenetreVue }
	| { type: 'quotas'; quotas: QuotasVue }
	/** L'état des modèles locaux a changé (niveau, gardien, appels en cours) : la vue entière, comme `GET modeles`. */
	| { type: 'modeles'; modeles: EtatModelesVue }
	| { type: 'memoire'; modifieeMs: number }
	/** Les lots d'informations ont changé (proposé par l'archiviste, validé, rejeté, écarté) : relire `GET lots`. */
	| { type: 'lots'; version: string }
	| { type: 'retard'; session: string };

/** Du client vers le service (WebSocket). */
export type MessageClient =
	| { type: 'abonner'; session: string }
	| { type: 'desabonner'; session: string }
	| { type: 'entree'; session: string; donnees: string }
	| { type: 'taille'; session: string; colonnes: number; lignes: number };

/**
 * Chemins de l'API HTTP du service (JSON ; erreur : `{ erreur }` en français). Jeton exigé partout sous `/api/` :
 * `Authorization: Bearer`. Les bornes des listes (`…_MAX`) sont les constantes de `@mnemo/commun`. Une ligne par route :
 * - `sante` GET → `SanteVue` ;
 * - `sessions` GET → `{ sessions: SessionVue[] }` (`?archivees=1` : terminées comprises) ; POST `{ profil?, dossier, objectif? }` (`profil` absent : `PROFIL_TRAVAIL`)
 *   → 201 `ReponseLancement` (`manuel` : ligne de commande à coller, mode dégradé) ;
 * - `session` GET → `{ session }` ; DELETE → `{ id }` : retire de l'historique une session terminée (son état chez Mnemo et
 *   son plugin ; jamais la transcription de Claude Code ni la mémoire) ; 409 si elle n'est pas terminée ou si son terminal tourne ;
 * - `historique` GET → `{ sessions: SessionTermineeVue[] }` : les sessions terminées, plus récentes d'abord ;
 * - `profils` GET → `ReponseProfils` : les profils du paquet et ceux de `profils/` ;
 * - `profil` GET → `ProfilDetailVue` (404 inconnu) ; PUT `EnregistrementProfil` → `ReponseEcritureProfil` (400 `RefusProfil`, 409 la fiche a changé) ; DELETE → `ReponseEcritureProfil` ;
 * - `profilDupliquer` POST `{ nom }` → `ReponseEcritureProfil` (201) ; `profilApercu` GET `?projet=` → `ApercuProfilVue` ;
 * - `pause` POST → `{ session }` ;
 * - `reprise` POST → `{ session }` ;
 * - `bilan` POST → `{ session }` : Claude rédige l'épisode ;
 * - `abandon` POST → `{ session }` : terminée sans bilan ;
 * - `servis` GET → `{ servis: EntreeServieVue[]; lues: LueVue[] }` (panneau Contexte ; seule la plus récente porte son classement d'une entrée ancienne ; `lues` : fiches que la session a lues, avec l'heure de leur dernière lecture, la plus récente d'abord ; un service plus ancien envoie des chemins seuls) ;
 * - `ecartes` GET → `{ ecartes: EcarteVue[] }` ; POST `{ id }` (un id des classements récents de la session : 404 sinon ; 409
 *   session terminée) écarte cet élément des prochains calculs de la session ; DELETE `?id=` le rétablit (409 session
 *   terminée) ; les deux rendent `{ ecartes }` et diffusent `ecartes` (aussi diffusé vide quand la session se termine) ;
 * - `aServir` GET → `ReponseAServir` ; POST `{ chemin }` (une fiche indexée : 404 sinon ; 409 session terminée) → `ReponseAServir` ; DELETE `?chemin=` → `ReponseAServir` : fiches injectées entières au prochain message de la session (message `aServir` diffusé) ;
 * - `fenetres` GET → `ReponseFenetres` : la fenêtre de contexte connue de chaque session (message `fenetre` à chaque changement) ;
 * - `quotas` GET → `ReponseQuotas` ; POST `{ rate_limits }` (de `mnemo ligne-etat`, tel que Claude Code le donne à sa ligne
 *   d'état) → `ReponseQuotas` : les quotas du compte, diffusés (message `quotas`) quand ils changent ; 400 sans fenêtre lisible ;
 * - `modeles` GET → `EtatModelesVue` (envoyée aussi, message `modeles`, à l'accueil d'un client WebSocket et à chaque
 *   changement : niveau, gardien, appels en cours) ;
 * - `modelesDemarrer` POST → `EtatModelesVue` : lance les modèles installés et permis par le niveau (geste de l'utilisateur ;
 *   sans attendre leur chargement ; même dans la minute qui suit un échec) ;
 * - `modelesArreter` POST → `ReponseArretModeles` : arrête les modèles de la machine sans changer le niveau (le prochain usage les
 *   relance) ;
 * - `modelesNiveau` PUT `{ niveau: NiveauModeles }` → `ReponseNiveauModeles` : niveau de la machine (un niveau qui retire un
 *   modèle arrête les modèles en marche, `arret` dit ce que cet arrêt a fait ; un niveau qui en ajoute ne lance rien,
 *   `arret` null) ; 400 : niveau invalide ;
 * - `sessionModeles` PUT `{ niveau: NiveauModeles | null }` (null : suivre le niveau de la machine) → `{ session }` : niveau
 *   propre à la session, valable dès son prochain appel aux modèles (message `session` diffusé) ; 400 : niveau invalide ;
 *   404 : session inconnue ; 409 : session terminée ;
 * - `hook` POST : un événement de `mnemo hook`, avec `echeanceMs` facultatif (instant où le hook cesse d'attendre : au-delà, rien
 *   n'est noté servi ; absent, une attente prudente est supposée) et `transcription` facultatif (chemin de la transcription de
 *   Claude Code, lu pour la seule jauge de la fenêtre de contexte) ;
 * - `memoire` : préfixe des routes de la mémoire, pas une route ;
 * - `memoireListe` GET `?dossier=` ;
 * - `memoireElement` GET `?id=` ;
 * - `documents` GET `?tout=1` facultatif → `ReponseDocuments` (`documents` : fiches de type `source`, où qu'elles soient rangées, plus récentes d'abord,
 *   `DOCUMENTS_MAX` au plus ; `aTraiter` : celles marquées « à traiter », `A_TRAITER_MAX` au plus ; sans borne avec `tout`) ;
 * - `recherche` GET → `ReponseRecherche` (paramètres et en-tête : voir `ReponseRecherche`) ;
 * - `voisins` GET `?id=` ;
 * - `proposer` POST (une demande) → `ResultatEcriture` ;
 * - `lots` GET → `ReponseLots` : les lots d'informations en attente de l'utilisateur, les plus anciens d'abord ;
 * - `lotValider` POST `{ lignes: number[] }` (indices des lignes cochées, de 0 à n − 1 ; au moins une, sans doublon) →
 *   `ReponseValidationLot` : les lignes s'appliquent en un commit (400 : corps ou choix invalide, ou lignes qui ne
 *   s'appliquent pas, le lot restant en attente ; 404 : lot inconnu ou déjà décidé ; 409 : la fiche a changé depuis la
 *   proposition, le lot est écarté et l'archiviste le reproposera) ; canal de l'utilisateur seulement ;
 * - `lotRejeter` POST (corps vide ou `{}`) → `ReponseRejetLot` : le lot disparaît, rien n'est écrit (404 : inconnu ou déjà décidé) ;
 * - `deplacer` POST `{ id, dossier, nom? }` → `ResultatEcriture` (`fiche` : le nouveau chemin ; la fiche d'un dossier emporte tout son dossier) ;
 * - `fil` GET `?jour=AAAA-MM-JJ` → `FilVue` ;
 * - `graphe` GET → `DonneesGraphe` ;
 * - `fiche` GET `?chemin=` (et `tout=1` : toutes ses sessions) → `FicheVue` (404 : la fiche n'existe pas) ;
 * - `brut` POST `{ chemin, texte, empreinte }` → `ResultatEcriture` (409 : la fiche a changé depuis la lecture ; 400 : refusée) ;
 * - `dossiers` GET `?chemin=` (relatif à la racine ; absent ou vide : la racine) → `NiveauDossiersVue` : ce dossier et ses
 *   sous-dossiers directs (400 : chemin refusé ; 404 : dossier absent ou illisible) ;
 * - `dossierGit` GET `?chemin=` (et `PARAMETRES_TOUT` : tous les fichiers) → `GitDossierVue` ;
 * - `depot` POST `?vers=<chemin relatif>`, corps brut ≤ `TAILLE_MAX_DOCUMENT` (`@mnemo/commun`), écrit en flux → 201 `ReponseDepot` (400 :
 *   chemin refusé, dont un nom qui contient `CARACTERES_INVISIBLES` de `@mnemo/commun` ; 409 : le fichier existe déjà ; 413 : trop gros, annoncé
 *   ou constaté en cours d'envoi ; 507 : place insuffisante ou disque plein ; rien n'est gardé) ; le document est référencé
 *   par une fiche `source` marquée « à traiter », en un commit ;
 * - `depotVerifier` GET `?vers=&taille=` → `{ chemin }` : les mêmes refus (400, 409, 413, 507) avant l'envoi, sans corps —
 *   l'interface le demande d'abord, pour que le refus lui arrive intact ;
 * - `depotTraiter` POST `{ chemins }` (documents déposés d'un lot, `CHEMINS_LOT_MAX` au plus) → `ReponseDepotTraiter` : une seule consigne
 *   pour le lot, à l'archiviste qui tourne ;
 * - `amorce` POST → `BilanAmorceVue` : importe la mémoire de Claude Code (notes `projects/<projet>/memory/<note>.md`,
 *   CLAUDE.md global) et référence les CLAUDE.md et `.claude/*.md` des projets, en un commit ; les fiches nouvelles ou
 *   modifiées sont marquées « à traiter » et une seule consigne part à l'archiviste qui tourne (sinon à son lancement) ;
 * - `sourcesTraiter` POST `{ chemins }` (fiches `source`, `CHEMINS_LOT_MAX` au plus) → `ReponseTraiter` : la consigne de l'import, qui
 *   nomme ces fiches, part à l'archiviste (repris, ou lancé, s'il ne tourne pas) ; 409 si aucune n'est à traiter ;
 * - `sourcesTraiterToutes` POST `{ sauf }` (fiches déjà confiées, à laisser de côté, `SAUF_MAX` au plus) → `ReponseTraiter` :
 *   toutes les autres fiches marquées « à traiter », listées ou non par l'interface, en une consigne qui les nomme jusqu'à
 *   `CONSIGNE_CHEMINS_MAX` ; au-delà, elle désigne la marque « à traiter » et l'archiviste peut y retrouver des fiches de
 *   `sauf` ; 409 si aucune n'est à traiter ;
 * - `dossiersTraiter` POST `{ chemins }` (dossiers non rattachés, `CHEMINS_LOT_MAX` au plus) → `ReponseTraiter` : la consigne
 *   qui demande à l'archiviste de poser leur `dossier_projet` part comme celle de `sourcesTraiter` ; 409 si aucun n'est à rattacher ;
 * - `sourcesMarquerTraite` POST `{ chemins }` → `ReponseMarquerTraite` : retire la marque « à traiter » sans rien créer
 *   (un commit par fiche ; celles déjà traitées sont ignorées) ;
 * - `reglages` GET → `ReglagesVue` ; PUT `{ valeurs: { "<cle>": valeur | null } }` → `ReglagesVue` (voir `ReglagesVue`) ;
 * - `claudeDesktop` GET → `ClaudeDesktopVue` : la configuration de l'app Claude (Claude Desktop), sans valeur de variable ;
 * - `claudeDesktopMnemo` PUT (sans corps) → `ClaudeDesktopVue` : branche ou met à jour l'entrée `mnemo` ; DELETE → `ClaudeDesktopVue` : la retire ;
 * - `claudeDesktopServeurs` POST `ServeurMcpEcriture` → 201 `ClaudeDesktopVue` : ajoute un serveur (409 : nom déjà pris) ;
 * - `claudeDesktopServeur` PUT `ServeurMcpEcriture` → `ClaudeDesktopVue` : modifie le serveur `:id` (renommé si `nom` diffère ;
 *   404 inconnu, 409 nouveau nom déjà pris) ; DELETE → `ClaudeDesktopVue` : le retire, quelle que soit sa forme (404 inconnu) ;
 *   écritures refusées (409) si l'app Claude n'est pas installée ou si son fichier est illisible (jamais réécrit) ; 400 : demande invalide ;
 * - `ws` : WebSocket (`MessageServeur`, `MessageClient`) ; jeton en sous-protocole `PREFIXE_JETON_WS` + jeton (avec
 *   `PROTOCOLE_WS`, que le service choisit), sinon en `?jeton=` (ligne de commande ; l'interface ne l'envoie jamais).
 * Hors de `/api/` et de `/ws`, le service sert l'interface (`/`, `/assets/…`) sans jeton.
 */
/**
 * En-tête de clé de remplacement d'une recherche complète (`<onglet>:<consommateur>`, ex. `…:palette`) : une recherche de
 * même clé remplace la précédente, qui reçoit 409. Sans l'en-tête (outils, CLI), jamais remplacée.
 */
export const ENTETE_REMPLACEMENT = 'X-Mnemo-Remplacement';

/** Sous-protocole WebSocket de l'interface, choisi par le service. */
export const PROTOCOLE_WS = 'mnemo';
/** Préfixe du sous-protocole qui porte le jeton (`mnemo.jeton.<64 hex>`) : le jeton n'est ni dans l'adresse, ni dans un journal d'URL. */
export const PREFIXE_JETON_WS = 'mnemo.jeton.';

export const ROUTES = {
	sante: '/api/sante',
	arret: '/api/arret',
	sessions: '/api/sessions',
	session: '/api/sessions/:id',
	historique: '/api/historique',
	profils: '/api/profils',
	profil: '/api/profils/:id',
	profilDupliquer: '/api/profils/:id/dupliquer',
	profilApercu: '/api/profils/:id/apercu',
	pause: '/api/sessions/:id/pause',
	reprise: '/api/sessions/:id/reprise',
	bilan: '/api/sessions/:id/bilan',
	abandon: '/api/sessions/:id/abandon',
	servis: '/api/sessions/:id/servis',
	ecartes: '/api/sessions/:id/ecartes',
	aServir: '/api/sessions/:id/a-servir',
	fenetres: '/api/fenetres',
	quotas: '/api/quotas',
	modeles: '/api/modeles',
	modelesDemarrer: '/api/modeles/demarrer',
	modelesArreter: '/api/modeles/arreter',
	modelesNiveau: '/api/modeles/niveau',
	sessionModeles: '/api/sessions/:id/modeles',
	hook: '/api/hook',
	memoire: '/api/memoire',
	memoireListe: '/api/memoire/liste',
	memoireElement: '/api/memoire/element',
	documents: '/api/memoire/documents',
	recherche: '/api/recherche',
	voisins: '/api/voisins',
	proposer: '/api/proposer',
	deplacer: '/api/deplacer',
	fil: '/api/fil',
	graphe: '/api/memoire/graphe',
	fiche: '/api/memoire/fiche',
	brut: '/api/memoire/brut',
	dossiers: '/api/dossiers',
	dossierGit: '/api/dossiers/git',
	depot: '/api/depot',
	depotVerifier: '/api/depot/verifier',
	depotTraiter: '/api/depot/traiter',
	amorce: '/api/memoire/amorce',
	sourcesTraiter: '/api/memoire/sources/traiter',
	sourcesTraiterToutes: '/api/memoire/sources/traiter-toutes',
	sourcesMarquerTraite: '/api/memoire/sources/marquer-traite',
	dossiersTraiter: '/api/memoire/dossiers-non-rattaches/traiter',
	reglages: '/api/reglages',
	claudeDesktop: '/api/claude-desktop',
	claudeDesktopMnemo: '/api/claude-desktop/mnemo',
	claudeDesktopServeurs: '/api/claude-desktop/serveurs',
	claudeDesktopServeur: '/api/claude-desktop/serveurs/:id',
	lots: '/api/lots',
	lotValider: '/api/lots/:id/valider',
	lotRejeter: '/api/lots/:id/rejeter',
	ws: '/ws',
} as const;

/** Fichiers d'un genre importés par `amorce` : nouveaux, modifiés (réécrits), inchangés. */
export type CompteAmorceVue = { nouvelles: number; modifiees: number; inchangees: number };

/**
 * Bilan de `amorce` : `notes` (mémoire de Claude Code, CLAUDE.md global compris), `instructions` (CLAUDE.md et `.claude/*.md`
 * des projets), `rattachees` (fiches liées à un dossier par cet import), `secrets` masqués, fichiers `ignores` avec leur
 * raison, `fiches` (nouvelles ou modifiées par cet import, marquées « à traiter »), `aTraiter` (toutes les fiches qui
 * attendent l'archiviste, cet import et les précédents), `archiviste` (`confie` : la consigne part à l'archiviste qui tourne ;
 * `en_attente` : il ne tourne pas, elle partira à son lancement ; `rien` : rien à traiter), `avertissements` (ce qui n'a pas pu
 * se faire sans annuler l'import), `commit` (null : rien n'a changé).
 */
export type BilanAmorceVue = {
	notes: CompteAmorceVue;
	instructions: CompteAmorceVue;
	rattachees: number;
	secrets: number;
	ignores: { chemin: string; raison: string }[];
	fiches: string[];
	aTraiter: number;
	archiviste: 'confie' | 'en_attente' | 'rien';
	commit: string | null;
} & AvecAvertissements;

/**
 * Réponse de `sourcesTraiter` : les fiches confiées (à traiter, sans doublon) et l'archiviste : `confie` (il tournait),
 * `repris` (il était arrêté : repris, la consigne tapée ensuite), `lance` (aucun : lancé avec la consigne pour objectif),
 * `manuel` (terminaux indisponibles : `manuel` est la commande à coller).
 */
export type ReponseTraiter = { chemins: string[]; archiviste: 'confie' | 'repris' | 'lance' | 'manuel'; manuel?: string };

/**
 * Réponse de `depotTraiter` : les fiches du lot encore « à traiter », et l'archiviste : `confie` (la consigne part à celui qui
 * tourne), `en_attente` (il ne tourne pas : elle partira à son lancement), `rien` (aucune fiche à traiter).
 */
export type ReponseDepotTraiter = { fiches: string[]; archiviste: 'confie' | 'en_attente' | 'rien' };

/** Réponse de `sourcesMarquerTraite` : les fiches dont la marque a été retirée. */
export type ReponseMarquerTraite = { traites: string[] } & AvecAvertissements;

/**
 * Réponse de `depot` (201) : le fichier rangé ; `avertissements` : pourquoi il ne sera pas cherchable (gardé quand même), et
 * ce qui a échoué après l'écriture sans l'annuler.
 */
export type ReponseDepot = { chemin: string } & AvecAvertissements;

/** Code de fermeture WebSocket d'un client trop lent : il se reconnecte et retrouve l'écran par la relecture du tampon. */
export const CODE_FERMETURE_LENT = 4008;

/**
 * Saisie au terminal : une trame `entree` porte au plus `ENTREE_MAX_OCTETS` octets UTF-8 dans `donnees` (un collage plus
 * grand est découpé par le client). Échappée en JSON (au pire `\u0000`, six octets par octet), elle tient dans un message
 * client, borné à `MESSAGE_CLIENT_MAX_OCTETS`.
 */
export const ENTREE_MAX_OCTETS = 64 * 1024;
export const MESSAGE_CLIENT_MAX_OCTETS = 1024 * 1024;

/** `GET sante` : le service répond, avec la racine du dossier Mnemo. */
export type SanteVue = {
	ok: true;
	pid: number;
	/** Chemin affiché, `~` abrégé. */
	racine: string;
	/** Chemin absolu (à copier). */
	racineAbsolue: string;
	/** Terminaux dans Mnemo (node-pty) ; sinon le motif du mode dégradé. */
	terminaux: { ok: true } | { ok: false; motif: string };
	version: string;
};

/** Une fiche du graphe : forme d'entrée de `preparerGraphe` de l'interface. */
export type FicheGraphe = {
	chemin: string;
	titre: string;
	type: string;
	alias: string[];
	etats: 'a_confirmer'[];
	faitsActifs: number;
	categories: Record<string, number>;
	/** Dates (AAAA-MM-JJ) des faits actifs. */
	dates: string[];
	/** Dossier de la fiche ; '' = racine. */
	branche: string;
	/** Fiche de lieu (`dossier` ou `entite`, `<d>/<nom de d>.md`) de sa branche, sinon du premier dossier au-dessus qui en a une. */
	parent: string | null;
};

/** `cible` : chemin de la fiche visée, ou null si le lien ne mène à aucune fiche ; `cibleEcrite` : la cible telle qu'écrite. */
export type LienGraphe = { source: string; cible: string | null; cibleEcrite: string; relation: string | null };

export type DonneesGraphe = {
	coffre: string;
	fiches: FicheGraphe[];
	liens: LienGraphe[];
	/** Mnemo n'envoie pas de notions ; l'interface sait les afficher. */
	notions: [];
	sens: { disponible: boolean; etat: string };
	/** Instant du dernier commit de la mémoire (0 : aucun). */
	modifieeMs: number;
};

/**
 * Projet d'une fiche (« Ce projet » de la palette) : la portée `projet` ou `client` la plus proche de la fiche, déclarée par
 * la fiche d'un dossier (clé `portee`) ou dérivée de sa place ; `projet` : son nom (dossier d'épisodes), `position` : le lieu
 * qui la porte.
 */
export type ProjetVue = { projet: string; position: string };

/** `GET fiche` : une fiche lue, pour l'afficher ou l'éditer. */
export type FicheVue = {
	chemin: string;
	titre: string;
	type: string;
	/** Frontmatter hors `id`, `updated` en dernier ; valeurs mises en texte. */
	proprietes: [string, string][];
	/** Markdown sans frontmatter. */
	corps: string;
	/** Texte entier du fichier. */
	brut: string;
	/** Empreinte de `brut`, à renvoyer avec une édition (`brut`). */
	empreinte: string;
	liens: {
		sortants: { ecrit: string; chemin: string | null; verbe: string | null }[];
		entrants: { chemin: string; titre: string; verbe: string | null }[];
	};
	/** Sessions qui l'ont utilisée (`SESSIONS_DE_FICHE_MAX` au plus sans `PARAMETRES_TOUT`, les plus récentes d'abord). */
	sessions: { id: string; objectif: string | null; etat: EtatSessionVue; horodatageMs: number }[];
	/** Nombre de sessions qui l'ont utilisée, listées ou non. */
	sessionsTotal: number;
	/**
	 * Ce que Mnemo n'a pas pu lire ou indexer comme prévu, en français : anomalies de lecture de la fiche (frontmatter ou
	 * type illisible, ligne hors de la forme de sa section), puis avertissements de l'indexation de son document (fiche
	 * `source`). Vide si tout a été lu.
	 */
	avertissements: string[];
	/** Son projet ; null hors de tout projet ou client. */
	projet: ProjetVue | null;
};

/**
 * Un sous-dossier, quel que soit son nom (caché compris ; seuls `_mnemo/` et `.mnemo/` de la racine ne sont jamais rendus).
 * `chemin` : relatif à la racine ; `git` : il contient `.git` ; `marque` (◆) : il contient un marqueur réglé
 * (`projets.marqueurs`) ; `sessions` : ses sessions non terminées (lancées exactement dans ce dossier) ; `erreur` : le motif
 * si son contenu n'a pas pu être lu (ses voisins sont rendus quand même).
 */
export type DossierVue = { chemin: string; nom: string; git: boolean; marque: boolean; sessions: number; erreur: string | null };

/** Un dossier (la racine : `chemin` et `nom` vides) et ses sous-dossiers directs, triés par nom, décrits de la même façon. */
export type NiveauDossiersVue = { dossier: DossierVue; sousDossiers: DossierVue[] };

/** État git d'un dossier : null si ce n'est pas un dépôt. `fichiers` : `FICHIERS_GIT_MAX` au plus (tous avec `PARAMETRES_TOUT`), relatifs au dossier ; `modifies` : leur nombre total. */
export type GitDossierVue = { branche: string | null; fichiers: { chemin: string; statut: 'M' | 'A' | 'D' }[]; modifies: number } | null;

export type NiveauVue = 'rappelee' | 'toujours' | 'verifiee';
export type RegleVue = { type: 'chemins_interdits' | 'commandes_interdites'; motifs: string[] };
export type StatutElementVue = 'servi' | 'a_confirmer' | 'invalide' | 'ancienne_version' | 'source_disparue';

/** Un élément de l'index (fiche, fait, consigne, passage). */
export type ElementIndexeVue = {
	/** Fiche, consigne : le chemin ; fait : `${chemin}#^${ancre}`. */
	id: string;
	chemin: string;
	genre: 'fiche' | 'fait' | 'consigne' | 'passage';
	typeFiche: string;
	/** Fait : énoncé, puis la citation sur une seconde ligne s'il y en a une. */
	texte: string;
	contexte: string;
	statut: StatutElementVue;
	date: string | null;
	valideFin: string | null;
	finIncluse: boolean;
	confiance: number | null;
	source: string | null;
	typeSource: string | null;
	categorie: string | null;
	niveau: NiveauVue | null;
	/** Consigne : sa portée (`globale`, `genre:nom`, `invalide`) ; fiche : la portée `genre:nom` qu'elle déclare pour son lieu ; sinon null. */
	portee: string | null;
	dossierProjet: string | null;
	page?: number | null;
};

/**
 * `GET fil` : « appris aujourd'hui ». `tronque` : le journal a atteint sa limite (500 commits) ; `montees` : `niveau` est le
 * niveau visé, `proposition` n'est posée que pour une proposition de session.
 */
export type FilVue = {
	commits: { hash: string; dateMs: number; message: string; fiches: string[]; session: string | null }[];
	tronque: boolean;
	aConfirmer: ElementIndexeVue[];
	montees: { fiche: string; texte: string; niveau: NiveauVue; proposition: { niveau: NiveauVue; regle?: RegleVue; date: string; source: string } | null }[];
	/**
	 * Modifications de consignes ou de profils proposées par une session (genre `modification`) : `cibles` (« synthese »,
	 * « section X », « type »…), `changements` en résumé court.
	 */
	modifications: { fiche: string; titre: string; cibles: string[]; changements: string[]; date: string; source: string }[];
};

/** Un résultat de recherche. */
export type TrouveVue = {
	id: string;
	chemin: string;
	genre: 'fiche' | 'fait' | 'consigne' | 'passage';
	typeFiche: string;
	texte: string;
	contexte: string;
	statut: StatutElementVue;
	date: string | null;
	valideFin: string | null;
	finIncluse: boolean;
	categorie: string | null;
	/** Consigne : sa portée (`globale`, `genre:nom`, `invalide`) ; fiche : la portée `genre:nom` qu'elle déclare pour son lieu ; sinon null. */
	portee: string | null;
	confiance: number | null;
	source: string | null;
	typeSource: string | null;
	page?: number | null;
	score: number;
};

/**
 * `GET recherche` (`?q=…&dossier=…&limite=…&genre=…&rapide=1`) : les éléments trouvés, dans l'ordre du moteur, et des avis
 * par sujet. `genre` : `fiche` (hors documents) ou `document` (fiches `source` seules) ; absent : les deux. `note` : la note
 * du reranker dans [0, 1] (comme le classement du panneau Contexte), null sans modèles ou avec `rapide=1` (les mots seuls).
 * En-tête `ENTETE_REMPLACEMENT` facultatif (recherche complète seulement).
 */
export type TrouveRechercheVue = TrouveVue & { note: number | null };
export type ReponseRecherche = { trouves: TrouveRechercheVue[]; avis: Record<string, string> };

/** `POST sessions` (201) : la session lancée ; `manuel` : lancée sans terminal (mode dégradé), la ligne de commande à coller. Refus : 400 `{ erreur }`. */
export type ReponseLancement = { session: SessionVue; manuel?: string };

/** Réponse d'une écriture acceptée (`proposer`, `deplacer`, `brut`) ; un refus est rendu en 400 `{ erreur }`. */
export type ResultatEcriture =
	/** `changements` (genre `modification`) : ce qui a changé, ou changerait une fois confirmé. */
	| ({ statut: 'ecrit'; fiche: string; ancre?: string; aConfirmer: boolean; commit: string; changements?: string[] } & AvecAvertissements)
	| { statut: 'doublon'; fiche: string; ancre?: string }
	| ({ statut: 'repetition'; fiche: string; repetitions: number; niveauPropose: NiveauVue | null; commit: string } & AvecAvertissements)
	| { statut: 'proches'; genre: 'fait' | 'consigne'; proches: TrouveVue[] }
	/** `retirer_dossier` : `commit` null si rien de suivi par git n'a changé. */
	| { statut: 'retire'; dossier: string; commit: string | null };

/** Groupes de la vue Réglages, dans l'ordre de la page. */
export type GroupeReglageVue = GroupeReglage;
export type ValeurReglageVue = number | string | string[];

/**
 * Un réglage de `.mnemo/reglages.json` : `cle` (`<groupe>.<nom>`), libellé et explication en une ligne, `genre` du champ
 * (`entier`, `decimal` : bornes `min`/`max` ; `liste` : noms libres ; `couleur` : `#rrggbb` ; `choix`, `choix-multiple` : parmi `choix`), `defaut`,
 * `valeur` en vigueur dans le fichier, `effet` d'une modification (`immediat`, `service` : au redémarrage du service,
 * `modeles` : au prochain démarrage des modèles).
 */
export type ChampReglageVue = {
	cle: string;
	groupe: GroupeReglageVue;
	libelle: string;
	explication: string;
	genre: 'entier' | 'decimal' | 'liste' | 'choix' | 'choix-multiple' | 'couleur';
	defaut: ValeurReglageVue;
	valeur: ValeurReglageVue;
	min?: number;
	max?: number;
	unite?: string;
	choix?: { valeur: string; libelle: string }[];
	effet: 'immediat' | 'service' | 'modeles';
	/** Variable d'environnement du service qui remplace ce réglage (`MNEMO_PORT`) : sans effet tant qu'elle est posée. */
	fixePar?: string;
};

/**
 * Réponse de `reglages` (GET et PUT) : les champs, les avertissements de lecture du fichier (réglage invalide remplacé par
 * son défaut…), et `enAttente` : les clés dont la valeur enregistrée n'est pas encore celle du service en cours (redémarrage
 * requis). PUT reçoit `{ valeurs: { "<cle>": valeur | null } }` (null : rétablir le défaut), tout ou rien.
 */
export type ReglagesVue = { champs: ChampReglageVue[]; avertissements: string[]; enAttente: string[] };

/**
 * Un serveur MCP de l'app Claude (autre que Mnemo) : `commande` et `args` tels quels, `env` : les noms des variables
 * seulement (leurs valeurs ne sortent jamais du service) ; `modifiable` faux : décrit autrement que par une commande (`url`,
 * champs inconnus), en lecture seule (il peut seulement être retiré ; `commande` est alors sa `command` s'il en a une, sinon
 * son `url` sans identifiants, paramètres ni fragment).
 */
export type ServeurMcpVue = { nom: string; commande: string; args: string[]; env: string[]; modifiable: boolean };

/**
 * Réponse des routes `claudeDesktop…` : `installee` faux si le dossier de l'app Claude n'existe pas (rien n'est écrit) ;
 * `fichier` : chemin du fichier (`~` abrégé) ; `erreur` : fichier illisible, jamais réécrit (`serveurs` vide) ; `mnemo` :
 * état de l'entrée `mnemo` (`perime` : présente mais différente de l'attendue) ; `serveurs` : les autres, dans l'ordre du
 * fichier. Un changement ne vaut qu'au redémarrage de l'app Claude.
 */
export type ClaudeDesktopVue = {
	installee: boolean;
	fichier: string;
	erreur?: string;
	mnemo: 'absent' | 'branche' | 'perime';
	serveurs: ServeurMcpVue[];
};

/**
 * Corps de `claudeDesktopServeurs` POST et `claudeDesktopServeur` PUT : nom (`^[A-Za-z0-9_.-]{1,64}$`, jamais `mnemo`),
 * commande non vide, arguments, variables ; une variable à `null` garde sa valeur actuelle (modification), une variable
 * absente est retirée.
 */
export type ServeurMcpEcriture = { nom: string; commande: string; args: string[]; env: Record<string, string | null> };

/** Genre d'un lot d'informations : fusionner des doublons, supprimer, confirmer (« à confirmer » retiré). */
export type GenreLotVue = 'fusionner' | 'supprimer' | 'confirmer';
/** Une ligne d'un lot telle que proposée (ancres nues « f-0001 ») : `{ garder, absorber }` pour fusionner, `{ ancre }` sinon. */
export type LigneDeLotProposeeVue = { garder: string; absorber: string[] } | { ancre: string };
/** Une information telle qu'écrite dans la fiche : sa ligne, puis sa citation et ses corroborations ; `lignes` vide : absente. */
export type InformationDuLotVue = { ancre: string; lignes: string[] };
/**
 * Une ligne d'un lot, pour « Revoir » : `indice` (à renvoyer dans `lignes` pour la valider), `avant` (les informations visées
 * telles qu'elles sont, la gardée d'abord pour une fusion), `apres` (l'information qui reste si cette ligne est appliquée
 * seule : la gardée avec les sources versées et sa confiance recalculée, ou la confirmée ; null pour une suppression),
 * `motif` (pourquoi elle ne s'appliquerait pas seule ; null sinon).
 */
export type LigneDeLotVue = { indice: number; ligne: LigneDeLotProposeeVue; avant: InformationDuLotVue[]; apres: InformationDuLotVue | null; motif: string | null };
/**
 * Un lot d'informations proposé par l'archiviste, en attente de l'utilisateur : `fiche` (chemin) et son `titre` (null si
 * absente ou illisible), `motif` de l'archiviste, `proposeMs`, `session` qui l'a proposé (null : hors session Mnemo),
 * `perime` (la fiche a changé depuis : la validation sera refusée, 409).
 */
export type LotVue = {
	id: string;
	genre: GenreLotVue;
	fiche: string;
	titre: string | null;
	motif: string;
	proposeMs: number;
	session: string | null;
	perime: boolean;
	lignes: LigneDeLotVue[];
};
export type ReponseLots = { lots: LotVue[] };
/** Corps de `lotValider` : indices des lignes cochées (toutes : « Tout valider »). */
export type DemandeValidationLot = { lignes: number[] };
/** Lot validé : `lignes` appliquées (triées), `commit`, ce qui a changé ; `avertissements` : réindexation incomplète. */
export type ReponseValidationLot = { id: string; fiche: string; commit: string; lignes: number[]; changements: string[] } & AvecAvertissements;
export type ReponseRejetLot = { id: string };

/**
 * `mnemo init --json` (lu par un programme qui pilote l'installation) : une ligne JSON par événement sur la sortie
 * standard, et rien d'autre. Une étape menée s'annonce (`debut`) puis finit (`fait` ou `echec`) ; une étape laissée de
 * côté ne donne qu'une ligne `saute`. `lanceur` : macOS seulement. `codex` et `codex_hooks` : seulement avec `--codex`
 * (déclaration MCP chez Codex ; hooks de Mnemo dans `~/.codex/hooks.json`, à approuver une fois dans Codex), aucune ligne
 * sans. `motif` (étapes `mcp`, `codex` et `codex_hooks`, `echec` seulement) : `perime`, une déclaration (ou des hooks) de
 * Mnemo de portée utilisateur existe déjà et lance un autre Node ou un autre `main.ts` (autre installation de Mnemo), que
 * `mnemo declarer --remplacer` (`--moteur codex` pour Codex) reprend. Absent : tout autre échec.
 */
export type EtapeInit = 'memoire' | 'mcp' | 'codex' | 'codex_hooks' | 'modeles' | 'commande' | 'lanceur';
export type MotifEchecInit = 'perime';
export type EvenementInit = { etape: EtapeInit; etat: 'debut' | 'fait' | 'saute' | 'echec'; message: string; motif?: MotifEchecInit };
/**
 * Progression du téléchargement d'une pièce de modèle, au plus une ligne par seconde et par pièce : `piece`, son nom
 * (`moteur`, `sens`, `reranker`) ; `libelle`, à montrer ; `total` : null si le serveur ne donne pas la taille.
 */
export type ProgressionInit = { etape: 'modeles'; etat: 'progression'; piece: string; libelle: string; recu: number; total: number | null };
/** Dernière ligne : `racine`, le dossier Mnemo ; `ok` faux si une étape a échoué (le code de sortie est alors 1). */
export type FinInit = { fin: true; racine: string; ok: boolean };
export type LigneInit = EvenementInit | ProgressionInit | FinInit;

/**
 * Déclaration du serveur MCP `mnemo` chez un moteur, lue sans rien changer : `deja` (elle lance ce Node et ce Mnemo),
 * `absent`, `perime` (une déclaration de Mnemo qui lance un autre Node ou un autre Mnemo : `mnemo declarer --moteur codex
 * --remplacer`), `autre` (une déclaration `mnemo` qui ne lance pas Mnemo : laissée), `desactive` (désactivée chez le
 * moteur, `enabled = false` : ni déclarée, ni réactivée par Mnemo ; `motif` le dit), `echec` (illisible ; `motif` dit
 * pourquoi).
 */
export type EtatMcpVerifie = { etat: 'deja' | 'absent' | 'perime' | 'autre' | 'desactive' | 'echec'; motif?: string };

/**
 * Hooks de Mnemo de `~/.codex/hooks.json`, lus sans rien changer : `a_jour` (ceux de ce Node et ce Mnemo), `perime` (d'une
 * autre installation : `mnemo declarer --moteur codex --remplacer`), `absent` (`mnemo init --codex`), `echec` (fichier
 * illisible, `motif`). `approbation` (à jour seulement), lue dans `hooks.state` de `config.toml` : `approuves`,
 * `a_approuver` (dans Codex, `/hooks` ; désactivés compris), `inconnu` ; Mnemo ne recalcule pas l'empreinte de Codex, une
 * approbation périmée n'est donc pas vue (`motif` le dit).
 */
export type EtatHooksVerifie = { etat: 'a_jour' | 'perime' | 'absent' | 'echec'; motif?: string; approbation?: { etat: 'approuves' | 'a_approuver' | 'inconnu'; motif: string } };

/**
 * `mnemo verifier-poste --json` : ce dont Mnemo a besoin sur le poste, un bloc par moteur. `git.version` : « 2.50.1 » ;
 * `claude.chemin` : le `claude` que lanceront les sessions ; `codex.chemin` : le `codex` trouvé (facultatif : son absence
 * n'est pas un manque), `codex.mcp` : sa déclaration MCP, lue quand il est trouvé, `codex.hooks` : ses hooks de Mnemo ; `motif` : pourquoi ce n'est pas
 * utilisable ; `node.version` : celle qui exécute Mnemo.
 */
export type PosteVerifie = {
	git: { ok: boolean; version?: string; motif?: string };
	claude: { ok: boolean; chemin?: string; motif?: string };
	codex: { ok: boolean; chemin?: string; motif?: string; mcp?: EtatMcpVerifie; hooks?: EtatHooksVerifie };
	node: { version: string };
};

/**
 * `mnemo declarer (--remplacer | --retirer) [--moteur claude-code | codex] --json` : une ligne.
 * `absent` : aucune déclaration `mnemo` ; `deja` : elle lance déjà ce Node et ce Mnemo ; `remplace` : refaite sur eux ;
 * `retire` : retirée ; `autre` : laissée (elle ne lance pas ce Mnemo, ou n'est pas de portée utilisateur) ; `echec` : code
 * de sortie 1, `message` dit pourquoi. `hooks` (Codex seulement) : les hooks de Mnemo de `~/.codex/hooks.json`, traités de
 * même après la déclaration MCP (`--remplacer` ne refait que des hooks de Mnemo existants ; `--retirer` ne retire que ceux
 * de ce Node et ce Mnemo) ; leur échec donne aussi le code 1.
 */
export type SortieDeclarer = { resultat: ResultatDeclarer; message: string; hooks?: { resultat: ResultatDeclarer; message: string } };
export type ResultatDeclarer = 'absent' | 'deja' | 'remplace' | 'autre' | 'retire' | 'echec';
