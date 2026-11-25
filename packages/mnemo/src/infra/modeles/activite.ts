import { rmSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { estOperationModele } from '@mnemo/commun';
import type { AvancementModele, OperationModele } from '@mnemo/commun';
import { ecrireJson, pidVivant } from './serveurs.ts';

/** Sous-dossier de `serveurs/` qui tient un fichier par appel en cours (`<pid>-<n>.json`). */
export const SOUS_DOSSIER_ACTIVITE = 'activite';
/** Un fichier plus vieux (sans réécriture), processus vivant, est ignoré : un pid réutilisé, ou un appel bloqué. */
export const AGE_MAX_ACTIVITE_MS = 10 * 60_000;
/** L'avancement d'une vectorisation est réécrit au plus une fois par cet écart. */
export const ECART_AVANCEMENT_MS = 1000;
/**
 * Une vectorisation enchaîne ses lots (un appel chacun) : son fichier survit ce temps à la fin d'un appel, et l'appel
 * suivant de la même passe le reprend, au lieu de le retirer et de le recréer à chaque lot.
 */
export const REPRISE_MS = 1000;

/** Un appel en cours : ce qu'il fait, pour quel dossier Mnemo (sa racine) et quelle session, depuis quand. Jamais de texte. */
export type Activite = { operation: OperationModele; dossier: string; session: string | null; depuisMs: number; avancement: AvancementModele | null };
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
		for (const f of vivantes) rmSync(f.fichier, { force: true });
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
	const cle = d.avancement === null ? null : JSON.stringify([dossierServeurs, d.operation, d.dossier, d.session]);
	const reprise = cle === null ? undefined : enAttente.get(cle);
	if (reprise !== undefined) {
		enAttente.delete(cle!);
		clearTimeout(reprise.retrait!);
		reprise.retrait = null;
		reprise.activite.avancement = d.avancement;
		if (Date.now() - reprise.ecritMs >= ECART_AVANCEMENT_MS) ecrire(reprise);
		return reprise;
	}
	surveillerSortie();
	const ici = dossierActivite(dossierServeurs);
	const fiche: Fiche = {
		fichier: join(ici, `${process.pid}-${++compteur}.json`),
		activite: { ...d, depuisMs: Date.now() },
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

function retirer(fiche: Fiche): Promise<void> {
	vivantes.delete(fiche);
	enchainer(fiche, () => rm(fiche.fichier, { force: true }));
	return fiche.file;
}

function fermer(fiche: Fiche): Promise<void> {
	if (fiche.cle === null) return retirer(fiche);
	// retrait différé : le lot suivant de la même passe reprend le fichier (une autre passe de même clé finie avant : retirée)
	const cle = fiche.cle;
	const ancienne = enAttente.get(cle);
	if (ancienne !== undefined) {
		clearTimeout(ancienne.retrait!);
		void retirer(ancienne);
	}
	fiche.retrait = setTimeout(() => {
		if (enAttente.get(cle) === fiche) enAttente.delete(cle);
		void retirer(fiche);
	}, REPRISE_MS);
	fiche.retrait.unref();
	enAttente.set(cle, fiche);
	return Promise.resolve();
}

/**
 * Fait `action` sous un fichier d'activité de `dossierServeurs/activite/` (écrit d'un coup, droits 0600, dossier 0700),
 * retiré à la fin, qu'elle réussisse ou échoue. L'écriture ne retarde pas l'action, et un échec d'écriture ne la touche pas.
 * Une vectorisation (avec avancement) garde son fichier entre deux lots (`REPRISE_MS`) et ne réécrit son avancement qu'au
 * plus une fois par seconde.
 */
export async function avecActivite<T>(dossierServeurs: string, description: DescriptionActivite, action: () => Promise<T>): Promise<T> {
	const fiche = ouvrir(dossierServeurs, description);
	try {
		return await action();
	} finally {
		await fermer(fiche);
	}
}

const MOTIF_PID = /^(\d+)-/u;
const MOTIF_FICHIER = /^\d+-\d+\.json$/u;
const entierPositif = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0;

function lireActivite(brut: unknown): Activite | null {
	if (typeof brut !== 'object' || brut === null) return null;
	const { operation, dossier, session, depuisMs, avancement } = brut as Record<string, unknown>;
	if (!estOperationModele(operation) || typeof dossier !== 'string' || (session !== null && typeof session !== 'string')) return null;
	if (typeof depuisMs !== 'number' || !Number.isFinite(depuisMs)) return null;
	if (avancement === null) return { operation, dossier, session, depuisMs, avancement: null };
	if (typeof avancement !== 'object') return null;
	const { faits, total } = avancement as Record<string, unknown>;
	if (!entierPositif(faits) || !entierPositif(total)) return null;
	return { operation, dossier, session, depuisMs, avancement: { faits, total } };
}

/**
 * Appels en cours sur la machine, du plus ancien au plus récent. Le fichier d'un processus mort est retiré (temporaire
 * compris) ; un fichier illisible, ou plus vieux que `AGE_MAX_ACTIVITE_MS` d'un processus vivant, est ignoré sans être retiré.
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
			if (activite !== null) activites.push(activite);
		} catch {
			/* illisible ou retiré entre-temps */
		}
	}
	return activites.sort((a, b) => a.depuisMs - b.depuisMs);
}
