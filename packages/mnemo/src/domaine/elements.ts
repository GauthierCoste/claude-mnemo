import { suivreBlocsDeCode } from './blocs-de-code.ts';
import { nomDeLaFiche } from './chemin.ts';
import { lireConsigne } from './consigne.ts';
import type { Niveau } from './consigne.ts';
import { empreinte } from './empreinte.ts';
import { estDate } from './fait.ts';
import type { Fait } from './fait.ts';
import { analyserFiche, estAnomalieBloquante, texteAnomalie } from './fiche.ts';
import { passagesDeFiche } from './passages-fiche.ts';
import { CLE_PORTEE, ecrirePortee, lirePortee, PORTEE_GLOBALE } from './portee.ts';
import type { Fiche, TypeFiche } from './fiche.ts';
import { typeSourceOuInconnue, typeSourcePersonnel } from './regles.ts';
import type { TypeSource } from './regles.ts';

/**
 * `passage` : morceau de texte libre, d'un document (jalon 4, indexé à part, `chemin#p-…`) ou d'une fiche (synthèse,
 * sections : `chemin#<section>`, tirés par `elementsDeFiche`).
 */
export type GenreElement = 'fiche' | 'fait' | 'consigne' | 'passage';
/**
 * `ancienne_version` (passage d'une source remplacée par une autre via `version_de`) et `source_disparue` (fait qui cite
 * une source dont le fichier a disparu) sont dérivés par l'index, jamais écrits dans une fiche.
 */
export type StatutElement = 'servi' | 'a_confirmer' | 'invalide' | 'ancienne_version' | 'source_disparue';
export type ElementIndexe = {
	/** Fiche, consigne : le chemin ; fait : `${chemin}#^${ancre}` ; passage : `${chemin}#p-…` (document) ou `${chemin}#<section>` (fiche). */
	id: string;
	chemin: string;
	genre: GenreElement;
	typeFiche: TypeFiche;
	/** Fiche : titre et synthèse ; fait : énoncé (et citation) ; consigne : texte. */
	texte: string;
	/** Segments du chemin humanisés, titre et alias, joints par « › » ; passage de document : son préfixe (titres — date — référence) ; de fiche : titre › titres. */
	contexte: string;
	statut: StatutElement;
	/** Fait : date d'apprentissage ; sinon `updated`. */
	date: string | null;
	/** Fait : fin de validité (`valide [début,fin)` ou `…fin]`) ; sinon null. */
	valideFin: string | null;
	/** Vrai si la fin de validité est incluse (`]`) ; faux sinon (`)`, ou pas de fin). */
	finIncluse: boolean;
	/** Fait : confiance / 100 ; sinon null. */
	confiance: number | null;
	/** Texte de la mention `src:`, ou clé `source` du frontmatter. */
	source: string | null;
	/** Type annoncé par le préfixe de la source ; null pour un lien `[[…]]` vers une fiche `source` (résolu plus tard par l'application). */
	typeSource: TypeSource | null;
	categorie: string | null;
	niveau: Niveau | null;
	/**
	 * Consigne : `globale`, `genre:nom`, ou `invalide` (portée mal écrite : jamais servie). Fiche : la portée `genre:nom`
	 * qu'elle déclare pour son lieu (voir `porteesDesLieux`), sinon null.
	 */
	portee: string | null;
	/** Fiche : valeur normalisée de `dossier_projet` du frontmatter (dossier de projet Claude Code relatif à la racine Mnemo) ; absent ou null sinon. */
	dossierProjet: string | null;
	/** Fiche `episode` : données `session` et `projet` (nom du projet de la session) ; absentes ou null sinon. */
	sessionEpisode?: string | null;
	projetEpisode?: string | null;
	/** Fiche `source` citée (pour le statut dérivé `source_disparue`) ; écrite dans l'index, jamais relue. */
	ficheCitee?: string | null;
	/** Passage : page du document (PDF) ; absent ou null sinon. */
	page?: number | null;
	/**
	 * Passage de fiche : ligne de contexte (synthèse de la fiche, masquée, 300 caractères au plus), ajoutée au préfixe
	 * cherché et vectorisé, jamais servie ; écrite dans l'index, jamais relue. Absente ou vide : aucune.
	 */
	ligneContexte?: string;
	/**
	 * bm25 de l'élément pour la requête plein texte qui l'a trouvé (valeur SQLite, négative, plus petite = meilleure) ;
	 * renseigné seulement par `Index.chercher`, jamais écrit dans l'index.
	 */
	bm25?: number;
};

