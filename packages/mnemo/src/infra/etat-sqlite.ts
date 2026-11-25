import { closeSync, openSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { estNiveauModeles } from '@mnemo/commun';
import type { ActionSurFiche, Classe, EntreeServie, EtatSessions, Lots } from '../application/ports.ts';
import type { DecisionLot, Lot, LotDecide } from '../domaine/lot.ts';
import type { RaisonMuet } from '../domaine/message-muet.ts';
import { etatApres } from '../domaine/session.ts';
import type { ArretAttendu, CauseArret, EtatSession, EvenementHook, Session } from '../domaine/session.ts';

/** Version du schéma (`PRAGMA user_version`). L'état n'est pas jetable : une autre version est une erreur, jamais un effacement. */
export const VERSION_ETAT = 13;
/** Migration 3 → 4 : les sessions terminées depuis plus longtemps n'entrent plus dans le rattrapage des épisodes. */
const RATTRAPAGE_MAX_MS = 7 * 86_400_000;
const ATTENTE_VERROU_MS = 2000;
const ENTREES_GARDEES = 200;

/** Écartés d'une session (effacés à sa fin) et trace de chaque geste (gardée) : ajoutés en version 5. */
const SCHEMA_ECARTES = `
CREATE TABLE IF NOT EXISTS ecartes (
	session TEXT NOT NULL,
	id TEXT NOT NULL,
	titre TEXT NOT NULL,
	horodatage_ms INTEGER NOT NULL,
	PRIMARY KEY (session, id)
);
CREATE TABLE IF NOT EXISTS traces_ecartes (
	rang INTEGER PRIMARY KEY AUTOINCREMENT,
	session TEXT NOT NULL,
	dossier TEXT NOT NULL,
	demande TEXT,
	fiche TEXT NOT NULL,
	horodatage_ms INTEGER NOT NULL
);
`;

/** Dossiers de projet vus sans lien vers la mémoire (« À traiter » de l'archiviste) : ajoutés en version 6. */
const SCHEMA_RATTACHEMENT = `
CREATE TABLE IF NOT EXISTS dossiers_non_rattaches (
	dossier TEXT PRIMARY KEY,
	vu_ms INTEGER NOT NULL
);
`;

/** Fiches servies, lues ou écrites par chaque session : points de départ du contexte servi ; ajoutées en version 7. */
const SCHEMA_FICHES_SERVIES_LUES_ECRITES = `
CREATE TABLE IF NOT EXISTS fiches_servies_lues_ecrites (
	session TEXT NOT NULL,
	chemin TEXT NOT NULL,
	premiere_action TEXT NOT NULL,
	premiere_ms INTEGER NOT NULL,
	derniere_action TEXT NOT NULL,
	derniere_ms INTEGER NOT NULL,
	empreinte_injectee TEXT,
	empreinte_lue TEXT,
	PRIMARY KEY (session, chemin)
);
`;

/** Cartes proposées et journal des actions sur les fiches ; colonnes du journal servi et de la session ajoutées en version 8. */
const SCHEMA_CARTES = `
CREATE TABLE IF NOT EXISTS cartes_proposees (
	session TEXT NOT NULL,
	chemin TEXT NOT NULL,
	empreinte TEXT NOT NULL,
	horodatage_ms INTEGER NOT NULL,
	PRIMARY KEY (session, chemin)
);
CREATE TABLE IF NOT EXISTS actions_fiches (
	session TEXT NOT NULL,
	chemin TEXT NOT NULL,
	action TEXT NOT NULL,
	horodatage_ms INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS actions_fiches_session ON actions_fiches (session, horodatage_ms);
`;

/**
 * Fiches injectées à la main (« Injecter dans la session ») et rang du message porteur qui les a portées : leur âge, en messages
 * porteurs, est `sessions.messages_porteurs - message` ; ajoutées en version 10, avec le compteur.
 */
const SCHEMA_INJECTIONS_MANUELLES = `
CREATE TABLE IF NOT EXISTS injections_manuelles (
	session TEXT NOT NULL,
	chemin TEXT NOT NULL,
	message INTEGER NOT NULL,
	PRIMARY KEY (session, chemin)
);
`;

/**
 * Lots d'informations proposés par l'archiviste (`lignes`, `decision` en JSON ; `decision` null : en attente) ; ajoutés en
 * version 11.
 */
const SCHEMA_LOTS = `
CREATE TABLE IF NOT EXISTS lots (
	id TEXT PRIMARY KEY,
	genre TEXT NOT NULL,
	fiche TEXT NOT NULL,
	lignes TEXT NOT NULL,
	motif TEXT NOT NULL,
	empreinte TEXT NOT NULL,
	propose_ms INTEGER NOT NULL,
	session TEXT,
	decision TEXT,
	decide_ms INTEGER,
	decide_rang INTEGER
);
CREATE INDEX IF NOT EXISTS lots_decide ON lots (decide_ms);
`;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS sessions (
	id TEXT PRIMARY KEY,
	profil TEXT NOT NULL,
	dossier TEXT NOT NULL,
	position TEXT NOT NULL,
	projet TEXT NOT NULL,
	objectif TEXT,
	etat TEXT NOT NULL,
	creee_ms INTEGER NOT NULL,
	maj_ms INTEGER NOT NULL,
	arret_attendu TEXT,
	bilan_demande_ms INTEGER,
	commit_debut TEXT,
	branche TEXT,
	pid INTEGER,
	ecrit_ms INTEGER NOT NULL DEFAULT 0,
	demarrage_machine_ms INTEGER,
	lance_ms INTEGER,
	vu_vivant_ms INTEGER,
	bilan_lu_ms INTEGER,
	dernier_arret TEXT,
	episode_ms INTEGER,
	dossier_non_rattache INTEGER NOT NULL DEFAULT 0,
	perimetre_propose_ms INTEGER,
	messages_porteurs INTEGER NOT NULL DEFAULT 0,
	niveau_modeles TEXT,
	moteur TEXT,
	modele TEXT,
	fil TEXT
);
CREATE TABLE IF NOT EXISTS servis (
	rang INTEGER PRIMARY KEY AUTOINCREMENT,
	session TEXT NOT NULL,
	moment TEXT NOT NULL,
	horodatage_ms INTEGER NOT NULL,
	ids TEXT NOT NULL,
	texte TEXT NOT NULL,
	ms INTEGER NOT NULL,
	sens INTEGER NOT NULL,
	demande TEXT,
	classement TEXT NOT NULL DEFAULT '[]',
	muet TEXT,
	cartes TEXT NOT NULL DEFAULT '[]',
	position TEXT
);
CREATE INDEX IF NOT EXISTS servis_session ON servis (session, rang);
${SCHEMA_ECARTES}${SCHEMA_RATTACHEMENT}${SCHEMA_FICHES_SERVIES_LUES_ECRITES}${SCHEMA_CARTES}${SCHEMA_INJECTIONS_MANUELLES}${SCHEMA_LOTS}`;

type Ligne = Record<string, unknown>;

export class ErreurEtat extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'ErreurEtat';
	}
}

function codeSqlite(erreur: unknown): string {
	const e = erreur as { errcode?: number; code?: string; message?: string };
	return String(e?.errcode ?? e?.code ?? '');
}

/** SQLITE_BUSY (5) et SQLITE_LOCKED (6) que `busy_timeout` ne couvre pas toujours (passage en WAL, escalade de verrou). */
function estOccupe(erreur: unknown): boolean {
	const code = codeSqlite(erreur);
	return code === '5' || code === '6' || /database is locked|SQLITE_BUSY|SQLITE_LOCKED/i.test((erreur as Error)?.message ?? '');
}

function pause(ms: number): void {
	Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Attente sur une base occupée. Par défaut : `busy_timeout` de 2 s, réessais ~5 s au plus. Bornée (`attenteMaxMs`, hooks) :
 * `busy_timeout` à 0 (SQLite n'attend jamais de lui-même) et seule la boucle de réessais attend, pauses coupées à
 * l'échéance : chaque opération échoue au plus `maxMs` (et quelques ms) après son début.
 */
type Attente = { maxMs: number; bornee: boolean };
const ATTENTE_PAR_DEFAUT: Attente = { maxMs: 5000, bornee: false };

/** Réessaie sur occupation : 10 à 200 ms avec gigue, jusqu'à `attente.maxMs` (pauses coupées à l'échéance). */
function reessayerSiOccupe<T>(base: DatabaseSync, attente: Attente, travail: () => T): T {
	const fin = Date.now() + attente.maxMs;
	for (let pauseMs = 10; ; pauseMs = Math.min(pauseMs * 2, 200)) {
		try {
			return travail();
		} catch (erreur) {
			const reste = fin - Date.now();
			if (!estOccupe(erreur) || reste <= 0) throw erreur;
			pause(Math.min(reste, pauseMs / 2 + Math.random() * (pauseMs / 2)));
		}
	}
}

function ligneVersSession(l: Ligne): Session {
	return {
		id: l.id as string,
		profil: l.profil as string,
		dossier: l.dossier as string,
		position: l.position as string,
		projet: l.projet as string,
		objectif: l.objectif as string | null,
		etat: l.etat as EtatSession,
		creeeMs: l.creee_ms as number,
		majMs: l.maj_ms as number,
		arretAttendu: l.arret_attendu as ArretAttendu,
		bilanDemandeMs: l.bilan_demande_ms as number | null,
		commitDebut: l.commit_debut as string | null,
		branche: l.branche as string | null,
		pid: l.pid as number | null,
		demarrageMachineMs: (l.demarrage_machine_ms as number | null) ?? null,
		lanceMs: (l.lance_ms as number | null) ?? null,
		vuVivantMs: (l.vu_vivant_ms as number | null) ?? null,
		bilanLuMs: (l.bilan_lu_ms as number | null) ?? null,
		dernierArret: (l.dernier_arret as CauseArret | null) ?? null,
		episodeMs: (l.episode_ms as number | null) ?? null,
		dossierNonRattache: l.dossier_non_rattache === 1,
		// une valeur qui n'est pas un niveau est ignorée : la session suit le niveau de la machine
		...(estNiveauModeles(l.niveau_modeles) ? { niveauModeles: l.niveau_modeles } : {}),
		// non enregistrés (session d'avant les moteurs) : absents, lus Claude Code et le modèle par défaut ; un moteur inconnu de
		// ce Mnemo est gardé tel quel
		...(typeof l.moteur === 'string' ? { moteur: l.moteur } : {}),
		...(typeof l.modele === 'string' ? { modele: l.modele } : {}),
		...(typeof l.fil === 'string' ? { fil: l.fil } : {}),
	};
}

function ligneVersEntree(l: Ligne): EntreeServie {
	return {
		session: l.session as string,
		moment: l.moment as EntreeServie['moment'],
		horodatageMs: l.horodatage_ms as number,
		ids: JSON.parse(l.ids as string) as string[],
		texte: l.texte as string,
		ms: l.ms as number,
		sens: l.sens === 1,
		demande: l.demande as string | null,
		classement: JSON.parse(l.classement as string) as Classe[],
		muet: (l.muet as RaisonMuet | null) ?? null,
		cartes: JSON.parse(l.cartes as string) as EntreeServie['cartes'],
		position: (l.position as string | null) ?? null,
	};
}

/** Une transaction courte, prise en écriture d'emblée : les écritures concurrentes de plusieurs processus se suivent. */
function transaction<T>(base: DatabaseSync, attente: Attente, travail: () => T): T {
	return reessayerSiOccupe(base, attente, () => {
		base.exec('BEGIN IMMEDIATE');
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
	});
}

function preparer(chemin: string, attente: Attente): DatabaseSync {
	const base = new DatabaseSync(chemin);
	try {
		base.exec(`PRAGMA busy_timeout = ${attente.bornee ? 0 : ATTENTE_VERROU_MS}`);
		reessayerSiOccupe(base, attente, () => {
			const mode = Object.values(base.prepare('PRAGMA journal_mode').get() as Ligne)[0];
			if (String(mode).toLowerCase() !== 'wal') base.exec('PRAGMA journal_mode = WAL');
			base.exec('PRAGMA synchronous = NORMAL');
		});
		transaction(base, attente, () => {
			const version = Number((base.prepare('PRAGMA user_version').get() as Ligne).user_version);
			const existe = base.prepare("SELECT 1 AS un FROM sqlite_master WHERE type = 'table' AND name = 'sessions'").get() !== undefined;
			if (version === 0 && !existe) {
				base.exec(SCHEMA);
				base.exec(`PRAGMA user_version = ${VERSION_ETAT}`);
			} else if (version >= 1 && version < VERSION_ETAT) {
				// versions précédentes : la trace du processus (1 → 2), le bilan lu (2 → 3), le dernier arrêt et l'épisode écrit
				// (3 → 4), la demande et le classement des entrées servies et les écartés (4 → 5), le dossier non rattaché
				// (5 → 6), les fiches servies, lues ou écrites par chaque session (6 → 7), les cartes proposées, le journal des actions et le journal servi enrichi (7 → 8), l'empreinte lue des fiches (8 → 9), les injections à la main et le
				// compteur de messages porteurs (9 → 10), les lots d'informations (10 → 11), le niveau des modèles d'une session (11 → 12),
				// le moteur et le modèle de chaque session (12 → 13) s'ajoutent, rien n'est perdu
				if (version === 1) for (const colonne of ['demarrage_machine_ms', 'lance_ms', 'vu_vivant_ms']) base.exec(`ALTER TABLE sessions ADD COLUMN ${colonne} INTEGER`);
				if (version <= 2) base.exec('ALTER TABLE sessions ADD COLUMN bilan_lu_ms INTEGER');
				if (version <= 3) {
					base.exec('ALTER TABLE sessions ADD COLUMN dernier_arret TEXT');
					base.exec('ALTER TABLE sessions ADD COLUMN episode_ms INTEGER');
					// les sessions terminées depuis plus de 7 jours ne sont plus rattrapées (un épisode effacé n'est jamais recréé)
					base.prepare("UPDATE sessions SET episode_ms = maj_ms WHERE etat = 'terminee' AND maj_ms < ?").run(Date.now() - RATTRAPAGE_MAX_MS);
				}
				if (version <= 4) {
					base.exec('ALTER TABLE servis ADD COLUMN demande TEXT');
					base.exec("ALTER TABLE servis ADD COLUMN classement TEXT NOT NULL DEFAULT '[]'");
					base.exec(SCHEMA_ECARTES);
				}
				if (version <= 5) {
					base.exec('ALTER TABLE sessions ADD COLUMN dossier_non_rattache INTEGER NOT NULL DEFAULT 0');
					base.exec(SCHEMA_RATTACHEMENT);
				}
				base.exec(SCHEMA_FICHES_SERVIES_LUES_ECRITES);
				// 8 → 9 : l'empreinte de la fiche à sa dernière lecture (une table créée à l'instant l'a déjà)
				const colonnes = (base.prepare('PRAGMA table_info(fiches_servies_lues_ecrites)').all() as Ligne[]).map((c) => c.name);
				if (!colonnes.includes('empreinte_lue')) base.exec('ALTER TABLE fiches_servies_lues_ecrites ADD COLUMN empreinte_lue TEXT');
				if (version <= 7) {
					base.exec('ALTER TABLE servis ADD COLUMN muet TEXT');
					base.exec("ALTER TABLE servis ADD COLUMN cartes TEXT NOT NULL DEFAULT '[]'");
					base.exec('ALTER TABLE servis ADD COLUMN position TEXT');
					base.exec('ALTER TABLE sessions ADD COLUMN perimetre_propose_ms INTEGER');
					base.exec(SCHEMA_CARTES);
				}
				if (version <= 9) {
					base.exec('ALTER TABLE sessions ADD COLUMN messages_porteurs INTEGER NOT NULL DEFAULT 0');
					base.exec(SCHEMA_INJECTIONS_MANUELLES);
				}
				base.exec(SCHEMA_LOTS);
				// 11 → 12 : le niveau des modèles propre à une session (absent : elle suit celui de la machine)
				const colonnesSessions = (base.prepare('PRAGMA table_info(sessions)').all() as Ligne[]).map((c) => c.name);
				if (!colonnesSessions.includes('niveau_modeles')) base.exec('ALTER TABLE sessions ADD COLUMN niveau_modeles TEXT');
				// 12 → 13 : le moteur, le modèle et l'identifiant chez le moteur (`fil`) de chaque session, null pour celles d'avant (lu :
				// Claude Code, modèle par défaut, fil inconnu) ; une table déjà au schéma courant les a
				const deSession = (base.prepare('PRAGMA table_info(sessions)').all() as Ligne[]).map((c) => c.name);
				for (const colonne of ['moteur', 'modele', 'fil']) if (!deSession.includes(colonne)) base.exec(`ALTER TABLE sessions ADD COLUMN ${colonne} TEXT`);
				base.exec(`PRAGMA user_version = ${VERSION_ETAT}`);
			} else if (version !== VERSION_ETAT) {
				throw new ErreurEtat(
					`L'état des sessions (${chemin}) est en version de schéma ${version}, ce Mnemo lit la version ${VERSION_ETAT} : rien n'est effacé, mettre Mnemo à jour.`,
				);
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

/** Lots décidés gardés (pour que l'archiviste voie leur sort) ; au-delà, les plus anciens sont oubliés. */
const LOTS_DECIDES_GARDES = 200;

function ligneVersLot(l: Ligne): Lot {
	return {
		id: l.id as string,
		genre: l.genre as Lot['genre'],
		fiche: l.fiche as string,
		lignes: JSON.parse(l.lignes as string) as Lot['lignes'],
		motif: l.motif as string,
		empreinte: l.empreinte as string,
		proposeMs: l.propose_ms as number,
		session: (l.session as string | null) ?? null,
	};
}

/**
 * Lots d'informations dans `etat.sqlite` à ce chemin (le même fichier que l'état des sessions, ouvert à part : un serveur
 * MCP enregistre, le service décide). Mêmes attentes sur une base occupée que `ouvrirEtat`.
 */
export function ouvrirLots(chemin: string): Lots {
	if (chemin !== ':memory:') closeSync(openSync(chemin, 'a', 0o600));
	const base = preparer(chemin, ATTENTE_PAR_DEFAUT);
	const reessayer = <T>(travail: () => T): T => reessayerSiOccupe(base, ATTENTE_PAR_DEFAUT, travail);
	const ecrire = <T>(travail: () => T): T => transaction(base, ATTENTE_PAR_DEFAUT, travail);
	return {
		async enregistrer(lot) {
			ecrire(() => {
				base
					.prepare('INSERT INTO lots (id, genre, fiche, lignes, motif, empreinte, propose_ms, session) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
					.run(lot.id, lot.genre, lot.fiche, JSON.stringify(lot.lignes), lot.motif, lot.empreinte, lot.proposeMs, lot.session);
			});
		},
		async enAttente() {
			return reessayer(() => (base.prepare('SELECT * FROM lots WHERE decision IS NULL ORDER BY propose_ms, rowid').all() as Ligne[]).map(ligneVersLot));
		},
		async lire(id) {
			const l = reessayer(() => base.prepare('SELECT * FROM lots WHERE id = ? AND decision IS NULL').get(id) as Ligne | undefined);
			return l === undefined ? null : ligneVersLot(l);
		},
		async decider(id, decision: DecisionLot, decideMs) {
			return ecrire(() => {
				const change = base
					.prepare('UPDATE lots SET decision = ?, decide_ms = ?, decide_rang = (SELECT COALESCE(MAX(decide_rang), 0) + 1 FROM lots) WHERE id = ? AND decision IS NULL')
					.run(JSON.stringify(decision), decideMs, id).changes;
				base
					.prepare('DELETE FROM lots WHERE decision IS NOT NULL AND rowid NOT IN (SELECT rowid FROM lots WHERE decision IS NOT NULL ORDER BY decide_rang DESC LIMIT ?)')
					.run(LOTS_DECIDES_GARDES);
				return Number(change) > 0;
			});
		},
		async decides(depuisMs, limite) {
			return reessayer(() =>
				(base.prepare('SELECT * FROM lots WHERE decision IS NOT NULL AND decide_ms > ? ORDER BY decide_rang DESC LIMIT ?').all(depuisMs, limite) as Ligne[]).map(
					(l): LotDecide => ({ ...ligneVersLot(l), decision: JSON.parse(l.decision as string) as DecisionLot, decideMs: l.decide_ms as number }),
				),
			);
		},
		async version() {
			// une proposition augmente le plus grand rowid, une décision le plus grand rang de décision
			const l = reessayer(() => base.prepare('SELECT COALESCE(MAX(rowid), 0) AS r, COALESCE(MAX(decide_rang), 0) AS d FROM lots').get() as Ligne);
			return `${String(l.r)}:${String(l.d)}`;
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

/**
 * Ouvre (et au besoin crée) `etat.sqlite` à ce chemin ; le dossier doit exister (voir `preparerDossierLocal`).
 * `attenteMaxMs` (hooks) : l'ouverture, puis chaque opération, n'attend pas plus sur une base occupée (sinon erreur).
 */
export function ouvrirEtat(chemin: string, options: { attenteMaxMs?: number } = {}): EtatSessions {
	const attente: Attente = options.attenteMaxMs === undefined ? ATTENTE_PAR_DEFAUT : { maxMs: Math.max(0, options.attenteMaxMs), bornee: true };
	// Créée d'abord en 0600 : SQLite donne les mêmes droits à ses fichiers -wal et -shm.
	if (chemin !== ':memory:') closeSync(openSync(chemin, 'a', 0o600));
	const base = preparer(chemin, attente);
	const reessayer = <T>(travail: () => T): T => reessayerSiOccupe(base, attente, travail);
	const ecrire = <T>(travail: () => T): T => transaction(base, attente, travail);
	const lire = (id: string): Session | null => {
		const l = base.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as Ligne | undefined;
		return l === undefined ? null : ligneVersSession(l);
	};
	const ecriture = (id: string): void => {
		base.prepare('UPDATE sessions SET ecrit_ms = ? WHERE id = ?').run(Date.now(), id);
	};
	/** Une session terminée n'a plus d'écartés (« pour cette session ») ; leur trace reste. */
	const oublierEcartesSiTerminee = (id: string): void => {
		if (lire(id)?.etat === 'terminee') base.prepare('DELETE FROM ecartes WHERE session = ?').run(id);
	};

	return {
		async creer(s) {
			ecrire(() => {
				base
					.prepare(
						`INSERT INTO sessions (id, profil, dossier, position, projet, objectif, etat, creee_ms, maj_ms, arret_attendu,
							bilan_demande_ms, commit_debut, branche, pid, ecrit_ms, demarrage_machine_ms, lance_ms, vu_vivant_ms, bilan_lu_ms, dernier_arret, episode_ms,
							dossier_non_rattache, niveau_modeles, moteur, modele, fil)
						VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
					)
					.run(
						s.id,
						s.profil,
						s.dossier,
						s.position,
						s.projet,
						s.objectif,
						s.etat,
						s.creeeMs,
						s.majMs,
						s.arretAttendu,
						s.bilanDemandeMs,
						s.commitDebut,
						s.branche,
						s.pid,
						Date.now(),
						s.demarrageMachineMs ?? null,
						s.lanceMs ?? null,
						s.vuVivantMs ?? null,
						s.bilanLuMs ?? null,
						s.dernierArret ?? null,
						s.episodeMs ?? null,
						s.dossierNonRattache === true ? 1 : 0,
						estNiveauModeles(s.niveauModeles) ? s.niveauModeles : null,
						s.moteur ?? null,
						s.modele ?? null,
						s.fil ?? null,
					);
			});
		},

		async lire(id) {
			return reessayer(() => lire(id));
		},

		async lister(options) {
			return reessayer(() => {
				const sql = options?.archivees === true ? 'SELECT * FROM sessions ORDER BY creee_ms, id' : "SELECT * FROM sessions WHERE etat <> 'terminee' ORDER BY creee_ms, id";
				return (base.prepare(sql).all() as Ligne[]).map(ligneVersSession);
			});
		},

		async appliquer(id, e: EvenementHook, horodatageMs, complement) {
			return ecrire(() => {
				const actuelle = lire(id);
				if (actuelle === null) return null;
				// l'identifiant chez le moteur : noté au premier événement qui le porte, jamais écrasé
				if (complement?.fil !== undefined && complement.fil !== '' && actuelle.fil === undefined) {
					base.prepare('UPDATE sessions SET fil = ? WHERE id = ? AND fil IS NULL').run(complement.fil, id);
					actuelle.fil = complement.fil;
				}
				if (horodatageMs <= actuelle.majMs) return actuelle;
				const objectif = actuelle.objectif === null && e === 'message' && complement?.objectif !== undefined ? complement.objectif : actuelle.objectif;
				const commitDebut = complement?.commitDebut !== undefined ? complement.commitDebut : actuelle.commitDebut;
				const branche = complement?.branche !== undefined ? complement.branche : actuelle.branche;
				// bilan : le premier message reçu après la demande est la consigne du bilan, soumise (Claude la lit)
				const bilanLu =
					e === 'message' && actuelle.arretAttendu === 'bilan' && actuelle.bilanDemandeMs !== null && horodatageMs > actuelle.bilanDemandeMs && (actuelle.bilanLuMs ?? null) === null
						? horodatageMs
						: (actuelle.bilanLuMs ?? null);
				// cause du dernier arrêt : notée par `arret` (Stop par défaut), effacée par ce qui montre Claude au travail ou au départ
				const dernierArret = e === 'arret' ? (complement?.arret ?? 'stop') : e === 'fin' ? (actuelle.dernierArret ?? null) : null;
				base
					.prepare('UPDATE sessions SET etat = ?, maj_ms = ?, objectif = ?, commit_debut = ?, branche = ?, bilan_lu_ms = ?, dernier_arret = ?, ecrit_ms = ? WHERE id = ?')
					.run(etatApres(actuelle, e), horodatageMs, objectif, commitDebut, branche, bilanLu, dernierArret, Date.now(), id);
				oublierEcartesSiTerminee(id);
				return lire(id);
			});
		},

		async modifier(id, champs) {
			return ecrire(() => {
				const actuelle = lire(id);
				if (actuelle === null) return null;
				const colonnes: Record<string, string> = {
					etat: 'etat',
					arretAttendu: 'arret_attendu',
					pid: 'pid',
					bilanDemandeMs: 'bilan_demande_ms',
					bilanLuMs: 'bilan_lu_ms',
					commitDebut: 'commit_debut',
					branche: 'branche',
					demarrageMachineMs: 'demarrage_machine_ms',
					lanceMs: 'lance_ms',
					vuVivantMs: 'vu_vivant_ms',
					episodeMs: 'episode_ms',
					position: 'position',
					projet: 'projet',
					dossierNonRattache: 'dossier_non_rattache',
					niveauModeles: 'niveau_modeles',
				};
				// un niveau des modèles invalide est ignoré (null : retiré, la session suit le niveau de la machine)
				if (champs.niveauModeles !== undefined && champs.niveauModeles !== null && !estNiveauModeles(champs.niveauModeles)) delete colonnes.niveauModeles;
				// une session terminée ne bouge plus : ni son état, ni la raison de son arrêt
				if (actuelle.etat === 'terminee') {
					delete colonnes.etat;
					delete colonnes.arretAttendu;
				}
				for (const [cle, colonne] of Object.entries(colonnes)) {
					const valeur = (champs as Record<string, unknown>)[cle];
					if (valeur === undefined) continue;
					const enBase = typeof valeur === 'boolean' ? (valeur ? 1 : 0) : (valeur as string | number | null);
					base.prepare(`UPDATE sessions SET ${colonne} = ? WHERE id = ?`).run(enBase, id);
				}
				ecriture(id);
				oublierEcartesSiTerminee(id);
				return lire(id);
			});
		},

		async battre(ids, vuVivantMs) {
			if (ids.length === 0) return;
			ecrire(() => {
				const requete = base.prepare('UPDATE sessions SET vu_vivant_ms = ? WHERE id = ?');
				for (const id of ids) requete.run(vuVivantMs, id);
			});
		},

		async journaliser(entree) {
			ecrire(() => {
				base
					.prepare('INSERT INTO servis (session, moment, horodatage_ms, ids, texte, ms, sens, demande, classement, muet, cartes, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
					.run(
						entree.session,
						entree.moment,
						entree.horodatageMs,
						JSON.stringify(entree.ids),
						entree.texte,
						entree.ms,
						entree.sens ? 1 : 0,
						entree.demande,
						JSON.stringify(entree.classement),
						entree.muet,
						JSON.stringify(entree.cartes),
						entree.position,
					);
				base
					.prepare('DELETE FROM servis WHERE session = ? AND rang <= (SELECT rang FROM servis WHERE session = ? ORDER BY rang DESC LIMIT 1 OFFSET ?)')
					.run(entree.session, entree.session, ENTREES_GARDEES);
				ecriture(entree.session);
			});
		},

		async servis(session, limite, moment) {
			return reessayer(() =>
				(
					(moment === undefined
						? base.prepare('SELECT * FROM servis WHERE session = ? ORDER BY rang DESC LIMIT ?').all(session, limite)
						: base.prepare('SELECT * FROM servis WHERE session = ? AND moment = ? ORDER BY rang DESC LIMIT ?').all(session, moment, limite)) as Ligne[]
				).map(ligneVersEntree),
			);
		},


		async ecarter(session, ecarte, trace) {
			return ecrire(() => {
				const s = lire(session);
				if (s === null || s.etat === 'terminee') return false;
				base.prepare('INSERT OR IGNORE INTO ecartes (session, id, titre, horodatage_ms) VALUES (?, ?, ?, ?)').run(session, ecarte.id, ecarte.titre, trace.horodatageMs);
				base
					.prepare('INSERT INTO traces_ecartes (session, dossier, demande, fiche, horodatage_ms) VALUES (?, ?, ?, ?, ?)')
					.run(session, trace.dossier, trace.demande, ecarte.id, trace.horodatageMs);
				ecriture(session);
				return true;
			});
		},

		async retablir(session, id) {
			return ecrire(() => {
				const s = lire(session);
				if (s === null || s.etat === 'terminee') return false;
				base.prepare('DELETE FROM ecartes WHERE session = ? AND id = ?').run(session, id);
				ecriture(session);
				return true;
			});
		},

		async ecartes(session) {
			return reessayer(() =>
				(base.prepare('SELECT id, titre, horodatage_ms FROM ecartes WHERE session = ? ORDER BY horodatage_ms, rowid').all(session) as Ligne[]).map((l) => ({
					id: l.id as string,
					titre: l.titre as string,
					horodatageMs: l.horodatage_ms as number,
				})),
			);
		},

		async noterFicheServieLueOuEcrite(session, f) {
			ecrire(() => {
				if (lire(session) === null) return;
				base
					.prepare(
						`INSERT INTO fiches_servies_lues_ecrites (session, chemin, premiere_action, premiere_ms, derniere_action, derniere_ms, empreinte_injectee, empreinte_lue)
						VALUES (?, ?, ?, ?, ?, ?, ?, ?)
						ON CONFLICT (session, chemin) DO UPDATE SET derniere_action = excluded.derniere_action, derniere_ms = excluded.derniere_ms,
							empreinte_injectee = COALESCE(excluded.empreinte_injectee, fiches_servies_lues_ecrites.empreinte_injectee),
							empreinte_lue = CASE WHEN excluded.derniere_action = 'servie' THEN fiches_servies_lues_ecrites.empreinte_lue ELSE excluded.empreinte_lue END`,
					)
					// l'empreinte est celle de l'injection (servie) ou de la lecture (lue) ; une écriture oublie la lecture : la fiche a changé
					.run(session, f.chemin, f.action, f.horodatageMs, f.action, f.horodatageMs, f.action === 'servie' ? f.empreinte : null, f.action === 'lue' ? f.empreinte : null);
				base.prepare('INSERT INTO actions_fiches (session, chemin, action, horodatage_ms) VALUES (?, ?, ?, ?)').run(session, f.chemin, f.action, f.horodatageMs);
				ecriture(session);
			});
		},

		async fichesServiesLuesOuEcrites(session) {
			return reessayer(() =>
				(base.prepare('SELECT * FROM fiches_servies_lues_ecrites WHERE session = ? ORDER BY premiere_ms, rowid').all(session) as Ligne[]).map((l) => ({
					chemin: l.chemin as string,
					premiereAction: l.premiere_action as ActionSurFiche,
					premiereMs: l.premiere_ms as number,
					derniereAction: l.derniere_action as ActionSurFiche,
					derniereMs: l.derniere_ms as number,
					empreinteInjectee: (l.empreinte_injectee as string | null) ?? null,
					empreinteLue: (l.empreinte_lue as string | null) ?? null,
				})),
			);
		},

		async oublierInjections(session) {
			ecrire(() => {
				base.prepare('UPDATE fiches_servies_lues_ecrites SET empreinte_injectee = NULL WHERE session = ?').run(session);
				base.prepare('DELETE FROM cartes_proposees WHERE session = ?').run(session);
				base.prepare('UPDATE sessions SET perimetre_propose_ms = NULL WHERE id = ?').run(session);
				base.prepare('DELETE FROM injections_manuelles WHERE session = ?').run(session);
			});
		},

		async noterMessagePorteur(session) {
			ecrire(() => {
				base.prepare('UPDATE sessions SET messages_porteurs = messages_porteurs + 1 WHERE id = ?').run(session);
			});
		},

		async noterInjectionManuelle(session, chemin) {
			ecrire(() => {
				const l = base.prepare('SELECT messages_porteurs FROM sessions WHERE id = ?').get(session) as Ligne | undefined;
				if (l === undefined) return;
				base
					.prepare('INSERT INTO injections_manuelles (session, chemin, message) VALUES (?, ?, ?) ON CONFLICT (session, chemin) DO UPDATE SET message = excluded.message')
					.run(session, chemin, Number(l.messages_porteurs));
			});
		},

		async injectionsManuelles(session) {
			return reessayer(() =>
				(
					base
						.prepare(
							`SELECT i.chemin AS chemin, s.messages_porteurs - i.message AS messages FROM injections_manuelles i JOIN sessions s ON s.id = i.session
							WHERE i.session = ? ORDER BY i.message, i.chemin`,
						)
						.all(session) as Ligne[]
				).map((l) => ({ chemin: l.chemin as string, messages: Number(l.messages) })),
			);
		},

		async noterCarteProposee(session, c) {
			ecrire(() => {
				if (lire(session) === null) return;
				base
					.prepare(
						`INSERT INTO cartes_proposees (session, chemin, empreinte, horodatage_ms) VALUES (?, ?, ?, ?)
						ON CONFLICT (session, chemin) DO UPDATE SET empreinte = excluded.empreinte, horodatage_ms = excluded.horodatage_ms`,
					)
					.run(session, c.chemin, c.empreinte, c.horodatageMs);
				base.prepare('INSERT INTO actions_fiches (session, chemin, action, horodatage_ms) VALUES (?, ?, ?, ?)').run(session, c.chemin, 'proposee', c.horodatageMs);
				ecriture(session);
			});
		},

		async cartesProposees(session) {
			return reessayer(() => new Map((base.prepare('SELECT chemin, empreinte FROM cartes_proposees WHERE session = ? ORDER BY horodatage_ms, rowid').all(session) as Ligne[]).map((l) => [l.chemin as string, l.empreinte as string])));
		},

		async perimetrePropose(session) {
			return reessayer(() => {
				const l = base.prepare('SELECT perimetre_propose_ms FROM sessions WHERE id = ?').get(session) as Ligne | undefined;
				return (l?.perimetre_propose_ms as number | null | undefined) ?? null;
			});
		},

		async noterPerimetrePropose(session, horodatageMs) {
			ecrire(() => {
				base.prepare('UPDATE sessions SET perimetre_propose_ms = ? WHERE id = ?').run(horodatageMs, session);
			});
		},

		async actions(session) {
			return reessayer(() =>
				(base.prepare('SELECT chemin, action, horodatage_ms FROM actions_fiches WHERE session = ? ORDER BY horodatage_ms, rowid').all(session) as Ligne[]).map((l) => ({
					chemin: l.chemin as string,
					action: l.action as ActionSurFiche,
					horodatageMs: l.horodatage_ms as number,
				})),
			);
		},

		async sessionsAyantServi(chemin, limite) {
			// ids exactement `chemin`, ou commençant par `chemin#` (comparaison de préfixe sans LIKE : aucun caractère spécial) ;
			// jointes aux sessions encore connues (une session retirée de l'historique n'est ni listée ni comptée)
			const servies = `WITH servies AS (
				SELECT s.session AS session, MAX(s.horodatage_ms) AS h FROM servis s, json_each(s.ids) j
				WHERE j.value = ? OR substr(j.value, 1, ?) = ? GROUP BY s.session
			)`;
			const parametres = [chemin, chemin.length + 1, `${chemin}#`] as const;
			return reessayer(() => {
				// LIMIT -1 : sans limite (SQLite)
				const lignes = base
					.prepare(`${servies} SELECT sessions.*, servies.h AS servie_ms FROM servies JOIN sessions ON sessions.id = servies.session ORDER BY servies.h DESC, servies.session LIMIT ?`)
					.all(...parametres, limite ?? -1) as Ligne[];
				const { total } = base.prepare(`${servies} SELECT COUNT(*) AS total FROM servies JOIN sessions ON sessions.id = servies.session`).get(...parametres) as { total: number };
				return { sessions: lignes.map((l) => ({ session: ligneVersSession(l), horodatageMs: Number(l.servie_ms) })), total };
			});
		},

		async supprimer(id) {
			return ecrire(() => {
				const s = lire(id);
				if (s === null) return 'inconnue';
				if (s.etat !== 'terminee') return 'non_terminee';
				for (const table of ['servis', 'ecartes', 'traces_ecartes', 'fiches_servies_lues_ecrites', 'cartes_proposees', 'actions_fiches', 'injections_manuelles']) base.prepare(`DELETE FROM ${table} WHERE session = ?`).run(id);
				base.prepare('DELETE FROM sessions WHERE id = ?').run(id);
				return 'supprimee';
			});
		},

		async derniereModificationMs() {
			return reessayer(() => Number((base.prepare('SELECT COALESCE(MAX(ecrit_ms), 0) AS m FROM sessions').get() as Ligne).m));
		},

		async noterRattachement(dossier, rattache, vuMs) {
			const note = reessayer(() => base.prepare('SELECT 1 AS un FROM dossiers_non_rattaches WHERE dossier = ?').get(dossier) !== undefined);
			if (note !== rattache) return;
			ecrire(() => {
				if (rattache) base.prepare('DELETE FROM dossiers_non_rattaches WHERE dossier = ?').run(dossier);
				else base.prepare('INSERT OR IGNORE INTO dossiers_non_rattaches (dossier, vu_ms) VALUES (?, ?)').run(dossier, vuMs);
			});
		},

		async dossiersNonRattaches() {
			return reessayer(() =>
				(base.prepare('SELECT dossier, vu_ms FROM dossiers_non_rattaches ORDER BY vu_ms, dossier').all() as Ligne[]).map((l) => ({ dossier: l.dossier as string, vuMs: l.vu_ms as number })),
			);
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
