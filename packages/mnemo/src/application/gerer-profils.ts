// Gestion des profils par l'utilisateur (interface, route HTTP) : détail éditable, enregistrement, duplication, suppression.
import type { Avatar, IdMoteur } from '@mnemo/commun';
import { COULEURS_AVATAR, DOSSIERS_FIXES, estIdMoteur, estModele, FORMES_AVATAR, IDS_MOTEURS, MODELE_MAX, MOTEUR_PAR_DEFAUT, PROFIL_ARCHIVISTE, PROFIL_TRAVAIL } from '@mnemo/commun';
import { empreinte } from '../domaine/empreinte.ts';
import { lireFiche } from '../domaine/fiche.ts';
import type { Fiche } from '../domaine/fiche.ts';
import { CLES_GEREES_DU_PROFIL, donneesDeProfil, estConsigneParDefaut, estIdentifiantDePlugin, estNomDeProfil, EVENEMENTS_HOOK, moteurOuModeleInvalides, MOTIF_NOM_DE_PROFIL, PROFILS_PAR_DEFAUT, refusDuMoteur } from '../domaine/profil.ts';
import type { Profil } from '../domaine/profil.ts';
import { lireSkill } from '../domaine/skill.ts';
import type { EvenementHook } from '../domaine/session.ts';
import { commiter, ecrireEtCommiter, ecrireOuDefaire, ficheVide, sousVerrou, texteDeFiche } from './commun.ts';
import { anciennesConsignes } from './consignes-par-defaut.ts';
import type { Dependances, PluginInstalle, SkillInstallee } from './ports.ts';
import { chargerProfil, cheminDeProfil, dossierSkillsDuProfil, profilParDefaut } from './profil.ts';
import { origineDeSkill, textePresente } from './gerer-skills.ts';
import { reindexerApresEcriture } from './synchroniser.ts';

/**
 * Ce que l'utilisateur règle d'un profil. `consigne` : `null` = la consigne par défaut du code ; `modele` : « » = le modèle par
 * défaut du moteur ; `plugins` : vide pour un autre moteur que Claude Code.
 */
export type ProfilEditable = {
	avatar: Avatar;
	consigne: string | null;
	lancement: 'projet' | 'memoire';
	hooks: EvenementHook[];
	skillsMemoire: 'tous' | string[];
	plugins: string[];
	moteur: IdMoteur;
	modele: string;
};

/**
 * Ce qu'un enregistrement reçoit : `ProfilEditable`, avec `moteur` et `modele` facultatifs (client d'avant les moteurs) ; absents,
 * les valeurs déjà écrites dans la fiche sont gardées telles quelles.
 */
export type ProfilEntree = Omit<ProfilEditable, 'moteur' | 'modele'> & { moteur?: IdMoteur; modele?: string };

/**
 * Détail d'un profil pour son éditeur. `empreinte` : celle du texte de la fiche lue (null : fiche absente), à renvoyer à
 * l'enregistrement pour détecter une modification faite entre-temps.
 */
export type DetailProfil = {
	nom: string;
	editable: ProfilEditable;
	consigneEffective: string;
	consigneParDefaut: string;
	supprimable: boolean;
	lancementModifiable: boolean;
	empreinte: string | null;
	skillsMemoireDisponibles: SkillInstallee[];
	skillsDuProfil: SkillInstallee[];
	pluginsInstalles: PluginInstalle[];
	avertissements: string[];
};

/** Issue d'une écriture : `commit` null quand il n'y avait rien à changer ; `motifs` : un motif par champ refusé. */
export type ResultatProfil = { ok: true; commit: string | null } | { ok: false; conflit: true } | { ok: false; motifs: Record<string, string> };

const PROFILS_DU_PAQUET: readonly string[] = [PROFIL_TRAVAIL, PROFIL_ARCHIVISTE];

const dossierDuProfil = (nom: string): string => `${DOSSIERS_FIXES.profils}/${nom}`;

/** Le profil existe : un profil du paquet, ou un dossier de `profils/` à son nom. */
async function existe(dep: Dependances, nom: string): Promise<boolean> {
	if (PROFILS_DU_PAQUET.includes(nom)) return true;
	return (await dep.coffre.lister(DOSSIERS_FIXES.profils)).dossiers.includes(dossierDuProfil(nom));
}

/**
 * Skills d'un dossier, celui de la mémoire (`profil` null) ou celui du profil `profil` : chaque sous-dossier qui contient un
 * `SKILL.md` (nom = dossier, description et icône du frontmatter ; frontmatter illisible : la skill reste listée par son nom),
 * avec son `origine` (`origineDeSkill`) : toutes s'éditent depuis Réglages (`gerer-skills.ts`). Une skill restée une version
 * fournie passée est lue dans sa version actuelle (`textePresente`).
 */
