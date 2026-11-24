/** Les avertissements (`AvecAvertissements`) qu'une écriture faite rend, d'où qu'elle vienne. */
import { ligneAvertissement, type AvecAvertissements } from '@mnemo/commun';

/** Les avertissements d'une réponse d'écriture (`avertissementsDe`), une ligne chacun ; aucun : aucune ligne. */
export function lignesAvertissements(a: AvecAvertissements): string[] {
	return (a.avertissements ?? []).map(ligneAvertissement);
}
