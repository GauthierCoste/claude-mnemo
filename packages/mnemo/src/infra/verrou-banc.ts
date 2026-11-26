/**
 * Verrou du fichier des jugements (`banc-contexte.json.verrou`) : une seule opération l'écrit à la fois (spec « entraîner la
 * note », D7). `--juger` ouvert pendant `--extraire` (ou l'inverse), ou pendant une tâche de la page Entraîner du service,
 * perdrait des réponses ; la seconde est refusée et le refus nomme celle qui le tient. Un verrou laissé par un processus mort
 * est repris ; un verrou du processus lui-même ne l'est que s'il ne le tient plus (laissé par un arrêt brutal, pid réutilisé) :
 * le service, qui en a plusieurs tâches, ne se le vole jamais.
 */
import { closeSync, openSync, readFileSync, unlinkSync, writeSync } from 'node:fs';

/** Qui tient le verrou : processus, opération (« --juger », « préparer des messages »…), depuis quand, service ou CLI. */
export type TenantDuVerrou = { pid: number | null; operation: string; depuis: string | null; service: boolean };

/** Le verrou est tenu par une autre opération ; le message dit laquelle. */
export class ErreurVerrouBanc extends Error {
	readonly tenant: TenantDuVerrou;
	constructor(message: string, tenant: TenantDuVerrou) {
		super(message);
		this.name = 'ErreurVerrouBanc';
		this.tenant = tenant;
	}
}

/** Verrous tenus par ce processus : chemin du verrou → jeton de la prise (une prise ne rend jamais celle d'une autre). */
const tenus = new Map<string, symbol>();

const vivant = (pid: number): boolean => {
	try {
		process.kill(pid, 0);
		return true;
	} catch (e) {
		return (e as NodeJS.ErrnoException).code === 'EPERM';
	}
};

/** Le refus, en mots : le service ou la commande qui tient le fichier, et ce qu'il faut faire. */
function motifDuRefus(t: TenantDuVerrou, operation: string): string {
	const depuis = t.depuis ?? '?';
	if (t.service) {
		return `Le fichier des jugements est utilisé par le service Mnemo (${t.operation}, processus ${t.pid ?? '?'}, depuis ${depuis}) : attendez la fin de la tâche ou arrêtez-la (Mémoire › Entraîner) avant de lancer ${operation}.`;
	}
	return `Le fichier des jugements est ouvert par « mnemo banc contexte ${t.operation} » (processus ${t.pid ?? '?'}, depuis ${depuis}) : terminez-le (q) avant de lancer ${operation}.`;
}

function lireTenant(chemin: string): TenantDuVerrou | null {
	try {
		const brut = JSON.parse(readFileSync(chemin, 'utf8')) as { pid?: unknown; operation?: unknown; depuis?: unknown; service?: unknown };
		return {
			pid: typeof brut.pid === 'number' ? brut.pid : null,
			operation: typeof brut.operation === 'string' ? brut.operation : '',
			depuis: typeof brut.depuis === 'string' ? brut.depuis : null,
			service: brut.service === true,
		};
	} catch {
		// verrou illisible (ou retiré entre-temps) : traité comme laissé par un processus mort
		return null;
	}
}

/** Vrai si ce processus tient le verrou de `fichier` (une de ses tâches). */
export function verrouTenuIci(fichier: string): boolean {
	return tenus.has(`${fichier}.verrou`);
}

/**
 * Prend le verrou pour `operation` ; rend de quoi le rendre. `service` : la prise est celle du service (le refus fait au CLI
 * le dit). Refus (`ErreurVerrouBanc`) : un autre processus vivant le tient, ou ce processus le tient déjà.
 */
export function prendreVerrouBanc(fichier: string, operation: string, options: { service?: boolean } = {}): () => void {
	const chemin = `${fichier}.verrou`;
	for (let essai = 0; essai < 2; essai++) {
		try {
			const fd = openSync(chemin, 'wx', 0o600);
			try {
				writeSync(fd, JSON.stringify({ pid: process.pid, operation, depuis: new Date().toISOString(), ...(options.service === true ? { service: true } : {}) }));
			} finally {
				closeSync(fd);
			}
			const jeton = Symbol(operation);
			tenus.set(chemin, jeton);
			return () => {
				if (tenus.get(chemin) !== jeton) return;
				tenus.delete(chemin);
				try {
					unlinkSync(chemin);
				} catch {
					// Déjà retiré.
				}
			};
		} catch (e) {
			if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
			const tenant = lireTenant(chemin);
			if (tenant !== null && tenant.pid !== null) {
				const autreVivant = tenant.pid !== process.pid && vivant(tenant.pid);
				const ici = tenant.pid === process.pid && tenus.has(chemin);
				if (autreVivant || ici) throw new ErreurVerrouBanc(motifDuRefus(tenant, operation), tenant);
			}
			try {
				unlinkSync(chemin);
			} catch {
				// Un autre l'a repris entre-temps : nouvel essai.
			}
		}
	}
	throw new Error(`Verrou du fichier des jugements impossible à prendre : ${chemin}`);
}
