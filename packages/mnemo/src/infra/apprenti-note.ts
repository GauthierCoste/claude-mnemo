/**
 * L'apprentissage de la note de confiance hors du fil du service (spec « entraîner la note », D6) : `apprendreNote`, synchrone
 * et lourd (validation emboîtée, plusieurs dizaines de secondes sur un gros banc), tourne dans un fil d'exécution à part
 * (`node:worker_threads`) ; le service continue de répondre aux hooks. Le jeu et les options passent par messages (copie
 * structurée), le rapport revient de même. Arrêt (`signal`) : le fil est terminé, rien n'est rendu. Le fil charge le module
 * applicatif tel quel : TypeScript exécuté sans compilation, comme le processus (Node ≥ 24 efface les types de lui-même, et le
 * fil hérite des options du processus).
 */
import { Worker } from 'node:worker_threads';
import type { JeuDApprentissage, OptionsApprentissage, RapportDApprentissage } from '../application/apprendre-note.ts';
import type { Apprenti } from '../application/entrainement.ts';

/** Ce que le fil reçoit. */
export type TravailDApprentissage = { jeu: JeuDApprentissage; options: OptionsApprentissage };

/** L'apprentissage arrêté avant sa fin. */
export class ApprentissageArrete extends Error {
	constructor() {
		super('apprentissage arrêté');
		this.name = 'AbortError';
	}
}

/** `script` : le fil à lancer (les tests en donnent un autre). */
export function apprentiNote(options: { script?: URL } = {}): Apprenti {
	const script = options.script ?? new URL('./apprenti-note-travailleur.ts', import.meta.url);
	return {
		apprendre(jeu, opts, signal) {
			return new Promise<RapportDApprentissage>((resoudre, rejeter) => {
				if (signal?.aborted === true) return rejeter(new ApprentissageArrete());
				let fini = false;
				let fil: Worker;
				const finir = (issue: () => void): void => {
					if (fini) return;
					fini = true;
					signal?.removeEventListener('abort', arreter);
					issue();
				};
				const arreter = (): void => {
					finir(() => rejeter(new ApprentissageArrete()));
					void fil.terminate();
				};
				try {
					fil = new Worker(script, { workerData: { jeu, options: opts } satisfies TravailDApprentissage, stdout: true, stderr: true });
				} catch (erreur) {
					return rejeter(erreur);
				}
				// ce que le fil écrirait n'atteint jamais la sortie du processus (protocole MCP), ni ne le bloque
				fil.stdout.resume();
				fil.stderr.resume();
				signal?.addEventListener('abort', arreter, { once: true });
				fil.once('message', (rapport: RapportDApprentissage) => finir(() => resoudre(rapport)));
				fil.once('error', (erreur: Error) => finir(() => rejeter(erreur)));
				fil.once('exit', (code) => finir(() => rejeter(new Error(`apprentissage interrompu (fil sorti, code ${code})`))));
			});
		},
	};
}
