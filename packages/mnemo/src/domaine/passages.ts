// Découpage d’un document Markdown en passages indexables. Pur, sans module `node:`.
import { fermeLe, marqueDOuverture, RE_OUVERTURE } from './blocs-de-code.ts';
import { empreinte } from './empreinte.ts';
import { masquerAvecPlages, masquerSecrets, positionMasquee } from './secrets.ts';
import { tronquerTexte } from './texte.ts';

export const TAILLE_MIN = 800;
export const TAILLE_MAX = 2000;
export const TAILLE_BLOC_MAX = 8000;

export type Contexte = { titre: string; date: string | null; auteur: string | null; ficheSource: string };
export type Passage = {
	ancre: string;
	texte: string;
	prefixe: string;
	titres: string[];
	page: number | null;
	position: number;
	section: string;
};

type Ligne = { texte: string; debut: number };
type Genre = 'titre' | 'code' | 'tableau' | 'liste' | 'paragraphe';
type Bloc = { genre: Genre; lignes: Ligne[]; niveau: number; titre: string };
/** Morceau à placer dans un passage ; `entier` : bloc plus grand que TAILLE_MAX, gardé d’un seul tenant. */
type Unite = { texte: string; debut: number; genre: Genre; entier: boolean; niveau: number; titre: string };
type Titre = { niveau: number; titre: string; debut: number; finSection: number };
type Brouillon = { parts: Unite[]; taille: number; sectionIdx: number; titres: string[] };

const RE_TITRE = /^ {0,3}(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/u;
const RE_ELEMENT = /^(\s*)(?:[-*+]|\d{1,9}[.)])[ \t]+\S/u;
const RE_SEPARATEUR = /^\s*\|?\s*:?-{1,}:?\s*(?:\|\s*:?-{1,}:?\s*)*\|?\s*$/u;

const estVide = (l: string): boolean => l.trim() === '';
const estTableau = (l: string): boolean => l.trimStart().startsWith('|');
const estTitre = (l: string): boolean => RE_TITRE.test(l);
const indentation = (l: string): number => l.length - l.trimStart().length;

function normaliser(texte: string): string {
	return texte.normalize('NFC').replace(/\s+/gu, ' ').trim();
}

function lignesAvecPositions(texte: string): Ligne[] {
	const lignes: Ligne[] = [];
	let debut = 0;
	for (;;) {
		const fin = texte.indexOf('\n', debut);
		if (fin === -1) {
			lignes.push({ texte: texte.slice(debut).replace(/\r$/u, ''), debut });
			return lignes;
		}
		lignes.push({ texte: texte.slice(debut, fin).replace(/\r$/u, ''), debut });
		debut = fin + 1;
	}
}

/** Premier niveau de structure : titres, blocs de code, tableaux, listes, paragraphes. */
function blocsDe(lignes: Ligne[]): Bloc[] {
	const blocs: Bloc[] = [];
	let i = 0;
	while (i < lignes.length) {
		const l = lignes[i]!.texte;
		if (estVide(l)) {
			i++;
			continue;
		}
		const marque = marqueDOuverture(l);
		if (marque !== null) {
			let j = i + 1;
			let ferme = false;
			while (j < lignes.length && !ferme) {
				ferme = fermeLe(marque, lignes[j]!.texte);
				j++;
			}
			blocs.push({ genre: 'code', lignes: lignes.slice(i, j), niveau: 0, titre: '' });
			i = j;
			continue;
		}
		const titre = RE_TITRE.exec(l);
		if (titre !== null) {
			blocs.push({ genre: 'titre', lignes: [lignes[i]!], niveau: titre[1]!.length, titre: titre[2]!.trim() });
			i++;
			continue;
		}
		if (estTableau(l)) {
			let j = i;
			while (j < lignes.length && estTableau(lignes[j]!.texte)) j++;
			blocs.push({ genre: 'tableau', lignes: lignes.slice(i, j), niveau: 0, titre: '' });
			i = j;
			continue;
		}
		if (RE_ELEMENT.test(l)) {
			const base = indentation(l);
			let j = i + 1;
			while (j < lignes.length) {
				const c = lignes[j]!.texte;
				if (estVide(c)) {
					// Une ligne vide ne ferme la liste que si ce qui suit n’en fait pas partie.
					let k = j + 1;
					while (k < lignes.length && estVide(lignes[k]!.texte)) k++;
					const suivante = lignes[k]?.texte;
					if (suivante === undefined || !(RE_ELEMENT.test(suivante) || indentation(suivante) > base)) break;
					j = k;
					continue;
				}
				if (indentation(c) > base || RE_ELEMENT.test(c)) j++;
				else break;
			}
			blocs.push({ genre: 'liste', lignes: lignes.slice(i, j).filter((x) => !estVide(x.texte)), niveau: 0, titre: '' });
			i = j;
			continue;
		}
		let j = i + 1;
		while (j < lignes.length) {
			const c = lignes[j]!.texte;
			if (estVide(c) || estTitre(c) || estTableau(c) || RE_OUVERTURE.test(c) || RE_ELEMENT.test(c)) break;
			j++;
		}
		blocs.push({ genre: 'paragraphe', lignes: lignes.slice(i, j), niveau: 0, titre: '' });
		i = j;
	}
	return blocs;
}

