/**
 * Fiche visée par un lien `[[cible]]` écrit dans un texte que le service n'a pas résolu (ligne d'information d'un lot) :
 * chemin (avec ou sans `.md`), sinon titre, alias ou nom de fichier, à la casse près, s'il ne désigne qu'une fiche.
 */
import type { FicheGraphe } from '@mnemo/contrat';

const plie = (x: string) => x.trim().toLowerCase();

/** `ecrit` : ce qui est entre `[[` et `]]` (`cible`, `cible|alias`, `cible#^f-0001`). Null : aucune fiche, ou plusieurs. */
export function resoudreLien(ecrit: string, fiches: readonly Pick<FicheGraphe, 'chemin' | 'titre' | 'alias'>[]): string | null {
	const cible = plie(ecrit.split('|')[0]!.split('#')[0]!).replace(/\.md$/u, '');
	if (cible === '') return null;
	const parChemin = fiches.find((f) => plie(f.chemin).replace(/\.md$/u, '') === cible);
	if (parChemin) return parChemin.chemin;
	const nom = (chemin: string) => plie(chemin.split('/').pop() ?? '').replace(/\.md$/u, '');
	const trouvees = fiches.filter((f) => plie(f.titre) === cible || f.alias.some((a) => plie(a) === cible) || nom(f.chemin) === cible);
	return trouvees.length === 1 ? trouvees[0]!.chemin : null;
}
