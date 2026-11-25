import { DOSSIERS_FIXES, PROFIL_ARCHIVISTE, PROFIL_TRAVAIL } from '@mnemo/commun';
import { lireFiche } from '../domaine/fiche.ts';
import { estNomDeProfil, lanceurPropreSansChemin, moteurOuModeleInvalides, estConsigneParDefaut, lireProfil as profilDeFiche, MOTIF_LANCEUR_PROPRE, MOTIF_NOM_DE_PROFIL, PROFILS_PAR_DEFAUT } from '../domaine/profil.ts';
import type { Fiche } from '../domaine/fiche.ts';
import type { Profil } from '../domaine/profil.ts';
import { commiter, sousVerrou } from './commun.ts';
import { anciennesConsignes, CONSIGNE_ARCHIVISTE_PAR_DEFAUT, CONSIGNE_TRAVAIL_PAR_DEFAUT, PHRASE_RELATIONS } from './consignes-par-defaut.ts';
import type { Dependances } from './ports.ts';

export { CONSIGNE_ARCHIVISTE_PAR_DEFAUT, CONSIGNE_TRAVAIL_PAR_DEFAUT, PHRASE_RELATIONS };

export const CHEMIN_PROFIL_TRAVAIL = `${DOSSIERS_FIXES.profils}/${PROFIL_TRAVAIL}/${PROFIL_TRAVAIL}.md`;
export const TITRE_PROFIL_TRAVAIL = 'Profil travail';

/** Nom de profil retenu : `nom` s'il est sûr (`estNomDeProfil`), sinon `PROFIL_TRAVAIL`. */
export const nomDeProfil = (nom: string): string => (estNomDeProfil(nom) ? nom : PROFIL_TRAVAIL);

/** Chemin de la fiche d'un profil ; un nom invalide désigne le profil `travail`. */
export const cheminDeProfil = (nom: string): string => `${DOSSIERS_FIXES.profils}/${nomDeProfil(nom)}/${nomDeProfil(nom)}.md`;

/**
 * Consigne du profil `nom` : synthèse de sa fiche de type `profil`. Ne lève jamais : fiche absente, illisible ou d'un autre
 * type, synthèse vide ou égale à une consigne par défaut (`parDefaut` ou une ancienne) → `parDefaut`.
 */
export async function lireProfil(dep: Dependances, nom: string, parDefaut: string): Promise<string> {
	try {
		const texte = await dep.coffre.lire(cheminDeProfil(nom));
		if (texte === null) return parDefaut;
		const fiche = lireFiche(cheminDeProfil(nom), texte);
		if (fiche.type !== 'profil') return parDefaut;
		return estConsigneParDefaut(fiche.synthese, [parDefaut, ...anciennesConsignes(nom)]) ? parDefaut : fiche.synthese;
	} catch {
		return parDefaut;
	}
}

/** Une skill déposée par défaut dans `profils/<profil>/skills/<nom>/SKILL.md`. */
export type SkillParDefaut = { nom: string; texte: string };

const skill = (nom: string, description: string, corps: string[]): SkillParDefaut => ({
	nom,
	texte: `---\nname: ${nom}\ndescription: ${description}\n---\n\n${corps.join('\n')}\n`,
});

const FIN_DE_SOURCE =
	'Pour finir : `proposer` genre `modification` avec `traitee: true` sur la fiche source. La réponse liste les fiches qui la citent ; une source riche qui n\'en touche qu\'une est suspecte : reprends la répartition.';
const CONDENSE =
	'un seul condensé : un document Markdown écrit à côté de l\'original, référencé par `extraire_source`, qui garde la liste complète des points à suivre ; les fiches y renvoient au lieu de la recopier.';

/**
 * Skills déposées au premier lancement d'un profil si elles manquent ; ensuite, réécrites seulement tant qu'elles restent
 * une version par défaut passée (`ANCIENNES_SKILLS`) : l'utilisateur et les agents les modifient comme toute fiche, et une
 * skill modifiée n'est plus touchée. Pour l'archiviste : une par type de source, et le ménage de la mémoire.
 */
