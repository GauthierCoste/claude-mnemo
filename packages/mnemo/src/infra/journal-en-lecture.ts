/**
 * Lecture seule du journal des sessions (`etat.sqlite`) pour le banc du contexte : jamais de migration, jamais d'écriture.
 * Le service en marche (peut-être d'une autre version de Mnemo) garde sa base telle quelle : une base migrée par une autre
 * version le ferait échouer à la réouverture. Toute version à partir de 11 qui porte ce que le banc lit est acceptée.
 */
import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import type { EntreeDuJournal, LectureDuJournal, SessionDuJournal } from '../application/banc-extraire.ts';
import type { RaisonMuet } from '../domaine/message-muet.ts';

/** Première version de l'état dont le journal porte la demande, le mutisme et la position de chaque entrée. */
export const VERSION_JOURNAL_MIN = 11;
const COLONNES_SERVIS = ['rang', 'session', 'ids', 'moment', 'horodatage_ms', 'demande', 'muet', 'position'];
const COLONNES_SESSIONS = ['id', 'profil', 'dossier', 'position', 'creee_ms'];

type Ligne = Record<string, unknown>;

/** Fiches injectées entières à cette entrée (JSON) ; illisible : aucune. */
function idsDe(v: unknown): string[] {
	try {
		const ids: unknown = JSON.parse(String(v));
		return Array.isArray(ids) ? ids.filter((x): x is string => typeof x === 'string') : [];
	} catch {
		return [];
	}
}

export function ouvrirJournalEnLecture(chemin: string): LectureDuJournal & { version: number; fermer(): void } {
	if (!existsSync(chemin)) throw new Error(`État des sessions absent : ${chemin}`);
	const base = new DatabaseSync(chemin, { readOnly: true });
	try {
		base.exec('PRAGMA busy_timeout = 5000');
		const version = Number((base.prepare('PRAGMA user_version').get() as Ligne).user_version);
		if (!(version >= VERSION_JOURNAL_MIN)) {
			throw new Error(`L'état des sessions (${chemin}) est en version ${version} : le banc lit la version ${VERSION_JOURNAL_MIN} ou plus. Mettre à jour Mnemo (l'app) d'abord ; rien n'est modifié.`);
		}
		const colonnes = (table: string) => new Set((base.prepare(`PRAGMA table_info(${table})`).all() as Ligne[]).map((c) => String(c.name)));
		const servis = colonnes('servis');
		const sessions = colonnes('sessions');
		const manquantes = [...COLONNES_SERVIS.filter((c) => !servis.has(c)).map((c) => `servis.${c}`), ...COLONNES_SESSIONS.filter((c) => !sessions.has(c)).map((c) => `sessions.${c}`)];
		if (manquantes.length > 0) throw new Error(`L'état des sessions (${chemin}, version ${version}) n'a pas ${manquantes.join(', ')} : le banc ne peut pas le lire.`);
		const session = (l: Ligne): SessionDuJournal => ({ id: String(l.id), profil: String(l.profil), dossier: String(l.dossier), position: String(l.position) });
		return {
			version,
			async sessions() {
				return (base.prepare('SELECT id, profil, dossier, position FROM sessions ORDER BY creee_ms, id').all() as Ligne[]).map(session);
			},
			async session(id) {
				const l = base.prepare('SELECT id, profil, dossier, position FROM sessions WHERE id = ?').get(id) as Ligne | undefined;
				return l === undefined ? null : session(l);
			},
			async messages(id, limite) {
				const lignes = base
					.prepare("SELECT moment, horodatage_ms, demande, muet, position, ids FROM servis WHERE session = ? AND moment = 'message' ORDER BY rang DESC LIMIT ?")
					.all(id, limite) as Ligne[];
				return lignes.map(
					(l): EntreeDuJournal => ({
						moment: 'message',
						horodatageMs: Number(l.horodatage_ms),
						demande: (l.demande as string | null) ?? null,
						muet: (l.muet as RaisonMuet | null) ?? null,
						position: (l.position as string | null) ?? null,
						ids: idsDe(l.ids),
					}),
				);
			},
			fermer() {
				base.close();
			},
		};
	} catch (erreur) {
		base.close();
		throw erreur;
	}
}