const texteDe = (lignes: Ligne[]): string => lignes.map((l) => l.texte).join('\n').trimEnd();

/** Coupe une ligne trop longue en morceaux ≤ max, de préférence sur une espace. */
function couperLigne(ligne: Ligne, max: number): Ligne[] {
	if (ligne.texte.length <= max) return [ligne];
	const morceaux: Ligne[] = [];
	let reste = ligne.texte;
	let debut = ligne.debut;
	while (reste.length > max) {
		let coupe = tronquerTexte(reste, max, 'utf16');
		const espace = coupe.lastIndexOf(' ');
		if (espace > coupe.length / 2) coupe = coupe.slice(0, espace + 1);
		morceaux.push({ texte: coupe.trimEnd(), debut });
		reste = reste.slice(coupe.length);
		debut += coupe.length;
	}
	if (reste.trim() !== '') morceaux.push({ texte: reste, debut });
	return morceaux;
}

/** Longueur exacte de `texteDe(lignes)`, sans construire le texte : total moins les blancs finaux que `trimEnd` retire. */
function longueurDe(lignes: Ligne[]): number {
	let total = Math.max(0, lignes.length - 1);
	for (const l of lignes) total += l.texte.length;
	for (let i = lignes.length - 1; i >= 0; i--) {
		const t = lignes[i]!.texte;
		const blancs = t.length - t.trimEnd().length;
		total -= blancs;
		if (blancs < t.length) break;
		if (i > 0) total -= 1; // le saut de ligne qui précède une ligne toute blanche disparaît aussi
	}
	return total;
}

/**
 * Regroupe des éléments (une ligne seule, ou une liste de lignes) en morceaux ≤ max, `entete` en tête et `pied` en queue de
 * chacun. Une ligne seule n'est pas enveloppée dans un tableau : un paragraphe de millions de lignes reste léger.
 */
function regrouper(elements: readonly (Ligne | Ligne[])[], max: number, entete: Ligne[], pied: string, genre: Genre): Unite[] {
	const unites: Unite[] = [];
	let courant: Ligne[] = [];
	let somme = 0; // longueur cumulée des lignes de `courant`, sans les sauts de ligne
	const base = entete.reduce((n, l) => n + l.texte.length + 1, 0) + pied.length;
	const longueur = (lignes: number, caracteres: number): number => base + caracteres + Math.max(0, lignes - 1);
	const total = (ls: Ligne[]): number => ls.reduce((n, l) => n + l.texte.length, 0);
	const fermer = (): void => {
		if (courant.length === 0) return;
		const texte = texteDe([...entete, ...courant]) + pied;
		unites.push({ texte, debut: courant[0]!.debut, genre, entier: false, niveau: 0, titre: '' });
		courant = [];
		somme = 0;
	};
	for (const brut of elements) {
		const element = Array.isArray(brut) ? brut : [brut];
		const t = total(element);
		if (courant.length > 0 && longueur(courant.length + element.length, somme + t) > max) fermer();
		if (longueur(element.length, t) > max) {
			// Élément plus grand que max : coupé ligne à ligne.
			for (const ligne of element.flatMap((l) => couperLigne(l, Math.max(100, max - 200)))) {
				if (courant.length > 0 && longueur(courant.length + 1, somme + ligne.texte.length) > max) fermer();
				courant.push(ligne);
				somme += ligne.texte.length;
			}
		} else {
			courant.push(...element);
			somme += t;
		}
	}
	fermer();
	return unites;
}

