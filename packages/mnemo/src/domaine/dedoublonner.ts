import { plier } from '@mnemo/commun';
import type { GenreElement } from './elements.ts';

/**
 * Ce que le dédoublonnage lit d'une entrée ; `source` : mention du fait (`[[chemin]]` quand elle cite une fiche source) ;
 * `citee` : la fiche que cette mention désigne, résolue par l'appelant (chemin, nom, titre ou alias ; null : aucune) ;
 * absente, la cible est lue dans `source`, par chemin seulement. `voisin` : l'entrée est dans le voisinage de la position.
 */
export type EntreeADedoublonner = {
	id: string;
	chemin: string;
	genre: GenreElement;
	texte: string;
	source?: string | null;
	citee?: string | null;
	date?: string | null;
	voisin?: boolean;
};

const normalise = (texte: string): string => plier(texte).replace(/\s+/gu, ' ').trim();
/**
 * Un document au sens du dédoublonnage (une fiche, de tout type, et ses passages) tient en une entrée ; un fait ou une
 * consigne est un élément à part entière. Plus large que `estContenuDeDocument` (fiche `source` seulement) : une fiche de
 * la mémoire et ses sections sont aussi une seule entrée.
 */
const estDocument = (genre: GenreElement): boolean => genre === 'fiche' || genre === 'passage';

/**
 * Genre de regroupement par contenu : une fiche et un passage (deux documents) se comparent entre eux ; un fait, seulement
 * à un fait ; une consigne jamais (deux consignes de même texte ont chacune leur portée).
 */
const genreDeContenu = (genre: GenreElement): string | null => (genre === 'consigne' ? null : estDocument(genre) ? 'document' : genre);

/** Fiche citée par un fait : `citee` si l'appelant l'a résolue, sinon la cible `[[chemin]]` de sa mention (avec `.md`) ; null sans lien. */
function citee(e: EntreeADedoublonner): string | null {
	if (e.citee !== undefined) return e.citee;
	const lien = /\[\[([^\]|#]+)/u.exec(e.source ?? '');
	if (lien === null) return null;
	const chemin = lien[1]!.trim();
	return chemin.endsWith('.md') ? chemin : `${chemin}.md`;
}

/**
 * Une entrée par document et par contenu, dans l'ordre reçu (déjà l'ordre final) : un document (une fiche et ses passages :
 * même chemin) et un texte normalisé (minuscules, accents, espaces repliés) de même genre (`genreDeContenu` ; sauf deux
 * faits d'une même fiche, et jamais deux consignes) n'ont qu'une entrée, à la place de leur mieux classé ; un document est
 * montré par son meilleur passage s'il y en a un, sinon par sa fiche. L'entrée montrée d'un contenu répété est une copie du
 * voisinage de la position (`voisin`) s'il y en a une, puis, parmi celles-là (ou toutes), la copie citée par un fait des
 * résultats, sinon la plus récente (`date`), sinon la mieux classée ; `copies` : les chemins des autres, écartées pour
 * contenu identique (pas celles écartées pour document). Une fiche source citée par un fait plus bas descend juste sous le
 * dernier fait qui la cite (si cela la pousse au-delà de la limite, la coupe l'écarte). `memeDate` (chronologie) : un
 * même texte n'est regroupé qu'à date égale, chaque date gardant sa place dans le temps.
 * `mieuxClasse` : le membre le mieux classé du groupe (document ou contenu), celui qui fixe la place de l'entrée. L'appelant
 * ordonne par sa note (la note du groupe), mais montre ce qui vaut pour l'élément montré (sa base, ses poids) : la liste
 * suit les notes des groupes, les bases affichées peuvent ne pas décroître.
 */
export function dedoublonner<T extends EntreeADedoublonner>(classes: T[], options: { memeDate?: boolean } = {}): (T & { copies: string[]; mieuxClasse: T })[] {
	const citees = new Set(classes.flatMap((e) => (e.genre === 'fait' ? [citee(e)] : [])));
	// Un document (fiche et passages d'un même chemin) : à la place de son mieux classé, montré par son meilleur passage
	// (la réponse est le contenu, pas le titre), sinon par sa fiche.
	const montreDuDocument = new Map<string, T>();
	for (const e of classes) {
		if (!estDocument(e.genre)) continue;
		const montre = montreDuDocument.get(e.chemin);
		if (montre === undefined || (montre.genre !== 'passage' && e.genre === 'passage')) montreDuDocument.set(e.chemin, e);
	}
	const documents = new Set<string>();
	const groupes: { membres: T[]; texte: string; genre: string | null; mieuxClasse: T }[] = [];
	for (const brute of classes) {
		if (estDocument(brute.genre) && documents.has(brute.chemin)) continue;
		const entree = estDocument(brute.genre) ? montreDuDocument.get(brute.chemin)! : brute;
		const texte = normalise(entree.texte);
		const genre = genreDeContenu(entree.genre);
		const jumeau =
			texte === '' || genre === null
				? undefined
				: groupes.find(
						(g) =>
							g.genre === genre &&
							g.texte === texte &&
							(options.memeDate !== true || (g.membres[0]!.date ?? null) === (entree.date ?? null)) &&
							!(entree.genre === 'fait' && g.membres.some((m) => m.genre === 'fait' && m.chemin === entree.chemin)),
					);
		if (estDocument(entree.genre)) documents.add(entree.chemin);
		if (jumeau === undefined) groupes.push({ membres: [entree], texte, genre, mieuxClasse: brute });
		else jumeau.membres.push(entree);
	}

	const liste = groupes.map(({ membres, mieuxClasse }) => {
		const voisins = membres.filter((m) => m.voisin === true);
		const candidates = voisins.length > 0 ? voisins : membres;
		const montree =
			candidates.find((m) => citees.has(m.chemin)) ??
			candidates.reduce((recente, m) => ((m.date ?? '') > (recente.date ?? '') ? m : recente), candidates[0]!);
		const copies = [...new Set(membres.filter((m) => m.chemin !== montree.chemin).map((m) => m.chemin))];
		return { ...montree, copies, mieuxClasse };
	});
	for (const source of [...liste]) {
		if (!estDocument(source.genre)) continue;
		const de = liste.indexOf(source);
		let dernier = -1;
		liste.forEach((e, i) => {
			if (i > de && e.genre === 'fait' && citee(e) === source.chemin) dernier = i;
		});
		if (dernier < 0) continue;
		liste.splice(de, 1);
		liste.splice(dernier, 0, source);
	}
	return liste;
}
