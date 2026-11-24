import { appendFile, stat, truncate } from 'node:fs/promises';
import { join } from 'node:path';
import { DOSSIER_LOCAL } from '../../domaine/dossier-memoire.ts';

/** Borne du journal des modèles : au-delà, il est vidé avant d'écrire. */
export const TAILLE_MAX_JOURNAL = 1024 * 1024;

/**
 * Une ligne dans `.mnemo/modeles.log` (date, pid, message), vidé quand il dépasse `max` octets. Ne lève jamais : un journal
 * impossible à écrire ne doit rien faire échouer. Ne crée jamais `.mnemo/` : un dossier supprimé n'est pas recréé.
 */
export async function journaliser(racine: string, message: string, max = TAILLE_MAX_JOURNAL): Promise<void> {
	const fichier = join(racine, DOSSIER_LOCAL, 'modeles.log');
	try {
		try {
			if ((await stat(fichier)).size > max) await truncate(fichier, 0);
		} catch {
			/* pas encore de journal */
		}
		await appendFile(fichier, `${new Date().toISOString()} [${process.pid}] ${message.replace(/[\r\n]+/gu, ' ')}\n`, { mode: 0o600 });
	} catch {
		/* journal impossible : ignoré */
	}
}
