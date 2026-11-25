import { cheminValide, cleDeCasse, contientSyntaxeDeLien, dossiersAscendants, estCache, ficheDeDossier, nomDeLaFiche } from '../domaine/chemin.ts';
import { ecrireFiche, lireFiche, prochaineAncre } from '../domaine/fiche.ts';
import { estTypeFiche, FORME_TYPE_FICHE } from '../domaine/fiche.ts';
import type { Fiche, TypeFiche } from '../domaine/fiche.ts';
import type { Niveau } from '../domaine/consigne.ts';
import type { Fait } from '../domaine/fait.ts';
import { estExpire } from '../domaine/elements.ts';
import type { ElementIndexe } from '../domaine/elements.ts';
import { estTypeSource, TYPES_PERSONNELS, typeSourceOuInconnue, typeSourcePersonnel } from '../domaine/regles.ts';
import type { TypeSource } from '../domaine/regles.ts';
import type { AvecAvertissements } from '@mnemo/commun';
import type { Trouve } from './chercher.ts';
import type { Dependances } from './ports.ts';
import { CHEMIN_SCHEMA } from './regles-du-coffre.ts';
import { motifTitre } from '../domaine/titre.ts';

export type SourceProposee = { ref: string; type: TypeSource };
/**
 * Bilan d'une source marquée traitée (`traitee: true`) : les fiches qui la citent, son nombre de passages, et `riche` quand
 * ce nombre laisse attendre plus d'une destination.
 */
export type BilanDeRepartition = { citeePar: string[]; passages: number; riche: boolean };

export type Resultat =
	/**
	 * `changements` (modification d'une fiche) : ce qui a changé, ou changerait une fois confirmé, en résumé court.
	 * `repartition` : bilan d'une source marquée traitée.
	 */
	| ({ statut: 'ecrit'; fiche: string; ancre?: string; aConfirmer: boolean; commit: string; changements?: string[]; repartition?: BilanDeRepartition } & AvecAvertissements)
	| { statut: 'doublon'; fiche: string; ancre?: string; repartition?: BilanDeRepartition }
	| ({ statut: 'repetition'; fiche: string; repetitions: number; niveauPropose: Niveau | null; commit: string } & AvecAvertissements)
	/** Rien n'est écrit : des éléments très proches (quasi-doublons) existent ; rappeler avec `apresProches` (ajout) ou, pour un fait, `remplace`. */
	| { statut: 'proches'; genre: 'fait' | 'consigne'; proches: Trouve[] }
	/** Dossier vide retiré ; `commit` null si rien de suivi par git n'a changé. */
	| { statut: 'retire'; dossier: string; commit: string | null }
	| { statut: 'refuse'; motif: string };

export { TYPES_PERSONNELS };
/** Premier lien `[[…]]` d'une mention de source ; groupe 1 : la cible du lien (la fiche citée, si c'est une fiche `source`). */
export const RE_LIEN_SOURCE = /\[\[([^\]]+)\]\]/u;

export const refuse = (motif: string): Resultat => ({ statut: 'refuse', motif });

/** Chaque avertissement de `r`, écrit dans `journal`. */
export function journaliserAvertissements(r: AvecAvertissements, journal: (message: string) => void): void {
	for (const a of r.avertissements ?? []) journal(a);
}

export function aujourdhui(dep: Dependances): string {
	const d = dep.systeme.maintenant();
	const deux = (n: number) => String(n).padStart(2, '0');
	return `${d.getFullYear()}-${deux(d.getMonth() + 1)}-${deux(d.getDate())}`;
}