/**
 * Contenu d'un document : une fiche `source` ou l'un de ses passages. Il n'a pas de confiance propre (celle du document : la
 * fiabilité de son type de source) et n'est pas de la mémoire. Un passage d'une autre fiche (section) compte comme sa fiche.
 */
export const estContenuDeDocument = (e: Pick<ElementIndexe, 'genre' | 'typeFiche'>): boolean => e.typeFiche === 'source' && (e.genre === 'fiche' || e.genre === 'passage');

/** `verbe` null : lien `[[…]]` du texte ; `vers` est un chemin de fiche avec `.md`. */
export type Lien = { de: string; vers: string; verbe: string | null };

const SEPARATEUR_CONTEXTE = ' › ';
const RE_LIEN = /\[\[([^\]]+)\]\]/gu;

/**
 * Éléments, liens et alias d'une fiche ; `titre` : son titre, ou le nom du fichier à défaut.
 * `typeDocument` : pour une fiche `source`, son `type_source` (« inconnue » s'il manque ou est invalide) ; pour une fiche
 * `dossier` qui en porte un (dossier des fils et pièces jointes d'une source, nommé d'après le document), ce type ; sinon null.
 * Tout ce que la fiche contient est indexé, même hors de sa forme (`analyserFiche`) ; `anomalies` dit ce qui a été
 * contourné. Frontmatter ou type illisible : on ne sait plus d'où vient le contenu, il est traité comme un document
 * (`typeDocument` « inconnue » : encadré quand il est servi).
 */
export function elementsDeFiche(
	chemin: string,
	texte: string,
): { titre: string; elements: ElementIndexe[]; liens: Lien[]; alias: string[]; typeDocument: TypeSource | null; anomalies: string[] } {
	const lue = analyserFiche(chemin, texte);
	const fiche = lue.fiche;
	const anomalies = lue.anomalies.map(texteAnomalie);
	const titre = fiche.titre === '' ? nomDeLaFiche(chemin) : fiche.titre;
	const contexte = contexteDe(chemin, titre, fiche.alias);
	const liens = liensDe(fiche);
	const origineInconnue = lue.anomalies.some(estAnomalieBloquante);
	if (fiche.type === 'consigne') {
		return { titre, elements: [elementDeConsigne(fiche, contexte)], liens, alias: fiche.alias, typeDocument: null, anomalies };
	}
	const typeDocument = origineInconnue
		? 'inconnue'
		: fiche.type === 'source' || (fiche.type === 'dossier' && fiche.donnees['type_source'] !== undefined)
			? typeSourceOuInconnue(fiche.donnees['type_source'])
			: null;
	const elements = [elementDeFiche(chemin, titre, fiche, contexte)];
	const pris = new Set<string>();
	for (const ligne of fiche.faits) {
		if (!('fait' in ligne)) continue;
		const ancre = ligne.fait.ancre === undefined ? `~${empreinte(enonceNormalise(ligne.fait)).slice(0, 8)}` : `^${ligne.fait.ancre}`;
		elements.push(elementDeFait(fiche, ligne.fait, idUnique(`${chemin}#${ancre}`, pris), contexte));
	}
	// Le texte libre (synthèse, sections) : en passages, comme un document, pour que tout soit cherchable.
	for (const p of passagesDeFiche(fiche)) {
		const passage = base(fiche, 'passage', `${chemin}#${p.ancre}`, p.texte, p.prefixe);
		if (p.ligneContexte !== '') passage.ligneContexte = p.ligneContexte;
		elements.push(passage);
	}

	return { titre, elements, liens, alias: fiche.alias, typeDocument, anomalies };
}

/** Vrai si la validité est passée à la date `aujourdhui` : fin exclusive (`)`) dès le jour de fin, inclusive (`]`) le lendemain. */
export function estExpire(element: { valideFin: string | null; finIncluse: boolean }, aujourdhui: string): boolean {
	const fin = element.valideFin;
	if (fin === null || !estDate(fin)) return false;
	return element.finIncluse ? fin < aujourdhui : fin <= aujourdhui;
}

function vide(chemin: string, titre: string): Fiche {
	return { chemin, id: '', type: 'sujet', alias: [], updated: '', titre, synthese: '', faits: [], relations: [], donnees: {}, autresSections: [] };
}

