/**
 * Lecture seule du journal des sessions (`etat.sqlite`) pour le banc du contexte : jamais de migration, jamais d'écriture.
 * Le service en marche (peut-être d'une autre version de Mnemo) garde sa base telle quelle : une base migrée par une autre
 * version le ferait échouer à la réouverture. Toute version à partir de 11 qui porte ce que le banc lit est acceptée.
 */
import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import type { EntreeDuJournal, LectureDuJournal, SessionDuJournal } from '../application/banc-extraire.ts';
import type { GestesDuBanc } from '../application/banc-signaux.ts';
import type { GesteDApriori } from '../domaine/apriori-gestes.ts';
import type { Geste } from '../domaine/gestes.ts';
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

/** Vecteur d'un geste (Float32 petit-boutiste, comme `etat-sqlite.ts`) ; illisible : null. */
function vecteurDe(octets: Uint8Array | null, modele: string | null): GesteDApriori['vecteur'] {
	if (octets === null || modele === null || octets.byteLength % 4 !== 0) return null;
	const vue = new DataView(octets.buffer, octets.byteOffset, octets.byteLength);
	return { modele, valeurs: Float32Array.from({ length: octets.byteLength / 4 }, (_, i) => vue.getFloat32(i * 4, true)) };
}

/**
 * Lecture seule de l'état pour le banc : le journal (`LectureDuJournal`) et, si l'état en a (version 13), les gestes
 * (`gestes` : null sans journal des gestes).
 */
export type JournalEnLecture = LectureDuJournal & { version: number; gestes(): Promise<GestesDuBanc | null>; fermer(): void };

export function ouvrirJournalEnLecture(chemin: string): JournalEnLecture {
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
		// l'instant du dernier /clear, si la base le porte (sinon : rien de plus qu'avant)
		const avecDebut = sessions.has('dernier_debut_ms');
		const champsSession = `id, profil, dossier, position${avecDebut ? ', dernier_debut_ms' : ''}`;
		const session = (l: Ligne): SessionDuJournal => ({
			id: String(l.id),
			profil: String(l.profil),
			dossier: String(l.dossier),
			position: String(l.position),
			...(typeof l.dernier_debut_ms === 'number' ? { dernierDebutMs: l.dernier_debut_ms } : {}),
		});
		return {
			version,
			async sessions() {
				return (base.prepare(`SELECT ${champsSession} FROM sessions ORDER BY creee_ms, id`).all() as Ligne[]).map(session);
			},
			async session(id) {
				const l = base.prepare(`SELECT ${champsSession} FROM sessions WHERE id = ?`).get(id) as Ligne | undefined;
				return l === undefined ? null : session(l);
			},
			async messages(id, limite) {
				const lignes = base
					// les débuts journalisés (remises à zéro) bornent la recherche du message d'avant
					.prepare("SELECT moment, horodatage_ms, demande, muet, position, ids FROM servis WHERE session = ? AND moment IN ('message', 'debut') ORDER BY rang DESC LIMIT ?")
					.all(id, limite) as Ligne[];
				return lignes.map(
					(l): EntreeDuJournal => ({
						moment: l.moment === 'debut' ? 'debut' : 'message',
						horodatageMs: Number(l.horodatage_ms),
						demande: (l.demande as string | null) ?? null,
						muet: (l.muet as RaisonMuet | null) ?? null,
						position: (l.position as string | null) ?? null,
						ids: idsDe(l.ids),
					}),
				);
			},
			async gestes() {
				const tables = new Set((base.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Ligne[]).map((l) => String(l.name)));
				if (!tables.has('gestes')) return null;
				const gestes = (
					base.prepare('SELECT geste, session, rang_message, horodatage_ms, dossier, position, fiche, modele_vecteur, vecteur FROM gestes ORDER BY rang').all() as Ligne[]
				).map(
					(l): GesteDApriori => ({
						geste: l.geste as Geste,
						session: String(l.session),
						rangMessage: Number(l.rang_message),
						horodatageMs: Number(l.horodatage_ms),
						dossier: String(l.dossier),
						position: (l.position as string | null) ?? null,
						fiche: String(l.fiche),
						vecteur: vecteurDe((l.vecteur as Uint8Array | null) ?? null, (l.modele_vecteur as string | null) ?? null),
					}),
				);
				const ecartees = tables.has('ecartees_toujours') && colonnes('ecartees_toujours').has('retablie_ms')
					? (base.prepare('SELECT fiche FROM ecartees_toujours WHERE retablie_ms IS NULL').all() as Ligne[]).map((l) => String(l.fiche))
					: [];
				const dossiers = (base.prepare('SELECT id, dossier FROM sessions').all() as Ligne[]).map((l) => [String(l.id), String(l.dossier)] as const);
				return { gestes, ecarteesToujours: new Set(ecartees), dossierDe: new Map(dossiers) };
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
