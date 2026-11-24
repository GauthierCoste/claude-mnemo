import { Worker } from 'node:worker_threads';
import { messageDErreur } from '../domaine/texte.ts';
import { extractionEnEtapes } from '../application/extraire-passages.ts';
import type { DecoupeSansPieces, EtapesExtraction, ExtraitSansPieces, IssuePiece } from '../application/extraire-passages.ts';
import type { Contenu, Extraction } from '../application/ports.ts';
import type { Travail } from './extraction-travailleur.ts';

export const MEMOIRE_MAX_MO = 1024;
/** Délai d'extraction d'un fichier, plus `DELAI_PAR_GO_MS` par Go : une boîte de 10 Go se lit message par message. */
export const DELAI_MAX_MS = 120_000;
export const DELAI_PAR_GO_MS = 120_000;
export const TROP_LOURD = 'document trop lourd à extraire (mémoire ou délai de l\'extraction dépassé)';

export type OptionsIsolement = { memoireMo?: number; delaiMs?: number; delaiParGoMs?: number; script?: URL; textePiecesMax?: number };

/** Du fil au processus : une demande de morceau du fichier, l'issue d'une pièce jointe, ou le résultat. */
export type MessageDuFil =
	| { type: 'lire'; id: number; position: number; longueur: number }
	| { type: 'piece'; issue: IssuePiece }
	| { type: 'resultat'; resultat: unknown };
/** Du processus au fil : le morceau demandé, ou pourquoi il n'a pas pu être lu. */
export type MessageVersLeFil = { id: number; octets?: Uint8Array; erreur?: string };

const message = messageDErreur;

/**
 * Extraction dans des fils d'exécution à part (`node:worker_threads`) : tas borné (`resourceLimits`) et délai dur
 * (`terminate`, `delaiMs` plus `delaiParGoMs` par Go lu). Un document qui dépasse l'un ou l'autre ne fait tomber ni le
 * processus ni l'index : il rend « document trop lourd à extraire ». Deux temps (`EtapesExtraction`) : un fil pour le
 * fichier sans ses pièces jointes, puis un fil pour ses pièces, une à une, chaque issue transmise dès qu'elle est prête ; si
 * ce fil tombe sur une pièce (PDF corrompu, mémoire), elle seule échoue et un nouveau fil reprend les suivantes. Le délai de
 * ce fil court par pièce (taille de son message). Les bibliothèques d'extraction ne sont chargées que dans ces fils. Le
 * fichier n'est pas copié au fil : le fil en demande les morceaux (`MessageDuFil` `lire`), lus ici dans le `Contenu` de
 * l'appelant et transférés un à un. Ce que le fil écrit sur stdout/stderr est lu et jeté : rien n'atteint le stdout du
 * processus (protocole MCP), et le fil ne bloque jamais sur un tampon plein.
 */
