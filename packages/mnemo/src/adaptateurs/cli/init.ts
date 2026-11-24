import { existsSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import type { Interface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { initialiser } from '../../application/initialiser.ts';
import type { ResultatInitialisation } from '../../application/initialiser.ts';
import { trouverClaude } from '../../infra/claude.ts';
import { commandeAJour, dossierDeCommande } from '../../infra/commande-mnemo.ts';
import { dependancesReelles } from '../../infra/systeme.ts';
import { nodeDurable } from '../../infra/node-durable.ts';
import { citerPosix, citerPowerShell, commandeManuelle, declarerServeurMcp } from './declarer.ts';
import type { ResultatDeclaration } from './declarer.ts';
import { ErreurCli } from './erreurs.ts';
import { executeurReel } from './executeur.ts';
import { DOSSIER_MEMOIRE } from '../../domaine/dossier-memoire.ts';

const MAIN = fileURLToPath(new URL('./main.ts', import.meta.url));
const SCHEMA = new URL('../../../modeles/SCHEMA.md', import.meta.url);
const USAGE = 'Usage : mnemo init [dossier] [--oui] [--sans-mcp]';
/** Une réponse invalide est reposée ; après ce nombre d'essais, le défaut est pris. */
const ESSAIS = 3;

/** Ce que `init` fait hors de la mémoire, à la demande seulement ; remplaçable (tests : rien n'est téléchargé ni installé). */
export type ActionsInit = {
	declarerMcp(): Promise<ResultatDeclaration>;
	installerModeles(racine: string): Promise<void>;
	creerLanceur(racine: string): Promise<void>;
	installerCommande(): Promise<void>;
	/** La commande `mnemo` installée lance-t-elle déjà ce Mnemo ? (Alors elle n'est pas proposée.) */
	commandeAJour(): boolean;
};

/**
 * Échanges de `init` : `interactif` (un terminal, par défaut si l'entrée et la sortie en sont un) pose les questions, sauf
 * `--oui` ; sans terminal (script, CI), les défauts sont pris comme avec `--oui`.
 */
export type OptionsInit = { entree?: Readable; sortie?: Writable; interactif?: boolean; plateforme?: NodeJS.Platform; actions?: Partial<ActionsInit> };

const actionsReelles: ActionsInit = {
	declarerMcp: () => declarerServeurMcp(executeurReel(), MAIN, trouverClaude(process.env, process.platform)),
	installerModeles: async (racine) => (await import('./modeles.ts')).commandeModeles(['installer'], { racine }),
	creerLanceur: async (racine) => (await import('./lanceur.ts')).commandeLanceur([], racine),
	installerCommande: async () => (await import('./commande.ts')).commandeCommande([]),
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

/**
 * `mnemo init [dossier] [--oui] [--sans-mcp]` : crée la mémoire (`_mnemo/`) ; dans un terminal, sur un dossier vierge, guide
 * pas à pas : dossier (`~/…` admis, chemin absolu affiché et confirmé avant création), déclaration à Claude Code,
 * modèles locaux (téléchargement, non par défaut), commande `mnemo` et lanceur macOS (oui par défaut). `--oui` : tous les défauts, sans question. Sans terminal ni `--oui` : les défauts
 * aussi, mais rien hors du dossier (ni déclaration MCP, ni modèles, ni lanceur) : la commande à lancer est donnée. Une
 * mémoire existante n'est jamais réécrite : seuls la déclaration MCP, la commande et le lanceur sont demandés.
 */
export async function commandeInit(args: string[], o: OptionsInit = {}): Promise<void> {
	const sansMcp = args.includes('--sans-mcp') || process.env.MNEMO_SANS_MCP === '1';
	const oui = args.includes('--oui');
	const inconnue = args.find((a) => a.startsWith('-') && a !== '--sans-mcp' && a !== '--oui');
	if (inconnue !== undefined) throw new ErreurCli(`Option inconnue : « ${inconnue} ».\n${USAGE}`, 2);
	const positionnels = args.filter((a) => !a.startsWith('-'));
	if (positionnels.length > 1) throw new ErreurCli(USAGE, 2);
	const sortie = o.sortie ?? process.stdout;
	const plateforme = o.plateforme ?? process.platform;
	const actions = { ...actionsReelles, ...o.actions };
	const ecrire = (ligne: string) => void sortie.write(`${ligne}\n`);
	const guide = !oui && (o.interactif ?? (process.stdin.isTTY === true && process.stdout.isTTY === true));
	const q: Questionneur | null = guide ? questionneur(o.entree ?? process.stdin, sortie) : null;
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

		const ici = process.cwd();
		const avecMemoire = (dossier: string) => existsSync(join(dossier, DOSSIER_MEMOIRE, 'SCHEMA.md'));
		let racine: string;
		if (positionnels[0] !== undefined) {
			const donne = cheminSaisi(positionnels[0]);
			if (donne === null) throw new ErreurCli(`Forme « ${positionnels[0]} » non prise en charge : donnez un chemin absolu, relatif ou ~/…`, 2);
			racine = donne;
		} else if (q === null || avecMemoire(ici)) racine = ici;
		else racine = await choisirDossier(q, ici, avecMemoire, ecrire, ouiNon);
		ecrire(`Dossier Mnemo : ${racine}`);
		const existante = avecMemoire(racine);
		await mkdir(racine, { recursive: true });
		const schema = await readFile(SCHEMA, 'utf8');
		const dependances = dependancesReelles(racine);
		let resultat: ResultatInitialisation;
		try {
			resultat = await initialiser(dependances, schema);
		} finally {
			dependances.index.fermer();
		}
		// la déclaration touche la configuration de Claude Code : seulement sur réponse, ou avec --oui
		let declaration: ResultatDeclaration | null = null;
		let sansDeclaration: string | null = null;
		if (!sansMcp) {
			if (oui || (q !== null && (await ouiNon('Déclarer Mnemo à Claude Code pour toutes les sessions (serveur MCP) ?', true)))) declaration = await actions.declarerMcp();
			else if (q === null) {
				sansDeclaration = `Serveur MCP non déclaré (ni terminal ni --oui) : relancez « mnemo init --oui », ou lancez vous-même : ${commandeManuelle(nodeDurable(), MAIN, process.platform)}`;
			} else sansDeclaration = 'Serveur MCP non déclaré ; plus tard : mnemo init (dans ce dossier).';
		}
		for (const ligne of messagesInit(racine, resultat, declaration)) ecrire(ligne);
		if (sansDeclaration !== null) ecrire(sansDeclaration);

		if (!existante) {
			if (await ouiNon('Installer les modèles locaux (recherche par le sens ; environ 1,3 Go à télécharger) ?', false)) await actions.installerModeles(racine);
			else ecrire('Modèles locaux : non installés (la recherche se fait par les mots) ; plus tard : mnemo modeles installer.');
		}
		// hors du dossier : proposés (oui par défaut) seulement à qui répond ; ni avec --oui, ni sans terminal, ni en fin d'entrée
		let commande = false;
		if (plateforme !== 'win32') {
			if (actions.commandeAJour()) commande = true;
			else if (await ouiNon('Installer la commande « mnemo » dans le terminal (~/.local/bin/mnemo) ?', q !== null, false)) {
				await actions.installerCommande();
				commande = true;
			} else if (!existante) ecrire('Commande « mnemo » : non installée ; plus tard : mnemo commande.');
		}
		let lanceur = false;
		if (plateforme === 'darwin') {
			if (await ouiNon('Créer l’application Mnemo (~/Applications/Mnemo.app, à mettre dans le Dock) ?', q !== null, false)) {
				await actions.creerLanceur(racine);
				lanceur = true;
			} else if (!existante) ecrire('Application Mnemo : non créée ; plus tard : mnemo lanceur.');
		}
		const demarrer = lanceur ? 'ouvrez l’application Mnemo (Launchpad, Spotlight ou Dock)' : commande ? `mnemo ${racine}` : commandeDemarrage(nodeDurable(plateforme), MAIN, racine, plateforme);
		ecrire(`Pour démarrer : ${demarrer}.`);
		if (!existante) ecrire('Première ouverture dans un navigateur : mnemo jeton.');
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
			ecrire(`Forme « ${r} » non prise en charge : donnez un chemin absolu, relatif ou ~/…`);
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
	else if ('perime' in declaration) lignes.push(`Serveur MCP déclaré avec un autre chemin${declaration.portee === undefined ? '' : ` (portée : ${declaration.portee})`} : lancez \`claude mcp remove mnemo --scope ${declaration.scope ?? 'user'}\` puis : ${declaration.manuel}`);
	else if (declaration.introuvable) lignes.push(`Claude Code introuvable : lancez vous-même : ${declaration.manuel}`);
	else lignes.push(`Déclaration automatique impossible (${declaration.raison}) : lancez vous-même : ${declaration.manuel}`);
	return lignes;
}

/** Ligne de démarrage à copier-coller sans la commande `mnemo` : PowerShell (`& 'node.exe' …`) sous Windows, POSIX ailleurs. */
export function commandeDemarrage(node: string, main: string, racine: string, plateforme: NodeJS.Platform): string {
	return plateforme === 'win32' ? `& ${[node, main, racine].map(citerPowerShell).join(' ')}` : [node, main, racine].map(citerPosix).join(' ');
}
