// Outil `diagnostiquer` : lit la mémoire une fois (fiches, dossiers, règles, empreintes des sources de l'index) et les lots en attente, sans rien écrire.
import { diagnostiquer as calculer, RUBRIQUES } from '../domaine/diagnostic.ts';
import type { FicheLue, Rubrique } from '../domaine/diagnostic.ts';
import { analyserFiche } from '../domaine/fiche.ts';
import { LIMITE_PAR_RUBRIQUE, rapportDeDiagnostic } from '../domaine/rapport-diagnostic.ts';
import { aujourdhui } from './commun.ts';
import { lireLaMemoire } from './entretien/memoire-lue.ts';
import type { Dependances } from './ports.ts';
import { LIMITE_SORTIE } from './presenter.ts';
import { chargerRegles } from './regles-du-coffre.ts';

export type DemandeDiagnostic = { rubriques?: readonly Rubrique[]; limite?: number };

/** Marge laissée sous la borne de sortie des outils (le rapport n'est jamais coupé par elle). */
const MARGE = 200;

/** Tous les dossiers non cachés de la mémoire, racine exclue, en largeur ; les liens symboliques ne sont jamais suivis (`lister`). */
async function tousLesDossiers(dep: Dependances): Promise<string[]> {
	const dossiers: string[] = [];
	const aVoir = [''];
	while (aVoir.length > 0) {
		const dossier = aVoir.shift()!;
		for (const sous of (await dep.coffre.lister(dossier)).dossiers) {
			dossiers.push(sous);
			aVoir.push(sous);
		}
	}
	return dossiers.sort();
}

/** Empreinte du document de chaque fiche `source` d'après l'index tel qu'il est (aucune extraction) ; vide si l'index est en panne. */
async function empreintesDesSources(dep: Dependances): Promise<Map<string, string>> {
	try {
		return new Map((await dep.index.sources()).flatMap((s) => (s.empreinteFichier === null ? [] : [[s.fiche, s.empreinteFichier] as const])));
	} catch {
		return new Map();
	}
}

/** Rapport texte du diagnostic de la mémoire, rubriques filtrées (toutes par défaut) et bornées à `limite` entrées chacune. */
export async function diagnostiquer(dep: Dependances, demande: DemandeDiagnostic = {}): Promise<string> {
	const [memoire, dossiers, regles, empreintesSources, lots] = await Promise.all([lireLaMemoire(dep), tousLesDossiers(dep), chargerRegles(dep), empreintesDesSources(dep), dep.lots.enAttente()]);
	const fiches: FicheLue[] = [...memoire.textes].map(([chemin, texte]) => ({ chemin, texte, fiche: analyserFiche(chemin, texte).fiche }));
	const d = calculer(
		{ fiches, dossiers, designee: memoire.designee, empreintesSources, seuilRappel: regles.seuilRappel, categoriesAEnjeu: regles.categoriesAEnjeu, lots, aujourdhui: aujourdhui(dep) },
		demande.rubriques === undefined || demande.rubriques.length === 0 ? RUBRIQUES : demande.rubriques,
	);
	return rapportDeDiagnostic(d, regles.seuilRappel, demande.limite ?? LIMITE_PAR_RUBRIQUE, LIMITE_SORTIE - MARGE);
}
