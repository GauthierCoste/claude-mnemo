import { cheminValide, dansGit } from '../domaine/chemin.ts';
import { elementsDeFiche } from '../domaine/elements.ts';
import { BUDGET_PAR_ENTREE, etendre } from '../domaine/etendue.ts';
import type { Etendue } from '../domaine/etendue.ts';
import { ecrireFait } from '../domaine/fait.ts';
import { lireFiche } from '../domaine/fiche.ts';
import { masquerSecrets } from '../domaine/secrets.ts';
import { estDocument, typeLePlusStrict } from '../domaine/regles.ts';
import type { TypeSource } from '../domaine/regles.ts';
import { typeDeMention } from './commun.ts';
import type { Fiche } from '../domaine/fiche.ts';
import type { Dependances } from './ports.ts';
import { SANS_EXTRACTION, synchroniser } from './synchroniser.ts';
import type { StatutElement } from '../domaine/elements.ts';

/** Fiche lue, ou null si le chemin est invalide ou la fiche absente. Une fiche illisible lève l'erreur de lecture. */
export async function lire(dep: Dependances, chemin: string): Promise<Fiche | null> {
	const valide = cheminValide(chemin);
	if (valide === null || dansGit(valide)) return null;
	const texte = await dep.coffre.lire(valide);
	if (texte === null) return null;
	return lireFiche(valide, texte);
}

export type Lu = {
	chemin: string;
	texte: string;
	fait: string | null;
	document: TypeSource | null;
	/** Lecture d'un passage : `texte` est sa section (petit pour chercher, grand pour lire) ; toujours un document. */
	passage?: { id: string; titres: string[]; page: number | null; statut: StatutElement };
	/** Lecture élargie d'un passage (`lireEtendu`) : ce qui est servi autour de lui. */
	etendue?: Etendue;
};

/**
 * Motif d'un identifiant introuvable. Un passage ou une information (`chemin#…`) a pu disparaître quand la fiche a changé :
 * une référence ne désigne jamais un autre texte, elle cesse d'exister ; on renvoie vers la fiche entière.
 */
export function motifIntrouvable(id: string): string {
	const coupe = id.indexOf('#');
	if (coupe < 0) return `introuvable : « ${id} ».`;
	return `introuvable : « ${id} » n'existe plus (la fiche a changé depuis) ou n'a jamais existé ; lire « ${id.slice(0, coupe)} » pour la fiche actuelle.`;
}

/**
 * Un passage (`<fiche source>#p-…`) : sa section, depuis l'index (les passages n'existent que là). Sans extraction : un
 * identifiant de passage vient d'une recherche, qui a déjà extrait ; l'index sert tel quel.
 */
async function lirePassage(dep: Dependances, id: string): Promise<Lu | null> {
	await synchroniser(dep, SANS_EXTRACTION);
	const p = await dep.index.passage(id);
	if (p === null) return null;
	// Toujours un document : une source « utilisateur » (CLAUDE.md amorcé) est encadrée comme « inconnue ».
	const document = estDocument(p.typeSource) ? p.typeSource : 'inconnue';
	return { chemin: p.ficheSource, texte: p.section, fait: null, document, passage: { id: p.id, titres: p.titres, page: p.page, statut: p.statut } };
}

/**
 * Lit par identifiant : `chemin`, `chemin#^ancre`, `chemin#~empreinte`, `chemin#<section>` (passage de fiche : son texte
 * est l'élément visé ; mêmes identifiants que l'index) ou `chemin#p-…` (un passage de document : voir `lirePassage`). `texte` est la fiche brute, `fait` la ligne visée (et sa citation). `document` : le type le plus strict parmi ceux de la fiche de source
 * et des faits tirés d'un document, sinon null ; la fiche entière est alors à encadrer. Une fiche illisible est traitée
 * comme un document de type inconnu (on ne sait pas ce qu'elle contient). Null si l'identifiant est invalide ou inconnu.
 */
