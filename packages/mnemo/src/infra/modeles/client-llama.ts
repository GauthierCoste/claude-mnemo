import { readFileSync, statSync } from 'node:fs';
import { utimes, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { modelesPermis } from '@mnemo/commun';
import type { OperationModele } from '@mnemo/commun';
import { messageDErreur } from '../../domaine/texte.ts';
import type { Modeles, OptionsModele, Reranker, Sens } from '../../application/ports.ts';
import { avecActivite, dossierActivite } from './activite.ts';
import { piecesPourPlateforme } from './catalogue.ts';
import type { Piece } from './catalogue.ts';
import { dossierModeles, dossierServeurs } from './dossier.ts';
import { requeteLocale } from './http-local.ts';
import type { ReponseLocale } from './http-local.ts';
import { inactiviteDuDossier } from './inactivite.ts';
import { dossierPiece } from './installer.ts';
import { journaliser } from './journal.ts';
import { changerNiveau, lireNiveau } from './niveau.ts';
import { surveillerDossiers } from '../surveillance-dossiers.ts';
import { lireEtatModeles, lirePiecesInstallees } from './etat-modeles.ts';
import type { PiecesInstallees } from './pieces-installees.ts';
import { arreterServeurs, cheminsModeles, oublierServeur, serveurPret } from './serveurs.ts';
import type { OptionsServeur } from './serveurs.ts';
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

/**
 * Ce qui est installé, relu au plus toutes les 30 s (`frais` : relu tout de suite, pour un geste de l'utilisateur). Le moteur
 * peut être remplacé par `MNEMO_LLAMA_SERVEUR` (tests).
 */
function piecesDisponibles(options: OptionsClient): (frais?: boolean) => Disponibles {
	const env = options.env ?? process.env;
	const plateforme = options.plateforme ?? process.platform;
	const arch = options.arch ?? process.arch;
	let cache: { instant: number; valeur: Disponibles } | null = null;
	return (frais = false) => {
		if (!frais && cache !== null && Date.now() - cache.instant < VALIDITE_PIECES_MS) return cache.valeur;
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

/**
 * Où trouver les serveurs (`serveurs/` du cache, un gardien pour la machine), et ce que le gardien reçoit s'il est lancé : son
 * environnement et l'inactivité tolérée par le dossier Mnemo `racine` (son réglage `modeles.inactiviteMinutes`). La racine ne
 * sert qu'à cela : l'état des serveurs ne dépend d'aucun dossier.
 */
function lieuDesServeurs(racine: string, options: OptionsClient): { racine: string; dossier: () => string; serveur: Pick<OptionsServeur, 'env' | 'inactiviteMs'> } {
	const env = options.env ?? process.env;
	const plateforme = options.plateforme ?? process.platform;
	const dossier = () => dossierServeurs(env, plateforme, homedir());
	return {
		racine,
		dossier,
		serveur: { env, inactiviteMs: () => inactiviteDuDossier(racine, env, (m) => void journaliser(dossier(), `réglages de ${racine} : ${m}`)) },
	};
}

/** Marque une requête : le gardien s'arrête après un long moment sans. */
async function toucher(dossier: string): Promise<void> {
	const fichier = cheminsModeles(dossier).actif;
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
 * une valeur ou le motif de son échec. `demarrer` faux (hooks) : sans serveur prêt, le gardien est lancé sans être attendu,
 * l'appel rend null aussitôt et les suivants trouveront les modèles. Un modèle exclu par le niveau de la machine rend null
 * tout de suite, sans rien lancer ni appeler : le niveau est relu à chaque appel (un petit fichier, bien moins coûteux que
 * l'appel lui-même), si bien qu'un changement vaut dès l'appel suivant. L'appel fait au serveur est affiché le temps qu'il
 * dure (`avecActivite`) : son opération (`operation` faute d'en avoir une dans `options.activite`), sa session, son
 * avancement ; un appel qui ne touche aucun serveur n'affiche rien.
 */
async function appeler<T>(lieu: ReturnType<typeof lieuDesServeurs>, type: TypeServeur, operation: OperationModele, options: OptionsModele, appel: Appel<T>): Promise<T | null> {
	const finMs = Date.now() + options.budgetMs;
	const dossier = lieu.dossier();
	if (!modelesPermis(await lireNiveau(dossier))[type]) return null;
	try {
		const serveur = await serveurPret(dossier, type, { finMs, demarrage: options.demarrer ? 'attendre' : 'sans-attendre', ...lieu.serveur });
		if (serveur === null) return null;
		await toucher(dossier);
		const a = options.activite;
		const description = { operation: a?.operation ?? operation, dossier: lieu.racine, session: a?.session ?? null, jusqueMs: finMs, avancement: a?.avancement ?? null };
		const resultat = await avecActivite(dossier, description, () => appel(serveur, finMs));
		if (typeof resultat !== 'string') return resultat;
		if (!resultat.startsWith('délai')) oublierServeur(serveur);
		await journaliser(dossier, `${type} : ${resultat}`);
		return null;
	} catch (erreur) {
		await journaliser(dossier, `${type} : ${messageDErreur(erreur)}`);
		return null;
	}
}

/** Vecteurs de sens par le serveur local `bge-m3` (`POST /v1/embeddings`, lots de 64), dans le budget de l'appelant. */
export function sensLlama(racine: string, options: OptionsClient = {}): Sens {
	const disponibles = piecesDisponibles(options);
	const lieu = lieuDesServeurs(racine, options);
	return {
		modele() {
			const sens = disponibles().sens;
			return sens === null ? null : `bge-m3@${sens.sha256.slice(0, 12)}`;
		},
		async vecteurs(textes, opts) {
			if (textes.length === 0) return [];
			const d = disponibles();
			if (!d.moteur || d.sens === null) return null;
			return appeler(lieu, 'sens', textes.length > 1 ? 'vectorisation' : 'recherche', opts, async (serveur, finMs) => {
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
	const lieu = lieuDesServeurs(racine, options);
	return {
		async noter(requete, textes, opts) {
			if (textes.length === 0) return [];
			const d = disponibles();
			if (!d.moteur || d.reranker === null) return null;
			return appeler(lieu, 'reranker', 'recherche', opts, async (serveur, finMs) => {
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

/** Démarrage demandé : le gardien est lancé, on n'attend pas son chargement au-delà. */
const ATTENTE_DEMARRAGE_MS = 1000;

/** Fichiers de `serveurs/` qui changent l'état affiché : l'état du gardien, le niveau (et leurs temporaires), le dossier d'activité. */
const FICHIERS_D_ETAT = /^(modeles\.json|niveau\.json|activite$)/u;

/**
 * Les modèles de la machine, vus du service du dossier `racine` : l'état seul ne lance rien (`lireEtatModeles`, pièces relues
 * au plus toutes les 30 s) ; `demarrer` (geste de l'utilisateur : pièces relues, gardien relancé même juste après un échec) ;
 * `arreter` (`arreterServeurs`, le niveau ne change pas) ; `changerNiveau` ; `surveiller` : `serveurs/` (état, niveau) et
 * `serveurs/activite/`, dès qu'ils existent (jamais créés pour cela).
 */
export function modelesLocaux(racine: string, options: OptionsClient = {}): Modeles {
	const disponibles = piecesDisponibles(options);
	const lieu = lieuDesServeurs(racine, options);
	const env = options.env ?? process.env;
	const plateforme = options.plateforme ?? process.platform;
	let pieces: { instant: number; valeur: Promise<PiecesInstallees> } | null = null;
	const piecesRecentes = (): Promise<PiecesInstallees> => {
		if (pieces === null || Date.now() - pieces.instant >= VALIDITE_PIECES_MS) {
			const valeur = lirePiecesInstallees(options);
			pieces = { instant: Date.now(), valeur };
			// une lecture en échec n'est pas gardée
			valeur.catch(() => {
				if (pieces?.valeur === valeur) pieces = null;
			});
		}
		return pieces.valeur;
	};
	return {
		etat: async () => lireEtatModeles(racine, options, { pieces: await piecesRecentes() }),
		async demarrer() {
			// le gardien lance tous les modèles permis : il suffit d'en demander un, permis et installé ; aucun (`coupes`) : rien
			pieces = null;
			const d = disponibles(true);
			const permis = modelesPermis(await lireNiveau(lieu.dossier()));
			const type = (['reranker', 'sens'] as const).find((t) => permis[t] && d[t] !== null);
			if (d.moteur && type !== undefined)
				await serveurPret(lieu.dossier(), type, { finMs: Date.now() + ATTENTE_DEMARRAGE_MS, demarrage: 'attendre', forcer: true, ...lieu.serveur });
		},
		async arreter() {
			const r = await arreterServeurs(lieu.dossier(), env);
			return r === 'perime' ? 'rien' : r;
		},
		async changerNiveau(niveau) {
			await changerNiveau(env, niveau, plateforme);
		},
		surveiller(rappel) {
			const dossier = lieu.dossier();
			return surveillerDossiers([{ chemin: dossier, filtre: (nom) => nom === null || FICHIERS_D_ETAT.test(nom) }, { chemin: dossierActivite(dossier) }], rappel);
		},
	};
}
