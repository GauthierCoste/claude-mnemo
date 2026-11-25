import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmod, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { reessayer } from '../reessayer.ts';
import { verrouFichier } from '../verrou-fichier.ts';
import { requeteLocale } from './http-local.ts';
import { VARIABLE_INACTIVITE } from './inactivite.ts';
import { journaliser } from './journal.ts';

export type TypeServeur = 'sens' | 'reranker';
/** Un `llama-server` en marche : `modele` = nom du fichier gguf, `pid` = celui du serveur, `depuis` = date ISO. */
export type EntreeServeur = { port: number; cle: string; modele: string; pid: number; depuis: string };
/** `demarrage` : serveurs en chargement ; `pret` ; `echec` : le dernier démarrage a échoué (pas de nouvel essai avant une minute). */
export type EtatGardien = 'demarrage' | 'pret' | 'echec';
/** Contenu de `serveurs/modeles.json` (droits 0600 : il contient les clés). */
export type EtatServeurs = {
	/** `inactiviteMs` : l'inactivité tolérée par le gardien (écrite par lui ; absente avant sa première publication). */
	gardien: { pid: number; depuis: string; etat: EtatGardien; inactiviteMs?: number };
	sens?: EntreeServeur;
	reranker?: EntreeServeur;
};

/** Un démarrage plus vieux que cela, gardien toujours là, est tenu pour bloqué : un autre peut le remplacer. */
export const AGE_MAX_DEMARRAGE_MS = 3 * 60_000;
/** Après un démarrage en échec, pas de nouvel essai pendant ce temps (un appel ne relance pas un gardien voué à échouer). */
export const PAUSE_APRES_ECHEC_MS = 60_000;
/** Attente de l'arrêt du gardien par `mnemo modeles arreter`, avant de tuer ses serveurs. */
const ATTENTE_ARRET_MS = 5_000;
const PAUSE_SONDAGE_MS = 100;

const MAIN = fileURLToPath(new URL('../../adaptateurs/cli/main.ts', import.meta.url));

/**
 * Fichiers d'état des serveurs dans `dossier` : `serveurs/` du cache des modèles (`dossierServeurs`), un seul pour la machine.
 * Les noms sont ceux de l'ancien état par dossier Mnemo (`.mnemo/`), que la migration arrête avec ce même code.
 */
export function cheminsModeles(dossier: string): { etat: string; lances: string; verrou: string; actif: string; journal: string } {
	return {
		etat: join(dossier, 'modeles.json'),
		lances: join(dossier, 'modeles-lances.json'),
		verrou: join(dossier, 'modeles.verrou'),
		actif: join(dossier, 'modeles.actif'),
		journal: join(dossier, 'modeles.log'),
	};
}

/** Fichier de clé d'un serveur (`modeles-<type>-<hasard>.cle`), lu par llama-server à son démarrage seulement. */
export const MOTIF_FICHIER_CLE = /^modeles-.+\.cle$/u;

/** Crée `serveurs/` (droits 0700 : il contient les clés) ; seuls le gardien et qui le lance le créent. */
export async function preparerDossierServeurs(dossier: string): Promise<void> {
	await mkdir(dossier, { recursive: true, mode: 0o700 });
	await chmod(dossier, 0o700).catch(() => {});
}

