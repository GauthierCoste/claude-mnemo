// Ce qu'une fiche `source` dit de son document : où il est, quelle partie en prendre, comment le présenter. Pur.
import { cheminValide, EXTENSION_MARKDOWN } from './chemin.ts';
import { empreinte } from './empreinte.ts';
import type { Fiche } from './fiche.ts';
import { typeSourceOuInconnue } from './regles.ts';
import { ligneDeContexte } from './passages.ts';
import { masquerSecrets } from './secrets.ts';
import type { TypeSource } from './regles.ts';

export { estCherchable, EXTENSIONS_EXTRAITES, extensionDe, motifSiNonCherchable, RAISON_NON_CHERCHABLE } from '@mnemo/commun';

/** Textes lus comme du Markdown (titres, listes, tableaux) ; les autres textes ont le format `texte`. */
export const EXTENSIONS_MARKDOWN: readonly string[] = [EXTENSION_MARKDOWN, '.markdown'];
/** Formats de courriel : type de source `email` par défaut. */
export const EXTENSIONS_EMAIL: readonly string[] = ['.eml', '.mbox'];

/**
 * Clé du frontmatter d'une fiche `source` qui attend l'archiviste (`a_traiter: true`) : posée par l'import de la mémoire de
 * Claude Code sur les fiches nouvelles ou modifiées, retirée par une modification `traitee: true`.
 */
export const CLE_A_TRAITER = 'a_traiter';

/** Titre de la section où l'amorçage (jalon 3) recopie une note de Claude Code, dans un bloc de code. */
export const TITRE_CONTENU = 'Contenu';

/**
 * Descripteur d'une fiche `source`, tel que l'index le garde : un autre descripteur → passages refaits.
 * `document` : chemin du fichier (relatif à la racine du dossier Mnemo, en « / ») ; `fil` : rang du fil dans un fichier
 * à plusieurs documents (`.mbox`) ; `parente` + `piece` : pièce jointe d'une autre source ; `empreinteContenu` : note amorcée
 * (passages tirés de la section `## Contenu`) ; `conteneur` : fichier découpé en plusieurs fils (`fils: N`, N ≥ 2), dont
 * chaque fil a sa fiche : la fiche du fichier n'a pas de passages propres (ils seraient en double), mais reste la parente
 * des pièces jointes et suit la présence du fichier.
 */
export type DescripteurSource = {
	document: string | null;
	/** Clé du fil (Message-ID de son premier message…) ; un entier : son rang, pour les fiches d'avant les clés. */
	fil: number | string | null;
	conteneur: boolean;
	parente: string | null;
	piece: string | null;
	/** Pièce jointe : sa position dans le fichier (`piece_position`, à partir de 1), ou null pour une fiche d'avant les positions. */
	positionPiece: number | null;
	empreinteContenu: string | null;
	versionDe: string | null;
	typeSource: TypeSource;
	titre: string;
	date: string | null;
	auteur: string | null;
	/**
	 * Synthèse de la fiche en ligne de contexte (`ligneDeContexte` : masquée, 300 caractères au plus), ou null : elle situe
	 * chaque passage du document ; elle fait partie du descripteur, donc la changer refait les passages.
	 */
	resume: string | null;
};

/** Valeur affichable (titre, auteur…), secrets masqués : le descripteur est gardé dans l'index. */
function affichable(valeur: unknown): string | null {
	const t = texte(valeur);
	return t === null ? null : masquerSecrets(t).texte;
}

function texte(valeur: unknown): string | null {
	if (valeur instanceof Date && !Number.isNaN(valeur.getTime())) return valeur.toISOString().slice(0, 10);
	if (typeof valeur !== 'string' && typeof valeur !== 'number') return null;
	const net = String(valeur).replace(/\s+/gu, ' ').trim();
	return net === '' ? null : net;
}

/** Clé du frontmatter d'une fiche de pièce jointe : sa position dans le fichier (le nom seul ne la désigne pas : il peut revenir). */
export const CLE_POSITION_PIECE = 'piece_position';

/**
 * Position, parmi `pieces` (les pièces jointes du fichier, chacune avec sa position), de la pièce qu'une fiche désigne par
 * son nom et sa position : celle-ci si son nom est le même (à la casse près), sinon null (le fichier a changé). Sans
 * position (fiche d'avant les positions, qui désignait la première pièce de ce nom) : la première de ce nom.
 */
