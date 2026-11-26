// Gestion des skills de la mémoire (`skills/<nom>/SKILL.md`) par l'utilisateur : lecture, création, modification (renommage
// compris), suppression, retour à la version d'origine d'une skill fournie par Mnemo. Les skills d'un profil et celles des
// plugins ne passent pas par ici : elles restent en lecture seule.
import { DOSSIERS_FIXES } from '@mnemo/commun';
import { empreinte } from '../domaine/empreinte.ts';
import { lireFiche } from '../domaine/fiche.ts';
import { estNomDeSkill, lireSkill, motifsDeSkill, texteDeSkill } from '../domaine/skill.ts';
import type { SkillEditee } from '../domaine/skill.ts';
import { ecrireEtCommiter, fichiersDuDossier, sousVerrou, texteDeFiche } from './commun.ts';
import { nomsDesSkills, retenueParLeProfil } from './moteurs/skills-de-session.ts';
import type { Dependances } from './ports.ts';
import { chargerProfil, cheminDeProfil, dossierSkillsDuProfil, SKILLS_MEMOIRE_FOURNIES } from './profil.ts';
import type { SkillParDefaut } from './profil.ts';
import { profilsDeLaMemoire } from './profils-disponibles.ts';
import { reindexerApresEcriture } from './synchroniser.ts';

/** Ce qu'une création ou une modification reçoit : la skill réglée (`nom` différent de l'actuel : renommage). */
export type SkillEntree = SkillEditee;

/**
 * Détail d'une skill pour son éditeur. `origine` : `mnemo` si Mnemo la fournit (`SKILLS_MEMOIRE_FOURNIES`), sinon `memoire` ;
 * `modifiee` : son texte diffère de la version fournie ; `agents` : les profils qui la reçoivent (retenue par `skillsMemoire`,
 * sans skill propre du même nom) ; `empreinte` : celle du `SKILL.md` lu, à renvoyer à la modification ; `avertissements` :
 * frontmatter illisible.
 */
export type DetailSkill = SkillEditee & { origine: 'mnemo' | 'memoire'; modifiee: boolean; agents: string[]; empreinte: string; avertissements: string[] };

/**
 * Issue d'une écriture : `nom`, celui de la skill après l'écriture ; `commit` null quand il n'y avait rien à changer ;
 * `motifs` : un motif par champ refusé ; `introuvable` : aucune skill de ce nom.
 */
export type ResultatSkill =
	| { ok: true; commit: string | null; nom: string }
	| { ok: false; conflit: true }
	| { ok: false; introuvable: true }
	| { ok: false; motifs: Record<string, string> };

const dossierDeSkill = (nom: string): string => `${DOSSIERS_FIXES.skills}/${nom}`;
const cheminDeSkill = (nom: string): string => `${dossierDeSkill(nom)}/SKILL.md`;
const motifNomPris = (nom: string): string => `la skill « ${nom} » existe déjà`;
const INTROUVABLE: ResultatSkill = { ok: false, introuvable: true };

/** Le nom est pris : un dossier de `skills/` porte ce nom, avec ou sans `SKILL.md`. */
const nomPris = async (dep: Dependances, nom: string): Promise<boolean> => (await dep.coffre.lister(DOSSIERS_FIXES.skills)).dossiers.includes(dossierDeSkill(nom));

/** Texte du `SKILL.md` de la skill `nom` ; null si le nom est invalide ou si la skill n'existe pas. */
async function texteDe(dep: Dependances, nom: string): Promise<string | null> {
	return estNomDeSkill(nom) ? dep.coffre.lire(cheminDeSkill(nom)) : null;
}

/** Profils qui reçoivent la skill `nom` de la mémoire : ils la retiennent et n'ont pas de skill propre du même nom. */
async function agentsDe(dep: Dependances, nom: string): Promise<string[]> {
	const agents: string[] = [];
	for (const profil of await profilsDeLaMemoire(dep)) {
		if (!retenueParLeProfil(await chargerProfil(dep, profil), nom)) continue;
		if ((await nomsDesSkills(dep, dossierSkillsDuProfil(profil))).includes(nom)) continue;
		agents.push(profil);
	}
	return agents;
}

