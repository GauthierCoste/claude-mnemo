import { existsSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import type { Interface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import type { EtapeInit, MotifEchecInit } from '@mnemo/contrat';
import { initialiser } from '../../application/initialiser.ts';
import type { ResultatInitialisation } from '../../application/initialiser.ts';
import type { ResultatDeclaration, ResultatInstallationHooks } from '../../application/ports.ts';
import { citerPosix, citerPowerShell } from '../../domaine/citer.ts';
import { commandeManuelle, declarerServeurMcp } from '../../infra/moteurs/claude-code/declaration-mcp.ts';
import { trouverClaude } from '../../infra/moteurs/claude-code/trouver-claude.ts';
import { MOTEURS_DU_POSTE } from '../../infra/moteurs/moteurs.ts';
import { MOTEURS_FACULTATIFS } from './moteurs-facultatifs.ts';
import { messageDeclarationMoteur, messageHooksMoteur } from '../../application/moteurs/messages-liaison.ts';
import type { IdMoteur } from '../../domaine/moteurs/moteur.ts';
import { commandeAJour, dossierDeCommande } from '../../infra/commande-mnemo.ts';
import type { Piece } from '../../infra/modeles/catalogue.ts';
import { dependancesReelles } from '../../infra/systeme.ts';
import { nodeDurable } from '../../infra/node-durable.ts';
import { ErreurCli } from './erreurs.ts';
import { executeurReel } from '../../infra/executeur.ts';
import { journalInit } from './init-journal.ts';
import { lireOptionsInit } from './init-options.ts';
import type { ChoixExplicite } from './init-options.ts';
import { DOSSIER_MEMOIRE } from '../../domaine/dossier-memoire.ts';

const MAIN = fileURLToPath(new URL('./main.ts', import.meta.url));
const SCHEMA = new URL('../../../modeles/SCHEMA.md', import.meta.url);
/** Une réponse invalide est reposée ; après ce nombre d'essais, le défaut est pris. */
const ESSAIS = 3;

/** Suivi de l'installation des modèles par `init --json` : ses lignes et la progression de chaque téléchargement. */
export type SuiviModeles = {
	journal: { info(ligne: string): void; erreur(ligne: string): void };
	progression(piece: Piece, recu: number, total: number | null): void;
};

/**
 * Ce que `init` fait hors de la mémoire, à la demande seulement ; remplaçable (tests : rien n'est téléchargé ni installé).
 * `suivi`, `ecrire` : donnés par `--json` seulement (rien sur la sortie standard) ; sinon, chaque action écrit elle-même.
 */
export type ActionsInit = {
	declarerMcp(): Promise<ResultatDeclaration>;
	/** Déclaration du serveur MCP chez un moteur facultatif (sur son option : `--codex`, `--mistral`). */
	declarerAuMoteur(id: IdMoteur): Promise<ResultatDeclaration>;
	/** Hooks de Mnemo pour tout le poste chez ce moteur (`~/.codex/hooks.json`, `~/.vibe/hooks.toml`). */
	installerHooks(id: IdMoteur): Promise<ResultatInstallationHooks>;
	/** Le fichier de hooks visé chez ce moteur, pour les messages. */
	cheminHooks(id: IdMoteur): string;
	installerModeles(racine: string, suivi?: SuiviModeles): Promise<void>;
	creerLanceur(racine: string, ecrire?: (ligne: string) => void): Promise<void>;
	installerCommande(ecrire?: (ligne: string) => void): Promise<void>;
	/** La commande `mnemo` installée lance-t-elle déjà ce Mnemo ? (Alors elle n'est pas proposée.) */
	commandeAJour(): boolean;
};

/**
 * Échanges de `init` : `interactif` (un terminal, par défaut si l'entrée et la sortie en sont un) pose les questions, sauf
 * `--oui` ou `--json` ; sans terminal (script, CI), les défauts sont pris comme avec `--oui`. `maintenant` : l'horloge du
 * rythme des lignes de progression (tests).
 */
export type OptionsInit = {
	entree?: Readable;
	sortie?: Writable;
	interactif?: boolean;
	plateforme?: NodeJS.Platform;
	actions?: Partial<ActionsInit>;
	maintenant?: () => number;
};

const actionsReelles: ActionsInit = {
	declarerMcp: () => declarerServeurMcp(executeurReel(), MAIN, trouverClaude(process.env, process.platform)),
	declarerAuMoteur: (id) =>
		MOTEURS_DU_POSTE[id].declarationMcp.declarer({ executer: executeurReel(), main: MAIN, commande: MOTEURS_DU_POSTE[id].trouver(process.env, process.platform), plateforme: process.platform, env: process.env }),
	installerHooks: (id) => MOTEURS_DU_POSTE[id].hooksDuPoste!.installer({ node: nodeDurable(process.platform), main: MAIN, env: process.env }),
	cheminHooks: (id) => MOTEURS_DU_POSTE[id].hooksDuPoste!.chemin(process.env),
	installerModeles: async (racine, suivi) => (await import('./modeles.ts')).commandeModeles(['installer'], { racine, ...suivi }),
	creerLanceur: async (racine, ecrire) => (await import('./lanceur.ts')).commandeLanceur([], racine, ecrire),
	installerCommande: async (ecrire) => (await import('./commande.ts')).commandeCommande([], ecrire === undefined ? {} : { ecrire }),
	commandeAJour: () => commandeAJour(dossierDeCommande(homedir()), { node: process.execPath, main: MAIN }),
};

type Questionneur = { demander(question: string): Promise<string | null>; fermer(): void };

/** Questions ligne à ligne, l'entrée ouverte à la première ; l'entrée finie, chaque question rend null (son défaut). */
function questionneur(entree: Readable, sortie: Writable): Questionneur {
	let lecture: { lignes: Interface; iterateur: AsyncIterator<string> } | null = null;
	let fini = false;
	return {
		async demander(question) {
			sortie.write(question);
			if (!fini) {
				if (lecture === null) {
					const lignes = createInterface({ input: entree, terminal: false, crlfDelay: Infinity });
					lecture = { lignes, iterateur: lignes[Symbol.asyncIterator]() };
				}
				const r = await lecture.iterateur.next();
				if (r.done !== true) return r.value.trim();
				fini = true;
			}
			sortie.write('\n');
			return null;
		},
		fermer: () => lecture?.lignes.close(),
	};
}

const texteErreur = (erreur: unknown): string => (erreur instanceof Error ? erreur.message : String(erreur));

/** Échec d'une étape dont la cause est dite au programme qui lit le JSON (`motif` de la ligne). */
class EchecMotive extends Error {
	readonly motif: MotifEchecInit;
	constructor(message: string, motif: MotifEchecInit) {
		super(message);
		this.motif = motif;
	}
}

/**
 * `mnemo init [dossier] [options]` : crée la mémoire (`_mnemo/`) ; dans un terminal, sur un dossier vierge, guide pas à pas :
 * dossier (`~/…` admis, chemin absolu affiché et confirmé avant création), déclaration à Claude Code, modèles locaux
 * (téléchargement, non par défaut), commande `mnemo` et lanceur macOS (oui par défaut). `--oui` : tous les défauts, sans
 * question. Sans terminal ni `--oui` : les défauts aussi, mais rien hors du dossier (ni déclaration MCP, ni modèles, ni
 * lanceur) : la commande à lancer est donnée. Une mémoire existante n'est jamais réécrite : seuls la déclaration MCP, la
 * commande et le lanceur sont demandés.
 *
 * Options explicites (`--mcp`/`--sans-mcp`, `--modeles`/`--sans-modeles`, `--commande`/`--sans-commande`,
 * `--lanceur`/`--sans-lanceur`) : l'étape est faite ou sautée sans question, avec ou sans terminal, mémoire existante ou
 * non (`MNEMO_SANS_MCP=1` l'emporte sur `--mcp`). `--json` : aucune question, une ligne `LigneInit` (`@mnemo/contrat`) par
 * événement et rien d'autre sur la sortie standard. L'échec d'une étape hors mémoire n'arrête pas les suivantes : il est
 * dit, puis le code de sortie est 1 (en texte, une déclaration MCP impossible reste dite sans être un échec, comme avant).
 * `--codex` : déclare aussi le serveur MCP chez Codex et installe les hooks de Mnemo dans `~/.codex/hooks.json` (sans
 * question ; sans `--codex`, Codex n'est jamais touché) ; de même `--mistral` chez Mistral Vibe (`~/.vibe/config.toml` et
 * `~/.vibe/hooks.toml`).
 */
export async function commandeInit(args: string[], o: OptionsInit = {}): Promise<void> {
	const choix = lireOptionsInit(args);
	const sansMcpEnv = process.env.MNEMO_SANS_MCP === '1';
	const { oui, json } = choix;
	const sortie = o.sortie ?? process.stdout;
	const plateforme = o.plateforme ?? process.platform;
	const actions = { ...actionsReelles, ...o.actions };
	const j = journalInit((ligne) => void sortie.write(`${ligne}\n`), json, o.maintenant);
	const ecrire = (ligne: string) => j.texte(ligne);
	const guide = !oui && !json && (o.interactif ?? (process.stdin.isTTY === true && process.stdout.isTTY === true));
	const q: Questionneur | null = guide ? questionneur(o.entree ?? process.stdin, sortie) : null;
	const echecs: EtapeInit[] = [];
	try {
		/** Oui ou non ; vide ou trop d'essais : le défaut ; fin de l'entrée : `siFin` (le défaut, sauf mention). */
		const ouiNon = async (question: string, defaut: boolean, siFin: boolean = defaut): Promise<boolean> => {
			if (q === null) return defaut;
			for (let essai = 0; essai < ESSAIS; essai++) {
				const r = await q.demander(`${question} ${defaut ? '[O/n]' : '[o/N]'} `);
				if (r === null) return siFin;
				if (r === '') return defaut;
				if (/^(o|oui|y|yes)$/iu.test(r)) return true;
				if (/^(n|non|no)$/iu.test(r)) return false;
				ecrire('Répondre par o (oui) ou n (non).');
			}
			return defaut;
		};
		/** Le choix explicite s'il y en a un (aucune question), sinon la réponse (ou le défaut). */
		const decider = async (explicite: ChoixExplicite, question: string, defaut: boolean, siFin: boolean = defaut): Promise<boolean> =>
			explicite ?? (await ouiNon(question, defaut, siFin));
		/** Une étape hors mémoire : son échec est dit (texte : `libelle : échec — …`), compté, et la suite continue. */
		// une action qui rend `{ laisse }` a laissé les choses telles quelles, à dessein : ni fait, ni échec
		const mener = async (etape: EtapeInit, libelle: string, debut: string, action: () => Promise<string | { laisse: string }>): Promise<boolean> => {
			j.evenement(etape, 'debut', debut);
			try {
				const r = await action();
				if (typeof r === 'string') j.evenement(etape, 'fait', r);
				else j.evenement(etape, 'laisse', r.laisse);
				return true;
			} catch (erreur) {
				echecs.push(etape);
				ecrire(`${libelle} : échec — ${texteErreur(erreur)}`);
				j.evenement(etape, 'echec', texteErreur(erreur), erreur instanceof EchecMotive ? erreur.motif : undefined);
				return false;
			}
		};

		const ici = process.cwd();
		const avecMemoire = (dossier: string) => existsSync(join(dossier, DOSSIER_MEMOIRE, 'SCHEMA.md'));
		let racine: string;
		if (choix.dossier !== undefined) {
			const donne = cheminSaisi(choix.dossier);
			if (donne === null) throw new ErreurCli(`Forme « ${choix.dossier} » non prise en charge : un chemin absolu, relatif ou ~/… attendu`, 2);
			racine = donne;
		} else if (q === null || avecMemoire(ici)) racine = ici;
		else racine = await choisirDossier(q, ici, avecMemoire, ecrire, ouiNon);
		ecrire(`Dossier Mnemo : ${racine}`);
		j.evenement('memoire', 'debut', `Dossier Mnemo : ${racine}`);
		const existante = avecMemoire(racine);
		let resultat: ResultatInitialisation;
		try {
			await mkdir(racine, { recursive: true });
			const schema = await readFile(SCHEMA, 'utf8');
			const dependances = dependancesReelles(racine);
			try {
				resultat = await initialiser(dependances, schema);
			} finally {
				dependances.index.fermer();
			}
		} catch (erreur) {
			// sans mémoire, rien d'autre n'est tenté : l'erreur part sur la sortie d'erreur
			j.evenement('memoire', 'echec', texteErreur(erreur));
			j.fin(racine, false);
			throw erreur;
		}
		j.evenement('memoire', 'fait', messagesInit(racine, resultat, null)[0]!);

		// la déclaration touche la configuration de Claude Code : seulement sur réponse, avec --oui ou --mcp
		let declaration: ResultatDeclaration | null = null;
		let sansDeclaration: string | null = null;
		const mcp = sansMcpEnv ? false : choix.mcp;
		if (mcp === false) j.evenement('mcp', 'saute', sansMcpEnv ? 'Serveur MCP non déclaré (MNEMO_SANS_MCP=1).' : 'Serveur MCP non déclaré (--sans-mcp).');
		else if (mcp ?? (oui || (q !== null && (await ouiNon('Déclarer Mnemo à Claude Code pour toutes les sessions (serveur MCP) ?', true))))) {
			await mener('mcp', 'Serveur MCP', 'Déclaration du serveur MCP à Claude Code.', async () => {
				declaration = await actions.declarerMcp();
				const message = messagesInit(racine, resultat, declaration)[1]!;
				// en JSON, une déclaration à refaire à la main est un échec ; en texte, elle est dite seulement
				// (déclarée pour une autre installation de Mnemo, de portée utilisateur : `perime`, que `mnemo declarer --lier` reprend)
				if (declaration === 'desactive') return { laisse: message };
				if (json && declaration !== 'declare' && declaration !== 'deja') throw 'perime' in declaration && declaration.remplacable === true ? new EchecMotive(message, 'perime') : new Error(message);
				return message;
			});
		} else {
			// sous Windows, pas de commande « mnemo » à relancer : seule la commande de Claude Code est donnée
			const manuel = commandeManuelle(nodeDurable(plateforme), MAIN, plateforme);
			if (plateforme === 'win32') sansDeclaration = `Serveur MCP non déclaré : lancer à la main : ${manuel}`;
			else
				sansDeclaration =
					q === null
						? `Serveur MCP non déclaré (ni terminal ni --oui) : relancer « mnemo init --oui », ou lancer à la main : ${manuel}`
						: 'Serveur MCP non déclaré ; plus tard : mnemo init (dans ce dossier).';
			j.evenement('mcp', 'saute', sansDeclaration);
		}
		for (const ligne of messagesInit(racine, resultat, declaration)) ecrire(ligne);
		if (sansDeclaration !== null) ecrire(sansDeclaration);

		// moteurs facultatifs : seulement sur leur option (jamais par défaut ni sur question) : serveur MCP puis hooks ;
		// MNEMO_SANS_MCP=1 l'emporte (ni l'un ni l'autre)
		for (const m of MOTEURS_FACULTATIFS) {
			if (!choix.moteurs.includes(m.id)) continue;
			const { nom } = m;
			if (sansMcpEnv) {
				j.evenement(m.etape, 'saute', `Serveur MCP non déclaré à ${nom} (MNEMO_SANS_MCP=1).`);
				j.evenement(m.etapeHooks, 'saute', `Hooks non installés chez ${nom} (MNEMO_SANS_MCP=1).`);
				continue;
			}
			let ligne: string | null = null;
			await mener(m.etape, `Serveur MCP (${nom})`, `Déclaration du serveur MCP à ${nom}.`, async () => {
				const declarationMoteur = await actions.declarerAuMoteur(m.id);
				ligne = messageDeclarationMoteur(MOTEURS_DU_POSTE[m.id], declarationMoteur);
				if (declarationMoteur === 'desactive') return { laisse: ligne };
				if (json && declarationMoteur !== 'declare' && declarationMoteur !== 'deja')
					throw 'perime' in declarationMoteur && declarationMoteur.remplacable === true ? new EchecMotive(ligne, 'perime') : new Error(ligne);
				return ligne;
			});
			if (ligne !== null) ecrire(ligne);
			let ligneHooks: string | null = null;
			const cheminHooks = actions.cheminHooks(m.id);
			await mener(m.etapeHooks, `Hooks (${nom})`, `Installation des hooks de Mnemo chez ${nom} (${cheminHooks}).`, async () => {
				const r = await actions.installerHooks(m.id);
				// hooks d'une autre installation de Mnemo : `mnemo declarer --moteur <id> --lier` les reprend
				if (typeof r !== 'string' && r.perime === true) throw new EchecMotive(r.echec, 'perime');
				if (typeof r !== 'string') throw new Error(r.echec);
				ligneHooks = messageHooksMoteur(MOTEURS_DU_POSTE[m.id], r, cheminHooks);
				return ligneHooks;
			});
			if (ligneHooks !== null) ecrire(ligneHooks);
		}

		// sur une mémoire existante, les modèles ne sont pas proposés (seulement installés sur --modeles)
		if (choix.modeles ?? (!existante && (await ouiNon('Installer les modèles locaux (recherche par le sens ; environ 1,3 Go à télécharger) ?', false)))) {
			await mener('modeles', 'Modèles locaux', 'Installation des modèles locaux.', async () => {
				if (!json) {
					await actions.installerModeles(racine);
					return 'Modèles locaux installés.';
				}
				const infos: string[] = [];
				const erreurs: string[] = [];
				const suivi: SuiviModeles = {
					journal: { info: (ligne) => void infos.push(ligne), erreur: (ligne) => void erreurs.push(ligne) },
					progression: (piece, recu, total) => j.progression(piece, recu, total),
				};
				try {
					await actions.installerModeles(racine, suivi);
				} catch (erreur) {
					throw new Error([...erreurs, texteErreur(erreur)].join(' ; '), { cause: erreur });
				}
				return infos.length > 0 ? infos.join(' ; ') : 'Modèles locaux installés.';
			});
		} else {
			// sous Windows, pas de commande « mnemo » à relancer plus tard : pas de renvoi vers elle
			const message = plateforme === 'win32' ? 'Modèles locaux : non installés (la recherche se fait par les mots).' : 'Modèles locaux : non installés (la recherche se fait par les mots) ; plus tard : mnemo modeles installer.';
			if (!existante) ecrire(message);
			j.evenement('modeles', 'saute', message);
		}

		// hors du dossier : proposés (oui par défaut) seulement à qui répond ; ni avec --oui, ni sans terminal, ni en fin d'entrée
		let commande = false;
		// sous Windows, pas de commande à installer : l'étape est sautée, sans conseil de développeur (l'app de bureau la tait)
		if (plateforme === 'win32') j.evenement('commande', 'saute', 'Commande « mnemo » : pas sous Windows.');
		else if (actions.commandeAJour()) {
			commande = true;
			// déjà là : une étape menée (`debut` puis `fait`, comme le dit le contrat), ou sautée sur --sans-commande
			const message = 'Commande « mnemo » déjà installée pour ce Mnemo.';
			if (choix.commande === false) j.evenement('commande', 'saute', message);
			else {
				j.evenement('commande', 'debut', 'Vérification de la commande « mnemo ».');
				j.evenement('commande', 'fait', message);
			}
		} else if (await decider(choix.commande, 'Installer la commande « mnemo » dans le terminal (~/.local/bin/mnemo) ?', q !== null, false)) {
			commande = await mener('commande', 'Commande « mnemo »', 'Installation de la commande « mnemo ».', async () => {
				if (!json) {
					await actions.installerCommande();
					return 'Commande « mnemo » installée.';
				}
				const lignes: string[] = [];
				await actions.installerCommande((ligne) => void lignes.push(ligne));
				return lignes.length > 0 ? lignes.join(' ') : 'Commande « mnemo » installée.';
			});
		} else {
			const message = 'Commande « mnemo » : non installée ; plus tard : mnemo commande.';
			if (!existante) ecrire(message);
			j.evenement('commande', 'saute', message);
		}

		let lanceur = false;
		if (plateforme !== 'darwin') j.evenement('lanceur', 'saute', 'L’application Mnemo (lanceur) est propre à macOS.');
		else if (await decider(choix.lanceur, 'Créer l’application Mnemo (~/Applications/Mnemo.app, à mettre dans le Dock) ?', q !== null, false)) {
			lanceur = await mener('lanceur', 'Application Mnemo', 'Création de l’application Mnemo (~/Applications/Mnemo.app).', async () => {
				if (!json) {
					await actions.creerLanceur(racine);
					return 'Application Mnemo créée.';
				}
				const lignes: string[] = [];
				await actions.creerLanceur(racine, (ligne) => void lignes.push(ligne));
				return lignes[0] ?? 'Application Mnemo créée.';
			});
		} else {
			const message = 'Application Mnemo : non créée ; plus tard : mnemo lanceur.';
			if (!existante) ecrire(message);
			j.evenement('lanceur', 'saute', message);
		}

		const demarrer = lanceur ? 'ouvrir l’application Mnemo (Launchpad, Spotlight ou Dock)' : commande ? `mnemo ${racine}` : commandeDemarrage(nodeDurable(plateforme), MAIN, racine, plateforme);
		ecrire(`Pour démarrer : ${demarrer}.`);
		if (!existante) ecrire('Première ouverture dans un navigateur : mnemo jeton.');
		j.fin(racine, echecs.length === 0);
		if (echecs.length > 0) throw new ErreurCli(`Installation incomplète, en échec : ${echecs.join(', ')}.`, 1);
	} finally {
		q?.fermer();
	}
}

/**
 * Chemin saisi, absolu : `~` et `~/…` dans le dossier personnel, un chemin relatif depuis le dossier courant ; null pour
 * `~nom` (dossier d'un autre utilisateur), qu'aucun shell n'a développé ici.
 */
export function cheminSaisi(texte: string, maison: string = homedir()): string | null {
	if (texte === '~') return maison;
	if (texte.startsWith('~/') || (process.platform === 'win32' && texte.startsWith('~\\'))) return join(maison, texte.slice(2));
	if (texte.startsWith('~')) return null;
	return resolve(texte);
}

/**
 * Dossier Mnemo demandé : le chemin absolu est affiché, puis confirmé avant toute création (sauf s'il a déjà une mémoire,
 * laissée telle quelle) ; refusé ou invalide, la question est reposée ; au bout de `ESSAIS`, rien n'est créé.
 */
async function choisirDossier(
	q: Questionneur,
	ici: string,
	avecMemoire: (dossier: string) => boolean,
	ecrire: (ligne: string) => void,
	ouiNon: (question: string, defaut: boolean) => Promise<boolean>,
): Promise<string> {
	for (let essai = 0; essai < ESSAIS; essai++) {
		const r = await q.demander(`Dossier Mnemo (la mémoire ira dans <dossier>/${DOSSIER_MEMOIRE}) [${ici}] : `);
		const chemin = r === null || r === '' ? ici : cheminSaisi(r);
		if (chemin === null) {
			ecrire(`Forme « ${r} » non prise en charge : un chemin absolu, relatif ou ~/… attendu`);
			continue;
		}
		if (avecMemoire(chemin)) return chemin;
		const question = existsSync(chemin)
			? `Créer la mémoire dans ${join(chemin, DOSSIER_MEMOIRE)} ?`
			: `${chemin} n'existe pas : le créer, avec la mémoire dans ${join(chemin, DOSSIER_MEMOIRE)} ?`;
		if (await ouiNon(question, true)) return chemin;
	}
	throw new ErreurCli('Aucun dossier confirmé : rien n’a été créé.', 1);
}

/** Une ligne pour la mémoire, une pour le serveur MCP (sauf `--sans-mcp`) : chacune ne parle que de ce qu'elle a fait. */
export function messagesInit(racine: string, resultat: ResultatInitialisation, declaration: ResultatDeclaration | null): string[] {
	const lignes: string[] = [];
	if (resultat.statut === 'cree') lignes.push(`Mémoire créée dans ${resolve(racine, DOSSIER_MEMOIRE)} (commit ${resultat.commit}).`);
	else if (resultat.profil === null) lignes.push(`Une mémoire existe déjà dans ${racine} : elle est laissée telle quelle.`);
	else lignes.push(`Une mémoire existe déjà dans ${racine} : profil travail ajouté (commit ${resultat.profil}), le reste est laissé tel quel.`);
	if (declaration === null) return lignes;
	if (declaration === 'declare') lignes.push('Serveur MCP déclaré pour toutes les sessions Claude Code.');
	else if (declaration === 'deja') lignes.push('Serveur MCP déjà déclaré.');
	else if (declaration === 'desactive') lignes.push('Serveur MCP : déclaration désactivée, laissée telle quelle.');
	else if ('perime' in declaration) lignes.push(`Serveur MCP déclaré avec un autre chemin${declaration.portee === undefined ? '' : ` (portée : ${declaration.portee})`} : lancer \`claude mcp remove mnemo --scope ${declaration.scope ?? 'user'}\` puis : ${declaration.manuel}`);
	else if (declaration.introuvable) lignes.push(`Claude Code introuvable : à lancer à la main : ${declaration.manuel}`);
	else lignes.push(`Déclaration automatique impossible (${declaration.raison}) : à lancer à la main : ${declaration.manuel}`);
	return lignes;
}

/** Ligne de démarrage à copier-coller sans la commande `mnemo` : PowerShell (`& 'node.exe' …`) sous Windows, POSIX ailleurs. */
export function commandeDemarrage(node: string, main: string, racine: string, plateforme: NodeJS.Platform): string {
	return plateforme === 'win32' ? `& ${[node, main, racine].map(citerPowerShell).join(' ')}` : [node, main, racine].map(citerPosix).join(' ');
}
