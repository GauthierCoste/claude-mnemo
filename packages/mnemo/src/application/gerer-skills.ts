// Gestion des skills par l'utilisateur, celles de la mémoire (`skills/<nom>/SKILL.md`) ou celles d'un profil
// (`profils/<profil>/skills/<nom>/SKILL.md`) : lecture, création, modification (renommage compris), suppression, retour à la
// version d'origine d'une skill fournie par Mnemo (skills par défaut d'un profil). Celles des plugins restent en lecture seule.
import { DOSSIERS_FIXES } from '@mnemo/commun';
import { empreinte } from '../domaine/empreinte.ts';
import { lireFiche } from '../domaine/fiche.ts';
import { estNomDeProfil } from '../domaine/profil.ts';
import { estNomDeSkill, lireSkill, motifsDeSkill, texteDeSkill } from '../domaine/skill.ts';
import type { SkillEditee } from '../domaine/skill.ts';
import { ecrireEtCommiter, fichiersDuDossier, sousVerrou, texteDeFiche } from './commun.ts';
import { nomsDesSkills, retenueParLeProfil } from './moteurs/skills-de-session.ts';
import type { Dependances } from './ports.ts';
import { ANCIENNES_SKILLS, chargerProfil, cheminDeProfil, dossierSkillsDuProfil, SKILLS_PAR_DEFAUT } from './profil.ts';
import type { SkillParDefaut } from './profil.ts';
import { profilsDeLaMemoire } from './profils-disponibles.ts';
import { reindexerApresEcriture } from './synchroniser.ts';

/** Ce qu'une création ou une modification reçoit : la skill réglée (`nom` différent de l'actuel : renommage). */
export type SkillEntree = SkillEditee;

/** Portée d'une skill : celle de la mémoire (`profil` null), ou celle du profil `profil`. */
export type PorteeSkill = string | null;

/**
 * Détail d'une skill pour son éditeur. `origine` : `mnemo` si Mnemo la fournit (une skill par défaut de son profil,
 * `SKILLS_PAR_DEFAUT`), sinon `memoire` ; `modifiee` : son texte n'est ni la version fournie ni une version fournie passée
 * (`ANCIENNES_SKILLS`, que le prochain lancement remplacera) ; `agents` : les profils qui la reçoivent (le profil propriétaire
 * pour une skill de profil) ; `empreinte` : celle du `SKILL.md` lu, à renvoyer à la modification ; `motifFixe` : pourquoi elle
 * ne se renomme ni ne se supprime (null : elle le peut) ; `avertissements` : frontmatter illisible.
 */
export type DetailSkill = SkillEditee & {
	profil: string | null;
	origine: 'mnemo' | 'memoire';
	modifiee: boolean;
	agents: string[];
	empreinte: string;
	motifFixe: string | null;
	avertissements: string[];
};

/**
 * Issue d'une écriture : `nom`, celui de la skill après l'écriture ; `commit` null quand il n'y avait rien à changer ;
 * `motifs` : un motif par champ refusé ; `introuvable` : aucune skill de ce nom (ou profil inconnu).
 */
export type ResultatSkill =
	| { ok: true; commit: string | null; nom: string }
	| { ok: false; conflit: true }
	| { ok: false; introuvable: true }
	| { ok: false; motifs: Record<string, string> };

/** Où vivent les skills d'une portée, et celles que Mnemo y fournit (version actuelle et versions passées). */
type Lieu = { dossier: string; profil: string | null; fournies: readonly SkillParDefaut[]; anciennes: readonly SkillParDefaut[] };

const INTROUVABLE: ResultatSkill = { ok: false, introuvable: true };
const motifNomPris = (nom: string): string => `la skill « ${nom} » existe déjà`;

/**
 * Motif d'une skill fournie par Mnemo qui ne se renomme ni ne se supprime : le dépôt des skills par défaut
 * (`deposerSkillsParDefaut`) recrée au lancement du profil toute skill par défaut qui manque.
 */
export const motifSkillFournie = (nom: string, profil: string): string =>
	`la skill « ${nom} » est fournie par Mnemo : elle serait redéposée au prochain lancement de « ${profil} » ; modifie-la, ou reviens à sa version d'origine`;

/** Lieu de la portée ; null pour un profil inconnu. */
async function lieuDe(dep: Dependances, profil: PorteeSkill): Promise<Lieu | null> {
	if (profil === null) return { dossier: DOSSIERS_FIXES.skills, profil: null, fournies: [], anciennes: [] };
	if (!estNomDeProfil(profil) || !(await profilsDeLaMemoire(dep)).includes(profil)) return null;
	return { dossier: dossierSkillsDuProfil(profil), profil, fournies: SKILLS_PAR_DEFAUT[profil] ?? [], anciennes: ANCIENNES_SKILLS[profil] ?? [] };
}

const dossierDe = (lieu: Lieu, nom: string): string => `${lieu.dossier}/${nom}`;
const cheminDe = (lieu: Lieu, nom: string): string => `${dossierDe(lieu, nom)}/SKILL.md`;
const fournieDe = (lieu: Lieu, nom: string): SkillParDefaut | undefined => lieu.fournies.find((s) => s.nom === nom);
const motifFixeDe = (lieu: Lieu, nom: string): string | null => (lieu.profil !== null && fournieDe(lieu, nom) !== undefined ? motifSkillFournie(nom, lieu.profil) : null);

