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
 * dépôt déplacé) — l'utilisateur retire lui-même l'ancienne déclaration ; sinon : échec, commande manuelle.
 */
export type PorteeMcp = 'user' | 'local' | 'project';

export type ResultatDeclaration = 'declare' | 'deja' | { perime: true; manuel: string; portee?: string; scope?: PorteeMcp } | { manuel: string; introuvable: boolean; raison: string };

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
			return { perime: true, manuel, ...(portee ? { portee } : {}), scope: portee ? porteeDe(portee) : 'user' };
		}
		const ajout = await lancer(['mcp', 'add-json', '--scope', 'user', 'mnemo', json]);
		if (ajout.code === 0) return 'declare';
		return { manuel, introuvable: false, raison: raisonCourte(ajout.erreur) || `code ${ajout.code}` };
	} catch (erreur) {
		const e = erreur as { code?: string; message?: string };
		return { manuel, introuvable: e.code === 'ENOENT', raison: raisonCourte(e.message ?? '') };
	}
}