async function skillsDuDossier(dep: Dependances, dossier: string, profil: string | null): Promise<SkillInstallee[]> {
	const resultat: SkillInstallee[] = [];
	for (const sous of (await dep.coffre.lister(dossier)).dossiers) {
		const texte = await dep.coffre.lire(`${sous}/SKILL.md`);
		if (texte === null) continue;
		const nom = sous.slice(sous.lastIndexOf('/') + 1);
		const { description, icone } = lireSkill(textePresente(profil, nom, texte));
		resultat.push({ nom, description, ...(icone === null ? {} : { icone }), origine: origineDeSkill(profil, nom) });
	}
	return resultat;
}

const editableDe = (p: Profil): ProfilEditable => ({
	avatar: { ...p.avatar },
	consigne: p.consignePersonnalisee ? p.consigne : null,
	lancement: p.lancement,
	hooks: [...p.hooks],
	skillsMemoire: p.skillsMemoire === 'tous' ? 'tous' : [...p.skillsMemoire],
	plugins: [...p.plugins],
	moteur: p.moteur,
	modele: p.modele,
});

/** Détail éditable du profil `nom` ; null s'il n'est ni un profil du paquet ni un dossier de `profils/`. */
export async function detailProfil(dep: Dependances, nom: string): Promise<DetailProfil | null> {
	if (!estNomDeProfil(nom) || !(await existe(dep, nom))) return null;
	const profil = await chargerProfil(dep, nom);
	const texte = await dep.coffre.lire(cheminDeProfil(nom));
	const { plugins, avertissements: desPlugins } = await dep.pluginsClaude.installes();
	let avertissements = desPlugins;
	try {
		if (texte !== null) avertissements = [...moteurOuModeleInvalides(lireFiche(cheminDeProfil(nom), texte)), ...desPlugins];
	} catch {
		// fiche illisible : chargerProfil a déjà rendu les valeurs par défaut
	}
	return {
		nom,
		editable: editableDe(profil),
		consigneEffective: profil.consigne,
		consigneParDefaut: profilParDefaut(nom).consigne,
		supprimable: !PROFILS_DU_PAQUET.includes(nom),
		lancementModifiable: nom !== PROFIL_ARCHIVISTE,
		empreinte: texte === null ? null : empreinte(texte),
		skillsMemoireDisponibles: await skillsDuDossier(dep, DOSSIERS_FIXES.skills, null),
		skillsDuProfil: await skillsDuDossier(dep, dossierSkillsDuProfil(nom), nom),
		pluginsInstalles: plugins,
		avertissements,
	};
}

const sansDoublons = <T>(liste: readonly T[]): T[] => [...new Set(liste)];

/** Motifs de refus de `editable`, par champ ; vide s'il est valide. */
async function motifsDe(dep: Dependances, nom: string, editable: ProfilEditable): Promise<Record<string, string>> {
	const motifs: Record<string, string> = {};
	if (!estNomDeProfil(nom)) motifs.nom = MOTIF_NOM_DE_PROFIL;
	const { forme, couleur } = editable.avatar ?? {};
	if (!(FORMES_AVATAR as readonly unknown[]).includes(forme) || !(COULEURS_AVATAR as readonly unknown[]).includes(couleur)) motifs.avatar = 'avatar inconnu : une forme et une couleur de la liste';
	if (editable.lancement !== 'projet' && editable.lancement !== 'memoire') motifs.lancement = 'lancement attendu : « projet » ou « memoire »';
	else if (nom === PROFIL_ARCHIVISTE && editable.lancement !== PROFILS_PAR_DEFAUT[PROFIL_ARCHIVISTE].lancement) motifs.lancement = 'le lancement de l\'archiviste ne se modifie pas';
	if (!Array.isArray(editable.hooks) || editable.hooks.length === 0 || !editable.hooks.every((h) => EVENEMENTS_HOOK.includes(h))) motifs.hooks = 'au moins un événement, parmi ceux de Mnemo';
	if (editable.skillsMemoire !== 'tous') {
		const disponibles = new Set((await skillsDuDossier(dep, DOSSIERS_FIXES.skills, null)).map((s) => s.nom));
		const inconnues = Array.isArray(editable.skillsMemoire) ? editable.skillsMemoire.filter((s) => !disponibles.has(s)) : ['?'];
		if (inconnues.length > 0) motifs.skillsMemoire = `skills inconnues dans ${DOSSIERS_FIXES.skills}/ : ${inconnues.join(', ')}`;
	}
	const malFormes = Array.isArray(editable.plugins) ? editable.plugins.filter((p) => typeof p !== 'string' || !estIdentifiantDePlugin(p)) : ['?'];
	if (malFormes.length > 0) motifs.plugins = `identifiants de plugin mal formés (attendu nom@marketplace) : ${malFormes.join(', ')}`;
	if (!estIdMoteur(editable.moteur)) motifs.moteur = `moteur inconnu : ${IDS_MOTEURS.map((m) => `« ${m} »`).join(' ou ')} attendu`;
	else if (Array.isArray(editable.plugins)) {
		const refus = refusDuMoteur({ nom, moteur: editable.moteur, plugins: editable.plugins });
		if (refus !== null && motifs[refus.champ] === undefined) motifs[refus.champ] = refus.motif;
	}
	if (!estModele(editable.modele)) motifs.modele = `modèle refusé : vide (celui par défaut du moteur) ou un nom de ${MODELE_MAX} caractères au plus, en lettres et chiffres ASCII et « . _ : / @ + [ ] - », commençant par une lettre ou un chiffre`;
	if (editable.consigne !== null && typeof editable.consigne !== 'string') motifs.consigne = 'consigne attendue : un texte, ou null pour celle par défaut';
	return motifs;
}

