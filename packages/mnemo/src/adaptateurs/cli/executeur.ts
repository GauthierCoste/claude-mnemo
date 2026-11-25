import { execFile } from 'node:child_process';
import type { Executer, OptionsExecution } from '../../application/ports.ts';

type Lancer = (
	commande: string,
	args: string[],
	fin: (erreur: (Error & { code?: string | number | null }) | null, sortie: string, erreurSortie: string) => void,
	options?: OptionsExecution,
) => void;

/** Délai par défaut (`claude mcp …`) ; sortie gardée : 1 Mo par défaut, 16 Mo pour une exécution longue (`delaiMs`). */
const DELAI_MS = 15_000;

const lancerReel: Lancer = (commande, args, fin, options = {}) => {
	// Jamais de shell : les arguments (JSON, chemins) partent tels quels.
	const enfant = execFile(
		commande,
		args,
		{
			timeout: options.delaiMs ?? DELAI_MS,
			windowsHide: true,
			maxBuffer: (options.delaiMs === undefined ? 1 : 16) * 1024 * 1024,
			...(options.cwd === undefined ? {} : { cwd: options.cwd }),
			...(options.env === undefined ? {} : { env: options.env }),
			...(options.signal === undefined ? {} : { signal: options.signal }),
		},
		(erreur, sortie, erreurSortie) => fin(erreur, sortie, erreurSortie),
	);
	// rien à lire sur l'entrée : fermée tout de suite (un `claude -p` qui lit l'entrée n'attend pas)
	enfant.stdin?.end();
};

/**
 * Exécuteur réel : rend le code de sortie ; rejette si le programme est introuvable, tué (délai : 15 s, ou `delaiMs`) ou
 * illancable, ou abandonné (`signal`).
 */
export function executeurReel(lancer: Lancer = lancerReel): Executer {
	return (commande, args, options) =>
		new Promise((resoudre, rejeter) => {
			lancer(commande, args, (erreur, sortie, erreurSortie) => {
				if (!erreur) return resoudre({ code: 0, sortie, erreur: erreurSortie });
				if (typeof erreur.code === 'number') return resoudre({ code: erreur.code, sortie, erreur: erreurSortie });
				rejeter(erreur);
			}, options);
		});
}