export const SKILLS_PAR_DEFAUT: Record<string, readonly SkillParDefaut[]> = {
	archiviste: [
		skill('emails', 'Ranger un email ou un fil d\'emails (.eml, .mbox) dans la mémoire Mnemo.', [
			'1. `extraire_source` sur le fichier, avec `type` `email`. Un `.mbox` donne une fiche par fil. La réponse nomme les fiches existantes que les messages citent.',
			'2. Lis chaque fil : qui écrit, à qui, quand, à propos de quel projet ou client.',
			'3. Ne garde que ce qui dure : décisions, engagements, montants, échéances, coordonnées, rôles. Laisse les politesses et le texte cité.',
			'4. Répartis par destination, pas seulement dans le projet : projet (décisions, demandes), métier du client (vocabulaire, processus), organisation (qui fait quoi, circuits de validation), personnes (rôle, contraintes, préférences, coordonnées ; crée la fiche d\'un interlocuteur qui revient), produit (pistes réutilisables), pratiques (leçons générales).',
			'5. Pour chaque information, `chercher` d\'abord, puis `proposer` avec la citation exacte et la source du fil.',
			`6. Un long fil qui porte des points à suivre : ${CONDENSE}`,
			'7. Une pièce jointe utile a sa propre fiche source : traite-la avec la skill de son type.',
			`8. ${FIN_DE_SOURCE}`,
		]),
		skill('specs', 'Ranger une spécification, un cahier des charges ou un document de conception dans la mémoire Mnemo.', [
			'1. `extraire_source` sur le document ; `type` `spec_validee` seulement si l\'utilisateur confirme qu\'elle est validée. La réponse nomme les fiches existantes que le document cite.',
			'2. Repère le projet et le module concernés ; range la fiche du projet dans l\'arbre s\'il le faut.',
			'3. Extrais le périmètre, les exigences, les choix techniques et les échéances, une information par ligne, chacune avec sa citation.',
			'4. Puis ce que le document apprend hors du projet : vocabulaire et processus du métier du client (une fiche de métier s\'il n\'y en a pas), organisation et rôles, personnes citées (crée la fiche de celles qui comptent), pistes produit réutilisables, pratiques.',
			'5. Une nouvelle version d\'une spec : passe la fiche source de la précédente dans `version_de`, et signale ce qui change.',
			`6. ${FIN_DE_SOURCE}`,
		]),
		skill('comptes-rendus', 'Ranger un compte rendu de réunion ou une transcription dans la mémoire Mnemo.', [
			'1. `extraire_source` sur le compte rendu ou la transcription, avec `type` `compte_rendu`. La réponse nomme les fiches existantes que la réunion cite.',
			'2. Note la date, les participants (fiches de personnes, alias compris ; crée celle d\'un participant qui compte) et les projets abordés.',
			'3. Projet : les décisions, les actions (qui, quoi, pour quand) et les points ouverts, chacun avec sa citation.',
			'4. Puis une passe par autre destination. Métier du client : termes, étapes d\'un processus (une fiche de métier s\'il n\'y en a pas). Organisation : qui fait quoi, comment ils travaillent. Personnes : rôle, contraintes, préférences exprimées. Produit : pistes réutilisables ailleurs. Pratiques : leçons de méthode. Demande-toi ce que la réunion apprend hors de son sujet.',
			`5. Une transcription ou une longue réunion : ${CONDENSE}`,
			'6. Une décision qui en contredit une plus ancienne : propose-la avec `remplace` et signale la contradiction.',
			`7. ${FIN_DE_SOURCE}`,
		]),
		skill('menage', 'Faire le ménage dans la mémoire Mnemo : doublons, fiches inutiles, liens cassés ou faux, fiches mal nommées.', [
			'1. Si la mémoire a une fiche de ménage (« Ménage de la mémoire »), lis-la d\'abord pour t\'en aider : elle dit ce que l\'utilisateur veut garder, fusionner ou retirer.',
			'2. Commence le ménage par `diagnostiquer` : liens cassés, doublons probables, fiches isolées ou mal nommées, chemins et ancres. Puis repère ce qui cite une fiche : `chercher` signale les copies, `voisins` montre les liens entrants.',
			'3. Deux fiches qui décrivent la même chose : `entretenir`, action `fusionner`, la moins complète `dans` l\'autre. Informations, sections, relations et alias sont versés, les liens réécrits, la fiche absorbée supprimée.',
			'4. Une fiche inutile : `entretenir`, action `supprimer`. Si d\'autres fiches la citent, le refus les liste : donne une `redirection` vers la fiche qui la remplace, ou corrige ces liens d\'abord. Une note importée de Claude Code (propriété `origine` en `claude-code/…`) supprimée sans `redirection` revient au prochain import tant qu\'elle existe dans Claude Code : donne une `redirection` (ou fusionne-la) ; l\'import la tient alors pour connue tant qu\'elle ne change pas.',
			'5. Un lien cassé ou faux (dans une source aussi) : `entretenir`, action `corriger_lien`, `ancien` → `nouveau` ; sans `nouveau`, le lien perd ses crochets.',
			'6. Une fiche mal nommée ou mal rangée : `deplacer` (`nom` pour renommer) ; les liens suivent.',
			'7. Les informations barrées restent : elles gardent l\'historique.',
			'8. Une fiche temporaire ou une information périmée (rubrique `perimees` de `diagnostiquer`) : supprime la fiche (`entretenir`, action `supprimer`) ou barre l\'information, sauf si elle reste vraie : prolonge alors `perime_le` (`proposer`, genre `modification`). Dans le doute, demande à l\'utilisateur.',
			'9. Plusieurs suppressions, fusions ou confirmations d\'informations : propose un lot (`entretenir`, action `proposer_lot`) que l\'utilisateur valide dans « À arbitrer », au lieu de les lui demander une par une. Une information faible : `corroborer` avec une seconde source ; une fiche de plus de 40 informations : `deplacer_informations`. Une faute de frappe, un nom mal écrit, une catégorie à reprendre (hors catégories à fort enjeu comme `montant`) : `retoucher_information` ; pour changer le sens d\'une information, `proposer` avec `remplace`.',
			'10. Dis à l\'utilisateur ce que tu as fusionné ou supprimé : chaque action est un commit, que git peut défaire.',
		]),
	],
};