/** Le processus existe (EPERM : il existe mais appartient à un autre). */
export function pidVivant(pid: number): boolean {
	if (!Number.isInteger(pid) || pid <= 0) return false;
	try {
		process.kill(pid, 0);
		return true;
	} catch (erreur) {
		return (erreur as NodeJS.ErrnoException).code === 'EPERM';
	}
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

function lireEntree(brut: unknown): EntreeServeur | undefined | null {
	if (brut === undefined) return undefined;
	if (typeof brut !== 'object' || brut === null) return null;
	const e = brut as Record<string, unknown>;
	const { port, cle, modele, pid, depuis } = e;
	if (!Number.isInteger(port) || (port as number) <= 0 || (port as number) > 65535) return null;
	if (typeof cle !== 'string' || typeof modele !== 'string' || typeof depuis !== 'string' || !Number.isInteger(pid)) return null;
	return { port: port as number, cle, modele, pid: pid as number, depuis };
}

/** État lu dans `modeles.json`, ou null s'il manque ou ne se lit pas. */
export async function lireEtatServeurs(dossier: string): Promise<EtatServeurs | null> {
	let brut: unknown;
	try {
		brut = JSON.parse(await readFile(cheminsModeles(dossier).etat, 'utf8'));
	} catch {
		return null;
	}
	if (typeof brut !== 'object' || brut === null) return null;
	const { gardien, sens, reranker } = brut as Record<string, unknown>;
	if (typeof gardien !== 'object' || gardien === null) return null;
	const g = gardien as Record<string, unknown>;
	if (!Number.isInteger(g['pid']) || typeof g['depuis'] !== 'string' || !['demarrage', 'pret', 'echec'].includes(g['etat'] as string)) return null;
	const s = lireEntree(sens);
	const r = lireEntree(reranker);
	if (s === null || r === null) return null;
	const inactiviteMs = g['inactiviteMs'];
	return {
		gardien: {
			pid: g['pid'] as number,
			depuis: g['depuis'] as string,
			etat: g['etat'] as EtatGardien,
			...(Number.isInteger(inactiviteMs) && (inactiviteMs as number) > 0 ? { inactiviteMs: inactiviteMs as number } : {}),
		},
		...(s === undefined ? {} : { sens: s }),
		...(r === undefined ? {} : { reranker: r }),
	};
}

/** Écrit un fichier JSON d'un coup (temporaire puis renommage), droits 0600. Ne crée pas le dossier (`preparerDossierServeurs`). */
export async function ecrireJson(fichier: string, valeur: unknown): Promise<void> {
	const temporaire = `${fichier}.tmp-${randomBytes(6).toString('hex')}`;
	try {
		await writeFile(temporaire, `${JSON.stringify(valeur, null, '\t')}\n`, { mode: 0o600 });
		await chmod(temporaire, 0o600);
		await reessayer(() => rename(temporaire, fichier));
	} finally {
		await rm(temporaire, { force: true });
	}
}

/** Écrit l'état d'un coup (temporaire puis renommage), droits 0600. */
export async function ecrireEtatServeurs(dossier: string, etat: EtatServeurs): Promise<void> {
	await ecrireJson(cheminsModeles(dossier).etat, etat);
}

/** Retire `modeles.json` s'il nomme encore ce gardien (un autre a pu le remplacer). */
export async function retirerEtatDuGardien(dossier: string, pid: number): Promise<void> {
	const etat = await lireEtatServeurs(dossier);
	if (etat !== null && etat.gardien.pid === pid) await rm(cheminsModeles(dossier).etat, { force: true });
}

/** Serveurs dont l'identité a été vérifiée par ce processus (pid, port et clé). */
const verifies = new Set<string>();
const cleDe = (e: EntreeServeur) => `${e.pid}:${e.port}:${e.cle}`;

/** À appeler quand un serveur a mal répondu : la prochaine fois, son identité sera revérifiée. */
export function oublierServeur(entree: EntreeServeur): void {
	verifies.delete(cleDe(entree));
}

/**
 * Un serveur est le nôtre si, avant `finMs` : son pid vit ; `GET /v1/models` SANS clé répond 401 (il exige une clé) ; et
 * AVEC sa clé répond 200 en nommant le bon modèle (`data[0].id`, dont le nom de fichier doit être `modele`). `/health` est
 * public, il ne prouve rien. Un serveur qui échoue n'est jamais tué : il est oublié, et le démarrage suivant le remplace.
 */
export async function verifierServeur(entree: EntreeServeur, finMs: number): Promise<boolean> {
	if (!pidVivant(entree.pid)) {
		oublierServeur(entree);
		return false;
	}
	if (verifies.has(cleDe(entree))) return true;
	const [sansCle, avecCle] = await Promise.all([
		requeteLocale(entree.port, '/v1/models', { cle: null, finMs }),
		requeteLocale(entree.port, '/v1/models', { cle: entree.cle, finMs }),
	]);
	if (sansCle?.statut !== 401 || avecCle?.statut !== 200) return false;
	const donnees = (avecCle.corps as { data?: unknown } | undefined)?.data;
	const id = Array.isArray(donnees) ? (donnees[0] as { id?: unknown } | undefined)?.id : undefined;
	if (typeof id !== 'string' || posix.basename(id.replaceAll('\\', '/')) !== entree.modele) return false;
	verifies.add(cleDe(entree));
	return true;
}

/** Serveurs de l'état qui répondent avec leur clé (ceux-là seuls peuvent être arrêtés sans risque de viser un pid réutilisé). */
export async function serveursVerifies(etat: EtatServeurs, finMs: number): Promise<{ type: TypeServeur; entree: EntreeServeur }[]> {
	const types = (['sens', 'reranker'] as const).filter((t) => etat[t] !== undefined);
	const ok = await Promise.all(types.map((t) => verifierServeur(etat[t]!, finMs)));
	return types.filter((_, i) => ok[i]).map((type) => ({ type, entree: etat[type]! }));
}

/**
 * SIGTERM puis, s'il vit encore après 3 s, SIGKILL. L'attente se fait en arrière-plan (sondage toutes les 100 ms) : un
 * processus court reste en vie au plus 3 s pour elle, et seulement dans ce cas rare (serveurs d'un gardien tué net).
 */
export function terminerProcessus(pid: number): void {
	try {
		process.kill(pid, 'SIGTERM');
	} catch {
		return;
	}
	const fin = Date.now() + 3_000;
	const sonde = setInterval(() => {
		if (!pidVivant(pid)) clearInterval(sonde);
		else if (Date.now() >= fin) {
			clearInterval(sonde);
			try {
				process.kill(pid, 'SIGKILL');
			} catch {
				/* déjà parti */
			}
		}
	}, 100);
}

/** Chargement d'un modèle : au-delà, un serveur qui ne répond pas n'est plus tenu pour nôtre. `MNEMO_MODELES_CHARGEMENT_MS` (tests). */
export const CHARGEMENT_MAX_MS = 120_000;

export function chargementMaxMs(env: NodeJS.ProcessEnv = process.env): number {
	const v = Number(env['MNEMO_MODELES_CHARGEMENT_MS']);
	return v > 0 ? v : CHARGEMENT_MAX_MS;
}

/**
 * Un `llama-server` lancé par un gardien (`gardien` : son pid ; `piece` : nom du fichier gguf), noté dans
 * `modeles-lances.json` dès son lancement, avant même d'être prêt. Ce registre n'est jamais écrasé ni retiré en bloc :
 * seulement élagué entrée par entrée (`nettoyerLances`), si bien qu'un serveur dont le gardien a été tué en plein chargement
 * reste retrouvable.
 */
export type ServeurLance = { pid: number; port: number; cle: string; piece: string; lanceMs: number; gardien: number };

function lireLance(brut: unknown): ServeurLance | null {
	if (typeof brut !== 'object' || brut === null) return null;
	const { pid, port, cle, piece, lanceMs, gardien } = brut as Record<string, unknown>;
	if (!Number.isInteger(pid) || !Number.isInteger(port) || !Number.isInteger(gardien) || typeof lanceMs !== 'number') return null;
	if (typeof cle !== 'string' || typeof piece !== 'string') return null;
	return { pid: pid as number, port: port as number, cle, piece, lanceMs, gardien: gardien as number };
}

/** Registre des serveurs lancés (vide s'il manque ; les entrées illisibles sont ignorées). */
export async function lireLances(dossier: string): Promise<ServeurLance[]> {
	try {
		const brut = JSON.parse(await readFile(cheminsModeles(dossier).lances, 'utf8')) as { lances?: unknown };
		return Array.isArray(brut.lances) ? brut.lances.map(lireLance).filter((l): l is ServeurLance => l !== null) : [];
	} catch {
		return [];
	}
}

const ecrireLances = (dossier: string, lances: ServeurLance[]) => ecrireJson(cheminsModeles(dossier).lances, { lances });

/**
 * Verrou de `modeles.verrou` (sans créer le dossier : absent, le verrou échoue) ; `finMs` borne l'attente (sinon l'attente par
 * défaut, une trentaine de secondes).
 */
export function verrouModeles(dossier: string, finMs?: number) {
	if (finMs === undefined) return verrouFichier(cheminsModeles(dossier).verrou, { creerDossier: false });
	return verrouFichier(cheminsModeles(dossier).verrou, { essais: Math.max(1, Math.ceil((finMs - Date.now()) / 40)), delaiMin: 20, facteur: 1, delaiMax: 20, creerDossier: false });
}

/** Ajoute un serveur au registre (sous le verrou). */
export async function noterLance(dossier: string, lance: ServeurLance): Promise<void> {
	await verrouModeles(dossier).avec(async () => ecrireLances(dossier, [...(await lireLances(dossier)), lance]));
}

/** Retire ces pids du registre (sous le verrou ; abandonné si le verrou reste pris jusqu'à `finMs`). */
export async function retirerLances(dossier: string, pids: number[], finMs = Date.now() + 2000): Promise<void> {
	await verrouModeles(dossier, finMs).avec(async () => ecrireLances(dossier, (await lireLances(dossier)).filter((l) => !pids.includes(l.pid))));
}

/**
 * Élague le registre ; À APPELER SOUS LE VERROU. Pour chaque entrée : pid mort → retirée ; vérifiée avec sa clé → arrêtée
 * (SIGTERM, SIGKILL après 3 s) puis retirée, sauf si elle appartient au gardien `garder` ; vivante, non vérifiée, plus jeune
 * que le chargement maximal → gardée (elle charge peut-être encore) ; plus vieille → retirée sans signal (pas à nous, ou pid
 * réutilisé). Retire aussi les fichiers de clé `.cle` plus vieux que le chargement maximal. Rend le nombre de serveurs arrêtés
 * et celui des serveurs d'un autre gardien gardés parce qu'ils chargent peut-être encore.
 */
async function elaguerLances(dossier: string, garder: number | null, chargementMs: number): Promise<Elagage> {
	const lances = await lireLances(dossier);
	const gardes: ServeurLance[] = [];
	let arretes = 0;
	let enChargement = 0;
	const verifs = await Promise.all(
		lances.map((l) =>
			pidVivant(l.pid) && l.gardien !== garder
				? verifierServeur({ pid: l.pid, port: l.port, cle: l.cle, modele: l.piece, depuis: '' }, Date.now() + 1000)
				: Promise.resolve(false),
		),
	);
	for (const [i, l] of lances.entries()) {
		if (!pidVivant(l.pid)) continue;
		if (l.gardien === garder) gardes.push(l);
		else if (verifs[i]) {
			await journaliser(dossier, `serveur ${l.piece} sans gardien arrêté (pid ${l.pid})`);
			terminerProcessus(l.pid);
			arretes++;
		} else if (Date.now() - l.lanceMs < chargementMs) {
			gardes.push(l);
			enChargement++;
		}
	}
	if (gardes.length !== lances.length) await ecrireLances(dossier, gardes);
	try {
		for (const nom of await readdir(dossier)) {
			if (!MOTIF_FICHIER_CLE.test(nom)) continue;
			const fichier = join(dossier, nom);
			if (Date.now() - (await stat(fichier)).mtimeMs > chargementMs) await rm(fichier, { force: true });
		}
	} catch {
		/* dossier illisible : rien à retirer */
	}
	return { arretes, enChargement };
}

/** Bilan d'un élagage : serveurs arrêtés, serveurs (d'un autre gardien) gardés parce qu'ils chargent peut-être encore. */
export type Elagage = { arretes: number; enChargement: number };

/** `elaguerLances` sous le verrou (abandonné si le verrou reste pris jusqu'à `finMs`, ou sans dossier). */
export async function nettoyerLances(dossier: string, options: { garder: number | null; env?: NodeJS.ProcessEnv; finMs?: number }): Promise<Elagage> {
	try {
		return await verrouModeles(dossier, options.finMs ?? Date.now() + 3000).avec(() => elaguerLances(dossier, options.garder, chargementMaxMs(options.env)));
	} catch {
		return { arretes: 0, enChargement: 0 };
	}
}

/** Pour qui tient déjà le verrou (le gardien à son démarrage). */
export const nettoyerLancesSousVerrou = (dossier: string, garder: number | null, env?: NodeJS.ProcessEnv) =>
	elaguerLances(dossier, garder, chargementMaxMs(env));

async function utilisable(etat: EtatServeurs | null, type: TypeServeur, finMs: number): Promise<EntreeServeur | null> {
	const entree = etat?.[type];
	if (etat === null || entree === undefined || !pidVivant(etat.gardien.pid)) return null;
	return (await verifierServeur(entree, finMs)) ? entree : null;
}

const age = (depuis: string) => Date.now() - (Date.parse(depuis) || 0);

/**
 * Faut-il laisser faire le gardien nommé (plutôt qu'en lancer un) ? Oui s'il démarre (récemment), s'il est prêt mais sans ce
 * modèle (pièce absente à son lancement), ou si le dernier démarrage a échoué il y a moins d'une minute. Un gardien mort en
 * plein démarrage (sans avoir pu écrire `echec`) compte comme un échec : pas de relance pendant une minute, sinon chaque
 * hook relancerait un gardien voué à mourir.
 */
function gardienEnCharge(etat: EtatServeurs | null, type: TypeServeur, forcer = false): boolean {
	if (etat === null) return false;
	const { pid, depuis, etat: phase } = etat.gardien;
	// un geste explicite (« Démarrer ») relance même pendant la pause qui suit un échec
	if (phase === 'echec') return !forcer && age(depuis) < PAUSE_APRES_ECHEC_MS;
	if (!pidVivant(pid)) return !forcer && phase === 'demarrage' && age(depuis) < PAUSE_APRES_ECHEC_MS;
	if (phase === 'demarrage') return age(depuis) < AGE_MAX_DEMARRAGE_MS;
	return etat[type] === undefined;
}

/** Résout `undefined` à `finMs` si la promesse n'a pas fini (elle continue en arrière-plan). */
function avant<T>(promesse: Promise<T>, finMs: number): Promise<T | undefined> {
	return new Promise((resoudre, rejeter) => {
		const minuteur = setTimeout(() => resoudre(undefined), Math.max(0, finMs - Date.now()));
		promesse.then(
			(v) => {
				clearTimeout(minuteur);
				resoudre(v);
			},
			(e: unknown) => {
				clearTimeout(minuteur);
				rejeter(e);
			},
		);
	});
}

/** Variables transmises au gardien : de quoi trouver le cache des modèles, les fichiers temporaires, et les réglages `MNEMO_*`. */
const VARIABLES_GARDIEN = ['HOME', 'USERPROFILE', 'PATH', 'SYSTEMROOT', 'TEMP', 'TMP', 'TMPDIR', 'LOCALAPPDATA', 'XDG_CACHE_HOME'];

export function environnementGardien(env: NodeJS.ProcessEnv): Record<string, string> {
	const sortie: Record<string, string> = {};
	for (const [nom, valeur] of Object.entries(env)) {
		if (valeur === undefined) continue;
		const majuscules = nom.toUpperCase();
		if (VARIABLES_GARDIEN.includes(majuscules) || majuscules.startsWith('MNEMO_')) sortie[nom] = valeur;
	}
	return sortie;
}

/**
 * Crée `serveurs/` puis, sous son verrou, relit l'état et, si personne ne s'en charge, lance `mnemo modeles garde` détaché,
 * avec l'inactivité tolérée par le dossier qui le lance (`MNEMO_MODELES_INACTIVITE_MS`).
 */
async function lancerGardien(dossier: string, type: TypeServeur, finMs: number, env: NodeJS.ProcessEnv, inactiviteMs: (() => number) | undefined, forcer: boolean): Promise<void> {
	const tentative = (async () => {
		await preparerDossierServeurs(dossier);
		await verrouModeles(dossier, finMs).avec(async () => {
			const etat = await lireEtatServeurs(dossier);
			if ((await utilisable(etat, type, Math.max(finMs, Date.now() + 500))) !== null || gardienEnCharge(etat, type, forcer)) return;
			// Serveurs d'un gardien disparu (tué net, même en plein chargement) : retrouvés par le registre, arrêtés s'ils répondent
			// avec leur clé. Ceux du gardien encore vivant sont laissés : remplacé, il s'arrête de lui-même avec ses serveurs.
			const vivant = etat !== null && pidVivant(etat.gardien.pid) ? etat.gardien.pid : null;
			await elaguerLances(dossier, vivant, chargementMaxMs(env));
			const variables = environnementGardien(env);
			if (inactiviteMs !== undefined) variables[VARIABLE_INACTIVITE] = String(inactiviteMs());
			const enfant = spawn(process.execPath, [MAIN, 'modeles', 'garde'], { detached: true, stdio: 'ignore', windowsHide: true, env: variables });
			enfant.on('error', () => {});
			enfant.unref();
			if (enfant.pid === undefined) return;
			await ecrireEtatServeurs(dossier, { gardien: { pid: enfant.pid, depuis: new Date().toISOString(), etat: 'demarrage' } });
			await journaliser(dossier, `gardien lancé (pid ${enfant.pid}) pour le ${type}`);
		});
	})();
	try {
		await avant(tentative, finMs);
	} catch {
		// verrou occupé : un autre processus démarre le gardien
	}
	tentative.catch(() => {});
}

/**
 * Sans serveur prêt : `attendre`, lancer le gardien puis attendre qu'il soit prêt (dans le budget) ; `sans-attendre`, le
 * lancer et rendre null aussitôt (un hook reste sur les mots pour ce tour, le suivant aura les modèles) ; `jamais`, ne rien
 * lancer (simple lecture de l'état).
 */
export type Demarrage = 'attendre' | 'sans-attendre' | 'jamais';

/**
 * `inactiviteMs` : l'inactivité tolérée transmise au gardien s'il est lancé (sinon la sienne par défaut). `forcer` : geste
 * explicite de l'utilisateur, pour un modèle permis et installé, qui relance le gardien même dans la minute qui suit un échec
 * (les appels automatiques, hooks et recherches, gardent cette pause), et remplace un gardien prêt à qui ce modèle manque.
 */
export type OptionsServeur = { finMs: number; demarrage: Demarrage; env?: NodeJS.ProcessEnv; inactiviteMs?: () => number; forcer?: boolean };

/**
 * Serveur de ce type prêt à répondre, ou null. Sans serveur utilisable, selon `demarrage`, lance le gardien (un seul pour toute
 * la machine), puis attend qu'il soit prêt, jamais au-delà de `finMs` : un premier chargement plus long rend null maintenant,
 * et les appels suivants trouveront le serveur en marche.
 */
export async function serveurPret(dossier: string, type: TypeServeur, options: OptionsServeur): Promise<EntreeServeur | null> {
	const { finMs, demarrage } = options;
	let etat = await lireEtatServeurs(dossier);
	const pret = await utilisable(etat, type, finMs);
	if (pret !== null || demarrage === 'jamais' || Date.now() >= finMs) return pret;
	const forcer = options.forcer === true;
	// geste explicite : un gardien prêt à qui manque ce modèle (permis et installé, garanti par l'appelant ; exclu par le niveau
	// à son lancement, ou qui n'avait pas chargé) est arrêté proprement, puis relancé avec tous les modèles permis
	if (forcer && etat !== null && etat.gardien.etat === 'pret' && pidVivant(etat.gardien.pid) && etat[type] === undefined) {
		await journaliser(dossier, `gardien prêt sans le ${type} : remplacé`);
		await arreterServeurs(dossier, options.env ?? process.env);
		etat = await lireEtatServeurs(dossier);
	}
	if (!gardienEnCharge(etat, type, forcer)) await lancerGardien(dossier, type, finMs, options.env ?? process.env, options.inactiviteMs, forcer);
	if (demarrage === 'sans-attendre') return null;
	for (;;) {
		const reste = finMs - Date.now();
		if (reste <= 0) return null;
		await pause(Math.min(PAUSE_SONDAGE_MS, reste));
		etat = await lireEtatServeurs(dossier);
		const entree = await utilisable(etat, type, finMs);
		if (entree !== null) return entree;
		// plus personne n'est en train de démarrer : abandon pour cet appel (pas de relance en boucle)
		if (etat === null || etat.gardien.etat !== 'demarrage' || !pidVivant(etat.gardien.pid)) return null;
	}
}

/** Un gardien en démarrage depuis moins que cela peut être arrêté sans serveur vérifié (ses serveurs chargent encore). */
const AGE_DEMARRAGE_ARRETABLE_MS = 2 * 60_000;

/** Résultat de `mnemo modeles arreter` ; `enChargement` : des serveurs d'un gardien disparu chargent encore (à relancer). */
export type ResultatArret = 'arrete' | 'perime' | 'rien' | { enChargement: number };

/**
 * `mnemo modeles arreter`. Seuls les processus prouvés nôtres sont visés : les serveurs qui répondent avec leur clé, et le
 * gardien si l'un d'eux répond ou s'il démarre depuis moins de 2 min. SIGTERM au gardien, attente de 5 s au plus, puis SIGKILL
 * des serveurs vérifiés encore vivants (le gardien a pu être tué net, ou ne pas recevoir de signal sous Windows). Des serveurs
 * du registre qui chargent encore (pas vérifiables) sont laissés : `{ enChargement }`, à relancer dans un instant. Un état
 * qui ne nomme rien de vérifiable (pids morts ou réutilisés) est seulement retiré : `perime`.
 */
export async function arreterServeurs(dossier: string, env: NodeJS.ProcessEnv = process.env): Promise<ResultatArret> {
	const etat = await lireEtatServeurs(dossier);
	if (etat === null) {
		// plus d'état, mais peut-être des serveurs d'un gardien disparu dans le registre
		const { arretes, enChargement } = await nettoyerLances(dossier, { garder: null, env });
		if (enChargement > 0) return { enChargement };
		return arretes > 0 ? 'arrete' : 'rien';
	}
	const verifies = await serveursVerifies(etat, Date.now() + 1000);
	const gardien = etat.gardien.pid;
	const gardienSur =
		gardien !== process.pid &&
		pidVivant(gardien) &&
		(verifies.length > 0 || (etat.gardien.etat === 'demarrage' && age(etat.gardien.depuis) < AGE_DEMARRAGE_ARRETABLE_MS));
	if (gardienSur) {
		try {
			process.kill(gardien, 'SIGTERM');
		} catch {
			/* déjà parti */
		}
		const fin = Date.now() + ATTENTE_ARRET_MS;
		while (pidVivant(gardien) && Date.now() < fin) await pause(50);
	}
	for (const { entree } of verifies) {
		if (!pidVivant(entree.pid)) continue;
		try {
			process.kill(entree.pid, 'SIGKILL');
		} catch {
			/* déjà parti */
		}
	}
	await retirerEtatDuGardien(dossier, gardien);
	const autres = await nettoyerLances(dossier, { garder: null, env });
	if (autres.enChargement > 0) {
		await journaliser(dossier, `${autres.enChargement} serveur(s) encore en chargement (mnemo modeles arreter)`);
		return { enChargement: autres.enChargement };
	}
	if (!gardienSur && verifies.length === 0 && autres.arretes === 0) {
		await journaliser(dossier, 'état périmé retiré (mnemo modeles arreter)');
		return 'perime';
	}
	await journaliser(dossier, 'serveurs arrêtés (mnemo modeles arreter)');
	return 'arrete';
}
