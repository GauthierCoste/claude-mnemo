import { parse } from 'yaml';
import { LANCEURS_DE_PROFIL, lireAvatar, PROFIL_ARCHIVISTE, PROFIL_TRAVAIL } from '@mnemo/commun';
import type { Avatar, LanceurDeProfil } from '@mnemo/commun';
import type { Fiche } from './fiche.ts';
import type { EvenementHook } from './session.ts';

/**
 * Un profil de session : ce qui distingue une session `travail` de l'archiviste. `consignePersonnalisee` : la synthèse de la
 * fiche remplace la consigne par défaut du code (`estConsigneParDefaut`) ; `lancement` : dossier de lancement (`projet` : le
 * projet choisi ; `memoire` : `_mnemo/`, la racine ajoutée par `--add-dir`) ; `lanceur` : qui le lance (`LANCEURS_DE_PROFIL`) ;
 * `skillsMemoire` : skills de `_mnemo/skills/` retenues (`tous`, ou leurs noms) ; `plugins` : identifiants `nom@marketplace`
 * des plugins Claude Code activés ; `avatar` : forme et couleur affichées dans l'interface.
 */
export type Profil = {
	nom: string;
	consigne: string;
	consignePersonnalisee: boolean;
	lancement: 'projet' | 'memoire';
	lanceur: LanceurDeProfil;
	hooks: EvenementHook[];
	skillsMemoire: 'tous' | string[];
	plugins: string[];
	avatar: Avatar;
};

/** Ordre canonique des événements (celui du `hooks.json` assemblé). */
export const EVENEMENTS_HOOK: readonly EvenementHook[] = ['debut', 'message', 'outil', 'apres_outil', 'arret', 'fin'];

export const PROFILS_PAR_DEFAUT: Record<typeof PROFIL_TRAVAIL | typeof PROFIL_ARCHIVISTE, Omit<Profil, 'consigne'>> = {
	[PROFIL_TRAVAIL]: {
		nom: PROFIL_TRAVAIL,
		consignePersonnalisee: false,
		lancement: 'projet',
		lanceur: 'dialogue',
		hooks: ['debut', 'message', 'outil', 'apres_outil', 'arret', 'fin'],
		skillsMemoire: 'tous',
		plugins: [],
		avatar: { forme: 'robot', couleur: 'vert' },
	},
	[PROFIL_ARCHIVISTE]: {
		nom: PROFIL_ARCHIVISTE,
		consignePersonnalisee: false,
		lancement: 'memoire',
		lanceur: 'propre',
		hooks: ['debut', 'arret', 'fin'],
		skillsMemoire: [],
		plugins: [],
		avatar: { forme: 'chouette', couleur: 'violet' },
	},
};

/** Clés du frontmatter d'une fiche `profil` réécrites (ou retirées, comme l'ancienne `skills`) à l'enregistrement. */
export const CLES_GEREES_DU_PROFIL = ['avatar', 'plugins', 'skills_memoire', 'skills', 'hooks', 'lancement', 'lanceur'] as const;

const RE_PLUGIN = /^[^@\s]+@[^@\s]+$/u;

/** Identifiant de plugin Claude Code bien formé : `nom@marketplace`, sans espace, 200 caractères au plus. */
export const estIdentifiantDePlugin = (id: string): boolean => id.length <= 200 && RE_PLUGIN.test(id);

const RE_NOM_PROFIL = /^[a-z0-9][a-z0-9-]{0,39}$/u;

/** Nom de profil sûr comme segment de chemin (`profils/<nom>/<nom>.md`) : minuscules, chiffres, tirets, 40 au plus. */
export const estNomDeProfil = (nom: string): boolean => RE_NOM_PROFIL.test(nom);

/** Motif d'un nom refusé par `estNomDeProfil`. */
export const MOTIF_NOM_DE_PROFIL = 'nom refusé : minuscules, chiffres et tirets, 40 caractères au plus, sans tiret au début';

/** Motif de `lanceurPropreSansChemin`. */
export const MOTIF_LANCEUR_PROPRE = 'lanceur « propre » sans chemin de lancement connu de Mnemo : lancé depuis Nouvelle session';

/** `lanceur: propre` déclaré par un profil dont Mnemo ne connaît pas le chemin de lancement (son défaut n'est pas `propre`). */
export function lanceurPropreSansChemin(fiche: Fiche | null, parDefaut: Pick<Profil, 'lanceur'>): boolean {
	return fiche !== null && fiche.type === 'profil' && fiche.donnees.lanceur === 'propre' && parDefaut.lanceur !== 'propre';
}

const copieSkills = (s: Profil['skillsMemoire']): Profil['skillsMemoire'] => (s === 'tous' ? s : [...s]);

const copie = (p: Profil): Profil => ({ ...p, hooks: [...p.hooks], skillsMemoire: copieSkills(p.skillsMemoire), plugins: [...p.plugins], avatar: { ...p.avatar } });

function hooksDe(valeur: unknown): EvenementHook[] | null {
	if (!Array.isArray(valeur) || valeur.length === 0) return null;
	if (!valeur.every((e) => typeof e === 'string' && (EVENEMENTS_HOOK as readonly string[]).includes(e))) return null;
	return EVENEMENTS_HOOK.filter((e) => valeur.includes(e));
}

