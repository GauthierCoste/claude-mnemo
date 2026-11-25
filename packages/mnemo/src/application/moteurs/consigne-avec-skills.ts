import { separerFrontmatter } from '../../domaine/fiche.ts';
import type { Profil } from '../../domaine/profil.ts';
import type { SkillDeSession } from './skills-de-session.ts';

/** Longueur au plus d'une description de skill dans la consigne : elle n'est qu'un indice, la skill se lit par `lire`. */
const DESCRIPTION_MAX = 300;

/** Description d'une skill (frontmatter de son `SKILL.md`), sur une ligne ; « » si elle n'en a pas ou s'il est illisible. */
function descriptionDe(skill: SkillDeSession): string {
	try {
		const valeur = separerFrontmatter(`${skill.dossier}/SKILL.md`, skill.texte).entete['description'];
		if (typeof valeur !== 'string') return '';
		const ligne = valeur.replace(/\s+/gu, ' ').trim();
		return ligne.length <= DESCRIPTION_MAX ? ligne : `${ligne.slice(0, DESCRIPTION_MAX - 1)}…`;
	} catch {
		return '';
	}
}

/**
 * Consigne d'une session d'un moteur qui ne prend pas de skills d'un plugin de session (Codex, Mistral Vibe) : celle du
 * profil, puis la liste des skills de la session. Rien n'est écrit dans le dossier du projet : chaque skill est nommée avec
 * sa description et l'identifiant de son `SKILL.md`, lu par l'outil `lire` de Mnemo quand elle s'applique.
 */
export function consigneAvecSkills(profil: Pick<Profil, 'consigne'>, skills: readonly SkillDeSession[]): string {
	const consigne = profil.consigne.trim();
	if (skills.length === 0) return `${consigne}\n`;
	const lignes = skills.map((s) => {
		const description = descriptionDe(s);
		return `- ${s.nom}${description === '' ? '' : ` : ${description}`} (\`${s.dossier}/SKILL.md\`)`;
	});
	return [
		consigne,
		'',
		'## Skills de Mnemo',
		'',
		'Ces skills sont dans la mémoire Mnemo, pas sur le disque du projet. Quand l\'une s\'applique à ta tâche, lis d\'abord son `SKILL.md` avec l\'outil `lire` de Mnemo (identifiant entre parenthèses), puis suis-la ; ses autres fichiers sont dans le même dossier (`lister`).',
		'',
		...lignes,
		'',
	].join('\n');
}