/**
 * Skills par défaut des versions passées, par profil : une skill dont le texte est l'une d'elles n'a jamais été modifiée, et
 * `deposerSkillsParDefaut` la remplace par la version actuelle. Quand une skill par défaut change, l'ancienne s'ajoute ici
 * (le test d'empreinte de `plugin.test.ts` le rappelle).
 */
export const ANCIENNES_SKILLS: Record<string, readonly SkillParDefaut[]> = {
	archiviste: [
		// « fait » avant « information » (e1fa7ed)
		skill('emails', 'Ranger un email ou un fil d\'emails (.eml, .mbox) dans la mémoire Mnemo.', [
			'1. `extraire_source` sur le fichier, avec `type` `email`. Un `.mbox` donne une fiche par fil.',
			'2. Lis chaque fil : qui écrit, à qui, quand, à propos de quel projet ou client.',
			'3. Ne garde que ce qui dure : décisions, engagements, montants, échéances, coordonnées, rôles. Laisse les politesses et le texte cité.',
			'4. Pour chaque fait, `chercher` d\'abord, puis `proposer` avec la citation exacte et la source du fil.',
			'5. Une pièce jointe utile a sa propre fiche source : traite-la avec la skill de son type.',
		]),
		skill('specs', 'Ranger une spécification, un cahier des charges ou un document de conception dans la mémoire Mnemo.', [
			'1. `extraire_source` sur le document ; `type` `spec_validee` seulement si l\'utilisateur confirme qu\'elle est validée.',
			'2. Repère le projet et le module concernés ; range la fiche du projet dans l\'arbre s\'il le faut.',
			'3. Extrais le périmètre, les exigences, les choix techniques et les échéances, un fait par ligne, chacun avec sa citation.',
			'4. Une nouvelle version d\'une spec : passe la fiche source de la précédente dans `version_de`, et signale ce qui change.',
		]),
		// avant `diagnostiquer` et `proposer_lot` (chantier « entretien des informations »)
		skill('menage', 'Faire le ménage dans la mémoire Mnemo : doublons, fiches inutiles, liens cassés ou faux, fiches mal nommées.', [
			'1. Si la mémoire a une fiche de ménage (« Ménage de la mémoire »), lis-la d\'abord pour t\'en aider : elle dit ce que l\'utilisateur veut garder, fusionner ou retirer.',
			'2. Repère les doublons et ce qui cite une fiche : `chercher` signale les copies, `voisins` montre les liens entrants.',
			'3. Deux fiches qui décrivent la même chose : `entretenir`, action `fusionner`, la moins complète `dans` l\'autre. Informations, sections, relations et alias sont versés, les liens réécrits, la fiche absorbée supprimée.',
			'4. Une fiche inutile : `entretenir`, action `supprimer`. Si d\'autres fiches la citent, le refus les liste : donne une `redirection` vers la fiche qui la remplace, ou corrige ces liens d\'abord. Une note importée de Claude Code (propriété `origine` en `claude-code/…`) supprimée sans `redirection` revient au prochain import tant qu\'elle existe dans Claude Code : donne une `redirection` (ou fusionne-la) ; l\'import la tient alors pour connue tant qu\'elle ne change pas.',
			'5. Un lien cassé ou faux (dans une source aussi) : `entretenir`, action `corriger_lien`, `ancien` → `nouveau` ; sans `nouveau`, le lien perd ses crochets.',
			'6. Une fiche mal nommée ou mal rangée : `deplacer` (`nom` pour renommer) ; les liens suivent.',
			'7. Les informations barrées restent : elles gardent l\'historique.',
			'8. Dis à l\'utilisateur ce que tu as fusionné ou supprimé : chaque action est un commit, que git peut défaire.',
		]),
		// avant la répartition d'une source par destination (chantier « écriture de la mémoire »)
		skill('emails', 'Ranger un email ou un fil d\'emails (.eml, .mbox) dans la mémoire Mnemo.', [
			'1. `extraire_source` sur le fichier, avec `type` `email`. Un `.mbox` donne une fiche par fil.',
			'2. Lis chaque fil : qui écrit, à qui, quand, à propos de quel projet ou client.',
			'3. Ne garde que ce qui dure : décisions, engagements, montants, échéances, coordonnées, rôles. Laisse les politesses et le texte cité.',
			'4. Pour chaque information, `chercher` d\'abord, puis `proposer` avec la citation exacte et la source du fil.',
			'5. Une pièce jointe utile a sa propre fiche source : traite-la avec la skill de son type.',
		]),
		skill('specs', 'Ranger une spécification, un cahier des charges ou un document de conception dans la mémoire Mnemo.', [
			'1. `extraire_source` sur le document ; `type` `spec_validee` seulement si l\'utilisateur confirme qu\'elle est validée.',
			'2. Repère le projet et le module concernés ; range la fiche du projet dans l\'arbre s\'il le faut.',
			'3. Extrais le périmètre, les exigences, les choix techniques et les échéances, une information par ligne, chacune avec sa citation.',
			'4. Une nouvelle version d\'une spec : passe la fiche source de la précédente dans `version_de`, et signale ce qui change.',
		]),
		skill('comptes-rendus', 'Ranger un compte rendu de réunion dans la mémoire Mnemo.', [
			'1. `extraire_source` sur le compte rendu, avec `type` `compte_rendu`.',
			'2. Note la date, les participants (fiches de personnes, alias compris) et les projets abordés.',
			'3. Extrais les décisions, les actions (qui, quoi, pour quand) et les points ouverts, chacun avec sa citation.',
			'4. Une décision qui en contredit une plus ancienne : propose-la avec `remplace` et signale la contradiction.',
		]),
		// avant les fiches temporaires (`perime_le`)
		skill('menage', 'Faire le ménage dans la mémoire Mnemo : doublons, fiches inutiles, liens cassés ou faux, fiches mal nommées.', [
			'1. Si la mémoire a une fiche de ménage (« Ménage de la mémoire »), lis-la d\'abord pour t\'en aider : elle dit ce que l\'utilisateur veut garder, fusionner ou retirer.',
			'2. Commence le ménage par `diagnostiquer` : liens cassés, doublons probables, fiches isolées ou mal nommées, chemins et ancres. Puis repère ce qui cite une fiche : `chercher` signale les copies, `voisins` montre les liens entrants.',
			'3. Deux fiches qui décrivent la même chose : `entretenir`, action `fusionner`, la moins complète `dans` l\'autre. Informations, sections, relations et alias sont versés, les liens réécrits, la fiche absorbée supprimée.',
			'4. Une fiche inutile : `entretenir`, action `supprimer`. Si d\'autres fiches la citent, le refus les liste : donne une `redirection` vers la fiche qui la remplace, ou corrige ces liens d\'abord. Une note importée de Claude Code (propriété `origine` en `claude-code/…`) supprimée sans `redirection` revient au prochain import tant qu\'elle existe dans Claude Code : donne une `redirection` (ou fusionne-la) ; l\'import la tient alors pour connue tant qu\'elle ne change pas.',
			'5. Un lien cassé ou faux (dans une source aussi) : `entretenir`, action `corriger_lien`, `ancien` → `nouveau` ; sans `nouveau`, le lien perd ses crochets.',
			'6. Une fiche mal nommée ou mal rangée : `deplacer` (`nom` pour renommer) ; les liens suivent.',
			'7. Les informations barrées restent : elles gardent l\'historique.',
			'8. Plusieurs suppressions, fusions ou confirmations d\'informations : propose un lot (`entretenir`, action `proposer_lot`) que l\'utilisateur valide dans « À arbitrer », au lieu de les lui demander une par une. Une information faible : `corroborer` avec une seconde source ; une fiche de plus de 40 informations : `deplacer_informations`. Une faute de frappe, un nom mal écrit, une catégorie à reprendre (hors catégories à fort enjeu comme `montant`) : `retoucher_information` ; pour changer le sens d\'une information, `proposer` avec `remplace`.',
			'9. Dis à l\'utilisateur ce que tu as fusionné ou supprimé : chaque action est un commit, que git peut défaire.',
		]),
	],
};

