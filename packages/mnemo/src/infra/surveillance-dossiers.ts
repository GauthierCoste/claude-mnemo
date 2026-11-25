import { watch } from 'node:fs';
import type { FSWatcher } from 'node:fs';
import { stat } from 'node:fs/promises';
import { basename } from 'node:path';

/** Nouvel essai de surveillance d'un dossier absent, ou dont la surveillance a cessé (dossier retiré, recréé, erreur). */
export const REESSAI_SURVEILLANCE_MS = 1000;

/** `filtre` : le changement d'un fichier de ce nom (null : nom inconnu, selon la plateforme) appelle-t-il le rappel ? */
export type DossierSurveille = { chemin: string; filtre?: (nom: string | null) => boolean };

type Surveillance = { observateur: FSWatcher; identite: string };

/** Identité d'un dossier (périphérique et inode) : un dossier retiré puis recréé en change ; null s'il manque. */
async function identiteDe(chemin: string): Promise<string | null> {
	try {
		const i = await stat(chemin);
		return i.isDirectory() ? `${i.dev}:${i.ino}` : null;
	} catch {
		return null;
	}
}

/**
 * Surveille ces dossiers (`fs.watch`, non récursif, un par dossier : portable) et appelle `rappel` quand un fichier y change.
 * Un dossier n'est jamais créé : absent, il est surveillé dès qu'il apparaît. Toutes les `reessaiMs`, les dossiers non
 * surveillés sont réarmés, et les surveillés revérifiés : un dossier retiré ou recréé (autre inode) perd son observateur, qui
 * est réarmé au tour suivant ; un événement sur le dossier lui-même (nom null ou le sien) déclenche cette vérification
 * aussitôt. `rappel` est appelé à chaque armement (des changements ont pu échapper). Un rappel peut ne rien signaler de neuf,
 * et des changements peuvent échapper : à compléter par un sondage. Rend la fonction qui arrête tout.
 */
export function surveillerDossiers(dossiers: DossierSurveille[], rappel: () => void, options: { reessaiMs?: number } = {}): () => void {
	const surveillances = new Map<string, Surveillance>();
	const enCours = new Set<string>();
	let arrete = false;

	const oublier = (chemin: string, s: Surveillance): void => {
		if (surveillances.get(chemin) !== s) return;
		surveillances.delete(chemin);
		try {
			s.observateur.close();
		} catch {
			/* déjà fermé */
		}
	};

	/** Le dossier surveillé est-il encore celui de l'armement ? Sinon, l'observateur est oublié (réarmé au tour suivant). */
	const verifier = async (chemin: string, s: Surveillance): Promise<void> => {
		if ((await identiteDe(chemin)) === s.identite || arrete || surveillances.get(chemin) !== s) return;
		oublier(chemin, s);
		rappel();
	};

	const armer = async (d: DossierSurveille): Promise<void> => {
		if (arrete || surveillances.has(d.chemin) || enCours.has(d.chemin)) return;
		enCours.add(d.chemin);
		try {
			const identite = await identiteDe(d.chemin);
			if (identite === null || arrete) return;
			const nomDuDossier = basename(d.chemin);
			const s: Surveillance = {
				identite,
				observateur: watch(d.chemin, { persistent: false }, (_type, nom) => {
					const n = typeof nom === 'string' ? nom : null;
					// le dossier lui-même a peut-être été retiré ou remplacé : vérifié avant tout
					if (n === null || n === nomDuDossier) void verifier(d.chemin, s);
					if (d.filtre === undefined || d.filtre(n)) rappel();
				}),
			};
			s.observateur.on('error', () => {
				oublier(d.chemin, s);
				rappel();
			});
			surveillances.set(d.chemin, s);
			rappel();
		} catch {
			/* dossier impossible à surveiller : nouvel essai plus tard */
		} finally {
			enCours.delete(d.chemin);
		}
	};

	const tour = (): void => {
		if (arrete) return;
		for (const d of dossiers) {
			const s = surveillances.get(d.chemin);
			if (s === undefined) void armer(d);
			else void verifier(d.chemin, s);
		}
	};
	tour();
	const reessai = setInterval(tour, options.reessaiMs ?? REESSAI_SURVEILLANCE_MS);
	reessai.unref();

	return () => {
		arrete = true;
		clearInterval(reessai);
		for (const [chemin, s] of [...surveillances]) oublier(chemin, s);
	};
}
