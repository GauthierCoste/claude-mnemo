import { Document, isSeq, parse, YAMLParseError } from 'yaml';
import { ecrireFait, lignesDuFait, lireFait } from './fait.ts';
import type { Fait } from './fait.ts';
import { suivreBlocsDeCode } from './blocs-de-code.ts';

/** Types dont un mécanisme de Mnemo dépend ; toute autre valeur de forme `estTypeFiche` est un type libre. */
export const TYPES_RESERVES = ['consigne', 'profil', 'source', 'episode', 'dossier'] as const;
export type TypeReserve = (typeof TYPES_RESERVES)[number];
export type TypeFiche = string;
/** Type d'une fiche dont le frontmatter n'en donne pas. */
export const TYPE_PAR_DEFAUT = 'sujet';
/**
 * Clé du frontmatter qui garde le plus haut numéro d'ancre jamais donné dans la fiche, quand l'information qui le portait
 * l'a quittée (déplacée, supprimée, absorbée) : un numéro d'ancre ne sert jamais deux fois (`prochaineAncre`).
 */
export const CLE_ANCRE_MAX = 'ancre_max';
/** Plus grande valeur d'`ancre_max` acceptée : l'ancre suivante (`f-999999999`) tient encore sur 9 chiffres, comme toute ancre lue. */
export const ANCRE_MAX_PLAFOND = 999_999_998;
/** Clés du frontmatter gérées par Mnemo : jamais dans `donnees`. */
export const CLES_RESERVEES: readonly string[] = ['id', 'type', 'alias', 'updated', CLE_ANCRE_MAX];

const RE_TYPE_FICHE = /^\p{Ll}[\p{Ll}\p{N}_-]{0,39}$/u;
export const FORME_TYPE_FICHE = 'une minuscule, puis minuscules, chiffres, « _ » ou « - », 40 caractères au plus';

export function estTypeFiche(valeur: unknown): valeur is TypeFiche {
	return typeof valeur === 'string' && RE_TYPE_FICHE.test(valeur);
}

export function estTypeReserve(valeur: unknown): valeur is TypeReserve {
	return typeof valeur === 'string' && (TYPES_RESERVES as readonly string[]).includes(valeur);
}
export type Relation = { verbe: string; cible: string };
/** `brute` : ligne de `## Relations` hors de la forme `- verbe [[cible]]` (ou ligne vide), conservée telle quelle. */
export type LigneDeRelation = Relation | { brute: string };
/** `brute` : ligne(s) illisible(s) de `## Informations`, conservée(s) telle(s) quelle(s). */
export type LigneDeFait = { fait: Fait } | { brute: string[] };
export type Fiche = {
	chemin: string;
	id: string;
	type: TypeFiche;
	alias: string[];
	updated: string;
	titre: string;
	synthese: string;
	faits: LigneDeFait[];
	relations: LigneDeRelation[];
	/** Autres clés du frontmatter (portee, niveau…). */
	donnees: Record<string, unknown>;
	autresSections: { titre: string; corps: string }[];
	/**
	 * Titres des sections dans l'ordre de lecture, pour réécrire une fiche retouchée à la main dans le même ordre.
	 * Facultatif : sans lui (fiche créée par Mnemo), ordre canonique faits, relations, autres sections.
	 */
	ordre?: string[];
	/** Plus haut numéro d'ancre jamais donné (`ancre_max`), écrit seulement quand il dépasse les ancres présentes. */
	ancreMax?: number;
};

/** Titre de la section des informations (lignes structurées `faits`), tel que Mnemo l'écrit. */
export const TITRE_INFORMATIONS = 'Informations';
/** Ancien titre de la même section : toujours lu, jamais écrit (réécrit en `## Informations`). */
export const TITRE_INFORMATIONS_ANCIEN = 'Faits';

/** Vrai pour le titre de la section des informations, nouveau ou ancien. */
export function estTitreDesInformations(titre: string): boolean {
	return titre === TITRE_INFORMATIONS || titre === TITRE_INFORMATIONS_ANCIEN;
}

/** Titre de la section des relations (`- verbe [[cible]]`). */
export const TITRE_RELATIONS = 'Relations';

const RE_TITRE = /^# (.*)$/u;
const RE_SECTION = /^## (.*)$/u;
const RE_RELATION = /^- (\S.*?) \[\[(.+)\]\]$/u;
const RE_ANCRE = / \^f-(\d+)$/u;