/** Dossier des skills d'un profil, relatif à la mémoire. */
export const dossierSkillsDuProfil = (nom: string): string => `${DOSSIERS_FIXES.profils}/${nomDeProfil(nom)}/${DOSSIERS_FIXES.skills}`;

/**
 * Dépose les skills par défaut du profil `nom` qui manquent, et remplace celles restées une version par défaut passée (un
 * commit, sous verrou) ; rend le commit, ou null si rien n'a été écrit. Une skill modifiée n'est jamais réécrite.
 */
export async function deposerSkillsParDefaut(dep: Dependances, nom: string): Promise<string | null> {
	const skills = SKILLS_PAR_DEFAUT[nom] ?? [];
	const anciennes = ANCIENNES_SKILLS[nom] ?? [];
	const chemin = (s: SkillParDefaut) => `${dossierSkillsDuProfil(nom)}/${s.nom}/SKILL.md`;
	const aEcrire = async () => {
		const resultat: SkillParDefaut[] = [];
		for (const s of skills) {
			const actuel = await dep.coffre.lire(chemin(s));
			if (actuel === null || (actuel !== s.texte && anciennes.some((a) => a.nom === s.nom && a.texte === actuel))) resultat.push(s);
		}
		return resultat;
	};
	if ((await aEcrire()).length === 0) return null;
	return sousVerrou(dep, async () => {
		const liste = await aEcrire();
		if (liste.length === 0) return null;
		for (const s of liste) await dep.coffre.ecrire(chemin(s), s.texte);
		return commiter(dep, `mnemo: skills par défaut ${dossierSkillsDuProfil(nom)}`, liste.map(chemin));
	});
}

