import { readFileSync, statSync } from 'node:fs';
import { utimes, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { messageDErreur } from '../../domaine/texte.ts';
import type { Modeles, OptionsModele, Reranker, Sens } from '../../application/ports.ts';
import { piecesPourPlateforme } from './catalogue.ts';
import type { Piece } from './catalogue.ts';
import { dossierModeles } from './dossier.ts';
import { requeteLocale } from './http-local.ts';
import type { ReponseLocale } from './http-local.ts';
import { dossierPiece } from './installer.ts';
import { journaliser } from './journal.ts';
import { cheminsModeles, oublierServeur, serveurPret } from './serveurs.ts';
import type { EntreeServeur, TypeServeur } from './serveurs.ts';

/** Dimension des vecteurs de bge-m3 : toute autre est une réponse invalide. */
export const DIMENSION_SENS = 1024;
const LOT_SENS = 64;
/** Les pièces installées sont relues au plus toutes les 30 s (`modele()` ne fait pas d'autre accès disque). */
const VALIDITE_PIECES_MS = 30_000;

/** `env` : celui du gardien lancé et du dossier des modèles ; `plateforme`, `arch` : pour les pièces (tests). */
export type OptionsClient = { env?: NodeJS.ProcessEnv; plateforme?: NodeJS.Platform; arch?: string };

type Disponibles = { moteur: boolean; sens: Piece | null; reranker: Piece | null };

function installee(dossier: string, piece: Piece): boolean {
	try {
		const ici = dossierPiece(dossier, piece);
		if (readFileSync(join(ici, '.empreinte'), 'utf8').split('\n')[0]!.trim() !== piece.sha256) return false;
		return statSync(join(ici, ...piece.fichier.split('/'))).isFile();
	} catch {
		return false;
	}
}

/** Ce qui est installé, relu au plus toutes les 30 s. Le moteur peut être remplacé par `MNEMO_LLAMA_SERVEUR` (tests). */
function piecesDisponibles(options: OptionsClient): () => Disponibles {
	const env = options.env ?? process.env;
	const plateforme = options.plateforme ?? process.platform;
	const arch = options.arch ?? process.arch;
	let cache: { instant: number; valeur: Disponibles } | null = null;
	return () => {
		if (cache !== null && Date.now() - cache.instant < VALIDITE_PIECES_MS) return cache.valeur;
		const pieces = piecesPourPlateforme(plateforme, arch);
		let valeur: Disponibles = { moteur: false, sens: null, reranker: null };
		if (pieces !== null) {
			const dossier = dossierModeles(env, plateforme, homedir());
			const de = (nom: Piece['nom']) => {
				const piece = pieces.find((p) => p.nom === nom)!;
				return installee(dossier, piece) ? piece : null;
			};
			const remplacant = env['MNEMO_LLAMA_SERVEUR'];
			valeur = { moteur: (remplacant !== undefined && remplacant !== '') || de('moteur') !== null, sens: de('sens'), reranker: de('reranker') };
		}
		cache = { instant: Date.now(), valeur };
		return valeur;
	};
}

/** Marque une requête : le gardien s'arrête après un long moment sans. */
async function toucher(racine: string): Promise<void> {
	const fichier = cheminsModeles(racine).actif;
	const maintenant = new Date();
	try {
		await utimes(fichier, maintenant, maintenant);
	} catch {
		await writeFile(fichier, '').catch(() => {});
	}
}

/** Motif d'une réponse inutilisable, ou null si elle est bonne. */
function motifReponse(reponse: ReponseLocale | null): string | null {
	if (reponse === null) return 'délai dépassé ou serveur injoignable';
	if (reponse.statut !== 200) return `réponse HTTP ${reponse.statut}`;
	if (typeof reponse.corps !== 'object' || reponse.corps === null) return 'réponse mal formée';
	return null;
}

/** Une liste de `n` éléments `{ index, <champ> }` aux index tous distincts dans [0, n), ou null. */
function parIndex<T>(liste: unknown, n: number, lire: (element: Record<string, unknown>) => T | null): T[] | null {
	if (!Array.isArray(liste) || liste.length !== n) return null;
	const sortie: (T | undefined)[] = new Array(n);
	for (const element of liste) {
		if (typeof element !== 'object' || element === null) return null;
		const e = element as Record<string, unknown>;
		const index = e['index'];
		if (!Number.isInteger(index) || (index as number) < 0 || (index as number) >= n || sortie[index as number] !== undefined) return null;
		const valeur = lire(e);
		if (valeur === null) return null;
		sortie[index as number] = valeur;
	}
	return sortie as T[];
}

function vecteur(brut: unknown): Float32Array | null {
	if (!Array.isArray(brut) || brut.length !== DIMENSION_SENS) return null;
	const v = new Float32Array(DIMENSION_SENS);
	for (let i = 0; i < DIMENSION_SENS; i++) {
		const x = brut[i];
		if (typeof x !== 'number' || !Number.isFinite(x)) return null;
		v[i] = x;
	}
	return v;
}

type Appel<T> = (serveur: EntreeServeur, finMs: number) => Promise<T | string>;

/**
 * Trouve (ou démarre) le serveur, puis fait l'appel ; tout ce qui ne va pas rend null, avec une ligne de journal. Un appel rend
 * une valeur ou le motif de son échec.
 */
async function appeler<T>(racine: string, type: TypeServeur, options: OptionsModele & { env: NodeJS.ProcessEnv }, appel: Appel<T>): Promise<T | null> {
	const finMs = Date.now() + options.budgetMs;
	try {
		const serveur = await serveurPret(racine, type, { finMs, demarrer: options.demarrer, env: options.env });
		if (serveur === null) return null;
		await toucher(racine);
		const resultat = await appel(serveur, finMs);
		if (typeof resultat !== 'string') return resultat;
		if (!resultat.startsWith('délai')) oublierServeur(serveur);
		await journaliser(racine, `${type} : ${resultat}`);
		return null;
	} catch (erreur) {
		await journaliser(racine, `${type} : ${messageDErreur(erreur)}`);
		return null;
	}
}

/** Vecteurs de sens par le serveur local `bge-m3` (`POST /v1/embeddings`, lots de 64), dans le budget de l'appelant. */
export function sensLlama(racine: string, options: OptionsClient = {}): Sens {
	const disponibles = piecesDisponibles(options);
	const env = options.env ?? process.env;
	return {
		modele() {
			const sens = disponibles().sens;
			return sens === null ? null : `bge-m3@${sens.sha256.slice(0, 12)}`;
		},
		async vecteurs(textes, opts) {
			if (textes.length === 0) return [];
			const d = disponibles();
			if (!d.moteur || d.sens === null) return null;
			return appeler(racine, 'sens', { ...opts, env }, async (serveur, finMs) => {
				const sortie: Float32Array[] = [];
				for (let i = 0; i < textes.length; i += LOT_SENS) {
					const lot = textes.slice(i, i + LOT_SENS);
					const reponse = await requeteLocale(serveur.port, '/v1/embeddings', { cle: serveur.cle, finMs, corps: { input: lot } });
					const motif = motifReponse(reponse);
					if (motif !== null) return motif;
					let dimension: number | null = null;
					const vecteurs = parIndex((reponse!.corps as { data?: unknown }).data, lot.length, (e) => {
						const v = vecteur(e['embedding']);
						if (v === null && Array.isArray(e['embedding'])) dimension = e['embedding'].length;
						return v;
					});
					if (vecteurs === null) return dimension !== null && dimension !== DIMENSION_SENS ? `dimension ${dimension} au lieu de ${DIMENSION_SENS}` : 'réponse mal formée';
					sortie.push(...vecteurs);
				}
				return sortie;
			});
		},
	};
}

/** Notes du serveur local `bge-reranker-v2-m3` (`POST /v1/rerank`), une par texte, dans le budget de l'appelant. */
export function rerankerLlama(racine: string, options: OptionsClient = {}): Reranker {
	const disponibles = piecesDisponibles(options);
	const env = options.env ?? process.env;
	return {
		async noter(requete, textes, opts) {
			if (textes.length === 0) return [];
			const d = disponibles();
			if (!d.moteur || d.reranker === null) return null;
			return appeler(racine, 'reranker', { ...opts, env }, async (serveur, finMs) => {
				const reponse = await requeteLocale(serveur.port, '/v1/rerank', { cle: serveur.cle, finMs, corps: { query: requete, documents: textes } });
				const motif = motifReponse(reponse);
				if (motif !== null) return motif;
				const notes = parIndex((reponse!.corps as { results?: unknown }).results, textes.length, (e) => {
					const note = e['relevance_score'];
					return typeof note === 'number' && Number.isFinite(note) ? note : null;
				});
				return notes ?? 'réponse mal formée';
			});
		},
	};
}

/** Lecture de l'état des serveurs : brève (un serveur prêt répond tout de suite). */
const LECTURE_ETAT_MS = 300;
/** Démarrage demandé : le gardien est lancé, on n'attend pas son chargement au-delà. */
const ATTENTE_DEMARRAGE_MS = 1000;

/** Les modèles de ce dossier, vus du service : rien n'est lancé sans `demarrer` (geste de l'utilisateur). */
export function modelesLocaux(racine: string, options: OptionsClient = {}): Modeles {
	const disponibles = piecesDisponibles(options);
	const env = options.env ?? process.env;
	const installes = () => {
		const d = disponibles();
		return d.moteur && d.reranker !== null;
	};
	return {
		async etatReranker() {
			if (!installes()) return 'absent';
			return (await serveurPret(racine, 'reranker', { finMs: Date.now() + LECTURE_ETAT_MS, demarrer: false, env })) === null ? 'arrete' : 'pret';
		},
		async demarrer() {
			if (installes()) await serveurPret(racine, 'reranker', { finMs: Date.now() + ATTENTE_DEMARRAGE_MS, demarrer: true, env });
		},
	};
}