function contexteDe(chemin: string, titre: string, alias: string[]): string {
	const segments = chemin.replace(/\.md$/u, '').split('/');
	segments[segments.length - 1] = titre;
	return [...segments, ...alias].join(SEPARATEUR_CONTEXTE);
}

function dateDe(fiche: Fiche): string | null {
	return estDate(fiche.updated) ? fiche.updated : null;
}

function sourceDeFrontmatter(fiche: Fiche): string | null {
	const source = fiche.donnees['source'];
	return typeof source === 'string' && source.trim() !== '' ? source : null;
}

function base(fiche: Fiche, genre: GenreElement, id: string, texte: string, contexte: string): ElementIndexe {
	const source = sourceDeFrontmatter(fiche);
	return {
		id,
		chemin: fiche.chemin,
		genre,
		typeFiche: fiche.type,
		texte,
		contexte,
		statut: 'servi',
		date: dateDe(fiche),
		valideFin: null,
		finIncluse: false,
		confiance: null,
		source,
		typeSource: source === null ? null : typeSourcePersonnel(source),
		categorie: null,
		niveau: null,
		portee: null,
		dossierProjet: null,
	};
}

/** Types qui ne sont jamais un lieu : ils ne portent ni dossier de projet Claude Code, ni fiches filles. */
const TYPES_HORS_LIEU: readonly TypeFiche[] = ['consigne', 'profil', 'source', 'episode'];

/** Une fiche de ce type peut être un lieu (rattacher un dossier de projet, être le parent de sa branche), quel que soit son type libre. */
export function estTypeDeLieu(type: TypeFiche): boolean {
	return !TYPES_HORS_LIEU.includes(type);
}

/** Phrase des types de lieu, pour les messages et les descriptions d'outils. */
export const TYPES_DE_LIEU_EN_CLAIR = `de lieu (ni ${TYPES_HORS_LIEU.join(', ni ')})`;

/** Clé du frontmatter qui rattache un dossier de projet Claude Code (relatif à la racine Mnemo) à une fiche de lieu. */
export const CLE_DOSSIER_PROJET = 'dossier_projet';

/** Valeur de `dossier_projet` : séparateurs en « / », sans « / » aux extrémités ; null si ce n'est pas un texte ou s'il est vide. */
export function normaliserDossierProjet(brut: unknown): string | null {
	if (typeof brut !== 'string') return null;
	const net = brut.trim().replace(/\\/gu, '/').replace(/^\/+|\/+$/gu, '');
	return net === '' ? null : net;
}

/** `dossier_projet` d'une fiche de lieu (`normaliserDossierProjet`) ; null pour une consigne, un profil, une source ou un épisode. */
function dossierProjetDe(fiche: Fiche): string | null {
	if (!estTypeDeLieu(fiche.type)) return null;
	return normaliserDossierProjet(fiche.donnees[CLE_DOSSIER_PROJET]);
}

function texteOuNull(valeur: unknown): string | null {
	return typeof valeur === 'string' && valeur.trim() !== '' ? valeur.trim() : null;
}

/** Portée nommée que la fiche déclare pour son lieu (clé `portee`) ; null si absente, globale ou mal écrite. */
function porteeDeclaree(fiche: Fiche): string | null {
	const lue = lirePortee(fiche.donnees[CLE_PORTEE]);
	return lue.genre === 'invalide' || lue.genre === PORTEE_GLOBALE ? null : ecrirePortee(lue);
}

function elementDeFiche(chemin: string, titre: string, fiche: Fiche, contexte: string): ElementIndexe {
	const corps = [titre, fiche.synthese].filter((t) => t !== '').join('\n\n');
	const element = base(fiche, 'fiche', chemin, corps, contexte);
	element.dossierProjet = dossierProjetDe(fiche);
	element.portee = porteeDeclaree(fiche);
	if (fiche.type === 'episode') {
		element.sessionEpisode = texteOuNull(fiche.donnees['session']);
		element.projetEpisode = texteOuNull(fiche.donnees['projet']);
	}
	return element;
}

function elementDeConsigne(fiche: Fiche, contexte: string): ElementIndexe {
	const consigne = lireConsigne(fiche);
	const element = base(fiche, 'consigne', fiche.chemin, consigne.texte, contexte);
	element.niveau = consigne.niveau;
	const portee = consigne.portee;
	// Une portée mal écrite ne correspond à aucune position : la consigne n'est jamais servie.
	element.portee = portee.genre === PORTEE_GLOBALE || portee.genre === 'invalide' ? portee.genre : ecrirePortee(portee);
	return element;
}

