import { lstat, readdir, readFile, realpath } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import type { DossierClaude, FichierIgnore, InstructionClaude, MemoireClaude, NoteClaude, ProjetsClaude } from '../application/ports.ts';
import { dansGit, DOSSIER_CLAUDE, estInstructionClaude, estMarkdown, EXTENSION_MARKDOWN, nomDeFichier } from '../domaine/chemin.ts';
import { empreinte } from '../domaine/empreinte.ts';
import { premiersNoms } from '../domaine/texte.ts';
import { NIVEAUX_AMORCE } from '../application/dossiers.ts';

const TAILLE_MAX = 1024 * 1024;

/** Configuration de Claude Code : `CLAUDE_CONFIG_DIR` s'il est donné, sinon `~/.claude`. */
export const dossierClaudeParDefaut = (): string => process.env['CLAUDE_CONFIG_DIR'] || join(homedir(), DOSSIER_CLAUDE);

/** Comme Claude Code : tout caractère hors lettres et chiffres devient « - » (`/Users/a/b.c` → `-Users-a-b-c`). */
const encoder = (chemin: string): string => chemin.replace(/[^a-zA-Z0-9]/gu, '-');

/** Longueur d'un nom de fichier sûr (`nomDeFichier`). */
const LONGUEUR_NOM = 120;

/**
 * Nom du projet : nom encodé sans le préfixe du dossier personnel (vide → `home`), en minuscules, sûr comme nom de dossier ;
 * un nom trop long est tronqué et suffixé de son empreinte (unique).
 */
export function projetDepuisDossier(encode: string, home: string): string {
	const prefixe = encoder(home);
	let reste = encode;
	if (encode === prefixe) reste = '';
	else if (encode.startsWith(`${prefixe}-`)) reste = encode.slice(prefixe.length + 1);
	reste = reste.replace(/^-+/u, '').toLowerCase();
	if (reste === '') return 'home';
	const nom = nomDeFichier(reste).toLowerCase();
	if (nom.length >= reste.length) return nom;
	// Nom tronqué (chemin long) : suffixé de l'empreinte du nom entier, pour que deux projets n'aient jamais le même dossier.
	const suffixe = `-${empreinte(reste).slice(0, 8)}`;
	return `${nom.slice(0, LONGUEUR_NOM - suffixe.length).replace(/-+$/u, '')}${suffixe}`;
}


/**
 * Mémoire native de Claude Code : `<dossierClaude>/projects/<projet>/memory/**` (sous-dossiers compris, tout `.md` sans tenir
 * compte de la casse, `MEMORY.md` compris) et `<dossierClaude>/CLAUDE.md`. Rien d'autre n'est lu. Tout ce qui est vu sous
 * `memory/` et écarté (lien symbolique, plus de 1 Mo, autre fichier, illisible) est rendu dans `ignores` avec sa raison.
 */
export function memoireClaude(dossierClaude: string, home: string = homedir()): MemoireClaude {
	async function nomsDe(dossier: string): Promise<string[]> {
		try {
			return (await readdir(dossier)).sort();
		} catch {
			return [];
		}
	}
	return {
		// Chaque lecture a sa propre liste d'écartés : deux imports simultanés ne se mélangent pas.
		async lire() {
			const ignores: FichierIgnore[] = [];
			const ignorer = (chemin: string, raison: string) => void ignores.push({ chemin, raison });
			/** Contenu d'un fichier ordinaire (ni lien, ni gros), sinon null ; absent : null sans rien dire (rien n'a été vu). */
			const lireOrdinaire = async (chemin: string): Promise<string | null> => {
				let etat;
				try {
					etat = await lstat(chemin);
				} catch {
					return null;
				}
				if (!etat.isFile()) {
					if (etat.isSymbolicLink()) ignorer(chemin, 'lien symbolique');
					return null;
				}
				if (etat.size > TAILLE_MAX) {
					ignorer(chemin, 'plus de 1 Mo');
					return null;
				}
				try {
					return await readFile(chemin, 'utf8');
				} catch (erreur) {
					ignorer(chemin, `illisible (${erreur instanceof Error ? erreur.message : String(erreur)})`);
					return null;
				}
			};
			const notes: NoteClaude[] = [];
			/** Les notes de `dossier` et de ses sous-dossiers ; `nom` : leur chemin sous `memory/`, sans extension, en « / ». */
			const lireNotes = async (dossier: string, sous: string, ajouter: (nom: string, texte: string) => void): Promise<void> => {
				for (const e of (await entreesDe(dossier)) ?? []) {
					const absolu = join(dossier, e.name);
					const relatif = sous === '' ? e.name : `${sous}/${e.name}`;
					if (e.isSymbolicLink()) ignorer(absolu, 'lien symbolique');
					else if (e.isDirectory()) await lireNotes(absolu, relatif, ajouter);
					else if (!e.isFile() || !estMarkdown(e.name)) ignorer(absolu, 'pas un fichier .md');
					else {
						const texte = await lireOrdinaire(absolu);
						if (texte !== null) ajouter(relatif.slice(0, -EXTENSION_MARKDOWN.length), texte);
					}
				}
			};
			const projets = join(dossierClaude, 'projects');
			for (const encode of await nomsDe(projets)) {
				const dossierProjet = join(projets, encode);
				const dossierMemoire = join(dossierProjet, 'memory');
				try {
					const projet = await lstat(dossierProjet);
					if (projet.isSymbolicLink()) {
						ignorer(dossierProjet, 'lien symbolique');
						continue;
					}
					if (!projet.isDirectory()) continue;
					const memoire = await lstat(dossierMemoire);
					if (memoire.isSymbolicLink()) {
						ignorer(dossierMemoire, 'lien symbolique');
						continue;
					}
					if (!memoire.isDirectory()) continue;
				} catch {
					continue;
				}
				const projet = projetDepuisDossier(encode, home);
				await lireNotes(dossierMemoire, '', (nom, texte) => void notes.push({ projet, nom, texte, origine: 'memoire', cle: encode }));
			}
			const global = await lireOrdinaire(join(dossierClaude, 'CLAUDE.md'));
			if (global !== null) notes.push({ projet: 'global', nom: 'CLAUDE', texte: global, origine: 'claude_md' });
			return { notes, ignores };
		},
	};
}