/**
 * Ce qu'une lecture de fiche a dû contourner. `entete` (frontmatter non terminé, illisible, pas une table) et `type`
 * (mal formé) interdisent de réécrire la fiche : `lireFiche` les refuse. `ligne` (ligne d'une section
 * structurée hors de sa forme) est gardée telle quelle, réécrite et indexée comme texte.
 */
export const GENRES_ANOMALIE = ['entete', 'type', 'ligne'] as const;
export type GenreAnomalie = (typeof GENRES_ANOMALIE)[number];
export type Anomalie = { genre: GenreAnomalie; message: string };
const ANOMALIE_BLOQUANTE: Record<GenreAnomalie, boolean> = { entete: true, type: true, ligne: false };
/** Ce que l'index fait de la fiche malgré l'anomalie : dit à l'utilisateur avec elle. */
const CONSEQUENCE_ANOMALIE: Record<GenreAnomalie, string> = {
	entete: 'propriétés ignorées, contenu indexé comme texte',
	type: 'lue comme un sujet',
	ligne: 'indexée comme texte',
};

/** Anomalie suivie de sa conséquence, telle que l'utilisateur la lit (vue de la fiche, `mnemo index`). */
export function texteAnomalie(anomalie: Anomalie): string {
	return `${anomalie.message} : ${CONSEQUENCE_ANOMALIE[anomalie.genre]}`;
}

export function estAnomalieBloquante(anomalie: Anomalie): boolean {
	return ANOMALIE_BLOQUANTE[anomalie.genre];
}

/** Lecture stricte, pour réécrire une fiche : lève sur une anomalie bloquante (`analyserFiche` lit tout, sans lever). */
export function lireFiche(chemin: string, texte: string): Fiche {
	const { fiche, anomalies } = analyserFiche(chemin, texte);
	const bloquante = anomalies.find(estAnomalieBloquante);
	if (bloquante !== undefined) throw new Error(`${chemin} : ${bloquante.message}`);
	return fiche;
}

/**
 * Lit tout ce que la fiche contient, sans jamais lever : un frontmatter illisible est ignoré (le corps qui suit est lu),
 * un type inconnu se lit comme `sujet`, une ligne hors de la forme de sa section est gardée en `brute` ; chaque contournement
 * est rendu dans `anomalies`, dans l'ordre du fichier.
 */
export function analyserFiche(chemin: string, texte: string): { fiche: Fiche; anomalies: Anomalie[] } {
	const anomalies: Anomalie[] = [];
	const lignes = texte.replace(/^\uFEFF/u, '').split(/\r\n|\r|\n/u);
	const { entete, debutCorps, anomalie } = separerEntete(lignes);
	if (anomalie !== null) anomalies.push({ genre: 'entete', message: anomalie });
	const donnees = { ...entete };
	const type = lireType(donnees.type);
	if (type === null) {
		anomalies.push({ genre: 'type', message: `type de fiche mal formé « ${String(donnees.type)} » (attendu : ${FORME_TYPE_FICHE})` });
	}
	const fiche: Fiche = {
		chemin,
		id: texteDe(donnees.id),
		type: type ?? TYPE_PAR_DEFAUT,
		alias: lireAlias(donnees.alias),
		updated: texteDe(donnees.updated),
		titre: '',
		synthese: '',
		faits: [],
		relations: [],
		donnees: {},
		autresSections: [],
		ordre: [],
	};
	const ancreMax = donnees[CLE_ANCRE_MAX];
	if (Number.isSafeInteger(ancreMax) && (ancreMax as number) > 0 && (ancreMax as number) <= ANCRE_MAX_PLAFOND) fiche.ancreMax = ancreMax as number;
	for (const [cle, valeur] of Object.entries(donnees)) {
		// une valeur mal formée reste dans `donnees`, réécrite telle quelle, plutôt que perdue
		if (!CLES_RESERVEES.includes(cle) || (cle === CLE_ANCRE_MAX && fiche.ancreMax === undefined)) fiche.donnees[cle] = valeur;
	}

	const corps = lignes.slice(debutCorps);
	// Le titre est la première ligne non vide du corps, si elle commence par « # ». Sinon la fiche n'a pas de titre
	// et tout le corps (texte placé avant un « # » tardif compris) reste synthèse et sections, réécrit tel quel.
	const premiere = corps.findIndex((l) => l.trim() !== '');
	let debutSections = 0;
	const titre = premiere === -1 ? null : RE_TITRE.exec(corps[premiere]!);
	if (titre !== null) {
		fiche.titre = titre[1]!.trim();
		debutSections = premiere + 1;
	}
	const sections = decouperSections(corps.slice(debutSections));
	fiche.synthese = rogner(sections.avant).join('\n');

	for (const section of sections.liste) {
		fiche.ordre!.push(section.titre);
		if (estTitreDesInformations(section.titre) && fiche.faits.length === 0 && !fiche.ordre!.slice(0, -1).some(estTitreDesInformations)) {
			fiche.faits = lireFaits(rogner(section.lignes));
		} else if (section.titre === TITRE_RELATIONS && fiche.relations.length === 0 && !fiche.ordre!.slice(0, -1).includes(TITRE_RELATIONS)) {
			fiche.relations = lireRelations(rogner(section.lignes));
		} else {
			fiche.autresSections.push({ titre: section.titre, corps: rogner(section.lignes).join('\n') });
		}
	}
	for (const { titre: section, lignes: brutes } of lignesBrutes(fiche)) {
		const nombre = brutes.length === 1 ? 'une ligne' : `${brutes.length} lignes`;
		anomalies.push({ genre: 'ligne', message: `${nombre} de « ${section} » hors de la forme attendue (« ${extrait(brutes[0]!)} »)` });
	}

	return { fiche, anomalies };
}

