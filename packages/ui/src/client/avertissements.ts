/** Les avertissements (`AvecAvertissements`) qu'une écriture faite rend, d'où qu'elle vienne. */
import type { AvecAvertissements } from '@mnemo/commun';
import { TEXTES, type Textes } from '../langue/textes.ts';

/** Les avertissements d'une réponse d'écriture (`avertissementsDe`), une ligne chacun ; aucun : aucune ligne. */
export function lignesAvertissements(a: AvecAvertissements, t: Textes['commun'] = TEXTES.fr.commun): string[] {
	return (a.avertissements ?? []).map((texte) => t.avertissement(texte));
}