/** Fichiers d'instructions listés par projet, au plus ; au-delà, ignorés. */
const INSTRUCTIONS_MAX = 200;
const CONFIGURATION = 'configuration de Claude Code (lue par l\'amorçage de la mémoire)';
/** Profondeur maximale d'un dossier parcouru sous un `.claude/` (1 : ses sous-dossiers directs). */
const PROFONDEUR_MAX = 6;

/** « 3 dossiers cachés non parcourus (.vscode, .idea, .venv) » : un nombre exact, les premiers noms. */
function dossiersNonParcourus(noms: string[], quoi: (pluriel: boolean) => string): string {
	const pluriel = noms.length > 1;
	return `${noms.length} ${quoi(pluriel)} non parcouru${pluriel ? 's' : ''} (${premiersNoms(noms)})`;
}

/**
 * Les dossiers du dossier Mnemo (`dossiers()`, relatifs à `racine`, les `NIVEAUX_AMORCE` premiers niveaux) vus de Claude
 * Code : clé de dossier (chemin absolu encodé) et nom du dossier des fiches importées (comme `projetDepuisDossier`). Dans
 * chaque dossier, caché ou non, chaque fichier passe par la même règle, `estInstructionClaude` (`CLAUDE.md`, `CLAUDE.local.md`,
 * `.md` sous `.claude/`), une fois chacun ; rien n'est lu ici. Un autre dépôt git (worktree) sous `.claude/`, un lien symbolique
 * d'instruction, et sous `.claude/` tout autre fichier, lien ou dossier caché, sont écartés un à un avec leur raison ; les
 * sous-dossiers absents de la liste (cachés, liens, au-delà de `NIVEAUX_AMORCE` niveaux) sont comptés par dossier. Le dépôt
 * `.git` n'est jamais lu. Un dossier qui est (ou est dans) la configuration de Claude Code `dossierClaude` n'est jamais
 * parcouru : elle est lue par `memoireClaude`, et seulement là.
 */
