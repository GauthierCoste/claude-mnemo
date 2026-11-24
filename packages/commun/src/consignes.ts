import { CONSIGNE_CHEMINS_MAX } from './limites.ts';

/**
 * Ce que l'archiviste fait d'un document à traiter : un tri, pas une recopie. Un seul texte, pour l'import de la mémoire de
 * Claude comme pour « Traiter » et « Tout traiter » ; sur une ligne (tapé dans le terminal, jamais de retour à la ligne).
 */
const CRIBLE =
	"Passe-la au crible : garde ce qui restera vrai et utile aux prochaines sessions (règles, décisions, préférences, pièges, conventions) ; " +
	"intègre les bonnes idées dans les fiches existantes plutôt que d'en créer ; ignore ce qui est périmé (état d'un plan à une date passée, " +
	"étapes d'implémentation d'un travail terminé). Le but : une mémoire qui rend les sessions Claude Code plus efficaces. " +
	'Quand tu as fini, marque-la traitée : `proposer` genre modification avec `traitee: true`.';

/**
 * La consigne, une seule ligne, qui confie à l'archiviste les fiches à traiter : rejouable (elle désigne le marqueur, pas
 * une liste), elle peut partir plusieurs fois sans rien perdre. Avec `chemins` (fiches choisies dans l'interface,
 * `CONSIGNE_CHEMINS_MAX` au plus, déjà validées : sans retour à la ligne), elle nomme ces fiches.
 */
export function consigneATraiter(nombre: number, chemins?: readonly string[]): string {
	if (chemins !== undefined && chemins.length > 0 && chemins.length <= CONSIGNE_CHEMINS_MAX) {
		const liste = chemins.map((c) => `« ${c} »`).join(', ');
		const tete = chemins.length > 1 ? `Traite les ${chemins.length} fiches sources « à traiter » (a_traiter) ${liste} : pour chacune, lis-la` : `Traite la fiche source « à traiter » (a_traiter) ${liste} : lis-la`;
		return `${tete} (une instruction de projet : son document). ${CRIBLE}`;
	}
	const fiches = nombre > 1 ? `${nombre} fiches sources marquées` : 'fiche source marquée';
	return (
		`Traite ${nombre > 1 ? 'les' : 'la'} ${fiches} « à traiter » (a_traiter) : \`lister\` avec \`aTraiter: true\` les rend toutes, ` +
		`où qu'elles soient rangées ; pour chacune, lis-la (une instruction de projet : son document). ${CRIBLE}`
	);
}
