// Un fichier du dossier référencé par une fiche `source` marquée « à traiter » (import de la mémoire de Claude, dépôt).
import { cleDeCasse } from '../domaine/chemin.ts';
import type { Fiche } from '../domaine/fiche.ts';
import { CLE_A_TRAITER } from '../domaine/source.ts';
import { aujourdhui, ficheVide } from './commun.ts';
import type { Dependances } from './ports.ts';
import { estFichierEntier, sourcesDuCoffre } from './sources.ts';

export type SourceDeDocument = { chemin: string; fiche: Fiche };

/** Fiches `source` qui référencent un fichier (ni fil ni pièce jointe), par chemin de fichier à la casse près. */
export async function sourcesDeDocuments(dep: Dependances): Promise<Map<string, SourceDeDocument>> {
	const sortie = new Map<string, SourceDeDocument>();
	for (const { chemin, fiche, d } of await sourcesDuCoffre(dep)) {
		if (!estFichierEntier(d)) continue;
		const cle = cleDeCasse(d.document);
		if (!sortie.has(cle)) sortie.set(cle, { chemin, fiche });
	}
	return sortie;
}

/** Fiche nouvelle pour un document pas encore référencé : son chemin, son titre, ses champs propres ; un texte : refus. */
export type NouvelleReference = { chemin: string; titre: string; donnees: Record<string, unknown> } | string;

/**
 * `inchangee` : même empreinte, mêmes champs de rattachement, rien à écrire ; `rattachee` : seul le rattachement change ;
 * `modifiee` : le fichier a changé, la fiche est marquée « à traiter » ; `nouvelle` : fiche créée, marquée.
 */
export type Reference =
	| { statut: 'inchangee'; chemin: string }
	| { statut: 'rattachee' | 'modifiee' | 'nouvelle'; chemin: string; fiche: Fiche }
	| { statut: 'refusee'; motif: string };

/**
 * La fiche qui référence déjà `document` (parmi `documents`) est remise à jour, jamais doublée ; sinon `nouvelle` la crée.
 * Rien n'est écrit ici : l'appelant écrit et commite la fiche rendue.
 */
export async function referencerDocument(
	dep: Dependances,
	documents: ReadonlyMap<string, SourceDeDocument>,
	d: { document: string; empreinte: string; rattachement?: Record<string, unknown> },
	nouvelle: () => Promise<NouvelleReference>,
): Promise<Reference> {
	const rattachement = d.rattachement ?? {};
	const existante = documents.get(cleDeCasse(d.document));
	if (existante !== undefined) {
		const { fiche, chemin } = existante;
		const memeEmpreinte = fiche.donnees['empreinte'] === d.empreinte;
		const memeRattachement = Object.entries(rattachement).every(([cle, valeur]) => fiche.donnees[cle] === valeur);
		if (memeEmpreinte && memeRattachement) return { statut: 'inchangee', chemin };
		fiche.donnees['empreinte'] = d.empreinte;
		Object.assign(fiche.donnees, rattachement);
		fiche.updated = aujourdhui(dep);
		if (memeEmpreinte) return { statut: 'rattachee', chemin, fiche };
		fiche.donnees[CLE_A_TRAITER] = true;
		return { statut: 'modifiee', chemin, fiche };
	}
	const n = await nouvelle();
	if (typeof n === 'string') return { statut: 'refusee', motif: n };
	return { statut: 'nouvelle', chemin: n.chemin, fiche: ficheVide(dep, n.chemin, 'source', n.titre, { chemin: d.document, empreinte: d.empreinte, ...n.donnees, ...rattachement, [CLE_A_TRAITER]: true }) };
}