const EXTRAIT_MAX = 80;
const extrait = (ligne: string): string => (ligne.length > EXTRAIT_MAX ? `${ligne.slice(0, EXTRAIT_MAX)}…` : ligne);

/**
 * Lignes non vides des sections structurées que Mnemo n'a pas pu lire (gardées en `brute`), par section : du texte écrit
 * à la main, indexé comme le texte libre.
 */
export function lignesBrutes(fiche: Fiche): { titre: string; lignes: string[] }[] {
	const informations = fiche.faits.flatMap((l) => ('brute' in l ? l.brute : [])).filter((l) => l.trim() !== '');
	const relations = fiche.relations.flatMap((r) => ('brute' in r ? [r.brute] : [])).filter((l) => l.trim() !== '');
	const sortie: { titre: string; lignes: string[] }[] = [];
	if (informations.length > 0) sortie.push({ titre: TITRE_INFORMATIONS, lignes: informations });
	if (relations.length > 0) sortie.push({ titre: TITRE_RELATIONS, lignes: relations });
	return sortie;
}

/**
 * Frontmatter (table de clés, dans l'ordre du fichier) et corps du texte, sans le frontmatter (lignes jointes en `\n`).
 * Lève, comme `lireFiche`, si le frontmatter est illisible.
 */
export function separerFrontmatter(chemin: string, texte: string): { entete: Record<string, unknown>; corps: string } {
	const lignes = texte.replace(/^\uFEFF/u, '').split(/\r\n|\r|\n/u);
	const { entete, debutCorps, anomalie } = separerEntete(lignes);
	if (anomalie !== null) throw new Error(`${chemin} : ${anomalie}`);
	return { entete, corps: lignes.slice(debutCorps).join('\n') };
}

/**
 * Frontmatter et début du corps. Illisible : entête vide et `anomalie` ; le corps commence après la ligne « --- » de fin
 * (au début du fichier si elle manque : tout le texte est du corps).
 */
function separerEntete(lignes: string[]): { entete: Record<string, unknown>; debutCorps: number; anomalie: string | null } {
	if (lignes[0]?.trimEnd() !== '---') {
		return { entete: {}, debutCorps: 0, anomalie: null };
	}
	const fin = lignes.findIndex((l, i) => i > 0 && l.trimEnd() === '---');
	if (fin === -1) {
		return { entete: {}, debutCorps: 0, anomalie: 'frontmatter non terminé (ligne « --- » de fin absente)' };
	}
	let valeur: unknown;
	try {
		valeur = parse(lignes.slice(1, fin).join('\n'));
	} catch (erreur) {
		// première ligne du message : la suite (extrait du YAML et repère) ne tient pas dans un avertissement
		const detail = (erreur instanceof YAMLParseError ? erreur.message : String(erreur)).split('\n')[0]!;
		return { entete: {}, debutCorps: fin + 1, anomalie: `frontmatter illisible : ${detail}` };
	}
	if (valeur === null || valeur === undefined) {
		return { entete: {}, debutCorps: fin + 1, anomalie: null };
	}
	if (typeof valeur !== 'object' || Array.isArray(valeur)) {
		return { entete: {}, debutCorps: fin + 1, anomalie: 'le frontmatter doit être une table de clés' };
	}

	return { entete: valeur as Record<string, unknown>, debutCorps: fin + 1, anomalie: null };
}