// Même notion que `memeEnonce` : catégorie, texte et validité ; espaces réduits, cibles de liens ignorées.
function enonceNormalise(fait: Fait): string {
	const texte = fait.texte.replace(/\[\[[^\]]*\]\]/gu, '[[]]').replace(/[\s\u00a0\u202f]+/gu, ' ').trim();
	return [fait.categorie ?? '', texte, fait.valideDebut ?? '', fait.valideFin ?? '', fait.finIncluse ? ']' : ')'].join('\u0000');
}

// Un identifiant déjà pris dans la fiche (ancre dupliquée, même énoncé sans ancre) reçoit `~2`, `~3`… dans l'ordre du document.
function idUnique(id: string, pris: Set<string>): string {
	let candidat = id;
	for (let n = 2; pris.has(candidat); n++) candidat = `${id}~${n}`;
	pris.add(candidat);
	return candidat;
}

/** Texte cherché d'un fait : son énoncé, sa citation, puis la citation de chaque corroboration (rien n'est écrit sans être cherchable). */
function texteDeFait(fait: Fait): string {
	const citations = [fait.citation, ...(fait.corroborations ?? []).map((c) => c.citation)].filter((c) => c !== undefined);
	return [fait.texte, ...citations].join('\n');
}

function elementDeFait(fiche: Fiche, fait: Fait, id: string, contexte: string): ElementIndexe {
	const source = fait.source ?? null;
	return {
		id,
		chemin: fiche.chemin,
		genre: 'fait',
		typeFiche: fiche.type,
		texte: texteDeFait(fait),
		contexte,
		statut: fait.barre ? 'invalide' : fait.aConfirmer ? 'a_confirmer' : 'servi',
		date: fait.appris ?? null,
		valideFin: fait.valideFin ?? null,
		finIncluse: fait.valideFin !== undefined && fait.finIncluse,
		confiance: fait.confiance === undefined ? null : fait.confiance / 100,
		source,
		typeSource: source === null ? null : typeSourcePersonnel(source),
		categorie: fait.categorie ?? null,
		niveau: null,
		portee: null,
		dossierProjet: null,
	};
}

function liensDe(fiche: Fiche): Lien[] {
	const liens: Lien[] = [];
	const vus = new Set<string>();
	const ajouter = (cible: string, verbe: string | null) => {
		const vers = normaliserCible(cible);
		if (vers === null || (vers === fiche.chemin && verbe === null)) return;
		const cle = `${verbe ?? ''}\u0000${vers}`;
		if (vus.has(cle)) return;
		vus.add(cle);
		liens.push({ de: fiche.chemin, vers, verbe });
	};
	for (const relation of fiche.relations) {
		if ('verbe' in relation) ajouter(relation.cible, relation.verbe);
	}
	const textes = [fiche.synthese];
	for (const ligne of fiche.faits) {
		if ('fait' in ligne) {
			textes.push(ligne.fait.texte, ligne.fait.source ?? '');
			// Une source ajoutée après coup est un lien sortant comme la première.
			for (const c of ligne.fait.corroborations ?? []) textes.push(c.source);
		}
	}
	for (const section of fiche.autresSections) textes.push(section.corps);
	for (const texte of textes) {
		for (const cible of ciblesDuTexte(texte)) ajouter(cible, null);
	}

	return liens;
}

// Cibles des liens `[[…]]` hors des blocs de code.
function ciblesDuTexte(texte: string): string[] {
	const cibles: string[] = [];
	const dansCode = suivreBlocsDeCode();
	for (const ligne of texte.split(/\r\n|\r|\n/u)) {
		if (dansCode(ligne)) continue;
		for (const trouve of ligne.matchAll(RE_LIEN)) cibles.push(trouve[1]!);
	}

	return cibles;
}

/** Chemin de fiche visé (sans ancre ni libellé, avec `.md`), ou null pour une cible vide ou externe. */
export function normaliserCible(cible: string): string | null {
	if (cible.includes('://')) return null;
	const cheminVise = cible.split('|')[0]!.split('#')[0]!.trim();
	if (cheminVise === '') return null;
	return cheminVise.endsWith('.md') ? cheminVise : `${cheminVise}.md`;
}
