// Profils qui peuvent être lancés (dialogue Nouvelle session, Réglages › Moteurs) : ce qui les décrit et leur équipement.
import { DOSSIERS_FIXES, MOTEUR_PAR_DEFAUT } from '@mnemo/commun';
import { estNomDeProfil, lanceurPropreSansChemin, moteurOuModeleInvalides, MOTIF_LANCEUR_PROPRE, MOTIF_NOM_DE_PROFIL, PROFILS_PAR_DEFAUT } from '../domaine/profil.ts';
import type { Profil } from '../domaine/profil.ts';
import type { EvenementHook } from '../domaine/session.ts';
import { skillsRetenues } from './moteurs/skills-de-session.ts';
import type { Dependances } from './ports.ts';
import { chargerProfil, ficheDeProfil, profilParDefaut } from './profil.ts';

/**
 * Équipement d'un profil, compté comme le montre l'aperçu de Réglages › Profils : `skills`, celles que ses sessions reçoivent
 * (`skillsRetenues` : celles du profil, puis celles de la mémoire qu'il retient, sans le filtre par projet) ; `plugins`, les
 * plugins Claude Code qu'il allume (seulement avec ce moteur) ; `hooks`, ses événements de hook de Mnemo.
 */
export type EquipementProfil = { skills: number; plugins: number; hooks: EvenementHook[] };

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

/** Équipement du profil, sans rien écrire (les skills par défaut pas encore déposées ne comptent pas). */
export async function equipementDuProfil(dep: Dependances, profil: Profil): Promise<EquipementProfil> {
	return {
		skills: (await skillsRetenues(dep, undefined, profil)).length,
		plugins: profil.moteur === MOTEUR_PAR_DEFAUT ? profil.plugins.length : 0,
		hooks: [...profil.hooks],
	};
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
			equipement: await equipementDuProfil(dep, profil),
		});
		const fiche = await ficheDeProfil(dep, nom).catch(() => null);
		if (lanceurPropreSansChemin(fiche, profilParDefaut(nom))) avertissements.push({ nom, motif: MOTIF_LANCEUR_PROPRE });
		for (const motif of moteurOuModeleInvalides(fiche)) avertissements.push({ nom, motif });
	}
	return { profils, ignores: dossiers.filter((nom) => !estNomDeProfil(nom)).map((nom) => ({ nom, motif: MOTIF_NOM_DE_PROFIL })), avertissements };
}
