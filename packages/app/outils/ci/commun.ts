/**
 * Outils communs des essais de la CI (workflow `app-windows.yml`) : lancer un programme sans shell avec un délai, une requête
 * au service local, et l'issue d'un essai (un échec attendu est dit en une ligne, code de sortie 1).
 */
import { spawn } from 'node:child_process';
import { request } from 'node:http';

/** Échec d'un essai : son message suffit (pas de pile). */
export class EchecEssai extends Error {}

export function echouer(message: string): never {
	throw new EchecEssai(message);
}

export function etape(texte: string): void {
	console.log(`essai : ${texte}`);
}

export type Sortie = { code: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string };

/**
 * Lance `commande args` sans shell, entrée fermée ; rend ses sorties à sa fin. Au-delà de `delaiMs`, il est tué et l'essai
 * échoue (ce qu'il a écrit est dans le message).
 */
export function lancer(commande: string, args: readonly string[], options: { env?: NodeJS.ProcessEnv; cwd?: string; delaiMs: number }): Promise<Sortie> {
	return new Promise((resoudre, rejeter) => {
		const enfant = spawn(commande, args, { env: options.env ?? process.env, cwd: options.cwd, stdio: ['ignore', 'pipe', 'pipe'], shell: false, windowsHide: true });
		let stdout = '';
		let stderr = '';
		enfant.stdout.setEncoding('utf8').on('data', (m: string) => (stdout += m));
		enfant.stderr.setEncoding('utf8').on('data', (m: string) => (stderr += m));
		const delai = setTimeout(() => {
			enfant.kill();
			rejeter(new EchecEssai(`${commande} ${args.join(' ')} : pas fini en ${options.delaiMs / 1000} s.\n${stdout}${stderr}`));
		}, options.delaiMs);
		enfant.on('error', (e) => {
			clearTimeout(delai);
			rejeter(new EchecEssai(`${commande} : ${e.message}`));
		});
		enfant.on('close', (code, signal) => {
			clearTimeout(delai);
			resoudre({ code, signal, stdout, stderr });
		});
	});
}

/** Requête au service local (jeton en Bearer, sans `Origin`) ; rend le statut et le corps JSON (null s'il n'en est pas). */
export function requete(port: number, jeton: string, methode: 'GET' | 'POST', chemin: string, corps?: unknown): Promise<{ statut: number; corps: unknown }> {
	return new Promise((resoudre, rejeter) => {
		const donnees = corps === undefined ? '' : JSON.stringify(corps);
		const entetes: Record<string, string | number> = { Authorization: `Bearer ${jeton}` };
		if (corps !== undefined) Object.assign(entetes, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(donnees) });
		const req = request({ host: '127.0.0.1', port, method: methode, path: chemin, headers: entetes, timeout: 30_000 }, (res) => {
			let texte = '';
			res.setEncoding('utf8').on('data', (m: string) => (texte += m));
			res.on('end', () => {
				let lu: unknown = null;
				try {
					lu = JSON.parse(texte);
				} catch {
					// corps non JSON : null
				}
				resoudre({ statut: res.statusCode ?? 0, corps: lu });
			});
		});
		req.on('timeout', () => req.destroy(new Error('pas de réponse en 30 s')));
		req.on('error', (e) => rejeter(new EchecEssai(`${methode} ${chemin} : ${e.message}`)));
		req.end(donnees);
	});
}

export const pause = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Exécute l'essai : un `EchecEssai` est dit en une ligne (code 1) ; toute autre erreur remonte telle quelle. */
export async function executer(essai: () => Promise<void>): Promise<void> {
	try {
		await essai();
	} catch (e) {
		if (!(e instanceof EchecEssai)) throw e;
		console.error(`essai : échec — ${e.message}`);
		process.exitCode = 1;
	}
}
