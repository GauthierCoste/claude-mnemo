import { ecrireFiche } from '../domaine/fiche.ts';
import { CHEMIN_SCHEMA } from './regles-du-coffre.ts';
import { commiter, ecrireEtCommiter, ficheVide } from './commun.ts';
import { CHEMIN_PROFIL_TRAVAIL, TITRE_PROFIL_TRAVAIL } from './profil.ts';
import type { Dependances } from './ports.ts';

export const MESSAGE_INITIALISATION = 'mnemo: initialisation';

/** `existante` : `profil` est le commit qui a déposé le profil travail manquant, null si rien n'a été écrit. */
export type ResultatInitialisation = { statut: 'cree'; commit: string } | { statut: 'existante'; profil: string | null };

export const MESSAGE_PROFIL_TRAVAIL = 'mnemo: profil travail';

/** Fiche du profil travail, à synthèse vide : sa consigne est celle du code (`CONSIGNE_TRAVAIL_PAR_DEFAUT`) tant que l'utilisateur ne l'écrit pas. */
function ficheDuProfilTravail(dep: Dependances) {
	return ficheVide(dep, CHEMIN_PROFIL_TRAVAIL, 'profil', TITRE_PROFIL_TRAVAIL);
}

/**
 * Crée la mémoire (SCHEMA.md, .gitattributes, .gitignore, profil travail) en un commit ; aucun dossier : l'arborescence
 * naît des fiches écrites, et l'archiviste l'organise selon l'usage de l'utilisateur. Si elle existe,
 * seul le profil travail est déposé s'il manque (son propre commit) ; rien d'existant n'est réécrit.
 */
export async function initialiser(dep: Dependances, schema: string): Promise<ResultatInitialisation> {
	return dep.verrou.avec(async () => {
		if ((await dep.coffre.lire(CHEMIN_SCHEMA)) !== null) {
			if ((await dep.coffre.lire(CHEMIN_PROFIL_TRAVAIL)) !== null) return { statut: 'existante', profil: null };
			const profil = ficheDuProfilTravail(dep);
			return { statut: 'existante', profil: await ecrireEtCommiter(dep, [{ chemin: profil.chemin, texte: ecrireFiche(profil) }], MESSAGE_PROFIL_TRAVAIL) };
		}
		await dep.historique.initialiser();
		await dep.coffre.ecrire('.gitattributes', '* text=auto eol=lf\n');
		// Fichiers temporaires d'une écriture interrompue : jamais versionnés.
		await dep.coffre.ecrire('.gitignore', '.mnemo-*.tmp\n');
		await dep.coffre.ecrire(CHEMIN_SCHEMA, schema);
		// Profil de travail : déposé seulement s'il manque, une fiche modifiée à la main n'est jamais touchée.
		if ((await dep.coffre.lire(CHEMIN_PROFIL_TRAVAIL)) === null) {
			const profil = ficheDuProfilTravail(dep);
			await dep.coffre.ecrire(profil.chemin, ecrireFiche(profil));
		}
		const commit = await commiter(dep, MESSAGE_INITIALISATION, 'tout');
		return { statut: 'cree', commit };
	});
}
