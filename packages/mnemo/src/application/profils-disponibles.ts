// Profils qui peuvent être lancés (dialogue Nouvelle session, Réglages › Moteurs) : ce qui les décrit et leur équipement.
import { DOSSIERS_FIXES, MOTEUR_PAR_DEFAUT } from '@mnemo/commun';
import { estNomDeProfil, lanceurPropreSansChemin, moteurOuModeleInvalides, MOTIF_LANCEUR_PROPRE, MOTIF_NOM_DE_PROFIL, PROFILS_PAR_DEFAUT } from '../domaine/profil.ts';
import type { Profil } from '../domaine/profil.ts';
import type { EvenementHook } from '../domaine/session.ts';
import { enabledPluginsDe } from './moteurs/claude-code/plugin.ts';
import { nomsDesSkills, retenueParLeProfil } from './moteurs/skills-de-session.ts';
import type { Dependances, PluginInstalle } from './ports.ts';
import { chargerProfil, dossierSkillsDuProfil, ficheDeProfil, profilParDefaut } from './profil.ts';

/**
 * Équipement d'un profil, compté comme le montre l'aperçu de Réglages › Profils : `skills`, celles que ses sessions reçoivent
 * (comme `skillsRetenues` sans projet : celles du profil, puis celles de la mémoire qu'il retient, celle du profil gagnant à
 * nom égal) ; `plugins`, les plugins Claude Code installés qu'il allume (`enabledPluginsDe`, seulement avec ce moteur) ;
 * `hooks`, ses événements de hook de Mnemo.
 */
type EquipementProfil = { skills: number; plugins: number; hooks: EvenementHook[] };

/**
 * Un profil qui peut être lancé : `description`, première ligne de sa consigne ; `lancement` : dans le dossier choisi ou
 * dans la mémoire ; `lanceur` : par le dialogue Nouvelle session ou par son propre chemin ; `avatar` ; `personnalise` : sa
 * consigne remplace celle par défaut ; `moteur` et `modele` (« » : celui par défaut du moteur) de ses sessions ; `equipement`.
 */
export type ProfilDisponible = {
	nom: string;
	description: string;
	lancement: Profil['lancement'];
	lanceur: Profil['lanceur'];
	avatar: Profil['avatar'];
	personnalise: boolean;
	moteur: Profil['moteur'];
	modele: string;
	equipement: EquipementProfil;
};

/**
 * Équipement du profil, sans rien écrire ni lire de `SKILL.md` (les skills par défaut pas encore déposées ne comptent pas) ;
 * `skillsMemoire` : noms des skills de `_mnemo/skills/`, `installes` : plugins Claude Code, lus une fois pour tous les profils.
 */
async function equipementDuProfil(dep: Dependances, profil: Profil, skillsMemoire: readonly string[], installes: readonly PluginInstalle[]): Promise<EquipementProfil> {
	const duProfil = await nomsDesSkills(dep, dossierSkillsDuProfil(profil.nom));
	const deLaMemoire = skillsMemoire.filter((nom) => !duProfil.includes(nom) && retenueParLeProfil(profil, nom));
	const allumes = profil.moteur === MOTEUR_PAR_DEFAUT ? Object.values(enabledPluginsDe(profil, installes)).filter(Boolean).length : 0;
	return { skills: duProfil.length + deLaMemoire.length, plugins: allumes, hooks: [...profil.hooks] };
}

/**
 * Profils qui peuvent être lancés, triés par nom : ceux du paquet et chaque dossier de `profils/`, lus par `chargerProfil`.
 * Un dossier au nom refusé par `estNomDeProfil` est rendu dans `ignores` avec son motif ; un profil lu autrement qu'il ne
 * se déclare, dans `avertissements`.
 */
export async function profilsDisponibles(
	dep: Dependances,
): Promise<{ profils: ProfilDisponible[]; ignores: { nom: string; motif: string }[]; avertissements: { nom: string; motif: string }[] }> {
	const dossiers = (await dep.coffre.lister(DOSSIERS_FIXES.profils)).dossiers.map((d) => d.slice(d.lastIndexOf('/') + 1));
	const noms = [...new Set([...Object.keys(PROFILS_PAR_DEFAUT), ...dossiers.filter(estNomDeProfil)])].sort();
	const profils: ProfilDisponible[] = [];
	const skillsMemoire = await nomsDesSkills(dep, DOSSIERS_FIXES.skills);
	// plugins illisibles : aucun compté, la liste des profils reste lisible
	const { plugins: installes } = await dep.pluginsClaude.installes().catch(() => ({ plugins: [] as PluginInstalle[] }));
	const avertissements: { nom: string; motif: string }[] = [];
	for (const nom of noms) {
		const profil = await chargerProfil(dep, nom);
		profils.push({
			nom,
			description: profil.consigne.split('\n')[0]!.trim(),
			lancement: profil.lancement,
			lanceur: profil.lanceur,
			avatar: profil.avatar,
			personnalise: profil.consignePersonnalisee,
			moteur: profil.moteur,
			modele: profil.modele,
			equipement: await equipementDuProfil(dep, profil, skillsMemoire, installes),
		});
		const fiche = await ficheDeProfil(dep, nom).catch(() => null);
		if (lanceurPropreSansChemin(fiche, profilParDefaut(nom))) avertissements.push({ nom, motif: MOTIF_LANCEUR_PROPRE });
		for (const motif of moteurOuModeleInvalides(fiche)) avertissements.push({ nom, motif });
	}
	return { profils, ignores: dossiers.filter((nom) => !estNomDeProfil(nom)).map((nom) => ({ nom, motif: MOTIF_NOM_DE_PROFIL })), avertissements };
}