/** Valeurs par défaut d'un profil : celles du paquet pour `travail` et `archiviste`, celles de `travail` pour un autre nom. */
export function profilParDefaut(nom: string): Profil {
	if (nom === PROFIL_ARCHIVISTE) return profilDeFiche(null, { ...PROFILS_PAR_DEFAUT[PROFIL_ARCHIVISTE], consigne: CONSIGNE_ARCHIVISTE_PAR_DEFAUT }, []);
	return profilDeFiche(null, { ...PROFILS_PAR_DEFAUT[PROFIL_TRAVAIL], nom, consigne: CONSIGNE_TRAVAIL_PAR_DEFAUT }, []);
}

/**
 * Profil `nom` lu dans `profils/<nom>/<nom>.md`. Ne lève jamais : fiche absente ou illisible → valeurs par défaut ; nom
 * invalide (hors `estNomDeProfil`) → profil `travail`.
 */
export async function chargerProfil(dep: Dependances, brut: string): Promise<Profil> {
	const nom = nomDeProfil(brut);
	const parDefaut = profilParDefaut(nom);
	try {
		return profilDeFiche(await ficheDeProfil(dep, nom), parDefaut, [parDefaut.consigne, ...anciennesConsignes(nom)]);
	} catch {
		return parDefaut;
	}
}