export function positionDeLaPiece(nom: string, position: number | null, pieces: readonly { nom: string; position: number }[]): number | null {
	const meme = (p: { nom: string }) => p.nom.toLowerCase() === nom.toLowerCase();
	if (position === null) return pieces.find(meme)?.position ?? null;
	const visee = pieces.find((p) => p.position === position);
	return visee !== undefined && meme(visee) ? position : null;
}

/**
 * Chemin de fiche (avec `.md`) désigné par un lien `[[…]]` (ou son texte nu), où qu'il soit rangé ; null s'il est invalide.
 * Ce n'est une source que si cette fiche est de type `source` : l'appelant le vérifie (index, lecture).
 */
export function ficheDeLienSource(valeur: unknown): string | null {
	if (typeof valeur !== 'string') return null;
	const brut = texte(valeur);
	if (brut === null) return null;
	const lien = /^\[\[([^\]]+)\]\]$/u.exec(brut);
	const cible = (lien === null ? brut : lien[1]!).split(/[#^|]/u)[0]!.trim();
	const chemin = cheminValide(cible.endsWith(EXTENSION_MARKDOWN) ? cible : `${cible}${EXTENSION_MARKDOWN}`);
	return chemin !== null && !chemin.endsWith(`/${EXTENSION_MARKDOWN}`) && chemin !== EXTENSION_MARKDOWN ? chemin : null;
}

/** Contenu d'une section `## Contenu` : l'intérieur du bloc de code qui l'entoure s'il y en a un, sinon la section telle quelle. */
export function contenuAmorce(corps: string): string {
	const lignes = corps.replace(/\r\n|\r/gu, '\n').split('\n');
	const ouverture = /^(`{3,}|~{3,})/u.exec(lignes[0] ?? '');
	if (ouverture === null) return corps.trim();
	const marque = ouverture[1]!;
	let fin = lignes.length - 1;
	while (fin > 0 && lignes[fin]!.trim() === '') fin--;
	const derniere = lignes[fin]!.trim();
	const fermee = fin > 0 && derniere.length >= marque.length && [...derniere].every((c) => c === marque[0]);
	return lignes.slice(1, fermee ? fin : undefined).join('\n');
}

/** Contenu amorcé d'une fiche `source` (section `## Contenu`), ou null si elle n'en a pas. */
export function contenuDeSource(fiche: Fiche): string | null {
	const section = fiche.autresSections.find((s) => s.titre === TITRE_CONTENU);
	return section === undefined ? null : contenuAmorce(section.corps);
}

/** Descripteur d'une fiche `source` ; null pour une autre fiche. */
export function descripteurDeSource(fiche: Fiche): DescripteurSource | null {
	if (fiche.type !== 'source') return null;
	const d = fiche.donnees;
	const document = texte(d['chemin']);
	const brut = d['fil'];
	const fil = typeof brut === 'number' && Number.isInteger(brut) && brut >= 0 ? brut : typeof brut === 'string' && brut.trim() !== '' ? brut.trim() : null;
	const fils = d['fils'];
	const conteneur = document !== null && fil === null && typeof fils === 'number' && Number.isInteger(fils) && fils >= 2;
	// Un fil porte aussi `source_parente` (sa fiche de fichier) : il n'en tire pas son fichier, seulement le lien de version.
	const parente = ficheDeLienSource(d['source_parente']);
	const contenu = document === null && parente === null ? contenuDeSource(fiche) : null;
	return {
		document: document?.replace(/\\/gu, '/') ?? null,
		fil: document === null ? null : fil,
		conteneur,
		parente,
		piece: document !== null || parente === null ? null : texte(d['piece']),
		positionPiece: document === null && parente !== null && Number.isSafeInteger(d[CLE_POSITION_PIECE]) && (d[CLE_POSITION_PIECE] as number) >= 1 ? (d[CLE_POSITION_PIECE] as number) : null,
		empreinteContenu: contenu === null ? null : empreinte(contenu),
		versionDe: ficheDeLienSource(d['version_de']),
		typeSource: typeSourceOuInconnue(d['type_source']),
		titre: masquerSecrets(fiche.titre).texte,
		date: affichable(d['date']),
		auteur: affichable(d['auteur']),
		resume: fiche.synthese.trim() === '' ? null : ligneDeContexte(fiche.synthese),
	};
}