function elementsDeListe(lignes: Ligne[]): Ligne[][] {
	let base = Infinity;
	for (const l of lignes) base = Math.min(base, indentation(l.texte));
	const elements: Ligne[][] = [];
	for (const l of lignes) {
		if (elements.length === 0 || (RE_ELEMENT.test(l.texte) && indentation(l.texte) <= base)) elements.push([l]);
		else elements[elements.length - 1]!.push(l);
	}
	return elements;
}

function unitesDeBloc(bloc: Bloc): Unite[] {
	const debut = bloc.lignes[0]!.debut;
	const longueur = longueurDe(bloc.lignes);
	// Le texte n'est construit que pour un bloc gardé d'un seul tenant (≤ TAILLE_BLOC_MAX) : un paragraphe géant n'est jamais recopié entier.
	const base = (): Unite => ({ texte: texteDe(bloc.lignes), debut, genre: bloc.genre, entier: false, niveau: bloc.niveau, titre: bloc.titre });
	if (bloc.genre === 'titre' || longueur <= TAILLE_MAX) return [base()];
	switch (bloc.genre) {
		case 'paragraphe':
			return regrouper(bloc.lignes, TAILLE_MAX, [], '', 'paragraphe');
		case 'liste':
			return longueur <= TAILLE_BLOC_MAX ? [{ ...base(), entier: true }] : regrouper(elementsDeListe(bloc.lignes), TAILLE_MAX, [], '', 'liste');
		case 'tableau': {
			if (longueur <= TAILLE_BLOC_MAX) return [{ ...base(), entier: true }];
			const avecEntete = bloc.lignes.length > 2 && RE_SEPARATEUR.test(bloc.lignes[1]!.texte);
			const entete = avecEntete ? bloc.lignes.slice(0, 2) : [];
			return regrouper(bloc.lignes.slice(entete.length), TAILLE_MAX, entete, '', 'tableau');
		}
		case 'code': {
			if (longueur <= TAILLE_BLOC_MAX) return [{ ...base(), entier: true }];
			const ouverture = bloc.lignes[0]!;
			const marque = RE_OUVERTURE.exec(ouverture.texte)![1]!;
			const fermee = bloc.lignes.length > 1 && fermeLe(marque, bloc.lignes[bloc.lignes.length - 1]!.texte);
			const corps = bloc.lignes.slice(1, fermee ? -1 : undefined);
			return regrouper(corps, TAILLE_MAX, [ouverture], `\n${marque}`, 'code');
		}
	}
}

function nouveauBrouillon(sectionIdx: number, titres: string[]): Brouillon {
	return { parts: [], taille: 0, sectionIdx, titres };
}

const SEPARATEUR = '\n\n';

/**
 * Coupe « par le contenu » : après une unité dont l'empreinte est paire, une fois TAILLE_MIN atteinte. Les bornes ne
 * dépendent alors que du texte voisin : une insertion ne déplace que les bornes de son passage, les suivants restent
 * identiques (la coupe forcée à TAILLE_MAX reste, et se recale à la coupe naturelle suivante).
 */
function coupeNaturelle(u: Unite): boolean {
	return Number.parseInt(empreinte(normaliser(u.texte)).slice(0, 4), 16) % 2 === 0;
}

/** Façon de couper un long texte : `taille` remplit chaque passage (documents) ; `contenu`, voir `coupeNaturelle`. */
export type Coupes = 'taille' | 'contenu';