export function projetsClaude(racine: string, dossiers: () => Promise<readonly { chemin: string }[]>, options: { home?: string; dossierClaude?: string } = {}): ProjetsClaude {
	const absolue = resolve(racine);
	const home = options.home ?? homedir();
	const configuration = resolve(options.dossierClaude ?? dossierClaudeParDefaut());
	/** Chemin réel (liens résolus : `/var` et `/private/var`), comparé sans casse (« .Claude » est le même dossier sur macOS). */
	const reel = async (chemin: string): Promise<string> => (await realpath(chemin).catch(() => chemin)).toLowerCase();
	const dansConfiguration = async (absolu: string): Promise<boolean> => {
		const [cle, config] = [await reel(absolu), await reel(configuration)];
		return cle === config || cle.startsWith(config + sep);
	};
	return {
		async lister() {
			const liste = await dossiers();
			const listes = new Set(liste.map((d) => d.chemin));
			const ignores: FichierIgnore[] = [];
			const instructions: InstructionClaude[] = [];
			const sortie: DossierClaude[] = liste.map((d) => {
				const cle = encoder(join(absolue, ...d.chemin.split('/')));
				return { dossier: d.chemin, cle, nom: projetDepuisDossier(cle, home) };
			});
			// un dossier sous `.claude/` d'un autre est listé lui aussi : chaque instruction n'est gardée qu'une fois
			const vues = new Set<string>();
			const configurations: string[] = [];
			const ecarterConfiguration = (chemin: string): void => {
				configurations.push(chemin);
				ignores.push({ chemin, raison: CONFIGURATION });
			};
			// un dossier sous `.claude/` est parcouru avec lui, depuis le dossier qui le contient
			const sousUnClaude = (chemin: string): boolean => chemin.split('/').some((segment) => segment.toLowerCase() === DOSSIER_CLAUDE);
			for (const d of liste.filter((x) => x.chemin !== '' && !sousUnClaude(x.chemin))) {
				const dossierProjet = join(absolue, ...d.chemin.split('/'));
				// un dossier dans une configuration déjà écartée l'est avec elle, sans ligne de plus
				if (configurations.some((c) => d.chemin === c || d.chemin.startsWith(`${c}/`))) continue;
				if (await dansConfiguration(dossierProjet)) {
					ecarterConfiguration(d.chemin);
					continue;
				}
				const trouvees: InstructionClaude[] = [];
				const caches: string[] = [];
				const liens: string[] = [];
				const profonds: string[] = [];
				const ajouter = (relatif: string, nom: string): void => {
					if (vues.has(relatif)) return;
					vues.add(relatif);
					if (trouvees.length >= INSTRUCTIONS_MAX) ignores.push({ chemin: relatif, raison: `plus de ${INSTRUCTIONS_MAX} instructions dans le projet` });
					else trouvees.push({ chemin: relatif, dossier: d.chemin, nom });
				};
				/** Sous un `.claude/` : chaque entrée est une instruction possible, dite une à une si elle est écartée. */
				const parcourirClaude = async (absolu: string, dansProjet: string, profondeur: number): Promise<void> => {
					const entrees = await entreesDe(absolu);
					if (entrees === null) return;
					if (profondeur > 0 && entrees.some((e) => dansGit(e.name))) {
						ignores.push({ chemin: `${d.chemin}/${dansProjet}`, raison: 'autre dépôt git' });
						return;
					}
					for (const e of entrees) {
						const nom = `${dansProjet}/${e.name}`;
						const relatif = `${d.chemin}/${nom}`;
						if (e.isSymbolicLink()) ignores.push({ chemin: relatif, raison: 'lien symbolique' });
						else if (e.isDirectory()) {
							if (e.name.startsWith('.')) ignores.push({ chemin: relatif, raison: 'dossier caché' });
							else if (await dansConfiguration(join(absolu, e.name))) ecarterConfiguration(relatif);
							else if (profondeur >= PROFONDEUR_MAX) ignores.push({ chemin: relatif, raison: 'trop profond' });
							else await parcourirClaude(join(absolu, e.name), nom, profondeur + 1);
						} else if (e.isFile()) {
							if (estInstructionClaude(relatif, d.chemin)) ajouter(relatif, nom);
							else ignores.push({ chemin: relatif, raison: e.name.startsWith('.') ? 'fichier caché' : 'pas un fichier .md' });
						}
					}
				};
				const niveau = d.chemin.split('/').length;
				for (const e of (await entreesDe(dossierProjet)) ?? []) {
					const relatif = `${d.chemin}/${e.name}`;
					const estClaude = e.name.toLowerCase() === DOSSIER_CLAUDE;
					if (e.isSymbolicLink()) {
						if (estClaude || estInstructionClaude(relatif, d.chemin)) ignores.push({ chemin: relatif, raison: 'lien symbolique' });
						else if (listes.has(relatif)) continue;
						else liens.push(e.name);
					} else if (e.isFile()) {
						if (estInstructionClaude(relatif, d.chemin)) ajouter(relatif, e.name);
					} else if (e.isDirectory()) {
						if (dansGit(e.name)) continue;
						if (estClaude) {
							// la configuration de Claude Code placée dans le projet (`CLAUDE_CONFIG_DIR=<projet>/.claude`) n'est pas une instruction
							if (await dansConfiguration(join(dossierProjet, e.name))) ecarterConfiguration(relatif);
							else await parcourirClaude(join(dossierProjet, e.name), e.name, 0);
						} else if (listes.has(relatif)) continue;
						else if (e.name.startsWith('.')) caches.push(e.name);
						else if (niveau + 1 > NIVEAUX_AMORCE) profonds.push(e.name);
					}
				}
				if (caches.length > 0) ignores.push({ chemin: d.chemin, raison: dossiersNonParcourus(caches, (p) => (p ? 'dossiers cachés' : 'dossier caché')) });
				if (liens.length > 0) ignores.push({ chemin: d.chemin, raison: dossiersNonParcourus(liens, (p) => (p ? 'liens symboliques' : 'lien symbolique')) });
				if (profonds.length > 0) ignores.push({ chemin: d.chemin, raison: dossiersNonParcourus(profonds, (p) => `${p ? 'dossiers' : 'dossier'} au-delà de ${NIVEAUX_AMORCE} niveaux de la racine`) });
				instructions.push(...trouvees);
			}
			return { dossiers: sortie, instructions, ignores };
		},
	};
}

/** Entrées d'un dossier, triées par nom ; null s'il est illisible. */
async function entreesDe(absolu: string): Promise<Dirent[] | null> {
	try {
		return (await readdir(absolu, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
	} catch {
		return null;
	}
}
