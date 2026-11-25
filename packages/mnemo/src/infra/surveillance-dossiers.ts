import { watch } from 'node:fs';
import type { FSWatcher } from 'node:fs';
import { mkdir } from 'node:fs/promises';

/** Nouvel essai de surveillance d'un dossier absent, ou dont la surveillance a cessé (dossier retiré, erreur). */
export const REESSAI_SURVEILLANCE_MS = 1000;

/** `filtre` : le changement d'un fichier de ce nom (null : nom inconnu, selon la plateforme) appelle-t-il le rappel ? */
export type DossierSurveille = { chemin: string; filtre?: (nom: string | null) => boolean };

/**
 * Surveille ces dossiers (`fs.watch`, non récursif, un par dossier : portable) et appelle `rappel` quand un fichier y change.
 * Chaque dossier est créé s'il manque (droits 0700) ; s'il ne peut l'être, ou si sa surveillance cesse (dossier retiré,
 * erreur), elle est reprise toutes les `reessaiMs`, et `rappel` est appelé à la reprise (des changements ont pu échapper).
 * Un rappel peut ne rien signaler de neuf, et des changements peuvent échapper : à compléter par un sondage. Rend la
 * fonction qui arrête tout.
 */
export function surveillerDossiers(dossiers: DossierSurveille[], rappel: () => void, options: { reessaiMs?: number } = {}): () => void {
	const surveillances = new Map<string, FSWatcher>();
	const enCours = new Set<string>();
	let arrete = false;
	let premierTour = true;

	const oublier = (chemin: string, w: FSWatcher): void => {
		if (surveillances.get(chemin) !== w) return;
		surveillances.delete(chemin);
		try {
			w.close();
		} catch {
			/* déjà fermée */
		}
	};

	const armer = async (d: DossierSurveille, apresPerte: boolean): Promise<void> => {
		if (arrete || surveillances.has(d.chemin) || enCours.has(d.chemin)) return;
		enCours.add(d.chemin);
		try {
			await mkdir(d.chemin, { recursive: true, mode: 0o700 });
			if (arrete) return;
			const w = watch(d.chemin, { persistent: false }, (type, nom) => {
				const n = typeof nom === 'string' ? nom : null;
				// le dossier lui-même renommé ou retiré : surveillance à reprendre
				if (type === 'rename' && n === null) oublier(d.chemin, w);
				if (d.filtre === undefined || d.filtre(n)) rappel();
			});
			w.on('error', () => {
				oublier(d.chemin, w);
				rappel();
			});
			surveillances.set(d.chemin, w);
			if (apresPerte) rappel();
		} catch {
			/* dossier impossible à créer ou à surveiller : nouvel essai plus tard */
		} finally {
			enCours.delete(d.chemin);
		}
	};

	const armerTout = (): void => {
		const apresPerte = !premierTour;
		premierTour = false;
		for (const d of dossiers) void armer(d, apresPerte);
	};
	armerTout();
	const reessai = setInterval(armerTout, options.reessaiMs ?? REESSAI_SURVEILLANCE_MS);
	reessai.unref();

	return () => {
		arrete = true;
		clearInterval(reessai);
		for (const [chemin, w] of [...surveillances]) oublier(chemin, w);
	};
}
