import { estModele } from '@mnemo/commun';
import { estObjet, objetJson } from '../../valeurs.ts';

/**
 * Modèles proposés par Codex, lus dans la sortie de `codex debug models` (`{ "models": [{ "slug", "visibility",
 * "priority" }] }`) : ceux de visibilité `list`, par priorité croissante (puis dans l'ordre du catalogue), sans doublon ni
 * identifiant refusé par `estModele`. Sortie illisible : aucun (le modèle par défaut de Codex seulement).
 */
export function modelesDuCatalogue(texte: string): string[] {
	const catalogue = objetJson(texte);
	const modeles = catalogue?.['models'];
	if (!Array.isArray(modeles)) return [];
	const retenus: { slug: string; priorite: number; rang: number }[] = [];
	modeles.forEach((m: unknown, rang) => {
		if (!estObjet(m) || m['visibility'] !== 'list') return;
		const slug = m['slug'];
		if (typeof slug !== 'string' || slug === '' || !estModele(slug) || retenus.some((r) => r.slug === slug)) return;
		const priorite = typeof m['priority'] === 'number' && Number.isFinite(m['priority']) ? m['priority'] : Number.MAX_SAFE_INTEGER;
		retenus.push({ slug, priorite, rang });
	});
	return retenus.sort((a, b) => a.priorite - b.priorite || a.rang - b.rang).map((r) => r.slug);
}
