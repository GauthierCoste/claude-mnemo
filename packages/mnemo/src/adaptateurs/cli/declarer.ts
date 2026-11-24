import type { CommandeClaude } from '../../infra/claude.ts';
import { nodeDurable } from '../../infra/node-durable.ts';

/**
 * Réglages d'une exécution : dossier courant, environnement complet (remplace celui du processus), délai avant de tuer,
 * signal d'abandon (levé : le processus est tué, la promesse rejette).
 */
export type OptionsExecution = { cwd?: string; env?: Record<string, string>; delaiMs?: number; signal?: AbortSignal };
export type Executer = (commande: string, args: string[], options?: OptionsExecution) => Promise<{ code: number; sortie: string; erreur: string }>;

/**
 * `deja` : déclaré avec cette commande ; `perime` : déclaré avec un autre Node ou un autre `main.ts` (mise à jour de Node,
 * dépôt déplacé) — l'utilisateur retire lui-même l'ancienne déclaration (`remplacable` : c'est une déclaration de Mnemo de
 * portée utilisateur, que `mnemo declarer --remplacer` refait) ; sinon : échec, commande manuelle.
 */
export type PorteeMcp = 'user' | 'local' | 'project';

export type ResultatDeclaration = 'declare' | 'deja' | { perime: true; manuel: string; portee?: string; scope?: PorteeMcp; remplacable?: boolean } | { manuel: string; introuvable: boolean; raison: string };

export function citerPosix(chemin: string): string {
	return `'${chemin.replaceAll("'", "'\\''")}'`;
}

export function citerPowerShell(chemin: string): string {
	return `'${chemin.replaceAll("'", "''")}'`;
}

/** Commande à copier-coller : aucun JSON, chaque chemin entre apostrophes (POSIX ou PowerShell). */
export function commandeManuelle(cheminNode: string, cheminMain: string, plateforme: string): string {
	const citer = plateforme === 'win32' ? citerPowerShell : citerPosix;
	return `claude mcp add --scope user mnemo -- ${citer(cheminNode)} ${citer(cheminMain)} mcp`;
}

/** Valeur de la première ligne `<clé>: …` (clé insensible à la casse) de la sortie de `claude mcp get`. */
function valeurDeLigne(sortie: string, cle: string): string | undefined {
	for (const ligne of sortie.split(/\r?\n/u)) {
		const m = /^\s*([A-Za-z]+)\s*:(.*)$/u.exec(ligne);
		if (m !== null && m[1]!.toLowerCase() === cle) return m[2]!.trim();
	}
	return undefined;
}

/** `deja` seulement si Command vaut exactement `commande` et si le premier argument vaut exactement `cheminMain` ; format inconnu : faux. */
function memeDeclaration(sortie: string, commande: string, cheminMain: string): boolean {
	if (valeurDeLigne(sortie, 'command') !== commande) return false;
	const args = valeurDeLigne(sortie, 'args');
	return args !== undefined && (args === cheminMain || args.startsWith(`${cheminMain} `));
}