/** Détail de la skill `nom` de la mémoire ; null si elle n'existe pas. */
export async function detailSkill(dep: Dependances, nom: string, fournies: readonly SkillParDefaut[] = SKILLS_MEMOIRE_FOURNIES): Promise<DetailSkill | null> {
	const texte = await texteDe(dep, nom);
	if (texte === null) return null;
	const lue = lireSkill(texte);
	const fournie = fournies.find((s) => s.nom === nom);
	return {
		nom,
		description: lue.description,
		icone: lue.icone,
		contenu: lue.contenu,
		origine: fournie === undefined ? 'memoire' : 'mnemo',
		modifiee: fournie !== undefined && fournie.texte !== texte,
		agents: await agentsDe(dep, nom),
		empreinte: empreinte(texte),
		avertissements: lue.illisible ? [`${cheminDeSkill(nom)} : frontmatter illisible ; l'enregistrer en réécrit un, le texte d'avant reste dans le contenu`] : [],
	};
}

/** Écrit, commite et réindexe ; la réindexation suit seulement un commit. */
async function ecrire(dep: Dependances, action: () => Promise<ResultatSkill>): Promise<ResultatSkill> {
	const resultat = await sousVerrou(dep, action);
	if (resultat.ok && resultat.commit !== null) await reindexerApresEcriture(dep);
	return resultat;
}

/** Crée la skill `entree.nom` ; refusée si un champ est invalide ou si le nom est pris. Un commit `mnemo: cree skills/<nom>/SKILL.md`. */
export async function creerSkill(dep: Dependances, entree: SkillEntree): Promise<ResultatSkill> {
	const motifs = motifsDeSkill(entree);
	if (Object.keys(motifs).length > 0) return { ok: false, motifs };
	return ecrire(dep, async () => {
		if (await nomPris(dep, entree.nom)) return { ok: false, motifs: { nom: motifNomPris(entree.nom) } };
		const chemin = cheminDeSkill(entree.nom);
		return { ok: true, commit: await ecrireEtCommiter(dep, [{ chemin, texte: texteDeSkill(entree) }], `mnemo: cree ${chemin}`), nom: entree.nom };
	});
}

/**
 * Fiches de profil à réécrire pour que leur `skills_memoire` (liste) suive la skill `ancien` : renommée en `nouveau`, ou
 * retirée (`nouveau` null). Une fiche illisible, ou dont la liste ne la nomme pas, n'est pas touchée ; `tous` la suit seul.
 */
async function profilsASuivre(dep: Dependances, ancien: string, nouveau: string | null): Promise<{ chemin: string; texte: string }[]> {
	const aEcrire: { chemin: string; texte: string }[] = [];
	for (const profil of await profilsDeLaMemoire(dep)) {
		const chemin = cheminDeProfil(profil);
		const texte = await dep.coffre.lire(chemin);
		if (texte === null) continue;
		let fiche;
		try {
			fiche = lireFiche(chemin, texte);
		} catch {
			continue;
		}
		const liste = fiche.donnees['skills_memoire'];
		if (!Array.isArray(liste) || !liste.includes(ancien)) continue;
		const suivie = liste.flatMap((s: unknown) => (s === ancien ? (nouveau === null ? [] : [nouveau]) : [s]));
		fiche.donnees['skills_memoire'] = [...new Set(suivie)];
		aEcrire.push({ chemin, texte: texteDeFiche(dep, fiche) });
	}
	return aEcrire;
}

/**
 * Modifie la skill `nom` (la renomme si `entree.nom` diffère). Refusée si un champ est invalide ou si le nouveau nom est pris,
 * en conflit si le `SKILL.md` n'a plus l'empreinte `empreinteLue`. Un commit `mnemo: modifie skills/<nom>/SKILL.md`, ou, pour
 * un renommage, `mnemo: renomme skills/<ancien> → skills/<nouveau>` : les `.md` du dossier déplacés et les profils qui la
 * listent mis à jour, dans le même commit.
 */