/** Motif de refus d'un chemin de fiche à écrire ou à déplacer, sinon null. */
function motifChemin(brut: string): string | null {
	const chemin = cheminValide(brut);
	if (chemin === null || !chemin.endsWith('.md')) return 'relatif, séparé par « / », terminé par .md';
	if (estCache(chemin)) return 'aucun dossier ni fichier caché, commençant par « . »';
	if (contientSyntaxeDeLien(chemin)) return 'sans « # », « ^ », « [ », « ] » ni « | », réservés aux liens';
	if (cleDeCasse(chemin) === cleDeCasse(CHEMIN_SCHEMA)) return `${CHEMIN_SCHEMA} ne s'écrit qu'à la main`;
	return null;
}

/**
 * Ancre d'un fait de la fiche `fiche`, tirée de l'identifiant tel que les outils l'affichent : « f-0001 », « ^f-0001 »
 * ou « <fiche>#^f-0001 » (chemin comparé sans tenir compte de la casse). Un identifiant d'une autre fiche est refusé.
 */
export function ancreDeFait(brut: string, fiche: string): { ancre: string } | { motif: string } {
	let reste = brut.trim();
	const diese = reste.indexOf('#');
	if (diese !== -1) {
		const chemin = reste.slice(0, diese).replace(/\\/gu, '/');
		if (cleDeCasse(chemin) !== cleDeCasse(fiche)) {
			return { motif: `L'identifiant « ${brut} » désigne une information de ${chemin}, pas de ${fiche}.` };
		}
		reste = reste.slice(diese + 1);
	}
	if (reste.startsWith('^')) reste = reste.slice(1);
	if (reste === '' || /[\s#^|[\]]/u.test(reste)) return { motif: `Ancre d'information invalide : « ${brut} » (attendu « f-0001 », « ^f-0001 » ou « ${fiche}#^f-0001 »).` };
	return { ancre: reste };
}

/** Chemin d'une fiche que Mnemo peut écrire ou déplacer (valide, .md, ni caché, ni SCHEMA.md, sans syntaxe de lien), sinon null. */
export function cheminDeFiche(brut: string): string | null {
	return motifChemin(brut) === null ? cheminValide(brut) : null;
}

/** Motif de refus d'un titre de fiche (`motifTitre`), sinon null. */
export const motifTitreInvalide = (titre: string): string | null => motifTitre('Le titre de la fiche', titre);

export const motifTypeInvalide = (type: string): string | null => (estTypeFiche(type) ? null : `Type de fiche mal formé : « ${type} » (attendu : ${FORME_TYPE_FICHE}).`);

export const motifCheminInvalide = (brut: string): string => `Chemin de fiche invalide : « ${brut} » (${motifChemin(brut) ?? 'refusé'}).`;

export function ficheVide(dep: Dependances, chemin: string, type: TypeFiche, titre: string, donnees: Record<string, unknown> = {}): Fiche {
	return {
		chemin,
		id: dep.systeme.nouvelId(),
		type,
		alias: [],
		updated: aujourdhui(dep),
		titre,
		synthese: '',
		faits: [],
		relations: [],
		donnees,
		autresSections: [],
	};
}

/** Lecture d'une fiche existante : texte de refus si absente ou illisible. */
export async function lireFicheExistante(dep: Dependances, chemin: string): Promise<Fiche | string> {
	const texte = await dep.coffre.lire(chemin);
	if (texte === null) return `La fiche ${chemin} n'existe pas.`;
	try {
		return lireFiche(chemin, texte);
	} catch (erreur) {
		return erreur instanceof Error ? erreur.message : String(erreur);
	}
}

/**
 * Refuse (texte) si une fiche existe sous un chemin qui ne diffère de `chemin` que par la casse. Sur un disque insensible
 * à la casse (macOS, Windows), lire ou écrire la variante toucherait l'autre fichier sans que git le voie : à appeler avant
 * de lire une fiche existante.
 */
export async function cheminExistant(dep: Dependances, chemin: string): Promise<string | null> {
	const cle = cleDeCasse(chemin);
	const existant = (await dep.coffre.toutesLesFiches()).find((e) => e !== chemin && cleDeCasse(e) === cle);
	return existant === undefined ? null : `La fiche ${chemin} existe déjà sous le nom ${existant} : utilise ce chemin.`;
}

/** Refuse (texte) si une fiche existante a le même chemin à la casse près. */
export async function motifCollision(dep: Dependances, chemin: string): Promise<string | null> {
	const cle = cleDeCasse(chemin);
	for (const existant of await dep.coffre.toutesLesFiches()) {
		if (cleDeCasse(existant) === cle) return `La fiche ${existant} existe déjà (les chemins se comparent sans tenir compte de la casse).`;
	}
	return null;
}

/** Fiches `dossier` des dossiers ascendants manquants de `chemin`, du plus haut au plus bas. */
export async function dossiersManquants(dep: Dependances, chemin: string): Promise<Fiche[] | string> {
	const fiches: Fiche[] = [];
	const existantes = await dep.coffre.toutesLesFiches();
	for (const dossier of dossiersAscendants(chemin)) {
		const cheminDossier = ficheDeDossier(dossier);
		if (cheminDossier === chemin || existantes.includes(cheminDossier)) continue;
		const cle = cleDeCasse(cheminDossier);
		const voisin = existantes.find((e) => cleDeCasse(e) === cle);
		if (voisin !== undefined) return `La fiche de dossier ${voisin} existe déjà, à la casse près de ${cheminDossier} : utilise ce chemin.`;
		fiches.push(ficheVide(dep, cheminDossier, 'dossier', dossier.slice(dossier.lastIndexOf('/') + 1)));
	}
	return fiches;
}

/**
 * Écrit les fichiers (la fiche principale en premier), retire `aSupprimer`, puis un seul commit ; tout est sérialisé par
 * l'appelant. Tout ou rien : si une écriture, un retrait ou le commit échoue, chaque fichier touché est remis comme avant
 * (retiré s'il n'existait pas), pour qu'aucune écriture partielle ne soit versionnée plus tard en « modification manuelle » ;
 * puis l'erreur remonte.
 */
export async function ecrireEtCommiter(dep: Dependances, aEcrire: { chemin: string; texte: string }[], message: string, aSupprimer: string[] = []): Promise<string> {
	const avant = new Map<string, string | null>();
	for (const chemin of [...aEcrire.map((f) => f.chemin), ...aSupprimer]) if (!avant.has(chemin)) avant.set(chemin, await dep.coffre.lire(chemin));
	try {
		for (const f of aEcrire) await dep.coffre.ecrire(f.chemin, f.texte);
		for (const chemin of aSupprimer) await dep.coffre.supprimer(chemin);
		return await commiter(dep, message, [...aEcrire.map((f) => f.chemin), ...aSupprimer]);
	} catch (erreur) {
		for (const [chemin, texte] of avant) {
			try {
				if (texte === null) await dep.coffre.supprimer(chemin);
				else await dep.coffre.ecrire(chemin, texte);
			} catch {
				// au mieux : l'erreur d'origine est celle qui compte
			}
		}
		throw erreur;
	}
}

/** Commit d'une écriture de Mnemo (porte la session d'origine en trailer) : n'avoir rien à commiter juste après avoir écrit est une erreur interne. */
export async function commiter(dep: Dependances, message: string, chemins: string[] | 'tout'): Promise<string> {
	const commit = await dep.historique.commit(message, chemins, dep.origine?.session);
	if (commit === null) throw new Error(`Erreur interne : « ${message} » n'a produit aucun changement à commiter.`);
	return commit;
}

/** Texte d'une fiche écrite par Mnemo ; une fiche sans identifiant en reçoit un (ULID), et chaque fait sans ancre une ancre, dans la même écriture (index du jalon 2). */
export function texteDeFiche(dep: Dependances, fiche: Fiche): string {
	if (fiche.id === '') fiche.id = dep.systeme.nouvelId();
	// Les faits écrits à la main sans ancre en reçoivent une, dans l'ordre du document, pour rester adressables.
	for (const ligne of fiche.faits) {
		if ('fait' in ligne && ligne.fait.ancre === undefined) ligne.fait.ancre = prochaineAncre(fiche);
	}
	return ecrireFiche(fiche);
}

/**
 * Texte dont un lien a été réécrit : octet pour octet, sauf une fiche lisible sans identifiant, réécrite avec un nouvel
 * identifiant. Une fiche illisible garde ses octets (seul le lien change).
 */
export function avecIdentifiant(dep: Dependances, chemin: string, texte: string): string {
	let fiche;
	try {
		fiche = lireFiche(chemin, texte);
	} catch {
		return texte;
	}
	return fiche.id === '' ? texteDeFiche(dep, fiche) : texte;
}

export const enFichier = (dep: Dependances, fiche: Fiche) => ({ chemin: fiche.chemin, texte: texteDeFiche(dep, fiche) });

/** Motif de refus d'une source (référence obligatoire, sans séparateur ni saut de ligne), sinon null. */
export function motifSourceInvalide(source: SourceProposee): string | null {
	if (!estTypeSource(source.type)) return `Type de source inconnu : « ${String(source.type)} ».`;
	const ref = source.ref.trim();
	if (ref === '') return 'La source est obligatoire.';
	if (ref.includes(' | ') || /[\r\n]/u.test(ref)) return 'La source ne doit contenir ni « | » entouré d\'espaces, ni saut de ligne.';
	return null;
}

/** Mention de source, et fiche de source à créer pour un document ; texte de refus si la référence est inacceptable. */
export function mentionDeSource(source: SourceProposee): { mention: string; ficheSource?: string; titreSource?: string } | string {
	const ref = source.ref.trim();
	if (TYPES_PERSONNELS.includes(source.type)) {
		return { mention: ref === source.type || ref.startsWith(`${source.type} `) ? ref : `${source.type} ${ref}` };
	}
	// La mention commence par le lien, suivi au besoin d'une précision après une espace.
	const lien = RE_LIEN_SOURCE.exec(ref);
	if (lien === null || lien.index !== 0 || !(ref.length === lien[0].length || ref[lien[0].length] === ' ')) {
		return `Une source de type « ${source.type} » doit commencer par un lien [[…]] vers sa fiche de source.`;
	}
	const ficheSource = cheminDeSource(lien[1]!);
	if (ficheSource === null) {
		return `Lien de source invalide : « ${lien[1]!} » (la fiche de source doit être un chemin de fiche valide, sans « .. »).`;
	}
	return { mention: ref, ficheSource, titreSource: nomDeLaFiche(ficheSource) };
}

/** Fiche de source à créer si la mention désigne un document absent du coffre, sinon null ; texte de refus si sa fiche existe à la casse près. */
export async function ficheDeSourceACreer(dep: Dependances, source: SourceProposee, mention: { ficheSource?: string; titreSource?: string }): Promise<Fiche | null | string> {
	if (mention.ficheSource === undefined) return null;
	const variante = await cheminExistant(dep, mention.ficheSource);
	if (variante !== null) return variante;
	const existante = await dep.coffre.lire(mention.ficheSource);
	if (existante !== null) return (await estFicheSource(dep, mention.ficheSource)) ? null : `${mention.ficheSource} n'est pas une fiche source : une source se cite par sa fiche de type « source ».`;
	return ficheVide(dep, mention.ficheSource, 'source', mention.titreSource!, { type_source: source.type });
}

/**
 * Chemin de fiche désigné par la cible d'un lien, ou null s'il est invalide ; c'est une source si cette fiche est de type
 * `source` (`estFicheSource`). La cible est coupée au premier `#` (section), `^` (bloc) ou `|` (alias).
 */
function cheminDeSource(lien: string): string | null {
	const cible = lien.split(/[#^|]/u)[0]!.trimEnd();
	const chemin = cible.endsWith('.md') ? cible : `${cible}.md`;
	if (cheminDeFiche(chemin) !== chemin || chemin.endsWith('/.md') || chemin === '.md') return null;
	return chemin;
}

/** Vrai si `chemin` est une fiche lisible de type `source`, où qu'elle soit rangée. */
export async function estFicheSource(dep: Pick<Dependances, 'coffre'>, chemin: string): Promise<boolean> {
	try {
		const texte = await dep.coffre.lire(chemin);
		return texte !== null && lireFiche(chemin, texte).type === 'source';
	} catch {
		return false;
	}
}

/**
 * Type d'une fiche de source (clé `type_source` de son frontmatter) ; « inconnue » si elle est absente, illisible, d'un
 * autre type que `source` ou sans type valide. `cache` : chemin → type, le temps d'une opération.
 */
export async function typeDeFicheSource(dep: Pick<Dependances, 'coffre'>, chemin: string, cache?: Map<string, TypeSource>): Promise<TypeSource> {
	const connu = cache?.get(chemin);
	if (connu !== undefined) return connu;
	let type: TypeSource = 'inconnue';
	try {
		const texte = await dep.coffre.lire(chemin);
		const fiche = texte === null ? null : lireFiche(chemin, texte);
		if (fiche !== null && fiche.type === 'source') type = typeSourceOuInconnue(fiche.donnees['type_source']);
	} catch {
		// fiche de source illisible : type inconnu
	}
	cache?.set(chemin, type);
	return type;
}

/**
 * Type de la source citée par une mention `src:` : préfixe personnel, sinon type de la fiche `source` liée, sinon
 * « inconnue » (un document dont on ne sait rien).
 */
export async function typeDeMention(dep: Pick<Dependances, 'coffre'>, mention: string, cache?: Map<string, TypeSource>): Promise<TypeSource> {
	const personnel = typeSourcePersonnel(mention);
	if (personnel !== null) return personnel;
	const chemin = lienDeMention(mention);
	return chemin === null ? 'inconnue' : typeDeFicheSource(dep, chemin, cache);
}

/** Chemin de la fiche visée par le premier lien `[[…]]` d'une mention `src:`, ou null (sans lien, chemin invalide). */
export function lienDeMention(mention: string): string | null {
	const lien = RE_LIEN_SOURCE.exec(mention);
	return lien === null ? null : cheminDeSource(lien[1]!);
}

/** Fiche `source` citée par une mention `src:` (son premier lien, s'il vise une fiche de type `source`), ou null. */
export async function ficheDeMention(dep: Pick<Dependances, 'coffre'>, mention: string): Promise<string | null> {
	const chemin = lienDeMention(mention);
	return chemin !== null && (await estFicheSource(dep, chemin)) ? chemin : null;
}

/** Type de source d'un fait déjà écrit. */
export async function typeDeSourceDe(dep: Dependances, fait: Fait): Promise<TypeSource> {
	return typeDeMention(dep, fait.source ?? '');
}

/** Sous verrou ; les retouches manuelles sont versionnées à part, avant toute écriture de Mnemo. */
export async function sousVerrou<T>(dep: Dependances, action: () => Promise<T>): Promise<T> {
	return dep.verrou.avec(async () => {
		const enCours = await dep.historique.modificationsEnCours();
		if (enCours.length > 0) await dep.historique.commit('mnemo: modification manuelle', 'tout');
		return action();
	});
}

/** Consignes indexées (servies, toutes portées) de ces niveaux. */
export async function consignesIndexees(dep: Dependances, niveaux: Niveau[]): Promise<ElementIndexe[]> {
	const toutes = await dep.index.elements({ genres: ['consigne'], statuts: ['servi'] });
	const jour = aujourdhui(dep);
	return toutes.filter((e) => e.niveau !== null && niveaux.includes(e.niveau) && !estExpire(e, jour));
}
