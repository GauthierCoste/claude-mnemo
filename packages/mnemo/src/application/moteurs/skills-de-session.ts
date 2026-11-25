import { DOSSIERS_FIXES } from '@mnemo/commun';
import type { Profil } from '../../domaine/profil.ts';
import { skillPourProjet } from '../../domaine/profil.ts';
import type { Session } from '../../domaine/session.ts';
import type { Dependances } from '../ports.ts';
import { deposerSkillsParDefaut, dossierSkillsDuProfil } from '../profil.ts';

/** Une skill retenue pour une session : son nom (celui de son dossier), son dossier (relatif à la mémoire) et le texte de son `SKILL.md`. */
export type SkillDeSession = { nom: string; dossier: string; texte: string };

/**
 * Skills d'un dossier : chaque sous-dossier dont le `SKILL.md` est une fiche listée (fichier ordinaire : un lien symbolique
 * n'est pas listé, donc jamais suivi) et que `garder` accepte (nom du sous-dossier, texte du `SKILL.md`).
 */
async function skillsDuDossier(dep: Dependances, dossier: string, garder: (nom: string, texteSkill: string) => boolean): Promise<SkillDeSession[]> {
	const retenues: SkillDeSession[] = [];
	for (const sous of (await dep.coffre.lister(dossier)).dossiers) {
		if (!(await dep.coffre.lister(sous)).fiches.includes(`${sous}/SKILL.md`)) continue;
		const nom = sous.slice(sous.lastIndexOf('/') + 1);
		const texte = await dep.coffre.lire(`${sous}/SKILL.md`);
		if (texte === null || !garder(nom, texte)) continue;
		retenues.push({ nom, dossier: sous, texte });
	}
	return retenues;
}

/**
 * Skills d'une session, quel que soit le moteur : celles du profil (`profils/<nom>/skills/`, ses skills par défaut
 * manquantes d'abord déposées, un commit), puis celles de `_mnemo/skills/` retenues par `skillsMemoire` et par leur champ
 * `projets` ; à nom égal, celle du profil gagne.
 */
export async function skillsDeSession(dep: Dependances, session: Pick<Session, 'projet'>, profil: Pick<Profil, 'nom' | 'skillsMemoire'>): Promise<SkillDeSession[]> {
	await deposerSkillsParDefaut(dep, profil.nom);
	const duProfil = await skillsDuDossier(dep, dossierSkillsDuProfil(profil.nom), () => true);
	const noms = new Set(duProfil.map((s) => s.nom));
	const retenue = (nom: string) => profil.skillsMemoire === 'tous' || profil.skillsMemoire.includes(nom);
	const deLaMemoire = await skillsDuDossier(dep, DOSSIERS_FIXES.skills, (nom, texte) => !noms.has(nom) && retenue(nom) && skillPourProjet(texte, session.projet));
	return [...duProfil, ...deLaMemoire];
}
