// Au moment de servir (hooks, outils `chercher` et `lire`, `mnemo cherche --contexte`) : chaque passage retenu est élargi à
// sa section ou à ses voisins (« petit pour chercher, grand pour lire »). La recherche, elle, reste au grain du passage.
import { BUDGET_PAR_ENTREE, etendre } from '../domaine/etendue.ts';
import type { Trouve } from './chercher.ts';
import type { Dependances, SectionDePassage } from './ports.ts';

/** Passages trouvés d'une même section, dans l'ordre des résultats (le meilleur d'abord). */
export type GroupeDeSection = { section: SectionDePassage; trouves: Trouve[] };

/** Les passages parmi des résultats, groupés par section, dans l'ordre du meilleur de chaque groupe. Un passage qui n'est plus dans l'index n'y est pas. */
export async function groupesDeSection(dep: Dependances, trouves: readonly Trouve[]): Promise<GroupeDeSection[]> {
	const groupes = new Map<string, GroupeDeSection>();
	for (const t of trouves) {
		if (t.genre !== 'passage') continue;
		const section = await dep.index.passagesDeSection(t.id);
		if (section === null) continue;
		const groupe = groupes.get(section.cle);
		if (groupe === undefined) groupes.set(section.cle, { section, trouves: [t] });
		else if (!groupe.trouves.some((x) => x.id === t.id)) groupe.trouves.push(t);
	}
	return [...groupes.values()];
}

/**
 * Élargit les passages trouvés d'une section :
 * - deux ou plus : une seule entrée, la section (budget `budgetSection`), au rang du meilleur, si tous les passages
 *   trouvés y tiennent entiers ; sinon, chacun comme s'il était seul ;
 * - seul : le passage et ses voisins (budget `budgetSeul(trouvé)`), sans les autres passages trouvés de la section.
 * `exclus` : passages déjà servis par ailleurs, jamais repris en voisin. Rend `fusion` (une entrée) ou `separes` (une
 * entrée par passage trouvé, dans l'ordre de `groupe.trouves`). L'entrée garde l'id et le score du passage trouvé.
 */
export function elargirGroupe(
	groupe: GroupeDeSection,
	budgetSection: number,
	budgetSeul: (trouve: Trouve) => number,
	exclus: ReadonlySet<string> = new Set(),
): { fusion: Trouve } | { separes: Trouve[] } {
	const ids = groupe.trouves.map((t) => t.id);
	const sauf = (gardes: readonly string[]): Set<string> => new Set([...exclus].filter((id) => !gardes.includes(id)));
	if (ids.length >= 2) {
		const { texte, complets, ...etendue } = etendre(groupe.section.passages, ids, 'section', budgetSection, sauf(ids));
		if (ids.every((id) => complets.includes(id))) return { fusion: { ...groupe.trouves[0]!, texte, etendue: { ...etendue, regroupes: ids } } };
	}
	// un voisin n'est servi qu'une fois : par l'entrée du meilleur passage qui le touche
	const montres = new Set<string>();
	return {
		separes: groupe.trouves.map((t) => {
			const exclusDeT = new Set([...sauf([t.id]), ...ids.filter((id) => id !== t.id), ...montres]);
			const { texte, complets: _complets, ...etendue } = etendre(groupe.section.passages, [t.id], 'voisins', budgetSeul(t), exclusDeT);
			for (const id of etendue.ids) montres.add(id);
			return { ...t, texte, etendue: { ...etendue, regroupes: [t.id] } };
		}),
	};
}

/**
 * Élargit les passages (de fiche ou de document) parmi des résultats, dans leur ordre (`elargirGroupe`, même `budget`
 * pour une section et pour un passage seul, 6 000 caractères par défaut). Les autres résultats passent tels quels, comme
 * un passage qui n'est plus dans l'index (réindexé entre-temps).
 */
export async function etendrePassages(dep: Dependances, trouves: readonly Trouve[], budget = BUDGET_PAR_ENTREE): Promise<Trouve[]> {
	/** Entrée à rendre au rang d'un passage trouvé ; null : regroupé dans l'entrée d'un meilleur. */
	const remplace = new Map<string, Trouve | null>();
	for (const groupe of await groupesDeSection(dep, trouves)) {
		const r = elargirGroupe(groupe, budget, () => budget);
		if ('fusion' in r) groupe.trouves.forEach((t, i) => remplace.set(t.id, i === 0 ? r.fusion : null));
		else groupe.trouves.forEach((t, i) => remplace.set(t.id, r.separes[i]!));
	}
	const resultat: Trouve[] = [];
	const vus = new Set<string>();
	for (const t of trouves) {
		if (vus.has(t.id)) continue;
		vus.add(t.id);
		const entree = remplace.has(t.id) ? remplace.get(t.id)! : t;
		if (entree !== null) resultat.push(entree);
	}
	return resultat;
}
