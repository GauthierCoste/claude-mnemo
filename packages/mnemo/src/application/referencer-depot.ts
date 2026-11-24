// Un fichier déposé par l'interface : sa fiche `source` marquée « à traiter » le garde en vue, même sans archiviste.
import { avecAvertissements, EMPLACEMENTS_PAR_DEFAUT } from '@mnemo/commun';
import type { AvecAvertissements } from '@mnemo/commun';
import { nomDeFichier } from '../domaine/chemin.ts';
import { motifSiNonCherchable } from '../domaine/source.ts';
import { debutDe } from './contenu.ts';
import { dossiersManquants, ecrireEtCommiter, enFichier, sousVerrou } from './commun.ts';
import { nommeur, titreDuFichier, typeSourceParDefaut } from './extraire-source.ts';
import { messageDErreur } from '../domaine/texte.ts';
import type { Dependances } from './ports.ts';
import { referencerDocument, sourcesDeDocuments } from './referencer-document.ts';
import { reindexerApresEcriture } from './synchroniser.ts';

/**
 * Référence le fichier déposé `chemin` (relatif à la racine, `empreinte` de ses octets) comme le ferait `extraire_source`
 * (même nom de fiche), sans l'extraire ; un commit. Rend la fiche (une fiche qui le référence déjà est reprise) et ses avertissements :
 * pourquoi le fichier ne sera pas cherchable (`motifSiNonCherchable`), puis l'échec de l'index. Le fichier est gardé dans tous les cas.
 */
export async function referencerDepot(dep: Dependances, d: { chemin: string; empreinte: string }): Promise<{ fiche: string } & AvecAvertissements> {
	const avis = await avisDuFichier(dep, d.chemin);
	const ecrite = await sousVerrou(dep, async () => {
		const noms = await nommeur(dep);
		const reference = await referencerDocument(dep, await sourcesDeDocuments(dep), { document: d.chemin, empreinte: d.empreinte }, async () => {
			const titre = titreDuFichier(d.chemin);
			return { chemin: noms.reserver(EMPLACEMENTS_PAR_DEFAUT.sources, nomDeFichier(titre)), titre, donnees: { type_source: typeSourceParDefaut(d.chemin), origine: 'depot' } };
		});
		if (reference.statut === 'refusee') throw new Error(reference.motif);
		if (reference.statut === 'inchangee') return { fiche: reference.chemin, ecrit: false };
		const dossiers = await dossiersManquants(dep, reference.chemin);
		const aEcrire = [enFichier(dep, reference.fiche), ...(typeof dossiers === 'string' ? [] : dossiers.map((f) => enFichier(dep, f)))];
		await ecrireEtCommiter(dep, aEcrire, `mnemo: dépôt ${reference.chemin}`);
		return { fiche: reference.chemin, ecrit: true };
	});
	const index = ecrite.ecrit ? await reindexerApresEcriture(dep) : {};
	return { fiche: ecrite.fiche, ...avecAvertissements([...(avis === null ? [] : [avis]), ...(index.avertissements ?? [])]) };
}

/** `motifSiNonCherchable` sur les premiers octets du fichier ; illisible ou disparu : son motif (rien n'est tu). */
async function avisDuFichier(dep: Dependances, chemin: string): Promise<string | null> {
	try {
		const ouvert = await dep.documents.ouvrir(chemin);
		if (ouvert === null) return `« ${chemin} » introuvable après le dépôt : sa lisibilité n'a pas pu être vérifiée`;
		try {
			return motifSiNonCherchable(chemin, await debutDe(ouvert));
		} finally {
			await ouvert.fermer();
		}
	} catch (erreur) {
		return `« ${chemin} » illisible après le dépôt (${messageDErreur(erreur)}) : sa lisibilité n'a pas pu être vérifiée`;
	}
}