function assembler(blocs: Bloc[], coupes: Coupes): Brouillon[] {
	const passages: Brouillon[] = [];
	const pile: { niveau: number; titre: string }[] = [];
	let sectionIdx = -1;
	let titresIdx = -1;
	let courant = nouveauBrouillon(-1, []);
	const fermer = (): void => {
		if (courant.parts.length > 0) passages.push(courant);
		courant = nouveauBrouillon(sectionIdx, pile.map((t) => t.titre));
	};
	const ajouter = (u: Unite): void => {
		courant.taille += (courant.parts.length > 0 ? SEPARATEUR.length : 0) + u.texte.length;
		courant.parts.push(u);
	};
	for (const bloc of blocs) {
		if (bloc.genre === 'titre') {
			titresIdx++;
			sectionIdx = titresIdx;
			while (pile.length > 0 && pile[pile.length - 1]!.niveau >= bloc.niveau) pile.pop();
			pile.push({ niveau: bloc.niveau, titre: bloc.titre });
			fermer();
			ajouter(unitesDeBloc(bloc)[0]!);
			continue;
		}
		for (const u of unitesDeBloc(bloc)) {
			const seulementTitres = courant.parts.every((p) => p.genre === 'titre');
			if (u.entier) {
				if (!seulementTitres) fermer();
				ajouter(u);
				fermer();
				continue;
			}
			if (courant.parts.length > 0 && courant.taille + SEPARATEUR.length + u.texte.length > TAILLE_MAX) fermer();
			ajouter(u);
			if (coupes === 'contenu' && courant.taille >= TAILLE_MIN && coupeNaturelle(u)) fermer();
		}
	}
	fermer();
	return passages;
}

const texteDuPassage = (b: Brouillon): string => b.parts.map((p) => p.texte).join(SEPARATEUR);

/** Un passage plus petit que TAILLE_MIN rejoint le suivant de la même section tant que le tout tient dans TAILLE_MAX. */
function fusionner(brouillons: Brouillon[]): Brouillon[] {
	const sortie: Brouillon[] = [];
	for (const b of brouillons) {
		const precedent = sortie[sortie.length - 1];
		if (
			precedent !== undefined &&
			precedent.sectionIdx === b.sectionIdx &&
			precedent.taille < TAILLE_MIN &&
			precedent.taille + SEPARATEUR.length + b.taille <= TAILLE_MAX
		) {
			precedent.parts.push(...b.parts);
			precedent.taille += SEPARATEUR.length + b.taille;
		} else sortie.push(b);
	}
	return sortie;
}

/** Préfixe de contexte d'un passage : titre du document › chemin des titres — date — auteur — fiche source. */
export function prefixeDe(contexte: Contexte, titres: readonly string[]): string {
	const chemin = [contexte.titre, ...titres].filter((t) => t !== '');
	return [chemin.join(' › '), contexte.date, contexte.auteur, contexte.ficheSource]
		.filter((x): x is string => x !== null && x !== '')
		.join(' — ');
}

