import { existsSync, rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import type { AVectoriser, EtatSource, FicheIndexee, FiltreIndex, Index, PassageIndexe, PassageLu } from '../application/ports.ts';
import type { ElementIndexe, GenreElement, Lien } from '../domaine/elements.ts';
import { racinesDe } from '../domaine/racines.ts';
import { COLONNE_RACINES, motsDe } from '../domaine/requete.ts';
import { decoderVecteur, empreinteSens, encoderVecteur, plusProches as lesPlusProches, prefixeIndexe, texteAVectoriser } from '../domaine/sens.ts';

/**
 * Version du schéma (`PRAGMA user_version`) : toute autre version est reconstruite. 2 : colonne `fin_incluse`.
 * 3 : colonne `dossier_projet`. 4 : passages, sources, statuts dérivés. 5 : sections partagées, réservations.
 * 6 : passages cherchés par ancre (quasi-copies). 7 : source parente (fils, pièces jointes d'une ancienne version).
 * 8 : vecteurs de sens (`vecteurs`, `etat_vecteurs`, `empreinte_sens`). 9 : passages de fiche (synthèse, sections) parmi
 * les éléments (genre `passage`). 10 : ancres et préfixes stables des passages de fiche. 11 : colonne `racines` des
 * tables plein texte (racines françaises), ligne de contexte des passages (`ligne_contexte`), empreinte de sens versionnée.
 * 12 : anomalies de lecture des fiches (`fiches.anomalies`), avertissements d'indexation des sources (`sources.avertissements`).
 * 13 : portée déclarée par une fiche (colonne `portee` des éléments `fiche`).
 * 14 : session et projet d'un épisode (`session_episode`, `projet_episode`), pour le retrouver où qu'il soit rangé.
 */
export const VERSION_SCHEMA = 14;
const ATTENTE_VERROU_MS = 5000;
/**
 * Poids bm25 des colonnes de `elements_fts` et `passages_fts` : texte, contexte (préfixe : titres ancêtres), racines, ligne
 * (ligne de contexte d'un passage). Les racines pèsent moins que le texte : à égalité, la forme exacte passe devant la forme
 * fléchie ; la ligne de contexte pèse comme le contexte.
 */
const POIDS_TEXTE = 1.0;
const POIDS_CONTEXTE = 0.5;
const POIDS_RACINES = 0.3;
const POIDS_LIGNE = 0.5;
/** Colonne de la ligne de contexte d'un passage : la seule que `correspondParLeTexte` ignore. */
const COLONNE_LIGNE = 'ligne';
const BM25_ELEMENTS = `bm25(elements_fts, ${POIDS_TEXTE}, ${POIDS_CONTEXTE}, ${POIDS_RACINES}, ${POIDS_LIGNE})`;
const BM25_PASSAGES = `bm25(passages_fts, ${POIDS_TEXTE}, ${POIDS_CONTEXTE}, ${POIDS_RACINES}, ${POIDS_LIGNE})`;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS fiches (
	chemin TEXT PRIMARY KEY,
	empreinte TEXT NOT NULL,
	mtime_ms REAL NOT NULL,
	taille INTEGER NOT NULL,
	titre TEXT NOT NULL,
	anomalies TEXT NOT NULL DEFAULT '[]'
);
CREATE TABLE IF NOT EXISTS elements (
	rowid INTEGER PRIMARY KEY,
	id TEXT NOT NULL UNIQUE,
	chemin TEXT NOT NULL,
	ordre INTEGER NOT NULL,
	genre TEXT NOT NULL,
	type_fiche TEXT NOT NULL,
	texte TEXT NOT NULL,
	contexte TEXT NOT NULL,
	statut TEXT NOT NULL,
	date TEXT,
	valide_fin TEXT,
	fin_incluse INTEGER NOT NULL DEFAULT 0,
	confiance REAL,
	source TEXT,
	type_source TEXT,
	categorie TEXT,
	niveau TEXT,
	portee TEXT,
	dossier_projet TEXT,
	session_episode TEXT,
	projet_episode TEXT,
	fiche_citee TEXT,
	ligne_contexte TEXT NOT NULL DEFAULT '',
	empreinte_sens TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS elements_chemin ON elements (chemin, ordre);
CREATE INDEX IF NOT EXISTS elements_fiche_citee ON elements (fiche_citee);
-- "contexte" : le contexte de l'élément ; "racines" : racines françaises du texte ; "ligne" : ligne de contexte d'un passage.
CREATE VIRTUAL TABLE IF NOT EXISTS elements_fts USING fts5(
	texte, contexte, ${COLONNE_RACINES}, ${COLONNE_LIGNE},
	tokenize = 'unicode61 remove_diacritics 2',
	prefix = '2 3'
);
CREATE TABLE IF NOT EXISTS liens (
	de TEXT NOT NULL,
	vers TEXT NOT NULL,
	verbe TEXT
);
CREATE INDEX IF NOT EXISTS liens_de ON liens (de);
CREATE INDEX IF NOT EXISTS liens_vers ON liens (vers);
CREATE TABLE IF NOT EXISTS alias (
	chemin TEXT NOT NULL,
	forme TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS alias_chemin ON alias (chemin);
CREATE TABLE IF NOT EXISTS sources (
	fiche TEXT PRIMARY KEY,
	descripteur TEXT NOT NULL,
	version_de TEXT,
	parente TEXT,
	mtime_ms REAL,
	taille INTEGER,
	empreinte_fichier TEXT,
	etat TEXT NOT NULL,
	secrets INTEGER NOT NULL DEFAULT 0,
	avertissements TEXT NOT NULL DEFAULT '[]',
	en_cours TEXT,
	depuis REAL
);
CREATE INDEX IF NOT EXISTS sources_version_de ON sources (version_de);
CREATE TABLE IF NOT EXISTS passages (
	rowid INTEGER PRIMARY KEY,
	id TEXT NOT NULL UNIQUE,
	fiche_source TEXT NOT NULL,
	ancre TEXT NOT NULL,
	texte TEXT NOT NULL,
	prefixe TEXT NOT NULL,
	titres TEXT NOT NULL,
	page INTEGER,
	position INTEGER NOT NULL,
	section INTEGER NOT NULL,
	type_source TEXT NOT NULL,
	date TEXT,
	ligne_contexte TEXT NOT NULL DEFAULT '',
	empreinte_sens TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS passages_fiche ON passages (fiche_source, position);
CREATE INDEX IF NOT EXISTS passages_ancre ON passages (ancre);
-- Une section (petit pour chercher, grand pour lire) est gardée une fois, quel que soit le nombre de ses passages.
CREATE TABLE IF NOT EXISTS sections (
	fiche_source TEXT NOT NULL,
	rang INTEGER NOT NULL,
	texte TEXT NOT NULL,
	PRIMARY KEY (fiche_source, rang)
);
-- Mêmes colonnes que "elements_fts" (une même expression s'applique aux deux) : "contexte" = préfixe.
CREATE VIRTUAL TABLE IF NOT EXISTS passages_fts USING fts5(
	texte, contexte, ${COLONNE_RACINES}, ${COLONNE_LIGNE},
	tokenize = 'unicode61 remove_diacritics 2',
	prefix = '2 3'
);
-- Vecteurs de sens d'un élément ou d'un passage (même espace d'ids) : valables seulement pour ce modèle et pour le texte
-- d'empreinte "empreinte" (comparée à "empreinte_sens" de l'élément ou du passage). "version" : valeur du compteur à
-- l'écriture, pour que chaque processus relise seulement ce qui a changé depuis son dernier passage.
CREATE TABLE IF NOT EXISTS vecteurs (
	id TEXT PRIMARY KEY,
	modele TEXT NOT NULL,
	dimension INTEGER NOT NULL,
	empreinte TEXT NOT NULL,
	vecteur BLOB NOT NULL,
	version INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS vecteurs_modele ON vecteurs (modele, version);
-- Marqueur de changement des vecteurs : "compteur" avance à chaque écriture ou suppression ; "generation" change quand
-- l'index est recréé (le compteur repart alors de zéro).
CREATE TABLE IF NOT EXISTS etat_vecteurs (
	cle INTEGER PRIMARY KEY CHECK (cle = 1),
	generation TEXT NOT NULL,
	compteur INTEGER NOT NULL
);
INSERT OR IGNORE INTO etat_vecteurs (cle, generation, compteur) VALUES (1, lower(hex(randomblob(8))), 0);
-- Statuts dérivés, calculés ici seulement : un fait qui cite une source dont le fichier a disparu est « source_disparue » ;
-- un passage d'une source qu'une autre, indexée, désigne par « version_de » est « ancienne_version » (une nouvelle version
-- disparue ou illisible ne remplace rien) ; de même pour les fils et pièces jointes (« parente ») d'une source remplacée.
CREATE VIEW IF NOT EXISTS vue_elements AS
	SELECT e.*, CASE
		WHEN e.genre = 'fait' AND e.statut = 'servi' AND e.fiche_citee IS NOT NULL
			AND EXISTS (SELECT 1 FROM sources s WHERE s.fiche = e.fiche_citee AND s.etat = 'disparue')
		THEN 'source_disparue' ELSE e.statut END AS statut_vu
	FROM elements e;
CREATE VIEW IF NOT EXISTS vue_passages AS
	SELECT p.*, p.fiche_source AS chemin, 'passage' AS genre, 'source' AS type_fiche, CASE
		WHEN EXISTS (SELECT 1 FROM sources s WHERE s.fiche <> p.fiche_source AND s.etat = 'indexee'
			AND (s.version_de = p.fiche_source OR s.version_de = (SELECT m.parente FROM sources m WHERE m.fiche = p.fiche_source)))
		THEN 'ancienne_version' ELSE 'servi' END AS statut_vu
	FROM passages p;
`;

type Ligne = Record<string, unknown>;
type Valeur = string | number | null | Uint8Array;

/**
 * Vecteurs d'un modèle gardés en mémoire du processus (le serveur MCP vit longtemps), à jour de l'index quand `compteur`
 * égale celui de `etat_vecteurs` ; `versionMax` : la plus grande version déjà lue (seules les suivantes sont relues).
 */
type CacheVecteurs = {
	modele: string;
	generation: string;
	compteur: number;
	versionMax: number;
	vecteurs: Map<string, { empreinte: string; vecteur: Float32Array }>;
};

/**
 * Éléments (hors invalides, préfixe = titre de leur fiche ; passage de fiche : son contexte, comme un passage de document)
 * puis passages (préfixe = le leur), chacun avec sa ligne de contexte, sans vecteur à jour pour le modèle (deux
 * paramètres : le modèle, deux fois).
 */
const SQL_A_VECTORISER = `
	SELECT 0 AS lot, e.id AS id, CASE WHEN e.genre = 'passage' THEN e.contexte ELSE f.titre END AS prefixe, e.ligne_contexte AS ligne, e.texte AS texte, e.empreinte_sens AS empreinte
	FROM elements e JOIN fiches f ON f.chemin = e.chemin LEFT JOIN vecteurs v ON v.id = e.id
	WHERE e.statut <> 'invalide' AND (v.id IS NULL OR v.modele <> ? OR v.empreinte <> e.empreinte_sens)
	UNION ALL
	SELECT 1, p.id, p.prefixe, p.ligne_contexte, p.texte, p.empreinte_sens
	FROM passages p LEFT JOIN vecteurs v ON v.id = p.id
	WHERE v.id IS NULL OR v.modele <> ? OR v.empreinte <> p.empreinte_sens`;

/** Code SQLite primaire d'une erreur de `node:sqlite` (les codes étendus gardent le primaire dans l'octet bas). */
function codeSqlite(erreur: unknown): number | null {
	const code = (erreur as { errcode?: unknown }).errcode;
	return typeof code === 'number' ? code & 0xff : null;
}

const SQLITE_BUSY = 5;
const SQLITE_LOCKED = 6;
const SQLITE_CORRUPT = 11;
const SQLITE_NOTADB = 26;

/** Fichier réellement illisible (pas un simple verrou ni une autre erreur). */
function estCorruption(erreur: unknown): boolean {
	const code = codeSqlite(erreur);
	return code === SQLITE_CORRUPT || code === SQLITE_NOTADB || erreur instanceof ErreurCorruption;
}

class ErreurCorruption extends Error {}

/**
 * Ouvre l'index. Une version de schéma différente est reconstruite en place (sans toucher au fichier) ;
 * seul un fichier réellement corrompu est supprimé, et s'il ne peut l'être (ouvert ailleurs sous Windows),
 * l'index de ce processus est en mémoire. Un verrou occupé (SQLITE_BUSY) remonte tel quel.
 */
function ouvrirOuReconstruire(fichier: string): DatabaseSync {
	const existait = fichier !== ':memory:' && existsSync(fichier);
	try {
		return preparer(fichier, existait);
	} catch (erreur) {
		if (fichier === ':memory:' || !estCorruption(erreur)) throw erreur;
		try {
			for (const suffixe of ['', '-wal', '-shm']) rmSync(`${fichier}${suffixe}`, { force: true });
			return preparer(fichier, false);
		} catch {
			return preparer(':memory:', false);
		}
	}
}

/** Noms des objets à supprimer pour repartir de zéro : vues, déclencheurs, tables virtuelles puis tables ordinaires. */
function objetsExistants(base: DatabaseSync): { type: string; nom: string }[] {
	const lignes = base.prepare("SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND type IN ('table', 'view', 'trigger')").all() as Ligne[];
	const virtuelles = lignes.filter((l) => String(l.sql).startsWith('CREATE VIRTUAL')).map((l) => String(l.name));
	// Les tables annexes d'une table virtuelle (`<nom>_data`…) disparaissent avec elle : on ne les supprime pas à part.
	const estAnnexe = (nom: string) => virtuelles.some((v) => nom.startsWith(`${v}_`));
	const ordre = (l: Ligne) => (l.type === 'trigger' ? 0 : l.type === 'view' ? 1 : virtuelles.includes(String(l.name)) ? 2 : 3);
	return lignes
		.filter((l) => l.type !== 'table' || !estAnnexe(String(l.name)))
		.sort((x, y) => ordre(x) - ordre(y))
		.map((l) => ({ type: String(l.type), nom: String(l.name) }));
}

/** Supprime tout et recrée le schéma, dans le fichier même (une connexion ouverte ailleurs reste valide). Sous transaction de l'appelant. */
function recreer(base: DatabaseSync): void {
	// Une seule passe suffit : l'ordre de `objetsExistants` respecte les dépendances.
	for (const o of objetsExistants(base)) base.exec(`DROP ${o.type.toUpperCase()} IF EXISTS "${o.nom}"`);
	base.exec(SCHEMA);
	base.exec(`PRAGMA user_version = ${VERSION_SCHEMA}`);
}

function estOccupe(erreur: unknown): boolean {
	const code = codeSqlite(erreur);
	return code === SQLITE_BUSY || code === SQLITE_LOCKED;
}

function pause(ms: number): void {
	Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** Réessaie sur SQLITE_BUSY / SQLITE_LOCKED (que `busy_timeout` ne couvre pas, ex. passage en WAL) : 10 à 200 ms, avec gigue, jusqu'à `finMs`. */
function reessayerSiOccupe<T>(travail: () => T, finMs = Date.now() + ATTENTE_VERROU_MS): T {
	for (let attente = 10; ; attente = Math.min(attente * 2, 200)) {
		try {
			return travail();
		} catch (erreur) {
			const reste = finMs - Date.now();
			if (!estOccupe(erreur) || reste <= 0) throw erreur;
			pause(Math.min(reste, attente / 2 + Math.random() * (attente / 2)));
		}
	}
}

/**
 * Lecture seule (hook `outil`) : ni WAL posé, ni schéma créé, ni `BEGIN IMMEDIATE` ; SQLite n'attend jamais de lui-même et les
 * réessais s'arrêtent à `finMs`, pour que l'attente d'un verrou ne dépasse pas l'échéance de l'appelant.
 */
function ouvrirEnLecture(fichier: string, finMs: number): DatabaseSync {
	if (!existsSync(fichier)) throw new Error('Index absent : la mémoire n\'a pas encore été synchronisée.');
	const base = new DatabaseSync(fichier);
	try {
		base.exec('PRAGMA busy_timeout = 0');
		base.exec('PRAGMA query_only = ON');
		const version = reessayerSiOccupe(() => Number((base.prepare('PRAGMA user_version').get() as Ligne).user_version), finMs);
		if (version !== VERSION_SCHEMA) throw new Error(`Index de version ${version} (attendue : ${VERSION_SCHEMA}) : une synchronisation le reconstruira.`);
		return base;
	} catch (erreur) {
		base.close();
		throw erreur;
	}
}

function preparer(fichier: string, existait: boolean): DatabaseSync {
	const base = new DatabaseSync(fichier);
	try {
		base.exec(`PRAGMA busy_timeout = ${ATTENTE_VERROU_MS}`);
		reessayerSiOccupe(() => {
			// Lire d'abord : écrire le mode exige un verrou que `busy_timeout` n'attend pas.
			const mode = Object.values(base.prepare('PRAGMA journal_mode').get() as Ligne)[0];
			if (String(mode).toLowerCase() !== 'wal') base.exec('PRAGMA journal_mode = WAL');
			if (existait) {
				const controle = base.prepare('PRAGMA quick_check(1)').get() as Ligne;
				if (Object.values(controle)[0] !== 'ok') throw new ErreurCorruption('Index corrompu.');
			}
			// Tout se décide sous le verrou : une autre connexion peut créer le schéma au même instant.
			base.exec('BEGIN IMMEDIATE');
			try {
				const version = Number((base.prepare('PRAGMA user_version').get() as Ligne).user_version);
				const avecFiches = objetsExistants(base).some((o) => o.nom === 'fiches');
				if (version !== VERSION_SCHEMA || !avecFiches) recreer(base);
				base.exec('COMMIT');
			} catch (erreur) {
				try {
					base.exec('ROLLBACK');
				} catch {
					// Transaction déjà terminée.
				}
				throw erreur;
			}
		});
		return base;
	} catch (erreur) {
		try {
			base.close();
		} catch {
			// Déjà fermée ou inutilisable.
		}
		throw erreur;
	}
}

function ligneVersElement(l: Ligne): ElementIndexe {
	return {
		id: l.id as string,
		chemin: l.chemin as string,
		genre: l.genre as ElementIndexe['genre'],
		typeFiche: l.type_fiche as ElementIndexe['typeFiche'],
		texte: l.texte as string,
		contexte: l.contexte as string,
		statut: l.statut_vu as ElementIndexe['statut'],
		date: l.date as string | null,
		valideFin: l.valide_fin as string | null,
		finIncluse: l.fin_incluse === 1,
		confiance: l.confiance as number | null,
		source: l.source as string | null,
		typeSource: l.type_source as ElementIndexe['typeSource'],
		categorie: l.categorie as string | null,
		niveau: l.niveau as ElementIndexe['niveau'],
		portee: l.portee as string | null,
		dossierProjet: l.dossier_projet as string | null,
		...(l.type_fiche === 'episode' ? { sessionEpisode: l.session_episode as string | null, projetEpisode: l.projet_episode as string | null } : {}),
	};
}

function ligneVersPassageElement(l: Ligne): ElementIndexe {
	return {
		id: l.id as string,
		chemin: l.fiche_source as string,
		genre: 'passage',
		typeFiche: 'source',
		texte: l.texte as string,
		contexte: l.prefixe as string,
		page: l.page as number | null,
		statut: l.statut_vu as ElementIndexe['statut'],
		date: l.date as string | null,
		valideFin: null,
		finIncluse: false,
		confiance: null,
		source: l.fiche_source as string,
		typeSource: l.type_source as ElementIndexe['typeSource'],
		categorie: null,
		niveau: null,
		portee: null,
		dossierProjet: null,
	};
}

function ligneVersPassage(l: Ligne): PassageLu {
	return {
		id: l.id as string,
		ficheSource: l.fiche_source as string,
		ancre: l.ancre as string,
		texte: l.texte as string,
		prefixe: l.prefixe as string,
		titres: JSON.parse(l.titres as string) as string[],
		page: l.page as number | null,
		position: l.position as number,
		section: l.texte_section as string,
		typeSource: l.type_source as PassageLu['typeSource'],
		date: l.date as string | null,
		statut: l.statut_vu as PassageLu['statut'],
	};
}

/** Ids par requête de `elementsParId`. */
const TRANCHE_IDS = 500;

/** Clauses WHERE (sur la vue `vue_elements` ou `vue_passages` aliasée `e`) et paramètres d'un filtre. */
function clauses(filtre: FiltreIndex): { sql: string[]; params: Valeur[] } {
	const sql: string[] = [];
	const params: Valeur[] = [];
	const dans = (colonne: string, valeurs: string[]) => {
		sql.push(`${colonne} IN (${valeurs.map(() => '?').join(', ')})`);
		params.push(...valeurs);
	};
	const perimetre = filtre.perimetre?.replace(/\/+$/u, '');
	if (perimetre !== undefined && perimetre !== '') {
		// Frontière de dossier : `projets/a` couvre `projets/a/…` mais pas `projets/ab/…`.
		sql.push('(e.chemin = ? OR substr(e.chemin, 1, ?) = ?)');
		params.push(perimetre, perimetre.length + 1, `${perimetre}/`);
	}
	if (filtre.statuts !== undefined) dans('e.statut_vu', filtre.statuts);
	if (filtre.genres !== undefined) dans('e.genre', filtre.genres);
	if (filtre.typesFiche !== undefined) dans('e.type_fiche', filtre.typesFiche);
	if (filtre.typesFicheExclus !== undefined && filtre.typesFicheExclus.length > 0) {
		sql.push(`e.type_fiche NOT IN (${filtre.typesFicheExclus.map(() => '?').join(', ')})`);
		params.push(...filtre.typesFicheExclus);
	}
	if (filtre.chemins !== undefined) dans('e.chemin', filtre.chemins);
	return { sql, params };
}

/** `lectureSeule` : index ouvert sans écrire, chaque lecture renonce à `finMs` sur une base occupée (voir `ouvrirEnLecture`). */
export function ouvrirIndex(fichier: string | ':memory:', options: { lectureSeule?: { finMs: number } } = {}): Index {
	const lectureSeule = options.lectureSeule;
	const base = lectureSeule === undefined ? ouvrirOuReconstruire(fichier) : ouvrirEnLecture(fichier, lectureSeule.finMs);
	const finDeLecture = (): number => (lectureSeule === undefined ? Date.now() + ATTENTE_VERROU_MS : lectureSeule.finMs);

	const toutes = (sql: string, ...params: Valeur[]): Ligne[] =>
		lectureSeule === undefined ? (base.prepare(sql).all(...params) as Ligne[]) : reessayerSiOccupe(() => base.prepare(sql).all(...params) as Ligne[], lectureSeule.finMs);
	const executer = (sql: string, ...params: Valeur[]): void => {
		base.prepare(sql).run(...params);
	};
	const transaction = (travail: () => void): void => {
		base.exec('BEGIN IMMEDIATE');
		try {
			travail();
			base.exec('COMMIT');
		} catch (erreur) {
			base.exec('ROLLBACK');
			throw erreur;
		}
	};
	/** Le compteur des vecteurs avance (une écriture ou une suppression) : rend sa nouvelle valeur. */
	const avancerCompteur = (): number =>
		Number((base.prepare('UPDATE etat_vecteurs SET compteur = compteur + 1 WHERE cle = 1 RETURNING compteur').get() as Ligne).compteur);
	/** Supprime des vecteurs ; le compteur n'avance que si quelque chose a été supprimé. */
	const retirerVecteurs = (sql: string, ...params: Valeur[]): void => {
		if (Number(base.prepare(sql).run(...params).changes) > 0) avancerCompteur();
	};
	/** Vide une fiche ; ses éléments dont l'id est dans `garder` gardent leur vecteur (encore valable si leur texte n'a pas changé). */
	const viderFiche = (chemin: string, garder: string[] = []): void => {
		retirerVecteurs(
			'DELETE FROM vecteurs WHERE id IN (SELECT id FROM elements WHERE chemin = ? AND id NOT IN (SELECT value FROM json_each(?)))',
			chemin, JSON.stringify(garder),
		);
		executer('DELETE FROM elements_fts WHERE rowid IN (SELECT rowid FROM elements WHERE chemin = ?)', chemin);
		executer('DELETE FROM elements WHERE chemin = ?', chemin);
		executer('DELETE FROM liens WHERE de = ?', chemin);
		executer('DELETE FROM alias WHERE chemin = ?', chemin);
		executer('DELETE FROM fiches WHERE chemin = ?', chemin);
	};
	/** Vide les passages d'une source ; ceux dont l'id est dans `garder` gardent leur vecteur. */
	const viderPassages = (ficheSource: string, garder: string[] = []): void => {
		retirerVecteurs(
			'DELETE FROM vecteurs WHERE id IN (SELECT id FROM passages WHERE fiche_source = ? AND id NOT IN (SELECT value FROM json_each(?)))',
			ficheSource, JSON.stringify(garder),
		);
		executer('DELETE FROM passages_fts WHERE rowid IN (SELECT rowid FROM passages WHERE fiche_source = ?)', ficheSource);
		executer('DELETE FROM passages WHERE fiche_source = ?', ficheSource);
		executer('DELETE FROM sections WHERE fiche_source = ?', ficheSource);
	};
	const noter = (fiche: string, etat: Omit<EtatSource, 'fiche'>): void => {
		executer(
			`INSERT INTO sources (fiche, descripteur, version_de, parente, mtime_ms, taille, empreinte_fichier, etat, secrets, avertissements, en_cours, depuis) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)
			 ON CONFLICT (fiche) DO UPDATE SET descripteur = excluded.descripteur, version_de = excluded.version_de, parente = excluded.parente, mtime_ms = excluded.mtime_ms,
			 taille = excluded.taille, empreinte_fichier = excluded.empreinte_fichier, etat = excluded.etat, secrets = excluded.secrets,
			 avertissements = excluded.avertissements, en_cours = NULL, depuis = NULL`,
			fiche, etat.descripteur, etat.versionDe, etat.parente ?? null, etat.mtimeMs, etat.taille, etat.empreinteFichier, etat.etat, etat.secrets, JSON.stringify(etat.avertissements),
		);
	};
	/** Recherche FTS dans une table ; `rang` : bm25 (plus petit = meilleur). Expression invalide : aucune réponse. */
	const chercherDans = (sql: string, ...params: Valeur[]): Ligne[] => {
		try {
			return toutes(sql, ...params);
		} catch (erreur) {
			if (/fts5: syntax error|unterminated string|unknown special query/iu.test(String((erreur as Error).message))) return [];
			throw erreur;
		}
	};
	/** Lecture cohérente (un seul instantané de la base) ; réessayée si la base est occupée. */
	const lecture = <T>(travail: () => T): T =>
		reessayerSiOccupe(() => {
			base.exec('BEGIN');
			try {
				const resultat = travail();
				base.exec('COMMIT');
				return resultat;
			} catch (erreur) {
				try {
					base.exec('ROLLBACK');
				} catch {
					// Transaction déjà terminée.
				}
				throw erreur;
			}
		}, finDeLecture());

	let cache: CacheVecteurs | null = null;
	/**
	 * Met le cache des vecteurs de `modele` d'accord avec l'index (dans une `lecture`) : rien si le compteur n'a pas bougé ;
	 * sinon relit les vecteurs écrits depuis la dernière fois et oublie ceux qui ne sont plus dans l'index. Un autre modèle
	 * ou un index recréé (autre génération) : tout est relu. Un vecteur illisible n'est jamais comparé.
	 */
	const vecteursDe = (modele: string): CacheVecteurs['vecteurs'] => {
		const etat = toutes('SELECT generation, compteur FROM etat_vecteurs WHERE cle = 1')[0];
		const generation = String(etat?.generation ?? '');
		const compteur = Number(etat?.compteur ?? 0);
		if (cache === null || cache.modele !== modele || cache.generation !== generation) {
			cache = { modele, generation, compteur: -1, versionMax: 0, vecteurs: new Map() };
		}
		const c = cache;
		if (c.compteur === compteur) return c.vecteurs;
		const nouveaux = base.prepare('SELECT id, dimension, empreinte, vecteur, version FROM vecteurs WHERE modele = ? AND version > ?');
		for (const l of nouveaux.iterate(modele, c.versionMax) as Iterable<Ligne>) {
			const id = l.id as string;
			c.versionMax = Math.max(c.versionMax, Number(l.version));
			try {
				c.vecteurs.set(id, { empreinte: l.empreinte as string, vecteur: decoderVecteur(l.vecteur as Uint8Array, Number(l.dimension)) });
			} catch {
				// Illisible : gardé vide (jamais comparé), pour que le cache reste le reflet exact de l'index.
				c.vecteurs.set(id, { empreinte: l.empreinte as string, vecteur: new Float32Array(0) });
			}
		}
		// Le cache contient tout ce que l'index a pour ce modèle : s'il en a plus, certains ont disparu (supprimés, remplacés).
		const nombre = Number((toutes('SELECT count(*) AS n FROM vecteurs WHERE modele = ?', modele)[0] as Ligne).n);
		if (c.vecteurs.size > nombre) {
			const presents = new Set(toutes('SELECT id FROM vecteurs WHERE modele = ?', modele).map((l) => l.id as string));
			for (const id of c.vecteurs.keys()) if (!presents.has(id)) c.vecteurs.delete(id);
		}
		c.compteur = compteur;
		return c.vecteurs;
	};
	/** Ids, genres et empreintes de texte des éléments et passages que `filtre` retient (mêmes vues et clauses que `chercher`). */
	const retenus = (filtre: FiltreIndex): Ligne[] => {
		const { sql, params } = clauses(filtre);
		const ou = sql.length > 0 ? ` WHERE ${sql.join(' AND ')}` : '';
		const genres = filtre.genres;
		const lignes: Ligne[] = [];
		// Les éléments comptent toujours : ils portent aussi des passages (ceux des fiches).
		lignes.push(...toutes(`SELECT e.id, e.genre, e.empreinte_sens FROM vue_elements e${ou}`, ...params));
		if (genres === undefined || genres.includes('passage')) lignes.push(...toutes(`SELECT e.id, e.genre, e.empreinte_sens FROM vue_passages e${ou}`, ...params));
		return lignes;
	};
	const versLien = (l: Ligne): Lien => ({ de: l.de as string, vers: l.vers as string, verbe: l.verbe as string | null });

	return {
		async fiches() {
			return toutes('SELECT chemin, empreinte, mtime_ms, taille, anomalies FROM fiches ORDER BY chemin').map((l) => ({
				chemin: l.chemin as string,
				empreinte: l.empreinte as string,
				mtimeMs: l.mtime_ms as number,
				taille: l.taille as number,
				anomalies: JSON.parse(l.anomalies as string) as string[],
			}));
		},

		async remplacer(fiche: FicheIndexee, contenu) {
			transaction(() => {
				viderFiche(fiche.chemin, contenu.elements.map((e) => e.id));
				executer(
					'INSERT INTO fiches (chemin, empreinte, mtime_ms, taille, titre, anomalies) VALUES (?, ?, ?, ?, ?, ?)',
					fiche.chemin, fiche.empreinte, fiche.mtimeMs, fiche.taille, contenu.titre, JSON.stringify(contenu.anomalies),
				);
				const insertion = base.prepare(
					`INSERT INTO elements (id, chemin, ordre, genre, type_fiche, texte, contexte, statut, date, valide_fin, fin_incluse, confiance, source, type_source, categorie, niveau, portee, dossier_projet, session_episode, projet_episode, fiche_citee, ligne_contexte, empreinte_sens)
					 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				);
				const insertionFts = base.prepare(`INSERT INTO elements_fts (rowid, texte, contexte, ${COLONNE_RACINES}, ${COLONNE_LIGNE}) VALUES (?, ?, ?, ?, ?)`);
				contenu.elements.forEach((e, ordre) => {
					// seule la ligne de contexte d'un passage compte (les autres éléments n'en ont pas)
					const ligne = e.genre === 'passage' ? (e.ligneContexte ?? '') : '';
					const contexte = prefixeIndexe(e.contexte, ligne);
					const prefixe = e.genre === 'passage' ? contexte : contenu.titre;
					const resultat = insertion.run(e.id, fiche.chemin, ordre, e.genre, e.typeFiche, e.texte, e.contexte, e.statut, e.date, e.valideFin, e.finIncluse ? 1 : 0, e.confiance, e.source, e.typeSource, e.categorie, e.niveau, e.portee, e.dossierProjet, e.sessionEpisode ?? null, e.projetEpisode ?? null, e.ficheCitee ?? null, ligne, empreinteSens(prefixe, e.texte));
					// racines du texte seul : ni le titre d'une fiche, ni la ligne de contexte (qui ne pèse qu'au poids du contexte)
					insertionFts.run(resultat.lastInsertRowid, e.texte, e.contexte, racinesDe(e.texte), ligne);
				});
				for (const lien of contenu.liens) executer('INSERT INTO liens (de, vers, verbe) VALUES (?, ?, ?)', fiche.chemin, lien.vers, lien.verbe);
				for (const forme of contenu.alias) executer('INSERT INTO alias (chemin, forme) VALUES (?, ?)', fiche.chemin, forme);
			});
		},

		async retirer(chemin) {
			transaction(() => {
				viderFiche(chemin);
				viderPassages(chemin);
				executer('DELETE FROM sources WHERE fiche = ?', chemin);
			});
		},

		async vider() {
			reessayerSiOccupe(() => transaction(() => recreer(base)));
		},

		async chercher(expression, filtre, limite) {
			if (expression.trim() === '') return [];
			const { sql, params } = clauses(filtre);
			const ou = sql.map((c) => ` AND ${c}`).join('');
			const genres = filtre.genres;
			const avecPassages = genres === undefined || genres.includes('passage');
			// Deux tables FTS de même forme (texte, contexte, racines) et mêmes poids : leurs bm25 se comparent ; fusion par rang.
			const trouves: { element: ElementIndexe; rang: number; ordre: number }[] = [];
			// Les éléments sont toujours parcourus : les passages des fiches y sont (genre `passage`).
			const lignesElements = chercherDans(
				`SELECT e.*, ${BM25_ELEMENTS} AS rang FROM elements_fts JOIN vue_elements e ON e.rowid = elements_fts.rowid
				 WHERE elements_fts MATCH ?${ou} ORDER BY rang, e.rowid LIMIT ?`,
				expression, ...params, limite,
			);
			lignesElements.forEach((l, i) => trouves.push({ element: ligneVersElement(l), rang: l.rang as number, ordre: i }));
			if (avecPassages) {
				const lignes = chercherDans(
					`SELECT e.*, ${BM25_PASSAGES} AS rang FROM passages_fts JOIN vue_passages e ON e.rowid = passages_fts.rowid
					 WHERE passages_fts MATCH ?${ou} ORDER BY rang, e.rowid LIMIT ?`,
					expression, ...params, limite,
				);
				lignes.forEach((l, i) => trouves.push({ element: ligneVersPassageElement(l), rang: l.rang as number, ordre: i }));
			}
			return trouves
				.sort((a, b) => a.rang - b.rang || a.ordre - b.ordre)
				.slice(0, limite)
				.map((t) => ({ ...t.element, bm25: t.rang }));
		},

		async elements(filtre) {
			const { sql, params } = clauses(filtre);
			const lignes = toutes(`SELECT e.* FROM vue_elements e${sql.length > 0 ? ` WHERE ${sql.join(' AND ')}` : ''} ORDER BY e.chemin, e.ordre`, ...params);
			return lignes.map(ligneVersElement);
		},

		async element(id) {
			const [ligne] = toutes('SELECT * FROM vue_elements WHERE id = ?', id);
			return ligne === undefined ? null : ligneVersElement(ligne);
		},

		async elementsParId(ids) {
			if (ids.length === 0) return [];
			const parId = new Map<string, ElementIndexe>();
			// par tranches : le nombre de paramètres d'une requête est borné
			lecture(() => {
				for (let i = 0; i < ids.length; i += TRANCHE_IDS) {
					const tranche = ids.slice(i, i + TRANCHE_IDS);
					const marques = tranche.map(() => '?').join(', ');
					for (const l of toutes(`SELECT * FROM vue_elements WHERE id IN (${marques})`, ...tranche)) parId.set(l.id as string, ligneVersElement(l));
					for (const l of toutes(`SELECT * FROM vue_passages WHERE id IN (${marques})`, ...tranche)) parId.set(l.id as string, ligneVersPassageElement(l));
				}
			});
			return ids.flatMap((id) => parId.get(id) ?? []);
		},

		async sources() {
			return toutes(
				`SELECT s.*, (SELECT count(*) FROM passages p WHERE p.fiche_source = s.fiche) AS nombre FROM sources s ORDER BY s.fiche`,
			).map((l) => ({
				fiche: l.fiche as string,
				descripteur: l.descripteur as string,
				versionDe: l.version_de as string | null,
				parente: l.parente as string | null,
				mtimeMs: l.mtime_ms as number | null,
				taille: l.taille as number | null,
				empreinteFichier: l.empreinte_fichier as string | null,
				etat: l.etat as EtatSource['etat'],
				secrets: l.secrets as number,
				avertissements: JSON.parse(l.avertissements as string) as string[],
				passages: l.nombre as number,
			}));
		},

		async remplacerPassages(ficheSource, passages: PassageIndexe[], sections, etat) {
			reessayerSiOccupe(() =>
				transaction(() => {
					viderPassages(ficheSource, passages.map((p) => `${ficheSource}#${p.ancre}`));
					const insertionSection = base.prepare('INSERT INTO sections (fiche_source, rang, texte) VALUES (?, ?, ?)');
					sections.forEach((texte, rang) => insertionSection.run(ficheSource, rang, texte));
					const insertion = base.prepare(
						`INSERT INTO passages (id, fiche_source, ancre, texte, prefixe, titres, page, position, section, type_source, date, ligne_contexte, empreinte_sens)
						 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
					);
					const insertionFts = base.prepare(`INSERT INTO passages_fts (rowid, texte, contexte, ${COLONNE_RACINES}, ${COLONNE_LIGNE}) VALUES (?, ?, ?, ?, ?)`);
					for (const p of passages) {
						const ligne = p.ligneContexte ?? '';
						const contexte = prefixeIndexe(p.prefixe, ligne);
						const r = insertion.run(`${ficheSource}#${p.ancre}`, ficheSource, p.ancre, p.texte, p.prefixe, JSON.stringify(p.titres), p.page, p.position, p.section, p.typeSource, p.date, ligne, empreinteSens(contexte, p.texte));
						insertionFts.run(r.lastInsertRowid, p.texte, p.prefixe, racinesDe(p.texte), ligne);
					}
					noter(ficheSource, etat);
				}),
			);
		},

		async retirerPassages(ficheSource, etat) {
			reessayerSiOccupe(() =>
				transaction(() => {
					viderPassages(ficheSource);
					if (etat === undefined) executer('DELETE FROM sources WHERE fiche = ?', ficheSource);
					else noter(ficheSource, etat);
				}),
			);
		},

		async noterSource(ficheSource, etat) {
			reessayerSiOccupe(() => transaction(() => noter(ficheSource, etat)));
		},

		async passage(id) {
			const [ligne] = toutes(
				`SELECT e.*, coalesce(s.texte, '') AS texte_section FROM vue_passages e
				 LEFT JOIN sections s ON s.fiche_source = e.fiche_source AND s.rang = e.section WHERE e.id = ?`,
				id,
			);
			return ligne === undefined ? null : ligneVersPassage(ligne);
		},

		async passagesDeSection(id) {
			return lecture(() => {
				const doc = toutes('SELECT fiche_source, section FROM passages WHERE id = ?', id)[0];
				if (doc !== undefined) {
					const passages = toutes('SELECT id, texte FROM passages WHERE fiche_source = ? AND section = ? ORDER BY position', doc.fiche_source as string, doc.section as number);
					return { cle: `${doc.fiche_source as string}\u0000${doc.section as number}`, passages: passages.map((l) => ({ id: l.id as string, texte: l.texte as string })) };
				}
				const fiche = toutes("SELECT chemin, contexte FROM elements WHERE id = ? AND genre = 'passage'", id)[0];
				if (fiche === undefined) return null;
				const passages = toutes("SELECT id, texte FROM elements WHERE chemin = ? AND genre = 'passage' AND contexte = ? ORDER BY ordre", fiche.chemin as string, fiche.contexte as string);
				return { cle: `${fiche.chemin as string}\u0000${fiche.contexte as string}`, passages: passages.map((l) => ({ id: l.id as string, texte: l.texte as string })) };
			});
		},

		async correspondParLeTexte(expression, ids) {
			const trouves = new Set<string>();
			if (ids.length === 0 || expression.trim() === '') return trouves;
			// filtre de colonnes : tout sauf la ligne de contexte (texte, racines, titres ancêtres)
			const filtre = `{texte contexte ${COLONNE_RACINES}} : (${expression})`;
			lecture(() => {
				for (let i = 0; i < ids.length; i += TRANCHE_IDS) {
					const tranche = ids.slice(i, i + TRANCHE_IDS);
					const marques = tranche.map(() => '?').join(', ');
					for (const table of ['elements', 'passages']) {
						const lignes = chercherDans(`SELECT e.id FROM ${table}_fts JOIN ${table} e ON e.rowid = ${table}_fts.rowid WHERE ${table}_fts MATCH ? AND e.id IN (${marques})`, filtre, ...tranche);
						for (const l of lignes) trouves.add(l.id as string);
					}
				}
			});
			return trouves;
		},

		async ancresCommunes(ancres) {
			if (ancres.length === 0) return [];
			return toutes(
				`SELECT fiche_source, count(DISTINCT ancre) AS n FROM passages WHERE ancre IN (SELECT value FROM json_each(?)) GROUP BY fiche_source ORDER BY fiche_source`,
				JSON.stringify(ancres),
			).map((l) => ({ fiche: l.fiche_source as string, communes: l.n as number }));
		},

		async reserverSources(fiches, jeton, maintenantMs, perimeMs) {
			const obtenues: string[] = [];
			reessayerSiOccupe(() =>
				transaction(() => {
					obtenues.length = 0;
					for (const fiche of fiches) {
						const [ligne] = toutes('SELECT en_cours, depuis FROM sources WHERE fiche = ?', fiche);
						const prise = ligne !== undefined && ligne.en_cours !== null && ligne.en_cours !== jeton && (ligne.depuis as number) > maintenantMs - perimeMs;
						if (prise) continue;
						if (ligne === undefined) {
							// Source jamais indexée : une ligne d'attente, sans descripteur (la suivante sera refaite).
							executer("INSERT INTO sources (fiche, descripteur, etat, secrets, en_cours, depuis) VALUES (?, '', 'sans_document', 0, ?, ?)", fiche, jeton, maintenantMs);
						} else executer('UPDATE sources SET en_cours = ?, depuis = ? WHERE fiche = ?', jeton, maintenantMs, fiche);
						obtenues.push(fiche);
					}
				}),
			);
			return [...obtenues];
		},

		async libererSources(fiches, jeton) {
			if (fiches.length === 0) return;
			reessayerSiOccupe(() =>
				transaction(() => {
					for (const fiche of fiches) executer('UPDATE sources SET en_cours = NULL, depuis = NULL WHERE fiche = ? AND en_cours = ?', fiche, jeton);
				}),
			);
		},

		async liens(chemin) {
			return {
				sortants: toutes('SELECT de, vers, verbe FROM liens WHERE de = ? ORDER BY rowid', chemin).map(versLien),
				entrants: toutes('SELECT de, vers, verbe FROM liens WHERE vers = ? ORDER BY de, rowid', chemin).map(versLien),
			};
		},

		async tousLesLiens() {
			return toutes('SELECT de, vers, verbe FROM liens ORDER BY de, rowid').map(versLien);
		},

		async titres() {
			const parChemin = new Map<string, { chemin: string; titre: string; alias: string[] }>();
			for (const l of toutes('SELECT f.chemin, f.titre, a.forme FROM fiches f LEFT JOIN alias a ON a.chemin = f.chemin ORDER BY f.chemin, a.rowid')) {
				const chemin = l.chemin as string;
				let fiche = parChemin.get(chemin);
				if (fiche === undefined) {
					fiche = { chemin, titre: l.titre as string, alias: [] };
					parChemin.set(chemin, fiche);
				}
				if (typeof l.forme === 'string') fiche.alias.push(l.forme);
			}
			return [...parChemin.values()];
		},

		async alias() {
			const formesParFiche = new Map<string, string[]>();
			for (const l of toutes('SELECT f.chemin, f.titre, a.forme FROM fiches f JOIN alias a ON a.chemin = f.chemin ORDER BY f.chemin, a.rowid')) {
				const formes = formesParFiche.get(l.chemin as string) ?? [l.titre as string];
				formes.push(l.forme as string);
				formesParFiche.set(l.chemin as string, formes);
			}
			const carte = new Map<string, string[]>();
			for (const formes of formesParFiche.values()) {
				for (const forme of formes) {
					const cle = motsDe(forme).join(' ');
					if (cle === '') continue;
					const autres = carte.get(cle) ?? [];
					for (const autre of formes) {
						if (motsDe(autre).join(' ') !== cle && !autres.includes(autre)) autres.push(autre);
					}
					if (autres.length > 0) carte.set(cle, autres);
				}
			}
			return carte;
		},

		async aVectoriser(modele, limite) {
			if (!(limite >= 1)) return [];
			return toutes(`${SQL_A_VECTORISER} ORDER BY lot, id LIMIT ?`, modele, modele, Math.floor(limite)).map(
				(l): AVectoriser => ({ id: l.id as string, texte: texteAVectoriser(prefixeIndexe(l.prefixe as string, l.ligne as string), l.texte as string), empreinte: l.empreinte as string }),
			);
		},

		async nombreAVectoriser(modele) {
			return Number((toutes(`SELECT count(*) AS n FROM (${SQL_A_VECTORISER})`, modele, modele)[0] as Ligne).n);
		},

		async enregistrerVecteurs(modele, dimension, vecteurs) {
			if (vecteurs.length === 0) return;
			for (const v of vecteurs) {
				if (v.vecteur.length !== dimension) throw new Error(`Vecteur de dimension ${v.vecteur.length} pour ${v.id} : ${dimension} attendue.`);
			}
			reessayerSiOccupe(() =>
				transaction(() => {
					const version = avancerCompteur();
					// Un id retiré entre-temps (autre processus) n'est pas écrit : pas de vecteur orphelin.
					const insertion = base.prepare(
						`INSERT OR REPLACE INTO vecteurs (id, modele, dimension, empreinte, vecteur, version)
						 SELECT ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM elements WHERE id = ?) OR EXISTS (SELECT 1 FROM passages WHERE id = ?)`,
					);
					for (const v of vecteurs) insertion.run(v.id, modele, dimension, v.empreinte, encoderVecteur(v.vecteur), version, v.id, v.id);
				}),
			);
		},

		cacheVecteurs(modele) {
			return cache !== null && cache.modele === modele && cache.compteur >= 0 ? 'chaud' : 'froid';
		},

		async nombreVecteurs(modele) {
			return lecture(() => Number((toutes('SELECT count(*) AS n FROM vecteurs WHERE modele = ?', modele)[0] as Ligne).n));
		},

		async plusProches(modele, requete, filtre, limite, options) {
			if (!(limite >= 1) || requete.length === 0) return [];
			const { vecteurs, lignes } = lecture(() => ({ vecteurs: vecteursDe(modele), lignes: retenus(filtre) }));
			// Seuls les vecteurs du texte actuel et de la dimension de la requête sont comparés ; regroupés par genre.
			const parGenre = new Map<string, { id: string; vecteur: Float32Array }[]>();
			for (const l of lignes) {
				const id = l.id as string;
				const connu = vecteurs.get(id);
				if (connu === undefined || connu.empreinte !== l.empreinte_sens || connu.vecteur.length !== requete.length) continue;
				// sans `parGenre`, un seul groupe
				const cle = options?.parGenre === true ? (l.genre as string) : '';
				const groupe = parGenre.get(cle) ?? [];
				groupe.push({ id, vecteur: connu.vecteur });
				parGenre.set(cle, groupe);
			}
			const voisins = [...parGenre.values()]
				.flatMap((groupe) => lesPlusProches(requete, groupe, limite))
				.sort((a, b) => b.similarite - a.similarite || a.id.localeCompare(b.id));
			const choisis = new Set(voisins.map((v) => v.id));
			const genres = new Map<string, GenreElement>();
			for (const l of lignes) if (choisis.has(l.id as string)) genres.set(l.id as string, l.genre as GenreElement);
			return voisins.map((v) => ({ ...v, genre: genres.get(v.id)! }));
		},

		fermer() {
			try {
				base.close();
			} catch {
				// Déjà fermée.
			}
		},
	};
}