async function ficheDeProfil(dep: Dependances, nom: string): Promise<Fiche | null> {
	const texte = await dep.coffre.lire(cheminDeProfil(nom));
	return texte === null ? null : lireFiche(cheminDeProfil(nom), texte);
}

/**
 * Un profil qui peut être lancé : `description`, première ligne de sa consigne ; `lancement` : dans le dossier choisi ou
 * dans la mémoire ; `lanceur` : par le dialogue Nouvelle session ou par son propre chemin ; `avatar` ; `personnalise` : sa
 * consigne remplace celle par défaut ; `moteur` et `modele` (« » : celui par défaut du moteur) de ses sessions.
 */
export type ProfilDisponible = { nom: string; description: string; lancement: Profil['lancement']; lanceur: Profil['lanceur']; avatar: Profil['avatar']; personnalise: boolean; moteur: Profil['moteur']; modele: string };

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
		profils.push({ nom, description: profil.consigne.split('\n')[0]!.trim(), lancement: profil.lancement, lanceur: profil.lanceur, avatar: profil.avatar, personnalise: profil.consignePersonnalisee, moteur: profil.moteur, modele: profil.modele });
		const fiche = await ficheDeProfil(dep, nom).catch(() => null);
		if (lanceurPropreSansChemin(fiche, profilParDefaut(nom))) avertissements.push({ nom, motif: MOTIF_LANCEUR_PROPRE });
		for (const motif of moteurOuModeleInvalides(fiche)) avertissements.push({ nom, motif });
	}
	return { profils, ignores: dossiers.filter((nom) => !estNomDeProfil(nom)).map((nom) => ({ nom, motif: MOTIF_NOM_DE_PROFIL })), avertissements };
}
