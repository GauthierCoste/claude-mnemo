/**
 * Journal de l'app (`installation.log` dans le dossier de l'app) : ce que la vérification au lancement a refait, ou n'a pas
 * pu refaire. Une ligne horodatée par événement ; jamais d'exception (un journal impossible n'empêche rien).
 */
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const FICHIER_JOURNAL_APP = 'installation.log';

export function cheminJournalApp(dossierApp: string): string {
	return join(dossierApp, FICHIER_JOURNAL_APP);
}

export type Journal = (ligne: string) => void;

export function journalFichier(chemin: string, maintenant: () => Date = () => new Date()): Journal {
	return (ligne) => {
		try {
			mkdirSync(dirname(chemin), { recursive: true, mode: 0o700 });
			appendFileSync(chemin, `${maintenant().toISOString()} ${ligne.replaceAll('\n', ' ')}\n`, { mode: 0o600 });
		} catch {
			// journal impossible : rien de plus à faire
		}
	};
}
