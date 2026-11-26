// Une skill de la mémoire (`skills/<nom>/SKILL.md`, format des Agent Skills) : validation, lecture et écriture de son texte.
import { stringify } from 'yaml';
import { separerFrontmatter } from './fiche.ts';
import { estObjet } from './valeurs.ts';

/** Ce que l'utilisateur règle d'une skill : `icone` (null : aucune) est rangée dans `metadata.icone` du frontmatter. */
export type SkillEditee = { nom: string; description: string; icone: string | null; contenu: string };

/**
 * Une skill lue : `entete`, son frontmatter entier (clés inconnues comprises, gardées à la réécriture) ; `illisible` : le
 * frontmatter ne se lit pas, tout le texte est alors du contenu.
 */
export type SkillLue = { description: string; icone: string | null; contenu: string; entete: Record<string, unknown>; illisible: boolean };

const RE_NOM_SKILL = /^[a-z0-9][a-z0-9-]{0,39}$/u;

/** Nom de skill sûr : celui de son dossier, et celui que voit l'agent. */
export const estNomDeSkill = (nom: string): boolean => RE_NOM_SKILL.test(nom);

/** Motif d'un nom refusé par `estNomDeSkill`. */
export const MOTIF_NOM_DE_SKILL = 'nom refusé : minuscules, chiffres et tirets, 40 caractères au plus, sans tiret au début';

/** Longueur maximale de la description (spécification des Agent Skills). */
export const DESCRIPTION_SKILL_MAX = 1024;
/** Longueur maximale de l'icône, en unités UTF-16 : un emoji composé tient. */
export const ICONE_SKILL_MAX = 16;
export const CONTENU_SKILL_MAX = 100_000;

/** Motifs de refus d'une skill, par champ ; vide si elle est valide. */
export function motifsDeSkill(s: SkillEditee): Record<string, string> {
	const motifs: Record<string, string> = {};
	if (!estNomDeSkill(s.nom)) motifs.nom = MOTIF_NOM_DE_SKILL;
	if (s.description.trim() === '') motifs.description = 'description obligatoire : c\'est elle qui fait charger la skill par l\'agent';
	else if (/[\r\n]/u.test(s.description)) motifs.description = 'description sur une seule ligne';
	else if (s.description.length > DESCRIPTION_SKILL_MAX) motifs.description = `description de ${DESCRIPTION_SKILL_MAX} caractères au plus`;
	if (s.icone !== null && (s.icone === '' || s.icone.length > ICONE_SKILL_MAX || /[\s\p{Cc}]/u.test(s.icone))) motifs.icone = 'icône refusée : un emoji ou un caractère, sans espace';
	if (s.contenu.length > CONTENU_SKILL_MAX) motifs.contenu = `contenu de ${CONTENU_SKILL_MAX} caractères au plus`;
	return motifs;
}

/** Lit le texte d'un `SKILL.md`. Ne lève jamais. */
export function lireSkill(texte: string): SkillLue {
	let entete: Record<string, unknown>;
	let corps: string;
	try {
		({ entete, corps } = separerFrontmatter('SKILL.md', texte));
	} catch {
		return { description: '', icone: null, contenu: texte.trim(), entete: {}, illisible: true };
	}
	const description = typeof entete.description === 'string' ? entete.description : '';
	const metadata = entete.metadata;
	const icone = estObjet(metadata) && typeof metadata.icone === 'string' ? metadata.icone : null;
	return { description, icone, contenu: corps.trim(), entete, illisible: false };
}

/**
 * Texte du `SKILL.md` de `s` : frontmatter `name` (= `s.nom`), `description`, puis les autres clés de `entete` (celui de la
 * skill lue) dans leur ordre, `metadata.icone` réécrite (retirée sans icône, `metadata` vide retirée) ; le contenu ensuite.
 */
export function texteDeSkill(s: SkillEditee, entete: Record<string, unknown> = {}): string {
	const donnees: Record<string, unknown> = { name: s.nom, description: s.description.trim() };
	for (const [cle, valeur] of Object.entries(entete)) if (cle !== 'name' && cle !== 'description') donnees[cle] = valeur;
	const metadata: Record<string, unknown> = estObjet(entete.metadata) ? { ...entete.metadata } : {};
	delete metadata.icone;
	if (s.icone !== null) metadata.icone = s.icone;
	if (Object.keys(metadata).length > 0) donnees.metadata = metadata;
	else delete donnees.metadata;
	const contenu = s.contenu.trim();
	return `---\n${stringify(donnees, { lineWidth: 0 })}---\n${contenu === '' ? '' : `\n${contenu}\n`}`;
}
