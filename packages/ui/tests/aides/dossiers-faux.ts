import type { DossierVue, NiveauDossiersVue } from '@mnemo/contrat';
import { ErreurApi } from '../../src/client/api.ts';

type Dossier = string | (Partial<DossierVue> & { chemin: string });
const RACINE: DossierVue = { chemin: '', nom: '', git: false, marque: false, sessions: 0, erreur: null };

/** Réponse de `dossiers?chemin=` tirée d'une liste de dossiers (la racine : `racine`) : le dossier demandé et ses sous-dossiers directs ; un dossier inconnu → 404. */
export function dossiersFaux(dossiers: readonly Dossier[], racine: Partial<DossierVue> = {}): (params: Record<string, string> | undefined) => NiveauDossiersVue {
	const vues = dossiers.map((d): DossierVue => {
		const o = typeof d === 'string' ? { chemin: d } : d;
		return { nom: o.chemin.slice(o.chemin.lastIndexOf('/') + 1), git: false, marque: false, sessions: 0, erreur: null, ...o };
	});
	const parent = (chemin: string) => chemin.slice(0, Math.max(0, chemin.lastIndexOf('/')));
	return (params) => {
		const chemin = params?.['chemin'] ?? '';
		if (chemin !== '' && !vues.some((v) => v.chemin === chemin)) throw new ErreurApi(`Dossier « ${chemin} » illisible : introuvable.`, 404);
		const dossier = chemin === '' ? { ...RACINE, ...racine } : vues.find((v) => v.chemin === chemin)!;
		return { dossier, sousDossiers: vues.filter((v) => parent(v.chemin) === chemin) };
	};
}