function porteeDe(texte: string): PorteeMcp {
	const mot = texte.split(/[\s(:]/u)[0]!.toLowerCase();
	return mot === 'local' || mot === 'project' ? mot : 'user';
}

function raisonCourte(texte: string): string {
	return (texte.split(/\r?\n/).find((l) => l.trim() !== '') ?? '').trim().slice(0, 200);
}

/**
 * Déclare `mnemo mcp` auprès de Claude Code au niveau utilisateur. `claude` : celui des sessions (`trouverClaude`), null s'il
 * est introuvable ; `executer` rejette s'il ne se lance pas ou ne répond pas à temps ; tout échec rend la commande manuelle.
 */
export async function declarerServeurMcp(
	executer: Executer,
	cheminMain: string,
	claude: CommandeClaude | null,
	plateforme: string = process.platform,
): Promise<ResultatDeclaration> {
	const node = nodeDurable(plateforme as NodeJS.Platform);
	const json = JSON.stringify({ type: 'stdio', command: node, args: [cheminMain, 'mcp'] });
	const manuel = commandeManuelle(node, cheminMain, plateforme);
	if (claude === null) return { manuel, introuvable: true, raison: '`claude` introuvable (PATH, ou MNEMO_CLAUDE).' };
	const lancer = (args: string[]) => executer(claude.commande, [...claude.avant, ...args]);
	try {
		const existante = await lancer(['mcp', 'get', 'mnemo']);
		if (existante.code === 0) {
			// Jamais de retrait automatique : la déclaration existante peut être voulue.
			if (memeDeclaration(existante.sortie, node, cheminMain)) return 'deja';
			const portee = valeurDeLigne(existante.sortie, 'scope');
			const scope = portee ? porteeDe(portee) : 'user';
			return { perime: true, manuel, ...(portee ? { portee } : {}), scope, remplacable: scope === 'user' && estDeclarationMnemo(existante.sortie) };
		}
		const ajout = await lancer(['mcp', 'add-json', '--scope', 'user', 'mnemo', json]);
		if (ajout.code === 0) return 'declare';
		return { manuel, introuvable: false, raison: raisonCourte(ajout.erreur) || `code ${ajout.code}` };
	} catch (erreur) {
		const e = erreur as { code?: string; message?: string };
		return { manuel, introuvable: e.code === 'ENOENT', raison: raisonCourte(e.message ?? '') };
	}
}

/** Déclaration de Mnemo, quel que soit son chemin : arguments `<…>/adaptateurs/cli/main.ts mcp`. */
function estDeclarationMnemo(sortie: string): boolean {
	const args = valeurDeLigne(sortie, 'args');
	return args !== undefined && /adaptateurs[\\/]cli[\\/]main\.ts mcp$/u.test(args);
}

/** Portée lue dans la sortie de `claude mcp get` (`User config (…)` → `user`) ; absente : null. */
function porteeLue(sortie: string): PorteeMcp | null {
	const portee = valeurDeLigne(sortie, 'scope');
	return portee === undefined ? null : porteeDe(portee);
}

/**
 * `absent` : aucune déclaration `mnemo` (rien n'est déclaré) ; `deja` : elle lance déjà ce Node et ce `main.ts` ; `remplace` :
 * une déclaration de Mnemo de portée utilisateur qui lançait un autre Node ou un autre `main.ts`, retirée puis refaite ;
 * `autre` : une déclaration `mnemo` qui ne lance pas Mnemo, ou d'une autre portée : laissée.
 */
export type ResultatRedeclaration = 'absent' | 'deja' | 'remplace' | 'autre' | { echec: string };
/** `retire` : retirée ; `autre` : elle ne lance pas ce Mnemo (ou d'une autre portée) : laissée. */
export type ResultatRetraitMcp = 'absent' | 'retire' | 'autre' | { echec: string };

const echecDe = (erreur: unknown): { echec: string } => {
	const e = erreur as { code?: string; message?: string };
	return { echec: e.code === 'ENOENT' ? '`claude` introuvable.' : raisonCourte(e.message ?? '') || 'claude ne répond pas.' };
};

/**
 * Remet la déclaration de Mnemo (portée utilisateur) sur ce Node et ce `main.ts`, seulement si elle existe déjà (après une
 * mise à jour de Node ou un déplacement de Mnemo) : rien n'est déclaré quand il n'y en a pas, et une déclaration `mnemo`
 * qui ne lance pas Mnemo, ou d'une autre portée, n'est jamais touchée.
 */
export async function redeclarerServeurMcp(executer: Executer, cheminMain: string, claude: CommandeClaude | null, plateforme: string = process.platform): Promise<ResultatRedeclaration> {
	if (claude === null) return { echec: '`claude` introuvable (PATH, ou MNEMO_CLAUDE).' };
	const node = nodeDurable(plateforme as NodeJS.Platform);
	const lancer = (args: string[]) => executer(claude.commande, [...claude.avant, ...args]);
	try {
		const existante = await lancer(['mcp', 'get', 'mnemo']);
		if (existante.code !== 0) return 'absent';
		if (memeDeclaration(existante.sortie, node, cheminMain)) return 'deja';
		if (!estDeclarationMnemo(existante.sortie) || porteeLue(existante.sortie) !== 'user') return 'autre';
		const retrait = await lancer(['mcp', 'remove', '--scope', 'user', 'mnemo']);
		if (retrait.code !== 0) return { echec: raisonCourte(retrait.erreur) || `claude mcp remove : code ${retrait.code}` };
		const ajout = await lancer(['mcp', 'add-json', '--scope', 'user', 'mnemo', JSON.stringify({ type: 'stdio', command: node, args: [cheminMain, 'mcp'] })]);
		if (ajout.code !== 0) return { echec: raisonCourte(ajout.erreur) || `claude mcp add-json : code ${ajout.code}` };
		return 'remplace';
	} catch (erreur) {
		return echecDe(erreur);
	}
}

/** Retire la déclaration de Mnemo (portée utilisateur) seulement si elle lance ce Node et ce `main.ts`. */
export async function retirerServeurMcp(executer: Executer, cheminMain: string, claude: CommandeClaude | null, plateforme: string = process.platform): Promise<ResultatRetraitMcp> {
	if (claude === null) return { echec: '`claude` introuvable (PATH, ou MNEMO_CLAUDE).' };
	const node = nodeDurable(plateforme as NodeJS.Platform);
	const lancer = (args: string[]) => executer(claude.commande, [...claude.avant, ...args]);
	try {
		const existante = await lancer(['mcp', 'get', 'mnemo']);
		if (existante.code !== 0) return 'absent';
		if (!memeDeclaration(existante.sortie, node, cheminMain) || porteeLue(existante.sortie) !== 'user') return 'autre';
		const retrait = await lancer(['mcp', 'remove', '--scope', 'user', 'mnemo']);
		if (retrait.code !== 0) return { echec: raisonCourte(retrait.erreur) || `claude mcp remove : code ${retrait.code}` };
		return 'retire';
	} catch (erreur) {
		return echecDe(erreur);
	}
}