/** Le type lu, `sujet` s'il manque, null s'il est mal formé. */
function lireType(valeur: unknown): TypeFiche | null {
	if (valeur === undefined || valeur === null) return TYPE_PAR_DEFAUT;
	return estTypeFiche(valeur) ? valeur : null;
}

function texteDe(valeur: unknown): string {
	if (valeur === undefined || valeur === null) return '';
	if (valeur instanceof Date) return valeur.toISOString().slice(0, 10);
	return String(valeur);
}

function lireAlias(valeur: unknown): string[] {
	if (Array.isArray(valeur)) return valeur.map(texteDe);
	if (valeur === undefined || valeur === null || valeur === '') return [];
	return [texteDe(valeur)];
}

// Coupe aux titres `## ` hors des blocs de code.
function decouperSections(lignes: string[]): { avant: string[]; liste: { titre: string; lignes: string[] }[] } {
	const avant: string[] = [];
	const liste: { titre: string; lignes: string[] }[] = [];
	let courante: string[] = avant;
	const dansCode = suivreBlocsDeCode();
	for (const ligne of lignes) {
		const section = dansCode(ligne) ? null : RE_SECTION.exec(ligne);
		if (section !== null) {
			const nouvelle = { titre: section[1]!.trim(), lignes: [] as string[] };
			liste.push(nouvelle);
			courante = nouvelle.lignes;
		} else {
			courante.push(ligne);
		}
	}

	return { avant, liste };
}

function rogner(lignes: string[]): string[] {
	let debut = 0;
	let fin = lignes.length;
	while (debut < fin && lignes[debut]!.trim() === '') debut++;
	while (fin > debut && lignes[fin - 1]!.trim() === '') fin--;
	return lignes.slice(debut, fin);
}

// Lignes lues après celle d'un fait (citation, corroborations et leurs citations) : borne qui évite de recopier toute la
// section à chaque fait ; au-delà, une corroboration de trop reste une ligne brute, gardée telle quelle.
const LIGNES_SUIVANTES_MAX = 201;

function lireFaits(lignes: string[]): LigneDeFait[] {
	const faits: LigneDeFait[] = [];
	const utiles = lignes;
	for (let i = 0; i < utiles.length; i++) {
		const ligne = utiles[i]!;
		const suivante = utiles[i + 1];
		const fait = lireFait(ligne, ...utiles.slice(i + 1, i + 1 + LIGNES_SUIVANTES_MAX));
		if (fait !== null) {
			faits.push({ fait });
			i += lignesDuFait(fait) - 1;
		} else if (suivante !== undefined && suivante.startsWith('  > ')) {
			faits.push({ brute: [ligne, suivante] });
			i++;
		} else {
			faits.push({ brute: [ligne] });
		}
	}

	return faits;
}

function lireRelations(lignes: string[]): LigneDeRelation[] {
	const relations: LigneDeRelation[] = [];
	for (const ligne of lignes) {
		const trouvee = RE_RELATION.exec(ligne);
		relations.push(trouvee === null ? { brute: ligne } : { verbe: trouvee[1]!, cible: trouvee[2]! });
	}

	return relations;
}

export function ecrireFiche(fiche: Fiche): string {
	const blocs: string[] = [];
	if (fiche.titre !== '') blocs.push(`# ${fiche.titre}`);
	if (fiche.synthese !== '') blocs.push(fiche.synthese);
	blocs.push(...ecrireSections(fiche));

	return `${ecrireEntete(fiche)}${blocs.join('\n\n')}\n`;
}