export async function lireElement(dep: Dependances, id: string): Promise<Lu | null> {
	const coupe = id.indexOf('#');
	const valide = cheminValide(coupe < 0 ? id : id.slice(0, coupe));
	if (valide === null || dansGit(valide)) return null;
	if (coupe >= 0 && id.startsWith('p-', coupe + 1)) {
		// Passage de document ; à défaut, peut-être une section de fiche dont l'ancre commence par « p- ».
		const passage = await lirePassage(dep, `${valide}${id.slice(coupe)}`);
		if (passage !== null) return passage;
	}
	const texte = await dep.coffre.lire(valide);
	if (texte === null) return null;
	let fiche: Fiche;
	try {
		fiche = lireFiche(valide, texte);
	} catch {
		return coupe < 0 ? { chemin: valide, texte: masquerSecrets(texte).texte, fait: null, document: 'inconnue' } : null;
	}
	const { elements, typeDocument } = elementsDeFiche(valide, texte);
	const cache = new Map<string, TypeSource>();
	let document: TypeSource | null = typeDocument;
	const sourceDeFiche = elements[0]!.source;
	if (sourceDeFiche !== null) document = typeLePlusStrict(document, await typeDeMention(dep, sourceDeFiche, cache));
	let fait: string | null = null;
	const identifiant = coupe < 0 ? null : `${valide}${id.slice(coupe)}`;
	// Une fiche `consigne` n'a qu'un élément : on n'aligne les faits que si les comptes concordent.
	const elementsDeFaits = elements.filter((e) => e.genre === 'fait');
	let k = 0;
	for (const ligne of fiche.faits) {
		if (!('fait' in ligne)) continue;
		const element = elementsDeFaits[k++];
		if (element === undefined) continue;
		const type = element.source === null ? null : await typeDeMention(dep, element.source, cache);
		if (type !== null) document = typeLePlusStrict(document, type);
		if (element.id === identifiant) fait = ecrireFait(ligne.fait).join('\n');
	}
	// Passage de la fiche (`chemin#<section>`) : son texte est l'élément visé.
	if (identifiant !== null && fait === null) fait = elements.find((e) => e.genre === 'passage' && e.id === identifiant)?.texte ?? null;
	if (identifiant !== null && fait === null) return null;
	// Aucun secret ne sort de `lire`, quelle que soit la fiche (comme les passages, masqués à l'indexation).
	const sortie = (t: string) => masquerSecrets(t).texte;
	return { chemin: valide, texte: sortie(texte), fait: fait === null ? null : sortie(fait), document: document !== null && estDocument(document) ? document : null };
}

/**
 * `lireElement`, mais un passage (`chemin#p-…` d'un document, `chemin#<section>` d'une fiche) est servi comme par la
 * recherche : avec ses voisins de section, dans le budget d'une entrée (`etendre`, 6 000 caractères), et non plus la
 * section entière. Pour un document, `texte` devient cette étendue ; pour une fiche, l'élément visé (`fait`), la fiche
 * restant entière. Un passage que l'index ne connaît pas (encore) se lit comme avec `lireElement`.
 */
export async function lireEtendu(dep: Dependances, id: string): Promise<Lu | null> {
	const lu = await lireElement(dep, id);
	const coupe = id.indexOf('#');
	if (lu === null || coupe < 0) return lu;
	const passage = lu.passage?.id ?? `${lu.chemin}${id.slice(coupe)}`;
	if (lu.passage === undefined) await synchroniser(dep, SANS_EXTRACTION);
	const section = await dep.index.passagesDeSection(passage);
	if (section === null || !section.passages.some((p) => p.id === passage)) return lu;
	const { texte, complets: _complets, ...etendue } = etendre(section.passages, [passage], 'voisins', BUDGET_PAR_ENTREE);
	const servi = masquerSecrets(texte).texte;
	return lu.passage !== undefined ? { ...lu, texte: servi, etendue } : { ...lu, fait: servi, etendue };
}
