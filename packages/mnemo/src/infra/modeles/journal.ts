import { appendFile, stat, truncate } from 'node:fs/promises';
import { join } from 'node:path';

/** Borne du journal des modèles : au-delà, il est vidé avant d'écrire. */
export const TAILLE_MAX_JOURNAL = 1024 * 1024;

/**
 * Une ligne dans `modeles.log` de `dossier` (`serveurs/` du cache des modèles) : date, pid, message ; vidé quand il dépasse
 * `max` octets. Ne lève jamais : un journal impossible à écrire ne doit rien faire échouer. Ne crée pas le dossier.
 */
export async function journaliser(dossier: string, message: string, max = TAILLE_MAX_JOURNAL): Promise<void> {
	const fichier = join(dossier, 'modeles.log');
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
