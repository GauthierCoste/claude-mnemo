import { randomBytes } from 'node:crypto';
import { linkSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { COMMANDES_CLI } from '../domaine/commandes.ts';
import { demarrageMachineMs, identiteProcessus, imageProcessusWindows, memeDemarrage, SONDE_MS } from './processus.ts';
import { processusVivant } from './service-local.ts';
import { DOSSIER_LOCAL } from '../domaine/dossier-memoire.ts';

/**
 * Verrou pris : `tenu()` relit le fichier (toujours le nôtre ?), `liberer()` le retire s'il l'est encore. Refusé : tenu par un
 * autre service vivant (`pid`, null s'il est illisible).
 */
export type VerrouService = { pris: true; tenu(): boolean; liberer(): void } | { pris: false; pid: number | null };

type Proprietaire = { pid: number; demarrageMachineMs: number | null; lanceMs: number | null };

/** Écart toléré entre `lanceMs` et le démarrage du pid lu par `ps` (à la seconde, tronqué). */
const TOLERANCE_LANCEMENT_MS = 2000;
/** Attente totale d'une reprise tenue par un autre (même budget que l'attente d'un autre service). */
const ATTENTE_MAX_MS = 10_000;

/** Commandes de `mnemo` qui ne sont pas le service (`mnemo` seul ou `mnemo <dossier>`). */
const COMMANDES = new Set(COMMANDES_CLI);

const fichierVerrou = (racine: string) => join(racine, DOSSIER_LOCAL, 'service.verrou');
const attendre = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Une ligne de commande est-elle celle d'un service Mnemo ? Un exécutable `mnemo` (ou `…/mnemo/…/cli/main.ts`) suivi de rien
 * ou d'un dossier, jamais d'une autre commande (`hook`, `mcp`, …).
 */
export function estLigneDuService(commande: string): boolean {
	const mots = commande.trim().split(/\s+/u);
	const i = mots.findIndex((m) => /(?:^|[/\\])mnemo$/iu.test(m) || /(?:^|[/\\])mnemo[/\\].*cli[/\\]main\.ts$/iu.test(m));
	if (i < 0) return false;
	const suivant = mots[i + 1];
	return suivant === undefined || (!COMMANDES.has(suivant) && !suivant.startsWith('-'));
}

/** Un fichier du verrou qu'on ne peut pas lire (dossier, droits, propriétaire root) : jamais repris, refus explicite. */
export class ErreurVerrouIllisible extends Error {
	constructor(chemin: string, code: string) {
		super(`Verrou du service illisible : ${chemin} (${code}). Vérifier ses droits (créé par un autre utilisateur, par sudo ?) ou le retirer.`);
	}
}

/** Contenu du fichier, null s'il n'existe pas (ENOENT seulement) ; toute autre erreur de lecture : `ErreurVerrouIllisible`. */
function lireBrut(chemin: string): string | null {
	try {
		return readFileSync(chemin, 'utf8');
	} catch (erreur) {
		const code = (erreur as NodeJS.ErrnoException).code ?? 'erreur';
		if (code === 'ENOENT') return null;
		throw new ErreurVerrouIllisible(chemin, code);
	}
}

/** `{ pid, demarrageMachineMs, lanceMs }`, ou l'ancien format (le pid seul) ; null si illisible. */
function lireProprietaire(brut: string): Proprietaire | null {
	const texte = brut.trim();
	if (/^\d+$/u.test(texte)) return { pid: Number(texte), demarrageMachineMs: null, lanceMs: null };
	try {
		const o = JSON.parse(texte) as Record<string, unknown>;
		if (!Number.isInteger(o.pid) || (o.pid as number) <= 0) return null;
		const nombre = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
		return { pid: o.pid as number, demarrageMachineMs: nombre(o.demarrageMachineMs), lanceMs: nombre(o.lanceMs) };
	} catch {
		return null;
	}
}

/** Lancement de ce processus (ms depuis l'époque), comparable au `lstart` de `ps`. */
const monLancementMs = (): number => Math.round(Date.now() - process.uptime() * 1000);

/**
 * Le propriétaire (du verrou ou d'une reprise) est-il un service vivant ? Mort si : le processus n'existe plus ; la machine a
 * redémarré depuis ; le pid vit mais a démarré à un autre instant que `lanceMs` (pid recyclé) ; ou sa ligne de commande n'est
 * pas celle d'un service Mnemo. `ps` muet : rien n'est conclu, il est tenu pour vivant. Windows : vivant si c'est un Node.
 */
async function proprietaireVivant(p: Proprietaire): Promise<boolean> {
	if (p.pid === process.pid) return p.lanceMs === null || Math.abs(p.lanceMs - monLancementMs()) <= TOLERANCE_LANCEMENT_MS;
	if (!processusVivant(p.pid)) return false;
	if (p.demarrageMachineMs !== null && !memeDemarrage(p.demarrageMachineMs, demarrageMachineMs())) return false;
	if (process.platform === 'win32') {
		// Windows réattribue vite les pids : vivant seulement si c'est encore un Node (tasklist muet : tenu pour vivant)
		const image = await imageProcessusWindows(p.pid);
		return image === null || /^node(?:\.exe)?$/iu.test(image);
	}
	const identite = await identiteProcessus(p.pid);
	if (identite === null) return processusVivant(p.pid);
	if (p.lanceMs !== null && Math.abs(identite.debutMs - p.lanceMs) > TOLERANCE_LANCEMENT_MS) return false;
	return estLigneDuService(identite.commande);
}

function retirer(chemin: string): void {
	try {
		unlinkSync(chemin);
	} catch {
		// déjà retiré
	}
}

/** Crée `chemin` avec `contenu`, complet dès qu'il existe (temporaire au nom unique lié en exclusif) ; false s'il existe. */
function creerExclusif(chemin: string, contenu: string): boolean {
	return avecTemporaire(chemin, contenu, (temporaire) => {
		try {
			linkSync(temporaire, chemin);
			return true;
		} catch (erreur) {
			const code = (erreur as NodeJS.ErrnoException).code;
			if (code === 'EEXIST') return false;
			// Système de fichiers sans lien physique (FAT, exFAT, certains partages) : création exclusive directe, moins sûre
			// (un lecteur peut voir le fichier vide un court instant), mais le service démarre.
			if (code === 'EPERM' || code === 'ENOTSUP' || code === 'EXDEV' || code === 'ENOSYS') return creerExclusifSansLien(chemin, contenu);
			throw erreur;
		}
	});
}

function creerExclusifSansLien(chemin: string, contenu: string): boolean {
	try {
		writeFileSync(chemin, contenu, { mode: 0o600, flag: 'wx' });
		return true;
	} catch (erreur) {
		if ((erreur as NodeJS.ErrnoException).code === 'EEXIST') return false;
		throw erreur;
	}
}

/** Fichier temporaire au nom unique, dans `.mnemo/`, toujours retiré par `travail` ou à défaut ensuite. */
function avecTemporaire<T>(chemin: string, contenu: string, travail: (temporaire: string) => T): T {
	const temporaire = `${chemin}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
	try {
		writeFileSync(temporaire, contenu, { mode: 0o600, flag: 'wx' });
		return travail(temporaire);
	} finally {
		retirer(temporaire);
	}
}

/**
 * Casse une `.reprise` laissée par un mort, sous un second verrou `.reprise.casse` (créé de même) : relue sous lui, elle n'est
 * retirée que si elle est encore celle constatée morte (jamais écartée puis remise). Une `.casse` d'un mort (même identité,
 * jamais l'âge) est retirée si elle n'a pas changé depuis le constat. Rend la main sans rien faire si la cassure est occupée.
 */
async function casserReprise(cheminReprise: string, constatee: string, contenu: string): Promise<void> {
	const cheminCasse = `${cheminReprise}.casse`;
	if (!creerExclusif(cheminCasse, contenu)) {
		const autre = lireBrut(cheminCasse);
		if (autre === null) return;
		const p = lireProprietaire(autre);
		if (p === null || !(await proprietaireVivant(p))) {
			if (lireBrut(cheminCasse) === autre) retirer(cheminCasse);
		}
		return;
	}
	try {
		if (lireBrut(cheminReprise) === constatee) retirer(cheminReprise);
	} finally {
		if (lireBrut(cheminCasse) === contenu) retirer(cheminCasse);
	}
}

/**
 * Un seul service par dossier Mnemo : `.mnemo/service.verrou` (`{ pid, demarrageMachineMs, lanceMs, jeton }`), créé complet et
 * en exclusif. Tenu par un service vivant (voir `proprietaireVivant`), celui-ci compris : refusé. Propriétaire mort : reprise
 * sérialisée par `.mnemo/service.verrou.reprise` (créé de même) ; sous elle, le verrou est relu et remplacé (renommage) seulement
 * s'il est encore celui constaté mort. Une reprise tenue par un vivant est attendue ; une reprise d'un mort (même identité que
 * le verrou, jamais l'âge) est cassée (`casserReprise`). Chaque tour vérifie l'échéance (`attenteMaxMs`, 10 s) : au-delà,
 * refus. Un fichier du verrou illisible (dossier, droits) : `ErreurVerrouIllisible`, aussitôt.
 */
export async function prendreVerrouService(racine: string, options: { attenteMaxMs?: number } = {}): Promise<VerrouService> {
	const chemin = fichierVerrou(racine);
	const cheminReprise = `${chemin}.reprise`;
	const fin = Date.now() + (options.attenteMaxMs ?? ATTENTE_MAX_MS);
	const moi = { pid: process.pid, demarrageMachineMs: demarrageMachineMs(), lanceMs: monLancementMs() };
	const contenu = `${JSON.stringify({ ...moi, jeton: randomBytes(8).toString('hex') })}\n`;
	const verrou: VerrouService = {
		pris: true,
		// un échec de lecture passager (EMFILE, EAGAIN…) n'est pas une perte : seuls un autre contenu ou l'absence le sont
		tenu: () => {
			try {
				return lireBrut(chemin) === contenu;
			} catch {
				return true;
			}
		},
		liberer: () => {
			try {
				if (lireBrut(chemin) === contenu) retirer(chemin);
			} catch {
				// illisible : laissé tel quel
			}
		},
	};
	const refus = (): VerrouService => ({ pris: false, pid: lireProprietaire(lireBrut(chemin) ?? '')?.pid ?? null });

	while (Date.now() < fin) {
		if (creerExclusif(chemin, contenu)) return verrou;
		const constate = lireBrut(chemin);
		if (constate === null) continue; // retiré entre-temps (ENOENT)
		const p = lireProprietaire(constate);
		// contenu illisible : jamais un verrou en cours d'écriture (création exclusive d'un fichier complet), repris comme un mort
		if (p !== null && (await proprietaireVivant(p))) return { pris: false, pid: p.pid };

		// propriétaire mort : reprise, sous `.reprise`
		if (!creerExclusif(cheminReprise, contenu)) {
			const autre = lireBrut(cheminReprise);
			if (autre === null) continue;
			const q = lireProprietaire(autre);
			if (q === null || !(await proprietaireVivant(q))) await casserReprise(cheminReprise, autre, contenu);
			await attendre(SONDE_MS);
			continue;
		}
		try {
			if (lireBrut(chemin) !== constate) continue; // repris ou retiré entre-temps : nouvel examen
			avecTemporaire(chemin, contenu, (remplacant) => renameSync(remplacant, chemin));
			return verrou;
		} finally {
			if (lireBrut(cheminReprise) === contenu) retirer(cheminReprise);
		}
	}
	return refus();
}