/**
 * Fiche à écrire : celle du disque (sections et clés non gérées gardées) ou une fiche neuve, avec les clés gérées réécrites ;
 * les clés de `gardees` reprennent la valeur de la fiche du disque telle quelle (absente : retirée).
 */
function ficheAEcrire(dep: Dependances, nom: string, existante: Fiche | null, editable: ProfilEditable, gardees: readonly ('moteur' | 'modele')[] = []): Fiche {
	const fiche = existante ?? ficheVide(dep, cheminDeProfil(nom), 'profil', `Profil ${nom}`);
	const parDefaut = profilParDefaut(nom);
	const profil: Profil = {
		...parDefaut,
		avatar: { ...editable.avatar },
		lancement: editable.lancement,
		hooks: EVENEMENTS_HOOK.filter((e) => editable.hooks.includes(e)),
		skillsMemoire: editable.skillsMemoire === 'tous' ? 'tous' : sansDoublons(editable.skillsMemoire),
		plugins: sansDoublons(editable.plugins),
		moteur: editable.moteur,
		modele: editable.modele,
	};
	const donnees = { ...fiche.donnees };
	for (const cle of CLES_GEREES_DU_PROFIL) delete donnees[cle];
	const nouvelles = donneesDeProfil(profil);
	for (const cle of gardees) {
		delete nouvelles[cle];
		if (existante !== null && existante.donnees[cle] !== undefined) nouvelles[cle] = existante.donnees[cle];
	}
	fiche.donnees = { ...donnees, ...nouvelles };
	const consigne = editable.consigne ?? '';
	// une consigne égale à celle par défaut (actuelle ou ancienne) reste « par défaut » : synthèse vide
	fiche.synthese = estConsigneParDefaut(consigne, [parDefaut.consigne, ...anciennesConsignes(nom)]) ? '' : consigne;
	return fiche;
}

/**
 * Enregistre le profil `nom` (le crée si sa fiche manque). Refusé en bloc si un champ est invalide (`motifs`), ou en conflit si
 * la fiche sur disque n'a plus l'empreinte `empreinteLue` (null : elle ne devait pas exister). `moteur` ou `modele` absents :
 * ceux de la fiche sont gardés tels quels (jamais remis à Claude Code ni à vide). Un commit
 * `mnemo: profil profils/<nom>/<nom>.md`, puis l'index est remis à jour.
 */
export async function enregistrerProfil(dep: Dependances, nom: string, entree: ProfilEntree, empreinteLue: string | null): Promise<ResultatProfil> {
	const gardees = (['moteur', 'modele'] as const).filter((cle) => entree[cle] === undefined);
	// valeurs enregistrées, pour valider le reste (les plugins dépendent du moteur) ; la fiche relue sous verrou fait foi
	const enregistre = gardees.length > 0 ? await chargerProfil(dep, nom) : null;
	const editable: ProfilEditable = { ...entree, moteur: entree.moteur ?? enregistre?.moteur ?? MOTEUR_PAR_DEFAUT, modele: entree.modele ?? enregistre?.modele ?? '' };
	const motifs = await motifsDe(dep, nom, editable);
	if (Object.keys(motifs).length > 0) return { ok: false, motifs };
	const chemin = cheminDeProfil(nom);
	const resultat = await sousVerrou(dep, async (): Promise<ResultatProfil> => {
		const texte = await dep.coffre.lire(chemin);
		if ((texte === null ? null : empreinte(texte)) !== empreinteLue) return { ok: false, conflit: true };
		const fiche = ficheAEcrire(dep, nom, texte === null ? null : lireFiche(chemin, texte), editable, gardees);
		const nouveau = texteDeFiche(dep, fiche);
		if (nouveau === texte) return { ok: true, commit: null };
		return { ok: true, commit: await ecrireEtCommiter(dep, [{ chemin, texte: nouveau }], `mnemo: profil ${chemin}`) };
	});
	if (resultat.ok && resultat.commit !== null) await reindexerApresEcriture(dep);
	return resultat;
}

