/**
 * Verrou du fichier des jugements (`banc-contexte.json.verrou`) : une seule commande l'écrit à la fois. `--juger` ouvert pendant
 * `--extraire` (ou l'inverse) perdrait des réponses ; la seconde est refusée clairement. Un verrou laissé par un processus mort
 * est repris.
 */
import { closeSync, openSync, readFileSync, unlinkSync, writeSync } from 'node:fs';
import { ErreurCli } from './erreurs.ts';

const vivant = (pid: number): boolean => {
	try {
		process.kill(pid, 0);
		return true;
	} catch (e) {
		return (e as NodeJS.ErrnoException).code === 'EPERM';
	}
};

/** Prend le verrou pour `operation` (« --juger », « --extraire »…) ; rend de quoi le rendre. */
export function prendreVerrouBanc(fichier: string, operation: string): () => void {
	const chemin = `${fichier}.verrou`;
	for (let essai = 0; essai < 2; essai++) {
		try {
			const fd = openSync(chemin, 'wx', 0o600);
			writeSync(fd, JSON.stringify({ pid: process.pid, operation, depuis: new Date().toISOString() }));
			closeSync(fd);
			return () => {
				try {
					unlinkSync(chemin);
				} catch {
					// Déjà retiré.
				}
			};
		} catch (e) {
			if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
			let tenant: { pid?: unknown; operation?: unknown; depuis?: unknown } = {};
			try {
				tenant = JSON.parse(readFileSync(chemin, 'utf8')) as typeof tenant;
			} catch {
				// Verrou illisible : traité comme laissé par un processus mort.
			}
			if (typeof tenant.pid === 'number' && tenant.pid !== process.pid && vivant(tenant.pid)) {
				throw new ErreurCli(
					`Le fichier des jugements est ouvert par « mnemo banc contexte ${String(tenant.operation ?? '')} » (processus ${tenant.pid}, depuis ${String(tenant.depuis ?? '?')}) : terminez-le (q) avant de lancer ${operation}.`,
				);
			}
			try {
				unlinkSync(chemin);
			} catch {
				// Un autre l'a repris entre-temps : nouvel essai.
			}
		}
	}
	throw new ErreurCli(`Verrou du fichier des jugements impossible à prendre : ${chemin}`);
}