/** `skills_memoire` : `tous` ou une liste de textes (invalide en bloc sinon) ; à défaut, l'ancienne clé `skills` de la v1.0. */
function skillsMemoireDe(skillsMemoire: unknown, ancienne: unknown): Profil['skillsMemoire'] | null {
	if (skillsMemoire === 'tous') return 'tous';
	if (Array.isArray(skillsMemoire) && skillsMemoire.every((s) => typeof s === 'string')) return [...skillsMemoire];
	if (ancienne === 'projet') return 'tous';
	if (ancienne === 'profil') return [];
	return null;
}

/** `plugins` : liste dont les identifiants mal formés sont écartés un à un ; autre chose qu'une liste → null. */
function pluginsDe(valeur: unknown): string[] | null {
	if (!Array.isArray(valeur)) return null;
	return valeur.filter((id): id is string => typeof id === 'string' && estIdentifiantDePlugin(id));
}

/** Texte comparable : fins de ligne `\n`, espaces de fin de ligne et lignes vides de bord retirés. */
function normaliser(texte: string): string {
	const lignes = texte.split(/\r\n|\r|\n/u).map((l) => l.trimEnd());
	while (lignes.length > 0 && lignes[0] === '') lignes.shift();
	while (lignes.length > 0 && lignes.at(-1) === '') lignes.pop();
	return lignes.join('\n');
}

/**
 * Une synthèse de fiche `profil` vaut la consigne par défaut du code : vide, ou égale (après normalisation) à l'une des
 * `anciennes` consignes par défaut, recopiées dans la fiche par une version précédente.
 */
export function estConsigneParDefaut(synthese: string, anciennes: readonly string[]): boolean {
	if (synthese.trim() === '') return true;
	const texte = normaliser(synthese);
	return anciennes.some((a) => normaliser(a) === texte);
}

/**
 * Profil tiré d'une fiche `profil` (frontmatter `lancement`, `lanceur`, `hooks`, `skills_memoire` ou l'ancienne `skills`,
 * `plugins`, `avatar` ; consigne = synthèse, sauf si `estConsigneParDefaut`). Ne lève jamais : fiche absente ou d'un autre
 * type → `parDefaut` ; chaque champ absent ou invalide → celui de `parDefaut`.
 */
export function lireProfil(fiche: Fiche | null, parDefaut: Profil, anciennesConsignes: readonly string[]): Profil {
	if (fiche === null || fiche.type !== 'profil') return copie(parDefaut);
	const { lancement, lanceur, hooks, skills, skills_memoire, plugins, avatar } = fiche.donnees;
	const consigneParDefaut = estConsigneParDefaut(fiche.synthese, anciennesConsignes);
	return {
		nom: parDefaut.nom,
		consigne: consigneParDefaut ? parDefaut.consigne : fiche.synthese,
		consignePersonnalisee: !consigneParDefaut,
		lancement: lancement === 'projet' || lancement === 'memoire' ? lancement : parDefaut.lancement,
		lanceur: lanceurPropreSansChemin(fiche, parDefaut) ? 'dialogue' : (LANCEURS_DE_PROFIL as readonly unknown[]).includes(lanceur) ? (lanceur as LanceurDeProfil) : parDefaut.lanceur,
		hooks: hooksDe(hooks) ?? [...parDefaut.hooks],
		skillsMemoire: skillsMemoireDe(skills_memoire, skills) ?? copieSkills(parDefaut.skillsMemoire),
		plugins: pluginsDe(plugins) ?? [...parDefaut.plugins],
		avatar: lireAvatar(avatar) ?? { ...parDefaut.avatar },
	};
}

/**
 * Clés gérées du frontmatter d'une fiche `profil`, dans un ordre stable : `avatar`, `plugins`, `skills_memoire`, `hooks`,
 * `lancement`, puis `lanceur` s'il diffère de `dialogue`. Jamais l'ancienne clé `skills`.
 */
export function donneesDeProfil(profil: Profil): Record<string, unknown> {
	const donnees: Record<string, unknown> = {
		avatar: { ...profil.avatar },
		plugins: [...profil.plugins],
		skills_memoire: copieSkills(profil.skillsMemoire),
		hooks: [...profil.hooks],
		lancement: profil.lancement,
	};
	if (profil.lanceur !== 'dialogue') donnees.lanceur = profil.lanceur;
	return donnees;
}

/**
 * Une skill de `_mnemo/skills/` est active pour `projet` si son `SKILL.md` n'a pas de champ `projets`, ou si ce champ (texte
 * ou liste) nomme le projet. Frontmatter illisible ou `projets` d'un autre type : écartée.
 */
export function skillPourProjet(texteSkill: string, projet: string): boolean {
	const lignes = texteSkill.replace(/^﻿/u, '').split(/\r\n|\r|\n/u);
	if (lignes[0]?.trimEnd() !== '---') return true;
	const fin = lignes.findIndex((l, i) => i > 0 && l.trimEnd() === '---');
	if (fin === -1) return false;
	let entete: unknown;
	try {
		entete = parse(lignes.slice(1, fin).join('\n'));
	} catch {
		return false;
	}
	if (entete === null || entete === undefined) return true;
	if (typeof entete !== 'object' || Array.isArray(entete)) return false;
	const projets = (entete as Record<string, unknown>).projets;
	if (projets === undefined || projets === null) return true;
	if (typeof projets === 'string') return projets === projet;
	return Array.isArray(projets) && projets.includes(projet);
}