/** Le nom est pris : un dossier de la portée porte ce nom, avec ou sans `SKILL.md`. */
const nomPris = async (dep: Dependances, lieu: Lieu, nom: string): Promise<boolean> => (await dep.coffre.lister(lieu.dossier)).dossiers.includes(dossierDe(lieu, nom));

/** Texte du `SKILL.md` de la skill `nom` ; null si le nom est invalide ou si la skill n'existe pas. */
async function texteDe(dep: Dependances, lieu: Lieu, nom: string): Promise<string | null> {
	return estNomDeSkill(nom) ? dep.coffre.lire(cheminDe(lieu, nom)) : null;
}

/** Lieu et texte de la skill `nom` de la portée ; null si le profil ou la skill n'existe pas. */
async function trouver(dep: Dependances, nom: string, profil: PorteeSkill): Promise<{ lieu: Lieu; texte: string } | null> {
	const lieu = await lieuDe(dep, profil);
	if (lieu === null) return null;
	const texte = await texteDe(dep, lieu, nom);
	return texte === null ? null : { lieu, texte };
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

/** Origine d'une skill de la portée : `mnemo` si Mnemo la fournit. */
export const origineDeSkill = (profil: PorteeSkill, nom: string): 'mnemo' | 'memoire' =>
	profil !== null && (SKILLS_PAR_DEFAUT[profil] ?? []).some((s) => s.nom === nom) ? 'mnemo' : 'memoire';

/** Détail de la skill `nom` (de la mémoire, ou du profil `profil`) ; null si elle ou le profil n'existe pas. */
export async function detailSkill(dep: Dependances, nom: string, profil: PorteeSkill = null): Promise<DetailSkill | null> {
	const trouvee = await trouver(dep, nom, profil);
	if (trouvee === null) return null;
	const { lieu, texte } = trouvee;
	const lue = lireSkill(texte);
	const fournie = fournieDe(lieu, nom);
	return {
		nom,
		description: lue.description,
		icone: lue.icone,
		contenu: lue.contenu,
		profil: lieu.profil,
		origine: fournie === undefined ? 'memoire' : 'mnemo',
		modifiee: fournie !== undefined && fournie.texte !== texte && !lieu.anciennes.some((a) => a.nom === nom && a.texte === texte),
		agents: lieu.profil === null ? await agentsDe(dep, nom) : [lieu.profil],
		empreinte: empreinte(texte),
		motifFixe: motifFixeDe(lieu, nom),
		avertissements: lue.illisible ? [`${cheminDe(lieu, nom)} : frontmatter illisible ; l'enregistrer en réécrit un, le texte d'avant reste dans le contenu`] : [],
	};
}

/** Écrit, commite et réindexe ; la réindexation suit seulement un commit. */
async function ecrire(dep: Dependances, action: () => Promise<ResultatSkill>): Promise<ResultatSkill> {
	const resultat = await sousVerrou(dep, action);
	if (resultat.ok && resultat.commit !== null) await reindexerApresEcriture(dep);
	return resultat;
}

/**
 * Crée la skill `entree.nom` (de la mémoire, ou du profil `profil`) ; refusée si un champ est invalide ou si le nom est pris,
 * introuvable si le profil n'existe pas. Un commit `mnemo: cree <dossier>/<nom>/SKILL.md`.
 */
export async function creerSkill(dep: Dependances, entree: SkillEntree, profil: PorteeSkill = null): Promise<ResultatSkill> {
	const lieu = await lieuDe(dep, profil);
	if (lieu === null) return INTROUVABLE;
	const motifs = motifsDeSkill(entree);
	if (Object.keys(motifs).length > 0) return { ok: false, motifs };
	return ecrire(dep, async () => {
		if (await nomPris(dep, lieu, entree.nom)) return { ok: false, motifs: { nom: motifNomPris(entree.nom) } };
		const chemin = cheminDe(lieu, entree.nom);
		return { ok: true, commit: await ecrireEtCommiter(dep, [{ chemin, texte: texteDeSkill(entree) }], `mnemo: cree ${chemin}`), nom: entree.nom };
	});
}

/**
 * Fiches de profil à réécrire pour que leur `skills_memoire` (liste) suive la skill de la mémoire `ancien` : renommée en
 * `nouveau`, ou retirée (`nouveau` null). Une fiche illisible, ou dont la liste ne la nomme pas, n'est pas touchée ; `tous`
 * la suit seul.
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
 * Modifie la skill `nom` (la renomme si `entree.nom` diffère). Refusée si un champ est invalide, si le nouveau nom est pris,
 * ou pour renommer une skill fournie par Mnemo (`motifSkillFournie`) ; en conflit si le `SKILL.md` n'a plus l'empreinte
 * `empreinteLue`. Une skill fournie modifiée n'est plus réécrite par le dépôt des skills par défaut. Un commit
 * `mnemo: modifie <dossier>/<nom>/SKILL.md`, ou, pour un renommage, `mnemo: renomme <dossier>/<ancien> → <dossier>/<nouveau>` :
 * les `.md` du dossier déplacés et, pour une skill de la mémoire, les profils qui la listent mis à jour, dans le même commit.
 */
export async function modifierSkill(dep: Dependances, nom: string, entree: SkillEntree, empreinteLue: string, profil: PorteeSkill = null): Promise<ResultatSkill> {
	const trouvee = await trouver(dep, nom, profil);
	if (trouvee === null) return INTROUVABLE;
	const { lieu } = trouvee;
	const motifs = motifsDeSkill(entree);
	const fixe = motifFixeDe(lieu, nom);
	if (entree.nom !== nom && fixe !== null && motifs.nom === undefined) motifs.nom = fixe;
	if (Object.keys(motifs).length > 0) return { ok: false, motifs };
	return ecrire(dep, async () => {
		const texte = await texteDe(dep, lieu, nom);
		if (texte === null) return INTROUVABLE;
		if (empreinte(texte) !== empreinteLue) return { ok: false, conflit: true };
		const nouveau = texteDeSkill(entree, lireSkill(texte).entete);
		if (entree.nom === nom) {
			if (nouveau === texte) return { ok: true, commit: null, nom };
			const chemin = cheminDe(lieu, nom);
			return { ok: true, commit: await ecrireEtCommiter(dep, [{ chemin, texte: nouveau }], `mnemo: modifie ${chemin}`), nom };
		}
		if (await nomPris(dep, lieu, entree.nom)) return { ok: false, motifs: { nom: motifNomPris(entree.nom) } };
		const ancienDossier = dossierDe(lieu, nom);
		const nouveauDossier = dossierDe(lieu, entree.nom);
		const anciens = await fichiersDuDossier(dep, ancienDossier);
		const aEcrire = [{ chemin: cheminDe(lieu, entree.nom), texte: nouveau }];
		for (const chemin of anciens) {
			if (chemin === cheminDe(lieu, nom)) continue;
			const autre = await dep.coffre.lire(chemin);
			if (autre !== null) aEcrire.push({ chemin: `${nouveauDossier}${chemin.slice(ancienDossier.length)}`, texte: autre });
		}
		if (lieu.profil === null) aEcrire.push(...(await profilsASuivre(dep, nom, entree.nom)));
		const commit = await ecrireEtCommiter(dep, aEcrire, `mnemo: renomme ${ancienDossier} → ${nouveauDossier}`, anciens);
		await dep.coffre.retirerDossierVide(ancienDossier);
		return { ok: true, commit, nom: entree.nom };
	});
}

/**
 * Supprime la skill `nom` : les `.md` de son dossier et, pour une skill de la mémoire, son nom de la liste `skills_memoire`
 * des profils qui la listent ; un commit `mnemo: supprime <dossier>/<nom>/`. Refusée pour une skill fournie par Mnemo
 * (`motifSkillFournie`).
 */
export async function supprimerSkill(dep: Dependances, nom: string, profil: PorteeSkill = null): Promise<ResultatSkill> {
	const trouvee = await trouver(dep, nom, profil);
	if (trouvee === null) return INTROUVABLE;
	const { lieu } = trouvee;
	const fixe = motifFixeDe(lieu, nom);
	if (fixe !== null) return { ok: false, motifs: { nom: fixe } };
	return ecrire(dep, async () => {
		if ((await texteDe(dep, lieu, nom)) === null) return INTROUVABLE;
		const dossier = dossierDe(lieu, nom);
		const profils = lieu.profil === null ? await profilsASuivre(dep, nom, null) : [];
		const commit = await ecrireEtCommiter(dep, profils, `mnemo: supprime ${dossier}/`, await fichiersDuDossier(dep, dossier));
		await dep.coffre.retirerDossierVide(dossier);
		return { ok: true, commit, nom };
	});
}

/**
 * Réécrit la skill `nom` avec sa version fournie par Mnemo ; refusée pour une skill que Mnemo ne fournit pas. Un commit
 * `mnemo: retablit <dossier>/<nom>/SKILL.md`, aucun si elle est déjà d'origine.
 */
export async function revenirALOrigine(dep: Dependances, nom: string, profil: PorteeSkill = null): Promise<ResultatSkill> {
	const trouvee = await trouver(dep, nom, profil);
	if (trouvee === null) return INTROUVABLE;
	const { lieu } = trouvee;
	const fournie = fournieDe(lieu, nom);
	if (fournie === undefined) return { ok: false, motifs: { nom: `la skill « ${nom} » n'est pas fournie par Mnemo : pas de version d'origine` } };
	return ecrire(dep, async () => {
		const texte = await texteDe(dep, lieu, nom);
		if (texte === null) return INTROUVABLE;
		if (texte === fournie.texte) return { ok: true, commit: null, nom };
		const chemin = cheminDe(lieu, nom);
		return { ok: true, commit: await ecrireEtCommiter(dep, [{ chemin, texte: fournie.texte }], `mnemo: retablit ${chemin}`), nom };
	});
}