/**
 * Copie le profil `source` sous le nom `nouveau` : ses valeurs effectives (sa consigne comprise, qui devient la consigne de la
 * copie) et son dossier de skills entier (tous ses fichiers, `.md` ou non). Refusé si `nouveau` est invalide ou existe déjà,
 * ou si `source` n'existe pas. Un commit ; s'il échoue, la copie est retirée.
 */
export async function dupliquerProfil(dep: Dependances, source: string, nouveau: string): Promise<ResultatProfil> {
	if (!estNomDeProfil(nouveau)) return { ok: false, motifs: { nom: MOTIF_NOM_DE_PROFIL } };
	if (!estNomDeProfil(source) || !(await existe(dep, source))) return { ok: false, motifs: { source: `profil inconnu : « ${source} »` } };
	const profil = await chargerProfil(dep, source);
	const editable: ProfilEditable = { ...editableDe(profil), consigne: profil.consigne, lancement: profil.lancement };
	const resultat = await sousVerrou(dep, async (): Promise<ResultatProfil> => {
		if (await existe(dep, nouveau)) return { ok: false, motifs: { nom: `le profil « ${nouveau} » existe déjà` } };
		const fiche = ficheAEcrire(dep, nouveau, null, editable);
		const dossierSource = dossierSkillsDuProfil(source);
		const aCopier = (await dep.coffre.lister(dossierDuProfil(source))).dossiers.includes(dossierSource);
		const copie = dossierDuProfil(nouveau);
		const commit = await ecrireOuDefaire(
			dep,
			[],
			async () => {
				if (aCopier) await dep.coffre.copierDossier(dossierSource, dossierSkillsDuProfil(nouveau));
				await dep.coffre.ecrire(cheminDeProfil(nouveau), texteDeFiche(dep, fiche));
				return commiter(dep, `mnemo: profil ${cheminDeProfil(nouveau)} (copie de ${source})`, [copie]);
			},
			() => dep.coffre.retirerDossier(copie),
		);
		return { ok: true, commit };
	});
	if (resultat.ok) await reindexerApresEcriture(dep);
	return resultat;
}

/**
 * Supprime le profil `nom` : son dossier entier (`profils/<nom>/`, fiche, skills et tout autre fichier), un commit
 * `mnemo: supprime profils/<nom>/` (aucun si rien n'y était suivi par git) ; le dossier est mis de côté (caché, hors du commit)
 * jusqu'au commit, et rendu s'il échoue. Refusé pour `travail` et `archiviste`. Les sessions de ce profil se reprennent
 * ensuite avec les valeurs par défaut de `travail`.
 */
export async function supprimerProfil(dep: Dependances, nom: string): Promise<ResultatProfil> {
	if (PROFILS_DU_PAQUET.includes(nom)) return { ok: false, motifs: { nom: `le profil « ${nom} » ne se supprime pas : rétablis ses valeurs par défaut` } };
	if (!estNomDeProfil(nom) || !(await existe(dep, nom))) return { ok: false, motifs: { nom: `profil inconnu : « ${nom} »` } };
	const dossier = dossierDuProfil(nom);
	const resultat = await sousVerrou(dep, async (): Promise<ResultatProfil> => {
		const deCote = `${DOSSIERS_FIXES.profils}/.mnemo-${dep.systeme.nouvelId()}.tmp`;
		await dep.coffre.deplacerDossier(dossier, deCote);
		const commit = await ecrireOuDefaire(
			dep,
			[],
			() => dep.historique.commit(`mnemo: supprime ${dossier}/`, [dossier], dep.origine?.session),
			() => dep.coffre.deplacerDossier(deCote, dossier),
		);
		await dep.coffre.retirerDossier(deCote);
		return { ok: true, commit };
	});
	if (resultat.ok && resultat.commit !== null) await reindexerApresEcriture(dep);
	return resultat;
}
