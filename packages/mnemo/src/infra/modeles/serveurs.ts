import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmod, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { reessayer } from '../reessayer.ts';
import { verrouFichier } from '../verrou-fichier.ts';
import { requeteLocale } from './http-local.ts';
import { journaliser } from './journal.ts';
import { DOSSIER_LOCAL } from '../../domaine/dossier-memoire.ts';

export type TypeServeur = 'sens' | 'reranker';
/** Un `llama-server` en marche : `modele` = nom du fichier gguf, `pid` = celui du serveur, `depuis` = date ISO. */
export type EntreeServeur = { port: number; cle: string; modele: string; pid: number; depuis: string };
/** `demarrage` : serveurs en chargement ; `pret` ; `echec` : le dernier démarrage a échoué (pas de nouvel essai avant une minute). */
export type EtatGardien = 'demarrage' | 'pret' | 'echec';
/** Contenu de `.mnemo/modeles.json` (droits 0600 : il contient les clés). */
export type EtatServeurs = {
	gardien: { pid: number; depuis: string; etat: EtatGardien };
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

/** Fichiers d'état des serveurs, dans `.mnemo/` du dossier Mnemo. */
export function cheminsModeles(racine: string): { etat: string; lances: string; verrou: string; actif: string; journal: string } {
	const local = join(racine, DOSSIER_LOCAL);
	return {
		etat: join(local, 'modeles.json'),
		lances: join(local, 'modeles-lances.json'),
		verrou: join(local, 'modeles.verrou'),
		actif: join(local, 'modeles.actif'),
		journal: join(local, 'modeles.log'),
	};
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

/** État lu dans `.mnemo/modeles.json`, ou null s'il manque ou ne se lit pas. */
export async function lireEtatServeurs(racine: string): Promise<EtatServeurs | null> {
	let brut: unknown;
	try {
		brut = JSON.parse(await readFile(cheminsModeles(racine).etat, 'utf8'));
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
	return {
		gardien: { pid: g['pid'] as number, depuis: g['depuis'] as string, etat: g['etat'] as EtatGardien },
		...(s === undefined ? {} : { sens: s }),
		...(r === undefined ? {} : { reranker: r }),
	};
}

/**
 * Écrit un fichier JSON d'un coup (temporaire puis renommage), droits 0600. Ne crée jamais `.mnemo/` (l'index le crée) : un
 * dossier Mnemo supprimé (ou recloné ailleurs) n'est pas recréé par les modèles.
 */
async function ecrireJson(fichier: string, valeur: unknown): Promise<void> {
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
export async function ecrireEtatServeurs(racine: string, etat: EtatServeurs): Promise<void> {
	await ecrireJson(cheminsModeles(racine).etat, etat);
}

/** Retire `modeles.json` s'il nomme encore ce gardien (un autre a pu le remplacer). */
export async function retirerEtatDuGardien(racine: string, pid: number): Promise<void> {
	const etat = await lireEtatServeurs(racine);
	if (etat !== null && etat.gardien.pid === pid) await rm(cheminsModeles(racine).etat, { force: true });
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
 * `.mnemo/modeles-lances.json` dès son lancement, avant même d'être prêt. Ce registre n'est jamais écrasé ni retiré en bloc :
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
export async function lireLances(racine: string): Promise<ServeurLance[]> {
	try {
		const brut = JSON.parse(await readFile(cheminsModeles(racine).lances, 'utf8')) as { lances?: unknown };
		return Array.isArray(brut.lances) ? brut.lances.map(lireLance).filter((l): l is ServeurLance => l !== null) : [];
	} catch {
		return [];
	}
}

const ecrireLances = (racine: string, lances: ServeurLance[]) => ecrireJson(cheminsModeles(racine).lances, { lances });

/**
 * Verrou de `.mnemo/modeles.verrou` (sans jamais créer `.mnemo/`) ; `finMs` borne l'attente (sinon l'attente par défaut, une
 * trentaine de secondes).
 */
export function verrouModeles(racine: string, finMs?: number) {
	if (finMs === undefined) return verrouFichier(cheminsModeles(racine).verrou, { creerDossier: false });
	return verrouFichier(cheminsModeles(racine).verrou, { essais: Math.max(1, Math.ceil((finMs - Date.now()) / 40)), delaiMin: 20, facteur: 1, delaiMax: 20, creerDossier: false });
}

/** Ajoute un serveur au registre (sous le verrou). */
export async function noterLance(racine: string, lance: ServeurLance): Promise<void> {
	await verrouModeles(racine).avec(async () => ecrireLances(racine, [...(await lireLances(racine)), lance]));
}

/** Retire ces pids du registre (sous le verrou ; abandonné si le verrou reste pris jusqu'à `finMs`). */
export async function retirerLances(racine: string, pids: number[], finMs = Date.now() + 2000): Promise<void> {
	await verrouModeles(racine, finMs).avec(async () => ecrireLances(racine, (await lireLances(racine)).filter((l) => !pids.includes(l.pid))));
}

/**
 * Élague le registre ; À APPELER SOUS LE VERROU. Pour chaque entrée : pid mort → retirée ; vérifiée avec sa clé → arrêtée
 * (SIGTERM, SIGKILL après 3 s) puis retirée, sauf si elle appartient au gardien `garder` ; vivante, non vérifiée, plus jeune
 * que le chargement maximal → gardée (elle charge peut-être encore) ; plus vieille → retirée sans signal (pas à nous, ou pid
 * réutilisé). Retire aussi les fichiers de clé `.cle` plus vieux que le chargement maximal. Rend le nombre de serveurs arrêtés
 * et celui des serveurs d'un autre gardien gardés parce qu'ils chargent peut-être encore.
 */
async function elaguerLances(racine: string, garder: number | null, chargementMs: number): Promise<Elagage> {
	const lances = await lireLances(racine);
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
			await journaliser(racine, `serveur ${l.piece} sans gardien arrêté (pid ${l.pid})`);
			terminerProcessus(l.pid);
			arretes++;
		} else if (Date.now() - l.lanceMs < chargementMs) {
			gardes.push(l);
			enChargement++;
		}
	}
	if (gardes.length !== lances.length) await ecrireLances(racine, gardes);
	const dossier = dirname(cheminsModeles(racine).lances);
	try {
		for (const nom of await readdir(dossier)) {
			if (!/^modeles-.+\.cle$/u.test(nom)) continue;
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

/** `elaguerLances` sous le verrou (abandonné si le verrou reste pris jusqu'à `finMs`, ou sans `.mnemo/`). */
export async function nettoyerLances(racine: string, options: { garder: number | null; env?: NodeJS.ProcessEnv; finMs?: number }): Promise<Elagage> {
	try {
		return await verrouModeles(racine, options.finMs ?? Date.now() + 3000).avec(() => elaguerLances(racine, options.garder, chargementMaxMs(options.env)));
	} catch {
		return { arretes: 0, enChargement: 0 };
	}
}

/** Pour qui tient déjà le verrou (le gardien à son démarrage). */
export const nettoyerLancesSousVerrou = (racine: string, garder: number | null, env?: NodeJS.ProcessEnv) =>
	elaguerLances(racine, garder, chargementMaxMs(env));

async function utilisable(etat: EtatServeurs | null, type: TypeServeur, finMs: number): Promise<EntreeServeur | null> {
	const entree = etat?.[type];
	if (etat === null || entree === undefined || !pidVivant(etat.gardien.pid)) return null;
	return (await verifierServeur(entree, finMs)) ? entree : null;
}

const age = (depuis: string) => Date.now() - (Date.parse(depuis) || 0);

/**
 * Faut-il laisser faire le gardien nommé (plutôt qu'en lancer un) ? Oui s'il démarre (récemment), s'il est prêt mais sans ce
 * modèle (pièce absente à son lancement), ou si le dernier démarrage a échoué il y a moins d'une minute.
 */
function gardienEnCharge(etat: EtatServeurs | null, type: TypeServeur): boolean {
	if (etat === null) return false;
	const { pid, depuis, etat: phase } = etat.gardien;
	if (phase === 'echec') return age(depuis) < PAUSE_APRES_ECHEC_MS;
	if (!pidVivant(pid)) return false;
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

/** Sous le verrou `.mnemo/modeles.verrou`, relit l'état et, si personne ne s'en charge, lance `mnemo modeles garde` détaché. */
async function lancerGardien(racine: string, type: TypeServeur, finMs: number, env: NodeJS.ProcessEnv): Promise<void> {
	const tentative = verrouModeles(racine, finMs).avec(async () => {
		const etat = await lireEtatServeurs(racine);
		if ((await utilisable(etat, type, Math.max(finMs, Date.now() + 500))) !== null || gardienEnCharge(etat, type)) return;
		// Serveurs d'un gardien disparu (tué net, même en plein chargement) : retrouvés par le registre, arrêtés s'ils répondent
		// avec leur clé. Ceux du gardien encore vivant sont laissés : remplacé, il s'arrête de lui-même avec ses serveurs.
		const vivant = etat !== null && pidVivant(etat.gardien.pid) ? etat.gardien.pid : null;
		await elaguerLances(racine, vivant, chargementMaxMs(env));
		const enfant = spawn(process.execPath, [MAIN, 'modeles', 'garde', racine], { detached: true, stdio: 'ignore', windowsHide: true, env: environnementGardien(env) });
		enfant.on('error', () => {});
		enfant.unref();
		if (enfant.pid === undefined) return;
		await ecrireEtatServeurs(racine, { gardien: { pid: enfant.pid, depuis: new Date().toISOString(), etat: 'demarrage' } });
		await journaliser(racine, `gardien lancé (pid ${enfant.pid}) pour le ${type}`);
	});
	try {
		await avant(tentative, finMs);
	} catch {
		// verrou occupé : un autre processus démarre le gardien
	}
	tentative.catch(() => {});
}

export type OptionsServeur = { finMs: number; demarrer: boolean; env?: NodeJS.ProcessEnv };

/**
 * Serveur de ce type prêt à répondre, ou null. Sans serveur utilisable et avec `demarrer`, lance le gardien (une seule fois
 * pour tous les processus du dossier) puis attend qu'il soit prêt, jamais au-delà de `finMs` : un premier chargement plus
 * long rend null maintenant, et les appels suivants trouveront le serveur en marche.
 */
export async function serveurPret(racine: string, type: TypeServeur, options: OptionsServeur): Promise<EntreeServeur | null> {
	const { finMs, demarrer } = options;
	let etat = await lireEtatServeurs(racine);
	const pret = await utilisable(etat, type, finMs);
	if (pret !== null || !demarrer || Date.now() >= finMs) return pret;
	if (!gardienEnCharge(etat, type)) await lancerGardien(racine, type, finMs, options.env ?? process.env);
	for (;;) {
		const reste = finMs - Date.now();
		if (reste <= 0) return null;
		await pause(Math.min(PAUSE_SONDAGE_MS, reste));
		etat = await lireEtatServeurs(racine);
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
export async function arreterServeurs(racine: string, env: NodeJS.ProcessEnv = process.env): Promise<ResultatArret> {
	const etat = await lireEtatServeurs(racine);
	if (etat === null) {
		// plus d'état, mais peut-être des serveurs d'un gardien disparu dans le registre
		const { arretes, enChargement } = await nettoyerLances(racine, { garder: null, env });
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
	await retirerEtatDuGardien(racine, gardien);
	const autres = await nettoyerLances(racine, { garder: null, env });
	if (autres.enChargement > 0) {
		await journaliser(racine, `${autres.enChargement} serveur(s) encore en chargement (mnemo modeles arreter)`);
		return { enChargement: autres.enChargement };
	}
	if (!gardienSur && verifies.length === 0 && autres.arretes === 0) {
		await journaliser(racine, 'état périmé retiré (mnemo modeles arreter)');
		return 'perime';
	}
	await journaliser(racine, 'serveurs arrêtés (mnemo modeles arreter)');
	return 'arrete';
}
