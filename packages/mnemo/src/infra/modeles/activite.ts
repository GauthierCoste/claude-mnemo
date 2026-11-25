import { rmSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { estOperationModele } from '@mnemo/commun';
import type { AvancementModele, OperationModele } from '@mnemo/commun';
import { ecrireJson, pidVivant } from './serveurs.ts';

/** Sous-dossier de `serveurs/` qui tient un fichier par appel en cours (`<pid>-<n>.json`). */
export const SOUS_DOSSIER_ACTIVITE = 'activite';
/** Filet : un fichier plus vieux (sans réécriture), processus vivant, est ignoré (son échéance le retire d'ordinaire bien avant). */
export const AGE_MAX_ACTIVITE_MS = 10 * 60_000;
/**
 * Un fichier dont l'échéance (`jusqueMs`) est dépassée de plus que cela est retiré, même d'un pid vivant : l'appel qui l'a
 * écrit ne peut plus durer (un pid réutilisé par un autre processus, sous Windows surtout, le ferait sinon vivre).
 */
export const MARGE_ECHEANCE_MS = 5000;
/** L'avancement d'une vectorisation est réécrit au plus une fois par cet écart. */
export const ECART_AVANCEMENT_MS = 1000;
/**
 * Une vectorisation enchaîne ses lots (un appel chacun) : son fichier survit ce temps à la fin d'un appel, et l'appel
 * suivant de la même passe le reprend, au lieu de le retirer et de le recréer à chaque lot.
 */
export const REPRISE_MS = 1000;

/**
 * Un appel en cours : ce qu'il fait, pour quel dossier Mnemo (sa racine) et quelle session, depuis quand, et jusqu'à quand
 * au plus (`jusqueMs` : la fin de son budget). Jamais de texte.
 */
export type Activite = {
	operation: OperationModele;
	dossier: string;
	session: string | null;
	depuisMs: number;
	jusqueMs: number;
	avancement: AvancementModele | null;
};
export type DescriptionActivite = Omit<Activite, 'depuisMs'>;

/** Dossier des fichiers d'activité, dans `serveurs/` (à surveiller pour suivre les appels en direct). */
export function dossierActivite(dossierServeurs: string): string {
	return join(dossierServeurs, SOUS_DOSSIER_ACTIVITE);
}

type Fiche = {
	fichier: string;
	activite: Activite;
	ecritMs: number;
	/** Écritures et retrait, enchaînés dans l'ordre ; jamais en échec. */
	file: Promise<void>;
	/** Minuteur du retrait différé (vectorisation entre deux lots), ou null pendant l'appel. */
	retrait: ReturnType<typeof setTimeout> | null;
	cle: string | null;
};

let compteur = 0;
/** Fichiers de ce processus pas encore retirés : retirés à sa sortie. */
const vivantes = new Set<Fiche>();
/** Vectorisations entre deux lots, par passe (dossier des serveurs, dossier Mnemo, session) : reprises par le lot suivant. */
const enAttente = new Map<string, Fiche>();
let sortieSurveillee = false;

function surveillerSortie(): void {
	if (sortieSurveillee) return;
	sortieSurveillee = true;
	process.once('exit', () => {
		for (const f of vivantes) {
			try {
				rmSync(f.fichier, { force: true });
			} catch {
				/* la purge des pids morts le retirera */
			}
		}
	});
}

function enchainer(fiche: Fiche, etape: () => Promise<unknown>): void {
	fiche.file = fiche.file.then(etape).then(
		() => {},
		() => {},
	);
}

function ecrire(fiche: Fiche): void {
	fiche.ecritMs = Date.now();
	const valeur = { ...fiche.activite };
	enchainer(fiche, () => ecrireJson(fiche.fichier, valeur));
}

function ouvrir(dossierServeurs: string, d: DescriptionActivite): Fiche {
	const maintenant = Date.now();
	const jusqueMs = Math.min(d.jusqueMs, maintenant + AGE_MAX_ACTIVITE_MS);
	const cle = d.avancement === null ? null : JSON.stringify([dossierServeurs, d.operation, d.dossier, d.session]);
	const reprise = cle === null ? undefined : enAttente.get(cle);
	if (reprise !== undefined) {
		enAttente.delete(cle!);
		clearTimeout(reprise.retrait!);
		reprise.retrait = null;
		// une nouvelle passe (premier lot) qui reprend le fichier de la précédente a son propre début
		const nouvellePasse = d.avancement!.faits === 0;
		if (nouvellePasse) reprise.activite.depuisMs = maintenant;
		const ecrite = reprise.activite.jusqueMs;
		reprise.activite.avancement = d.avancement;
		reprise.activite.jusqueMs = jusqueMs;
		// l'échéance écrite n'a jamais plus d'une seconde de retard (comme l'avancement)
		if (nouvellePasse || maintenant - reprise.ecritMs >= ECART_AVANCEMENT_MS || jusqueMs - ecrite >= ECART_AVANCEMENT_MS) ecrire(reprise);
		return reprise;
	}
	surveillerSortie();
	const ici = dossierActivite(dossierServeurs);
	const fiche: Fiche = {
		fichier: join(ici, `${process.pid}-${++compteur}.json`),
		activite: { ...d, depuisMs: maintenant, jusqueMs },
		ecritMs: 0,
		file: mkdir(ici, { recursive: true, mode: 0o700 }).then(
			() => {},
			() => {},
		),
		retrait: null,
		cle,
	};
	vivantes.add(fiche);
	ecrire(fiche);
	return fiche;
}

function retirer(fiche: Fiche): void {
	vivantes.delete(fiche);
	enchainer(fiche, () => rm(fiche.fichier, { force: true }));
}

/** Sans attente : le retrait ne s'ajoute pas au temps de l'appel (filets : la sortie du processus, la purge des pids morts). */
function fermer(fiche: Fiche): void {
	if (fiche.cle === null) return retirer(fiche);
	// retrait différé : le lot suivant de la même passe reprend le fichier (une autre passe de même clé finie avant : retirée)
	const cle = fiche.cle;
	const ancienne = enAttente.get(cle);
	if (ancienne !== undefined) {
		clearTimeout(ancienne.retrait!);
		retirer(ancienne);
	}
	fiche.retrait = setTimeout(() => {
		if (enAttente.get(cle) === fiche) enAttente.delete(cle);
		retirer(fiche);
	}, REPRISE_MS);
	fiche.retrait.unref();
	enAttente.set(cle, fiche);
}

/**
 * Fait `action` sous un fichier d'activité de `dossierServeurs/activite/` (écrit d'un coup, droits 0600, dossier 0700),
 * retiré à la fin (sans l'attendre), qu'elle réussisse ou échoue. L'écriture ne retarde pas l'action, et un échec d'écriture
 * ne la touche pas. `jusqueMs` : la fin du budget de l'appel (bornée à `AGE_MAX_ACTIVITE_MS`).
 * Une vectorisation (avec avancement) garde son fichier entre deux lots (`REPRISE_MS`) et ne réécrit son avancement qu'au
 * plus une fois par seconde.
 */
export async function avecActivite<T>(dossierServeurs: string, description: DescriptionActivite, action: () => Promise<T>): Promise<T> {
	const fiche = ouvrir(dossierServeurs, description);
	try {
		return await action();
	} finally {
		fermer(fiche);
	}
}

const MOTIF_PID = /^(\d+)-/u;
const MOTIF_FICHIER = /^\d+-\d+\.json$/u;
const entierPositif = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0;

function lireActivite(brut: unknown): Activite | null {
	if (typeof brut !== 'object' || brut === null) return null;
	const { operation, dossier, session, depuisMs, jusqueMs, avancement } = brut as Record<string, unknown>;
	if (!estOperationModele(operation) || typeof dossier !== 'string' || (session !== null && typeof session !== 'string')) return null;
	if (typeof depuisMs !== 'number' || !Number.isFinite(depuisMs) || typeof jusqueMs !== 'number' || !Number.isFinite(jusqueMs)) return null;
	if (avancement === null) return { operation, dossier, session, depuisMs, jusqueMs, avancement: null };
	if (typeof avancement !== 'object') return null;
	const { faits, total } = avancement as Record<string, unknown>;
	if (!entierPositif(faits) || (total !== null && !entierPositif(total))) return null;
	return { operation, dossier, session, depuisMs, jusqueMs, avancement: { faits, total } };
}

/**
 * Appels en cours sur la machine, du plus ancien au plus récent. Le fichier d'un processus mort est retiré (temporaire
 * compris), comme celui dont l'échéance est dépassée de plus de `MARGE_ECHEANCE_MS` ; un fichier illisible, ou plus vieux
 * que `AGE_MAX_ACTIVITE_MS` d'un processus vivant, est ignoré sans être retiré.
 */
export async function lireActivites(dossierServeurs: string): Promise<Activite[]> {
	const ici = dossierActivite(dossierServeurs);
	let noms: string[];
	try {
		noms = await readdir(ici);
	} catch {
		return [];
	}
	const activites: Activite[] = [];
	for (const nom of noms) {
		const pid = MOTIF_PID.exec(nom)?.[1];
		if (pid === undefined) continue;
		const fichier = join(ici, nom);
		if (!pidVivant(Number(pid))) {
			await rm(fichier, { force: true }).catch(() => {});
			continue;
		}
		if (!MOTIF_FICHIER.test(nom)) continue;
		try {
			const [texte, infos] = await Promise.all([readFile(fichier, 'utf8'), stat(fichier)]);
			if (Date.now() - infos.mtimeMs > AGE_MAX_ACTIVITE_MS) continue;
			const activite = lireActivite(JSON.parse(texte));
			if (activite === null) continue;
			if (Date.now() - activite.jusqueMs > MARGE_ECHEANCE_MS) {
				await rm(fichier, { force: true }).catch(() => {});
				continue;
			}
			activites.push(activite);
		} catch {
			/* illisible ou retiré entre-temps */
		}
	}
	return activites.sort((a, b) => a.depuisMs - b.depuisMs);
}