export async function modifierSkill(dep: Dependances, nom: string, entree: SkillEntree, empreinteLue: string): Promise<ResultatSkill> {
	if ((await texteDe(dep, nom)) === null) return INTROUVABLE;
	const motifs = motifsDeSkill(entree);
	if (Object.keys(motifs).length > 0) return { ok: false, motifs };
	return ecrire(dep, async () => {
		const texte = await texteDe(dep, nom);
		if (texte === null) return INTROUVABLE;
		if (empreinte(texte) !== empreinteLue) return { ok: false, conflit: true };
		const nouveau = texteDeSkill(entree, lireSkill(texte).entete);
		if (entree.nom === nom) {
			if (nouveau === texte) return { ok: true, commit: null, nom };
			const chemin = cheminDeSkill(nom);
			return { ok: true, commit: await ecrireEtCommiter(dep, [{ chemin, texte: nouveau }], `mnemo: modifie ${chemin}`), nom };
		}
		if (await nomPris(dep, entree.nom)) return { ok: false, motifs: { nom: motifNomPris(entree.nom) } };
		const ancienDossier = dossierDeSkill(nom);
		const nouveauDossier = dossierDeSkill(entree.nom);
		const anciens = await fichiersDuDossier(dep, ancienDossier);
		const aEcrire = [{ chemin: cheminDeSkill(entree.nom), texte: nouveau }];
		for (const chemin of anciens) {
			if (chemin === cheminDeSkill(nom)) continue;
			const autre = await dep.coffre.lire(chemin);
			if (autre !== null) aEcrire.push({ chemin: `${nouveauDossier}${chemin.slice(ancienDossier.length)}`, texte: autre });
		}
		aEcrire.push(...(await profilsASuivre(dep, nom, entree.nom)));
		const commit = await ecrireEtCommiter(dep, aEcrire, `mnemo: renomme ${ancienDossier} → ${nouveauDossier}`, anciens);
		await dep.coffre.retirerDossierVide(ancienDossier);
		return { ok: true, commit, nom: entree.nom };
	});
}

/**
 * Supprime la skill `nom` : les `.md` de son dossier, et son nom de la liste `skills_memoire` des profils qui la listent ;
 * un commit `mnemo: supprime skills/<nom>/`.
 */
export async function supprimerSkill(dep: Dependances, nom: string): Promise<ResultatSkill> {
	if ((await texteDe(dep, nom)) === null) return INTROUVABLE;
	return ecrire(dep, async () => {
		if ((await texteDe(dep, nom)) === null) return INTROUVABLE;
		const dossier = dossierDeSkill(nom);
		const commit = await ecrireEtCommiter(dep, await profilsASuivre(dep, nom, null), `mnemo: supprime ${dossier}/`, await fichiersDuDossier(dep, dossier));
		await dep.coffre.retirerDossierVide(dossier);
		return { ok: true, commit, nom };
	});
}

/**
 * Réécrit la skill `nom` avec sa version fournie par Mnemo ; refusée pour une skill que Mnemo ne fournit pas. Un commit
 * `mnemo: retablit skills/<nom>/SKILL.md`, aucun si elle est déjà d'origine.
 */
export async function revenirALOrigine(dep: Dependances, nom: string, fournies: readonly SkillParDefaut[] = SKILLS_MEMOIRE_FOURNIES): Promise<ResultatSkill> {
	if ((await texteDe(dep, nom)) === null) return INTROUVABLE;
	const fournie = fournies.find((s) => s.nom === nom);
	if (fournie === undefined) return { ok: false, motifs: { nom: `la skill « ${nom} » n'est pas fournie par Mnemo : pas de version d'origine` } };
	return ecrire(dep, async () => {
		const texte = await texteDe(dep, nom);
		if (texte === null) return INTROUVABLE;
		if (texte === fournie.texte) return { ok: true, commit: null, nom };
		const chemin = cheminDeSkill(nom);
		return { ok: true, commit: await ecrireEtCommiter(dep, [{ chemin, texte: fournie.texte }], `mnemo: retablit ${chemin}`), nom };
	});
}
