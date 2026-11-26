import { randomUUID } from 'node:crypto';
import { cp, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { PROFIL_ARCHIVISTE, PROJET_PAR_DEFAUT } from '@mnemo/commun';
import { fichesEnMarkdown, lancerBanc, referenceSansMoteur, VARIANTES_DU_BANC } from '../../application/banc.ts';
import type { Question, ResultatVariante } from '../../application/banc.ts';
import { deposerFiches, faitsDeMemoire, lancerBancConsignes, noterContradictions, noterExtraction } from '../../application/banc-archiviste.ts';
import type { CasConsigne, DecisionCle, FaitAttendu, PaireContradictoire } from '../../application/banc-archiviste.ts';
import { initialiser } from '../../application/initialiser.ts';
import { argumentsClaude, assemblerPlugin, environnementClaude } from '../../application/moteurs/claude-code/plugin.ts';
import { chargerProfil } from '../../application/profil.ts';
import { objectifDe } from '../../domaine/session.ts';
import type { Session } from '../../domaine/session.ts';
import { motifRegleInvalide } from '../../domaine/regles-verifiees.ts';
import type { Regle } from '../../domaine/consigne.ts';
import { trouverClaude } from '../../infra/moteurs/claude-code/trouver-claude.ts';
import { ecrirePlugin } from '../../infra/plugin-fichiers.ts';
import { dossierServeurs } from '../../infra/modeles/dossier.ts';
import { arreterServeurs, lireEtatServeurs, pidVivant } from '../../infra/modeles/serveurs.ts';
import { appelPlugin, dependancesReelles } from '../../infra/systeme.ts';
import type { Executer } from '../../application/ports.ts';
import { AUCUNE_MEMOIRE, ErreurCli } from './erreurs.ts';
import { executeurReel } from '../../infra/executeur.ts';
import { trouverRacine } from './racine.ts';
import { DOSSIER_MEMOIRE } from '../../domaine/dossier-memoire.ts';
import { estObjet } from '../../domaine/valeurs.ts';

const USAGE = 'Usage : mnemo banc [questions.yaml] [--json] | mnemo banc consignes [--json] | mnemo banc contexte [--extraire [<session>] [--nombre <n>] | --completer | --juger | --recalculer | --gestes | --apprendre] [--json] | mnemo banc extraction|contradictions --reel [--json]';
/** Mémoire d'essai (dossier qui contient `_mnemo/`) et ses questions, livrées avec Mnemo. */
const CORPUS = fileURLToPath(new URL('../../../banc/corpus/', import.meta.url));
const QUESTIONS = fileURLToPath(new URL('../../../banc/questions.yaml', import.meta.url));

/** Questions de la section `recherche` d'un fichier de banc ; erreur lisible (question numérotée) si le fichier est mal formé. */
export function lireQuestions(texte: string): Question[] {
	let document: unknown;
	try {
		document = parse(texte);
	} catch (erreur) {
		throw new ErreurCli(`Fichier de questions illisible (YAML) : ${erreur instanceof Error ? erreur.message : String(erreur)}`);
	}
	const liste = (document as { recherche?: unknown } | null)?.recherche;
	if (!Array.isArray(liste)) throw new ErreurCli('Fichier de questions : section « recherche » (liste de questions) attendue.');
	if (liste.length === 0) throw new ErreurCli('Fichier de questions : aucune question dans « recherche ».');
	return liste.map((brute: unknown, i): Question => {
		const refus = (motif: string) => new ErreurCli(`Fichier de questions, question ${i + 1} : ${motif}.`);
		const q = (brute ?? {}) as Record<string, unknown>;
		if (typeof q['question'] !== 'string' || q['question'].trim() === '') throw refus('« question » (texte non vide) attendue');
		const attendus = q['attendus'];
		if (!Array.isArray(attendus) || attendus.length === 0 || !attendus.every((a) => typeof a === 'string' && a.trim() !== '')) {
			throw refus('« attendus » (liste d\'ids ou de chemins de fiche) attendue');
		}
		for (const cle of ['genre', 'position', 'perimetre'] as const) {
			if (q[cle] !== undefined && (typeof q[cle] !== 'string' || q[cle].trim() === '')) throw refus(`« ${cle} » doit être un texte`);
		}
		const unSeulDe = q['unSeulDe'];
		if (unSeulDe !== undefined && (!Array.isArray(unSeulDe) || unSeulDe.length === 0 || !unSeulDe.every((c) => typeof c === 'string' && c.trim() !== ''))) {
			throw refus('« unSeulDe » (liste de chemins de fiche) attendue');
		}
		return {
			question: q['question'],
			attendus: attendus.map((a: string) => a.trim()),
			...(q['genre'] === undefined ? {} : { genre: (q['genre'] as string).trim() }),
			...(q['position'] === undefined ? {} : { position: (q['position'] as string).trim() }),
			...(q['perimetre'] === undefined ? {} : { perimetre: (q['perimetre'] as string).trim() }),
			...(unSeulDe === undefined ? {} : { unSeulDe: (unSeulDe as string[]).map((c) => c.trim()) }),
		};
	});
}

/** Pid du gardien des modèles de la machine s'il est vivant, sinon null. */
async function gardienVivant(serveurs: string): Promise<number | null> {
	const etat = await lireEtatServeurs(serveurs);
	return etat !== null && pidVivant(etat.gardien.pid) ? etat.gardien.pid : null;
}

/**
 * `travail` dans un dossier temporaire neuf, supprimé ensuite. Les serveurs de modèles sont partagés par toute la machine :
 * ils ne sont arrêtés avant la suppression que si le banc a lancé leur gardien (un gardien vivant autre que celui d'avant le
 * banc) ; celui qui tournait déjà, celui de l'app par exemple, est laissé. Le nettoyage se fait une seule fois, même
 * interrompu (Ctrl-C ou SIGTERM : rien ne reste derrière). Interrompu, le `signal` passé à `travail` est d'abord levé : un
 * processus lancé avec lui (`claude -p`) est tué.
 */
async function dansUnDossierTemporaire<T>(prefixe: string, travail: (dossier: string, signal: AbortSignal) => Promise<T>): Promise<T> {
	const serveurs = dossierServeurs(process.env, process.platform, homedir());
	const gardienAvant = await gardienVivant(serveurs);
	const dossier = await mkdtemp(resolve(tmpdir(), prefixe));
	const abandon = new AbortController();
	let nettoyage: Promise<void> | null = null;
	const nettoyer = (): Promise<void> =>
		(nettoyage ??= (async () => {
			const gardien = await gardienVivant(serveurs);
			if (gardien !== null && gardien !== gardienAvant) await arreterServeurs(serveurs).catch(() => 'rien');
			await rm(dossier, { recursive: true, force: true });
		})());
	const interrompre = (): void => {
		abandon.abort();
		void nettoyer().finally(() => process.exit(130));
	};
	process.once('SIGINT', interrompre);
	process.once('SIGTERM', interrompre);
	try {
		return await travail(dossier, abandon.signal);
	} finally {
		// gestionnaires retirés APRÈS le nettoyage : un Ctrl-C pendant celui-ci attend le même nettoyage (mémorisé), puis sort
		await nettoyer();
		process.off('SIGINT', interrompre);
		process.off('SIGTERM', interrompre);
	}
}

/** Toutes les variantes, puis la référence sans moteur, sur la mémoire de `racine`. */
async function mesurer(racine: string, questions: Question[]): Promise<ResultatVariante[]> {
	const dependances = dependancesReelles(racine);
	try {
		const variantes = await lancerBanc(dependances, questions, VARIANTES_DU_BANC);
		return [...variantes, referenceSansMoteur(await fichesEnMarkdown(dependances), questions)];
	} finally {
		dependances.index.fermer();
	}
}

/** Sortie JSON : clés dans un ordre fixe, mêmes mesures d'une exécution à l'autre (hors durées). */
export function enJson(questions: number, resultats: ResultatVariante[]): string {
	return JSON.stringify(
		{
			questions,
			resultats: resultats.map((r) => ({
				variante: r.variante,
				presentsDans5: r.presentsDans5,
				total: r.total,
				mrr: r.mrr,
				doublonsDans10: r.doublonsDans10,
				egalitesEnTete: r.egalitesEnTete,
				echecsUnSeulDe: r.echecsUnSeulDe,
				msMoyen: r.msMoyen,
				modelesAbsents: r.modelesAbsents,
				parGenre: Object.fromEntries(Object.entries(r.parGenre).map(([g, m]) => [g, { presentsDans5: m.presentsDans5, total: m.total, mrr: m.mrr, doublonsDans10: m.doublonsDans10, egalitesEnTete: m.egalitesEnTete, echecsUnSeulDe: m.echecsUnSeulDe }])),
			})),
		},
		null,
		2,
	);
}

/** Nom affiché d'une variante : les étapes qu'elle n'a pas pu faire (modèle absent) sont dites, pas cachées. */
function libelle(r: ResultatVariante): string {
	return r.modelesAbsents.length === 0 ? r.variante : `${r.variante} (sans ${r.modelesAbsents.join(' ni ')})`;
}

function tableau(entetes: string[], lignes: string[][]): string {
	const largeurs = entetes.map((e, i) => Math.max(e.length, ...lignes.map((l) => l[i]!.length)));
	const rendre = (l: string[]) => l.map((c, i) => (i === l.length - 1 ? c : c.padEnd(largeurs[i]! + 3))).join('');
	return [entetes, ...lignes].map(rendre).join('\n');
}

/** Tableau lisible : une ligne par variante (référence en dernier), puis les réussites par genre de question. */
export function enTableau(resultats: ResultatVariante[]): string {
	const principal = tableau(
		['variante', 'présents dans 5', 'MRR', 'doublons dans 10', 'égalités en tête', 'copies en trop', 'ms moyen'],
		resultats.map((r) => [libelle(r), `${r.presentsDans5} / ${r.total}`, r.mrr.toFixed(3), String(r.doublonsDans10), String(r.egalitesEnTete), String(r.echecsUnSeulDe), String(r.msMoyen)]),
	);
	const genres = [...new Set(resultats.flatMap((r) => Object.keys(r.parGenre)))].sort();
	const parGenre = tableau(
		['variante', ...genres],
		resultats.map((r) => [libelle(r), ...genres.map((g) => (r.parGenre[g] === undefined ? '-' : `${r.parGenre[g].presentsDans5} / ${r.parGenre[g].total}`))]),
	);
	return `${principal}\n\nPar genre (présents dans 5)\n${parGenre}`;
}

/**
 * `mnemo banc [questions.yaml] [--json]` : qualité de la recherche, variante par variante (`consignes`, `extraction`,
 * `contradictions` : bancs de l'archiviste, voir `commandeArchiviste`). Sans fichier : la mémoire d'essai
 * livrée avec Mnemo, copiée dans un dossier temporaire (supprimé ensuite) ; avec un fichier : la mémoire courante.
 */
export async function commandeBanc(args: string[]): Promise<void> {
	const [premier, ...reste] = args;
	if (premier === 'contexte') return (await import('./banc-contexte.ts')).commandeContexte(reste);
	if (premier === 'consignes' || premier === 'extraction' || premier === 'contradictions') return commandeArchiviste(premier, reste);
	const json = args.includes('--json');
	const positionnels = args.filter((a) => a !== '--json');
	const option = positionnels.find((a) => a.startsWith('--'));
	if (option !== undefined) throw new ErreurCli(`Option inconnue : « ${option} ».\n${USAGE}`, 2);
	if (positionnels.length > 1) throw new ErreurCli(USAGE, 2);
	const fichier = positionnels[0];

	let resultats: ResultatVariante[];
	let questions: Question[];
	if (fichier === undefined) {
		const lues = lireQuestions(await readFile(QUESTIONS, 'utf8'));
		questions = lues;
		resultats = await dansUnDossierTemporaire('mnemo-banc-', async (dossier) => {
			await cp(CORPUS, dossier, { recursive: true });
			return mesurer(dossier, lues);
		});
	} else {
		const racine = trouverRacine(process.cwd());
		if (racine === null) throw new ErreurCli(AUCUNE_MEMOIRE);
		let texte: string;
		try {
			texte = await readFile(resolve(fichier), 'utf8');
		} catch {
			throw new ErreurCli(`Fichier de questions introuvable ou illisible : ${fichier}`);
		}
		questions = lireQuestions(texte);
		resultats = await mesurer(racine, questions);
	}
	console.log(json ? enJson(questions.length, resultats) : enTableau(resultats));
}

// --- Bancs de l'archiviste ---

/** Corpus fictif des bancs de l'archiviste : `extraction/documents/`, `contradictions/{memoire,documents}/`. */
export const CORPUS_ARCHIVISTE = fileURLToPath(new URL('../../../banc/corpus-archiviste/', import.meta.url));
const SCHEMA = fileURLToPath(new URL('../../../modeles/SCHEMA.md', import.meta.url));
const MAIN = fileURLToPath(new URL('./main.ts', import.meta.url));
/** Un `claude -p` d'archiviste peut lire et ranger longtemps : tué au bout de 30 minutes. */
export const DELAI_ARCHIVISTE_MS = 30 * 60_000;
/**
 * Règles permises d'avance à l'archiviste du banc (`--allowedTools`, une règle par argument comme dans la doc CLI) : les
 * outils du serveur MCP de Mnemo, et `Skill` (sous `dontAsk`, un appel de skill non permis d'avance serait refusé).
 */
export const OUTILS_ARCHIVISTE: readonly string[] = ['mcp__mnemo__*', 'Skill'];
/**
 * Outils intégrés laissés à l'archiviste du banc (`--tools`) : la lecture seule, et `Skill` pour ses skills (le banc les
 * mesure aussi). `extraire_source` référence un document sans en rendre le texte : l'archiviste le lit avec `Read`. Ni
 * Bash, ni l'écriture, ni le web.
 */
export const OUTILS_INTEGRES_ARCHIVISTE = 'Read,Glob,Grep,Skill';
const CLAUDE_INTROUVABLE = '`claude` introuvable (PATH, ou MNEMO_CLAUDE) : le banc ne peut pas lancer l\'archiviste.';

export type GenreArchiviste = 'extraction' | 'contradictions';
export type BancArchiviste = { extraction: { faits: FaitAttendu[]; decisions: DecisionCle[] }; contradictions: PaireContradictoire[]; consignes: CasConsigne[] };
export type ResultatArchiviste =
	| { genre: 'extraction'; fidelite: number; couverture: number; couvertureFidele: number; faits: number; details: string[] }
	| { genre: 'contradictions'; reussies: number; total: number };

/** La mission donnée à l'archiviste : son travail, sans les réponses attendues. */
export const MISSIONS: Record<GenreArchiviste, string> = {
	extraction: [
		'Range dans la mémoire Mnemo les documents du dossier `documents/` (à la racine du dossier Mnemo).',
		'Pour chaque document : `extraire_source` avec son type (`email` pour un .eml, `compte_rendu` pour un compte rendu, `contrat` pour un devis, un contrat ou un avenant, `spec_validee` pour une spécification validée, `note` pour une note),',
		'puis `proposer` chaque information qui dure (décision, montant, échéance, rôle, choix technique, engagement), une information par ligne, avec sa citation exacte, mot pour mot, et sa source `[[sources/…]]`.',
		'Range les informations dans la fiche du client concerné, sous `clients/`. Travaille seul, sans poser de question : tu es lancé par le banc d\'essai de Mnemo.',
	].join(' '),
	contradictions: [
		'Des documents récents sont arrivés dans le dossier `documents/` (à la racine du dossier Mnemo). La mémoire contient déjà les fiches des clients concernés, sous `clients/`.',
		'Pour chaque document : `extraire_source` avec son type (`email` pour un .eml, `compte_rendu` pour un compte rendu, `contrat` pour un contrat ou un avenant, `spec_validee` pour une spécification validée, `note` pour une note).',
		'Puis, pour chaque information : cherche l\'information existante (`chercher`, `lire`) ; si elle change, propose la nouvelle dans la même fiche, avec sa citation exacte, sa source `[[sources/…]]` et `remplace` (l\'ancre de l\'information existante), pour que Mnemo arbitre.',
		'Travaille seul, sans poser de question : tu es lancé par le banc d\'essai de Mnemo.',
	].join(' '),
};

const texteNonVide = (v: unknown): v is string | number => (typeof v === 'string' && v.trim() !== '') || typeof v === 'number';
const enTexte = (v: string | number) => String(v).trim();
const listeDeTermes = (v: unknown): string[] | null => (Array.isArray(v) && v.length > 0 && v.every(texteNonVide) ? v.map(enTexte) : null);
const objet = (v: unknown): Record<string, unknown> => (estObjet(v) ? v : {});
function liste(v: unknown, nom: string): unknown[] {
	if (v === undefined || v === null) return [];
	if (!Array.isArray(v)) throw new ErreurCli(`Banc de l'archiviste : « ${nom} » doit être une liste.`);
	return v;
}

/**
 * Sections `extraction`, `contradictions` et `consignes` d'un fichier de banc (chacune facultative) ; erreur lisible qui
 * nomme l'entrée mal formée.
 */
export function lireBancArchiviste(texte: string): BancArchiviste {
	let document: unknown;
	try {
		document = parse(texte);
	} catch (erreur) {
		throw new ErreurCli(`Fichier de banc illisible (YAML) : ${erreur instanceof Error ? erreur.message : String(erreur)}`);
	}
	const racine = objet(document);
	const refus = (quoi: string, i: number, motif: string) => new ErreurCli(`Banc de l'archiviste, ${quoi} ${i + 1} : ${motif}.`);
	const extraction = objet(racine['extraction']);
	const faits = liste(extraction['faits'], 'extraction.faits').map((brut, i): FaitAttendu => {
		const f = objet(brut);
		if (!texteNonVide(f['document'])) throw refus('fait', i, '« document » (chemin) attendu');
		const termes = listeDeTermes(f['termes']);
		if (termes === null) throw refus('fait', i, '« termes » (liste de mots ou valeurs non vides) attendue');
		if (!texteNonVide(f['citation'])) throw refus('fait', i, '« citation » (texte non vide) attendue');
		return { document: enTexte(f['document']), termes, citation: enTexte(f['citation']) };
	});
	const decisions = liste(extraction['decisions'], 'extraction.decisions').map((brut, i): DecisionCle => {
		const d = objet(brut);
		if (!texteNonVide(d['document'])) throw refus('décision', i, '« document » (chemin) attendu');
		const termes = listeDeTermes(d['termes']);
		if (termes === null) throw refus('décision', i, '« termes » (liste de mots ou valeurs non vides) attendue');
		return { document: enTexte(d['document']), termes };
	});
	const contradictions = liste(racine['contradictions'], 'contradictions').map((brut, i): PaireContradictoire => {
		const p = objet(brut);
		if (!texteNonVide(p['ancien']) || !texteNonVide(p['nouveau'])) throw refus('paire', i, '« ancien » et « nouveau » (textes non vides) attendus');
		if (p['attendu'] !== 'remplace' && p['attendu'] !== 'a_confirmer') throw refus('paire', i, '« attendu » vaut « remplace » ou « a_confirmer »');
		return { ancien: enTexte(p['ancien']), nouveau: enTexte(p['nouveau']), attendu: p['attendu'] };
	});
	const consignes = liste(racine['consignes'], 'consignes').map((brut, i): CasConsigne => {
		const c = objet(brut);
		if (!texteNonVide(c['consigne'])) throw refus('cas', i, '« consigne » (texte non vide) attendue');
		const cas: CasConsigne = { consigne: enTexte(c['consigne']) };
		if (c['regle'] !== undefined) {
			const motif = motifRegleInvalide(c['regle'] as Regle);
			if (motif !== null) throw refus('cas', i, `règle invalide (${motif})`);
			cas.regle = c['regle'] as Regle;
		}
		if (c['action'] !== undefined) {
			const a = objet(c['action']);
			if (!texteNonVide(a['nom']) || typeof a['entree'] !== 'object' || a['entree'] === null) throw refus('cas', i, '« action » : { nom, entree } attendue');
			if (c['attendu'] !== 'refus' && c['attendu'] !== 'permis') throw refus('cas', i, '« attendu » vaut « refus » ou « permis » avec une action');
			cas.action = { nom: enTexte(a['nom']), entree: a['entree'] as Record<string, unknown> };
			cas.attendu = c['attendu'];
		}
		if (c['message'] !== undefined) {
			if (!texteNonVide(c['message'])) throw refus('cas', i, '« message » (texte non vide) attendu');
			cas.message = enTexte(c['message']);
		}
		if (cas.action === undefined && cas.message === undefined) throw refus('cas', i, '« action » ou « message » attendu');
		return cas;
	});
	return { extraction: { faits, decisions }, contradictions, consignes };
}

/** Fichiers d'un dossier, récursivement : chemin relatif (en « / ») → texte. */
async function lireDossier(dossier: string): Promise<Map<string, string>> {
	const sortie = new Map<string, string>();
	for (const entree of await readdir(dossier, { recursive: true, withFileTypes: true })) {
		if (!entree.isFile()) continue;
		const chemin = join(entree.parentPath, entree.name);
		sortie.set(relative(dossier, chemin).split(sep).join('/'), await readFile(chemin, 'utf8'));
	}
	return new Map([...sortie].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

/** Mémoire neuve dans `dossier` ; documents du banc dans `documents/` ; pour les contradictions, la mémoire de départ (un commit). */
async function preparerArchiviste(genre: GenreArchiviste, dossier: string): Promise<void> {
	await cp(join(CORPUS_ARCHIVISTE, genre, 'documents'), join(dossier, 'documents'), { recursive: true });
	const dep = dependancesReelles(dossier);
	try {
		await initialiser(dep, await readFile(SCHEMA, 'utf8'));
		if (genre === 'contradictions') {
			const fiches = [...(await lireDossier(join(CORPUS_ARCHIVISTE, 'contradictions', 'memoire')))].map(([chemin, texte]) => ({ chemin, texte }));
			await deposerFiches(dep, fiches, 'mnemo: mémoire de départ du banc de contradictions');
		}
	} finally {
		dep.index.fermer();
	}
}

/** Premières lignes non vides d'une sortie, pour un message d'erreur. */
const extrait = (texte: string) => texte.split(/\r?\n/u).filter((l) => l.trim() !== '').slice(0, 5).join(' / ').slice(0, 500);

/**
 * Arguments de confinement du `claude -p` du banc. `dontAsk` refuse tout appel qui demanderait une permission : seuls
 * passent ce que `--allowedTools` permet d'avance (le serveur MCP de Mnemo) et la lecture dans les dossiers de travail.
 * `--tools` retire les autres outils intégrés (Bash, écriture, web). `--strict-mcp-config` ignore les serveurs MCP de
 * l'utilisateur ; `--mcp-config` déclare celui de Mnemo, qui trouve la mémoire temporaire par le dossier du projet
 * (`CLAUDE_PROJECT_DIR`, le dossier courant de `claude`). Options à plusieurs valeurs : à placer avant une autre option.
 */
export function confinementArchiviste(): string[] {
	const mcp = { mcpServers: { mnemo: { type: 'stdio', command: process.execPath, args: [MAIN, 'mcp'] } } };
	return ['--permission-mode', 'dontAsk', '--tools', OUTILS_INTEGRES_ARCHIVISTE, '--allowedTools', ...OUTILS_ARCHIVISTE, '--strict-mcp-config', '--mcp-config', JSON.stringify(mcp)];
}

/** Motif lisible d'un `claude -p` qui n'a pas abouti : jamais la ligne de commande (mission, chemins, JSON). */
function echecDeClaude(erreur: unknown, signal: AbortSignal | undefined): string {
	const e = (typeof erreur === 'object' && erreur !== null ? erreur : {}) as { name?: unknown; code?: unknown; killed?: unknown };
	if (signal?.aborted === true || e.name === 'AbortError') return 'claude -p interrompu : banc arrêté, processus tué.';
	if (typeof e.code === 'string') return `claude -p n'a pas pu aboutir (${e.code}).`;
	if (e.killed === true) return `claude -p tué au bout de ${DELAI_ARCHIVISTE_MS / 60_000} minutes : délai dépassé.`;
	return 'claude -p n\'a pas pu aboutir.';
}

/**
 * Lance l'archiviste sur la mémoire de `racine` : `claude -p <mission>`, profil archiviste (consigne, skills, hooks), plugin
 * assemblé comme pour une session, confiné (`confinementArchiviste`), dossier courant `_mnemo/`, environnement sans clé d'API
 * ni autre fournisseur. `executer` reçoit la commande et `signal` (interruption du banc) ; erreur lisible si `claude` est
 * introuvable, sort en échec, dépasse le délai ou est interrompu.
 */
export async function lancerArchiviste(executer: Executer, racine: string, mission: string, signal?: AbortSignal): Promise<void> {
	const claude = trouverClaude(process.env, process.platform);
	if (claude === null) throw new ErreurCli(CLAUDE_INTROUVABLE);
	const dep = dependancesReelles(racine);
	let commande: { args: string[]; env: Record<string, string> };
	try {
		const maintenant = Date.now();
		const session: Session = {
			id: randomUUID(),
			profil: PROFIL_ARCHIVISTE,
			dossier: DOSSIER_MEMOIRE,
			position: '',
			projet: PROJET_PAR_DEFAUT,
			objectif: objectifDe(mission),
			etat: 'travaille',
			creeeMs: maintenant,
			majMs: maintenant,
			arretAttendu: null,
			bilanDemandeMs: null,
			commitDebut: null,
			branche: null,
			pid: null,
		};
		const profil = await chargerProfil(dep, PROFIL_ARCHIVISTE);
		const plugin = await ecrirePlugin(racine, session.id, await assemblerPlugin(dep, session, profil, appelPlugin()));
		// options à plusieurs valeurs placées avant les options de session : aucune n'avale la mission
		const args = ['-p', ...confinementArchiviste(), ...argumentsClaude(session, profil, { plugin, racine }, 'nouvelle', mission)];
		commande = { args, env: environnementClaude(process.env, session, racine) };
	} finally {
		dep.index.fermer();
	}
	// banc arrêté pendant la préparation : claude n'est pas lancé
	if (signal?.aborted === true) throw new ErreurCli(echecDeClaude(null, signal));
	let r: Awaited<ReturnType<Executer>>;
	try {
		r = await executer(claude.commande, [...claude.avant, ...commande.args], {
			cwd: join(racine, DOSSIER_MEMOIRE),
			env: commande.env,
			delaiMs: DELAI_ARCHIVISTE_MS,
			...(signal === undefined ? {} : { signal }),
		});
	} catch (erreur) {
		throw new ErreurCli(echecDeClaude(erreur, signal));
	}
	if (r.code !== 0) throw new ErreurCli(`claude -p a échoué (code ${r.code}) : ${extrait(r.erreur) || extrait(r.sortie) || 'sans message'}`);
}

/** Note la mémoire de `racine` après le passage de l'archiviste. */
async function noterArchiviste(genre: GenreArchiviste, racine: string, banc: BancArchiviste): Promise<ResultatArchiviste> {
	const dep = dependancesReelles(racine);
	let memoire: Map<string, string>;
	try {
		memoire = await fichesEnMarkdown(dep);
	} finally {
		dep.index.fermer();
	}
	if (genre === 'contradictions') return { genre, ...noterContradictions(memoire, banc.contradictions) };
	const documents = new Map([...(await lireDossier(join(racine, 'documents')))].map(([chemin, texte]) => [`documents/${chemin}`, texte]));
	const faits = faitsDeMemoire(memoire);
	return { genre, ...noterExtraction(faits, documents, banc.extraction.faits, banc.extraction.decisions), faits: faits.length };
}

/** Banc d'extraction ou de contradictions : mémoire préparée dans un dossier temporaire, archiviste lancé par `executer`, note. */
export async function mesurerArchiviste(genre: GenreArchiviste, executer: Executer, banc: BancArchiviste): Promise<ResultatArchiviste> {
	return dansUnDossierTemporaire(`mnemo-banc-${genre}-`, async (dossier, signal) => {
		await preparerArchiviste(genre, dossier);
		await lancerArchiviste(executer, dossier, MISSIONS[genre], signal);
		return noterArchiviste(genre, dossier, banc);
	});
}

/** Banc de consignes sur une mémoire neuve, dans un dossier temporaire : sans `claude`. */
async function mesurerConsignes(cas: CasConsigne[]): Promise<{ reussis: number; total: number; echecs: string[] }> {
	return dansUnDossierTemporaire('mnemo-banc-consignes-', async (dossier) => {
		const dep = dependancesReelles(dossier);
		try {
			await initialiser(dep, await readFile(SCHEMA, 'utf8'));
			return await lancerBancConsignes(dep, cas);
		} finally {
			dep.index.fermer();
		}
	});
}

const USAGE_ARCHIVISTE = 'Usage : mnemo banc consignes [--json] | mnemo banc extraction|contradictions --reel [--json]';
const pourcent = (x: number) => `${(x * 100).toFixed(1).replace('.', ',')} %`;

/**
 * `mnemo banc consignes|extraction|contradictions` : bancs de l'archiviste, sur le corpus fictif livré avec Mnemo. `consignes`
 * se mesure sans `claude`. `extraction` et `contradictions` lancent le vrai `claude -p` (abonnement consommé) : seulement avec
 * `--reel`, après un avertissement ; sans, refus lisible.
 */
async function commandeArchiviste(genre: 'consignes' | GenreArchiviste, args: string[]): Promise<void> {
	const json = args.includes('--json');
	const reel = args.includes('--reel');
	const autre = args.find((a) => a !== '--json' && (a !== '--reel' || genre === 'consignes'));
	if (autre !== undefined) throw new ErreurCli(`${autre.startsWith('--') ? `Option inconnue : « ${autre} »` : `Argument inattendu : « ${autre} »`}.\n${USAGE_ARCHIVISTE}`, 2);
	const banc = lireBancArchiviste(await readFile(QUESTIONS, 'utf8'));

	if (genre === 'consignes') {
		const r = await mesurerConsignes(banc.consignes);
		if (json) console.log(JSON.stringify(r, null, 2));
		else console.log([`Consignes : ${r.reussis} / ${r.total} cas réussis`, ...r.echecs.map((e) => `  échec : ${e}`)].join('\n'));
		return;
	}
	if (!reel) {
		throw new ErreurCli(
			`Le banc « ${genre} » lance le vrai \`claude -p\` (profil archiviste) : il consomme l’abonnement Claude et écrit une session dans ~/.claude. Le lancer à la main avec : mnemo banc ${genre} --reel`,
			2,
		);
	}
	if (trouverClaude(process.env, process.platform) === null) throw new ErreurCli(CLAUDE_INTROUVABLE);
	console.error(`Attention : « mnemo banc ${genre} --reel » lance le vrai claude -p sur l’abonnement Claude (plusieurs minutes, 30 au plus) ; la session est enregistrée dans ~/.claude.`);
	const r = await mesurerArchiviste(genre, executeurReel(), banc);
	if (json) console.log(JSON.stringify(r, null, 2));
	else if (r.genre === 'extraction') console.log([`Extraction : fidélité ${pourcent(r.fidelite)}, couverture ${pourcent(r.couverture)}, couverture fidèle ${pourcent(r.couvertureFidele)} (${r.faits} informations extraites)`, ...r.details.map((d) => `  ${d}`)].join('\n'));
	else console.log(`Contradictions : ${r.reussies} / ${r.total} paires arbitrées comme attendu`);
}