/** Frontmatter tel que `ecrireFiche` l'écrit (lignes `---` comprises). */
function ecrireEntete(fiche: Fiche): string {
	const entete: Record<string, unknown> = {};
	if (fiche.id !== '') entete.id = fiche.id;
	entete.type = fiche.type;
	if (fiche.alias.length > 0) entete.alias = fiche.alias;
	if (fiche.updated !== '') entete.updated = fiche.updated;
	if (fiche.ancreMax !== undefined) entete[CLE_ANCRE_MAX] = fiche.ancreMax;
	for (const [cle, valeur] of Object.entries(fiche.donnees)) {
		if (!CLES_RESERVEES.includes(cle) || (cle === CLE_ANCRE_MAX && fiche.ancreMax === undefined)) entete[cle] = valeur;
	}
	const document = new Document(entete);
	const alias = document.get('alias', true);
	if (isSeq(alias)) alias.flow = true;
	const yaml = document.toString({ lineWidth: 0, flowCollectionPadding: false });

	return `---\n${yaml}---\n`;
}

function ecrireSections(fiche: Fiche): string[] {
	const sections: string[] = [];
	const restantes = [...fiche.autresSections];
	let faitsEcrits = false;
	let relationsEcrites = false;
	const ecrireFaits = () => {
		faitsEcrits = true;
		sections.push(bloc(TITRE_INFORMATIONS, fiche.faits.flatMap((l) => ('fait' in l ? ecrireFait(l.fait) : l.brute))));
	};
	const ecrireRelations = () => {
		relationsEcrites = true;
		sections.push(bloc(TITRE_RELATIONS, fiche.relations.map((r) => ('brute' in r ? r.brute : `- ${r.verbe} [[${r.cible}]]`))));
	};
	const ordre = fiche.ordre ?? [];
	for (const titre of ordre) {
		if (estTitreDesInformations(titre) && !faitsEcrits) {
			ecrireFaits();
			continue;
		}
		if (titre === TITRE_RELATIONS && !relationsEcrites) {
			ecrireRelations();
			continue;
		}
		const index = restantes.findIndex((s) => s.titre === titre);
		if (index !== -1) {
			const [section] = restantes.splice(index, 1);
			sections.push(bloc(section!.titre, section!.corps === '' ? [] : [section!.corps]));
		}
	}
	// Sections absentes de l'ordre d'origine : ordre canonique, sans écrire une section vide.
	if (!faitsEcrits && fiche.faits.length > 0) ecrireFaits();
	if (!relationsEcrites && fiche.relations.length > 0) ecrireRelations();
	for (const section of restantes) {
		sections.push(bloc(section.titre, section.corps === '' ? [] : [section.corps]));
	}

	return sections;
}

function bloc(titre: string, lignes: string[]): string {
	return [`## ${titre}`, ...lignes].join('\n');
}

/** Plus haut numéro des ancres présentes dans la fiche (informations lisibles et lignes brutes), 0 si aucune. */
function plusHauteAncrePresente(fiche: Fiche): number {
	let maximum = 0;
	for (const ligne of fiche.faits) {
		const ancres = 'fait' in ligne
			? [ligne.fait.ancre ?? '']
			: ligne.brute.map((l) => RE_ANCRE.exec(l)?.[0].trim().slice(1) ?? '');
		for (const ancre of ancres) {
			const numero = /^f-(\d+)$/u.exec(ancre)?.[1];
			if (numero !== undefined) maximum = Math.max(maximum, Number(numero));
		}
	}
	return maximum;
}

/** Plus haut numéro d'ancre jamais donné dans la fiche : celui des ancres présentes, ou `ancre_max` s'il est plus haut. */
export function plusHauteAncre(fiche: Fiche): number {
	return Math.max(plusHauteAncrePresente(fiche), fiche.ancreMax ?? 0);
}

/**
 * Après le départ d'informations (déplacées, supprimées, absorbées) : si la plus haute ancre de `avant` n'est plus
 * présente dans `apres`, `apres.ancreMax` la retient, pour que `prochaineAncre` ne redonne jamais son numéro ; sinon
 * `ancre_max`, redondant, est retiré. `avant` : la fiche avant le départ (non modifiée).
 */
export function retenirPlusHauteAncre(avant: Fiche, apres: Fiche): void {
	const jamais = Math.max(plusHauteAncre(avant), apres.ancreMax ?? 0);
	if (plusHauteAncrePresente(apres) < jamais) apres.ancreMax = jamais;
	else delete apres.ancreMax;
}

/** `f-0001` si aucune ancre n'a jamais été donnée ; sinon le plus haut numéro jamais donné + 1, sur 4 chiffres au moins. */
export function prochaineAncre(fiche: Fiche): string {
	return `f-${String(plusHauteAncre(fiche) + 1).padStart(4, '0')}`;
}
