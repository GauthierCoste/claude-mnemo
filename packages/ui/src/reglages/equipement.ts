/**
 * Équipement d'un agent dans son brouillon (Réglages › Agents) : cocher une skill de la mémoire ou un plugin, suivre le
 * renommage ou la suppression d'une skill de la mémoire, et compter ce que reçoivent ses sessions (comme le service : les
 * skills propres à l'agent, puis celles de la mémoire qu'il retient et qui n'ont pas le nom d'une des siennes ; les plugins
 * avec Claude Code seulement).
 */
import type { ProfilDetailVue, ProfilEditableVue } from '@mnemo/contrat';

/** Coche ou décoche `valeur` dans `liste`, dans l'ordre de `ordre` (les valeurs hors de `ordre` restent, à la fin). */
export function basculer<T>(liste: readonly T[], valeur: T, coche: boolean, ordre: readonly T[]): T[] {
	const ensemble = new Set(liste);
	if (coche) ensemble.add(valeur);
	else ensemble.delete(valeur);
	return [...ordre.filter((x) => ensemble.has(x)), ...[...ensemble].filter((x) => !ordre.includes(x))];
}

/** La skill `nom` de la mémoire est-elle retenue ? */
export const retient = (skillsMemoire: ProfilEditableVue['skillsMemoire'], nom: string): boolean => skillsMemoire === 'tous' || skillsMemoire.includes(nom);

/**
 * Cocher ou décocher une skill de la mémoire : depuis « toutes », décocher en garde toutes les autres (la liste explicite des
 * skills `disponibles`) ; cocher quand toutes sont déjà retenues ne change rien.
 */
export function basculerSkill(skillsMemoire: ProfilEditableVue['skillsMemoire'], nom: string, coche: boolean, disponibles: readonly string[]): ProfilEditableVue['skillsMemoire'] {
	if (skillsMemoire === 'tous') return coche ? 'tous' : disponibles.filter((x) => x !== nom);
	return basculer(skillsMemoire, nom, coche, disponibles);
}

/** La liste des skills retenues suit la skill `ancien` de la mémoire : renommée en `nouveau`, ou retirée (null). */
export function suivreSkill(skillsMemoire: ProfilEditableVue['skillsMemoire'], ancien: string, nouveau: string | null): ProfilEditableVue['skillsMemoire'] {
	if (skillsMemoire === 'tous' || !skillsMemoire.includes(ancien)) return skillsMemoire;
	return [...new Set(skillsMemoire.flatMap((x) => (x === ancien ? (nouveau === null ? [] : [nouveau]) : [x])))];
}

/** Ce que reçoivent les sessions de l'agent réglé ainsi : skills (propres puis de la mémoire) et plugins installés allumés. */
export function compterEquipement(e: ProfilEditableVue, d: Pick<ProfilDetailVue, 'skillsDuProfil' | 'skillsMemoireDisponibles' | 'pluginsInstalles'>): { skills: number; plugins: number } {
	const propres = new Set(d.skillsDuProfil.map((x) => x.nom));
	const memoire = d.skillsMemoireDisponibles.filter((x) => !propres.has(x.nom) && retient(e.skillsMemoire, x.nom)).length;
	const plugins = e.moteur === 'claude-code' ? d.pluginsInstalles.filter((x) => e.plugins.includes(x.id)).length : 0;
	return { skills: propres.size + memoire, plugins };
}