/** Longueur maximale (points de code) d'une ligne de contexte. */
export const LIGNE_CONTEXTE_MAX = 300;
const RE_LIGNE_INUTILE = /^\s*(?:#{1,6}(?:\s|$)|(?:`{3,}|~{3,})|(?:[-*_]\s*){3,}$|\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$)/u;

/**
 * Ligne de contexte d'un texte (synthèse d'une fiche, résumé ou début d'un document) : ses premières lignes utiles (ni
 * titres, ni clôtures de blocs de code, ni séparateurs), jointes en une ligne, secrets masqués, `LIGNE_CONTEXTE_MAX`
 * caractères au plus (coupée à un mot, « … »). Ajoutée au préfixe cherché et vectorisé d'un passage, jamais servie :
 * le passage d'un long texte garde ainsi le sujet du texte entier (version gratuite du « contextual retrieval »).
 */
export function ligneDeContexte(texte: string): string {
	const morceaux: string[] = [];
	let taille = 0;
	// au plus deux fois la borne, avant masquage : un long document n'est pas parcouru en entier
	for (let debut = 0; debut < texte.length && taille <= 2 * LIGNE_CONTEXTE_MAX; ) {
		const fin = texte.indexOf('\n', debut);
		const ligne = texte.slice(debut, fin === -1 ? texte.length : fin);
		debut = fin === -1 ? texte.length : fin + 1;
		if (ligne.trim() === '' || RE_LIGNE_INUTILE.test(ligne)) continue;
		const nette = ligne.replace(/\s+/gu, ' ').trim();
		morceaux.push(nette);
		taille += nette.length + 1;
	}
	const ligne = masquerSecrets(morceaux.join(' ')).texte;
	if ([...ligne].length <= LIGNE_CONTEXTE_MAX) return ligne;
	let coupe = tronquerTexte(ligne, LIGNE_CONTEXTE_MAX - 1);
	const espace = coupe.lastIndexOf(' ');
	if (espace > coupe.length / 2) coupe = coupe.slice(0, espace);
	return `${coupe.trimEnd()}…`;
}

/** Un passage dont la section est un rang dans la liste des sections du document (une section, souvent longue, n'est gardée qu'une fois). */
export type PassageCompact = Omit<Passage, 'section'> & { section: number };
export type Decoupage = { passages: PassageCompact[]; sections: string[]; secrets: number };

/**
 * Découpe un document Markdown en passages. Les secrets sont masqués sur tout le document avant la coupe (`secrets` : leur
 * nombre) ; `pages` (début de chaque page, en caractères du texte d’origine) est recalé sur le texte masqué.
 * Choix : un passage fait seulement de titres (section sans corps) est écarté, sauf s’il n’y a rien d’autre ;
 * `position` est le rang à partir de 0 ; `coupes` : voir `Coupes`. Les métadonnées de `contexte` ne sont pas masquées ici (à l'appelant).
 */
export function decouperDocument(markdown: string, contexte: Contexte, pages?: number[], coupes: Coupes = 'taille'): Decoupage {
	const { texte, remplacements } = masquerAvecPlages(markdown);
	const debutsDePages = pages?.map((p) => positionMasquee(p, remplacements));
	const blocs = blocsDe(lignesAvecPositions(texte));

	const titres: Titre[] = blocs
		.filter((b) => b.genre === 'titre')
		.map((b) => ({ niveau: b.niveau, titre: b.titre, debut: b.lignes[0]!.debut, finSection: texte.length }));
	const ouverts: Titre[] = [];
	for (const t of titres) {
		while (ouverts.length > 0 && ouverts[ouverts.length - 1]!.niveau >= t.niveau) ouverts.pop()!.finSection = t.debut;
		ouverts.push(t);
	}

	// Un passage fait seulement de titres n'apprend rien (e-mail au corps vide : sujet et en-tête) : jamais gardé.
	const brouillons = fusionner(assembler(blocs, coupes)).filter((b) => b.parts.some((p) => p.genre !== 'titre'));

	const vus = new Map<string, number>();
	const sections: string[] = [];
	const rangs = new Map<number, number>();
	const passages = brouillons.map((b, position): PassageCompact => {
		const premier = b.parts[0]!;
		const texteP = texteDuPassage(b);
		const base = `p-${empreinte(normaliser(texteP)).slice(0, 8)}`;
		const n = vus.get(base) ?? 0;
		vus.set(base, n + 1);

		let rang = rangs.get(b.sectionIdx);
		if (rang === undefined) {
			const [d, f] = b.sectionIdx < 0 ? [0, titres[0]?.debut ?? texte.length] : [titres[b.sectionIdx]!.debut, titres[b.sectionIdx]!.finSection];
			// 2 × la borne suffit : la borne compte des points de code, au plus 2 unités chacun.
			rang = sections.push(tronquerTexte(texte.slice(d, Math.min(f, d + 2 * TAILLE_BLOC_MAX + 100)).trim(), TAILLE_BLOC_MAX)) - 1;
			rangs.set(b.sectionIdx, rang);
		}
		const prefixe = prefixeDe(contexte, b.titres);
		const page = debutsDePages === undefined ? null : Math.max(1, debutsDePages.filter((d) => d <= premier.debut).length);
		return { ancre: n === 0 ? base : `${base}~${n}`, texte: texteP, prefixe, titres: b.titres, page, position, section: rang };
	});
	return { passages, sections, secrets: remplacements.length };
}

/** `decouperDocument`, chaque passage avec le texte de sa section. */
export function decouper(markdown: string, contexte: Contexte, pages?: number[]): Passage[] {
	const { passages, sections } = decouperDocument(markdown, contexte, pages);
	return passages.map((p) => ({ ...p, section: sections[p.section]! }));
}