export function extractionIsolee(options: OptionsIsolement = {}): Extraction {
	const memoireMo = options.memoireMo ?? MEMOIRE_MAX_MO;
	const delaiMs = options.delaiMs ?? DELAI_MAX_MS;
	const delaiParGoMs = options.delaiParGoMs ?? DELAI_PAR_GO_MS;
	const script = options.script ?? new URL('./extraction-travailleur.ts', import.meta.url);
	const delaiPour = (octets: number): number => delaiMs + Math.round((octets / 1024 ** 3) * delaiParGoMs);

	/**
	 * Lance un fil sur `travail` ; tout échec (création, mémoire, délai, sortie) devient `echec(motif)`, jamais une exception.
	 * `surPiece` : chaque issue de pièce transmise ; elle rend la taille lue pour la suivante, dont le délai repart de zéro.
	 */
	function lancer<T>(travail: Travail, contenu: Contenu, echec: (motif: string) => T, delaiInitial: number, surPiece?: (issue: IssuePiece) => number): Promise<T> {
		return new Promise((resoudre) => {
			let fini = false;
			let travailleur: Worker | null = null;
			let minuteur: ReturnType<typeof setTimeout> | undefined;
			const terminer = (resultat: T): void => {
				if (fini) return;
				fini = true;
				clearTimeout(minuteur);
				if (travailleur !== null) void travailleur.terminate();
				resoudre(resultat);
			};
			const armer = (ms: number): void => {
				clearTimeout(minuteur);
				minuteur = setTimeout(() => terminer(echec(TROP_LOURD)), ms);
			};
			try {
				travailleur = new Worker(script, {
					workerData: travail,
					resourceLimits: { maxOldGenerationSizeMb: memoireMo, maxYoungGenerationSizeMb: Math.min(64, memoireMo / 4) },
					stdout: true,
					stderr: true,
				});
			} catch (erreur) {
				// création impossible (script introuvable, limites refusées, trop de fils…) : un échec lisible
				terminer(echec(`extraction impossible : ${message(erreur)}`));
				return;
			}
			travailleur.stdout.resume();
			travailleur.stderr.resume();
			armer(delaiInitial);
			const fil = travailleur;
			fil.on('message', (m: MessageDuFil) => {
				if (fini) return;
				if (m.type === 'resultat') return terminer(m.resultat as T);
				if (m.type === 'piece') {
					if (surPiece !== undefined) armer(delaiPour(surPiece(m.issue)));
					return;
				}
				contenu.lire(m.position, m.longueur).then(
					(lu) => {
						if (fini) return;
						// copie à part (pas `slice`, qui sur un Buffer n'est qu'une vue) : transférée au fil sans détacher le tampon de l'appelant
						const octets = new Uint8Array(lu);
						fil.postMessage({ id: m.id, octets } satisfies MessageVersLeFil, [octets.buffer]);
					},
					(erreur: unknown) => {
						if (!fini) fil.postMessage({ id: m.id, erreur: message(erreur) } satisfies MessageVersLeFil);
					},
				);
			});
			travailleur.once('error', (erreur: Error & { code?: string }) => {
				const lourd = erreur.code === 'ERR_WORKER_OUT_OF_MEMORY' || /heap out of memory|memory limit/iu.test(erreur.message);
				terminer(echec(lourd ? TROP_LOURD : `extraction impossible : ${erreur.message}`));
			});
			travailleur.once('exit', () => terminer(echec(TROP_LOURD)));
		});
	}

	const etapes: EtapesExtraction = {
		decouper(chemin, contenu) {
			const travail: Travail = { mode: 'decouper', chemin, taille: contenu.taille };
			return lancer(travail, contenu, (motif): DecoupeSansPieces => ({ decoupe: { ok: false, motif }, aExtraire: [] }), delaiPour(contenu.taille));
		},
		extraire(chemin, contenu, cibles) {
			const travail: Travail = { mode: 'extraire', chemin, taille: contenu.taille, cibles };
			const echec = (motif: string): ExtraitSansPieces => ({ resultats: cibles.map(() => ({ ok: false, motif })), aExtraire: cibles.map(() => null) });
			return lancer(travail, contenu, echec, delaiPour(contenu.taille));
		},
		async pieces(chemin, contenu, demandes, budget, rendre) {
			const taille = (i: number): number => (demandes[i] === undefined ? 0 : demandes[i].repere.fin - demandes[i].repere.debut);
			let rendues = 0;
			const travail: Travail = { mode: 'pieces', chemin, taille: contenu.taille, demandes, budget };
			const surPiece = (issue: IssuePiece): number => {
				rendre(issue);
				return taille(++rendues);
			};
			return lancer(travail, contenu, (motif): string | null => motif, delaiPour(taille(0)), surPiece).then((arret) => (rendues >= demandes.length ? null : arret));
		},
	};
	return extractionEnEtapes(etapes, options.textePiecesMax);
}
