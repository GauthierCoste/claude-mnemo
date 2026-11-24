// Extraction et découpage d'un fichier en passages, pour chacune de ses cibles (fichier entier, fil, pièce jointe).
// Sans module `node:` : tourne dans le processus (tests) ou dans un fil d'exécution isolé (`infra/extraction-isolee.ts`).
import { decouperDocument, ligneDeContexte, prefixeDe } from '../domaine/passages.ts';
import { positionDeLaPiece } from '../domaine/source.ts';
import type { Contexte, PassageCompact } from '../domaine/passages.ts';
import { masquerSecrets } from '../domaine/secrets.ts';
import { messageDErreur, premiersNoms } from '../domaine/texte.ts';
import { contenuEnMemoire, texteCoupe } from './contenu.ts';
import { ErreurExtraction, TEXTE_MAX_DOCUMENT, TEXTE_MAX_PIECES } from './ports.ts';
import type { CibleExtraction, Contenu, DocumentExtrait, Extracteurs, Extraction, FichierDecoupe, PartieDecoupee, PieceJointe, ReperePiece, ResultatCible } from './ports.ts';

const RE_DATE = /^\d{4}-\d{2}-\d{2}/u;

/** Date du jour (AAAA-MM-JJ) tirée d'une date plus précise, ou null. */
function jour(date: string | null): string | null {
	return date !== null && RE_DATE.test(date) ? date.slice(0, 10) : null;
}

/** Motif lisible d'un échec d'extraction. */
export function motifExtraction(erreur: unknown): string {
	const message = messageDErreur(erreur);
	return erreur instanceof ErreurExtraction ? message : `extraction impossible : ${message}`;
}

type Metadonnees = { titre: string | null; date: string | null; auteur: string | null };

/**
 * Le document, son texte coupé à `TEXTE_MAX_DOCUMENT` caractères au plus (pages au-delà retirées), avec un avertissement :
 * quel que soit le format, l'index ne reçoit jamais plus que cette borne d'un seul document.
 */
function plafonne(doc: DocumentExtrait): DocumentExtrait {
	if (doc.markdown.length <= TEXTE_MAX_DOCUMENT) return doc;
	return {
		...doc,
		markdown: doc.markdown.slice(0, TEXTE_MAX_DOCUMENT),
		pages: doc.pages === null ? null : doc.pages.filter((p) => p < TEXTE_MAX_DOCUMENT),
		avertissements: [...(doc.avertissements ?? []), texteCoupe(TEXTE_MAX_DOCUMENT)],
	};
}

/**
 * Contexte (préfixe) des passages d'une cible : titre, date et auteur de la fiche, à défaut ceux du document, masqués ;
 * `masques` : secrets trouvés dans ces métadonnées. `date` : la date retenue, non masquée.
 */
function contexteDe(cible: CibleExtraction, doc: Metadonnees | null): { contexte: Contexte; masques: number; date: string | null } {
	let masques = 0;
	const masquer = (valeur: string | null): string | null => {
		if (valeur === null) return null;
		const m = masquerSecrets(valeur);
		masques += m.masques;
		return m.texte;
	};
	const date = cible.date ?? doc?.date ?? null;
	const contexte = {
		titre: masquer(cible.titre !== '' ? cible.titre : (doc?.titre ?? '')) ?? '',
		date: masquer(date),
		auteur: masquer(cible.auteur ?? doc?.auteur ?? null),
		ficheSource: cible.fiche,
	};
	return { contexte, masques, date };
}

/** Passages lus pour la ligne de contexte d'un document sans résumé : ses premières lignes utiles y sont. */
const PASSAGES_DU_DEBUT = 2;

/**
 * Ligne de contexte des passages d'une cible : son résumé (synthèse de la fiche) s'il existe, sinon les premières lignes
 * utiles du document (tirées de ses premiers passages, déjà masqués).
 */
function ligneDeCible(cible: CibleExtraction, passages: PassageCompact[]): string {
	if (cible.resume !== null && cible.resume !== '') return cible.resume;
	return ligneDeContexte(passages.slice(0, PASSAGES_DU_DEBUT).map((p) => p.texte).join('\n'));
}

/**
 * Passages d'un Markdown pour une cible : métadonnées (titre, date, auteur) masquées avant de bâtir le préfixe, secrets
 * comptés (texte et métadonnées). `doc` : le document extrait, en repli des métadonnées de la fiche.
 */
export function passagesDeMarkdown(cible: CibleExtraction, markdown: string, doc: DocumentExtrait | null): Extract<ResultatCible, { ok: true }> {
	const { contexte, masques, date } = contexteDe(cible, doc);
	const { passages, sections, secrets } = decouperDocument(markdown, contexte, doc?.pages ?? undefined);
	const dateDuJour = jour(date);
	const avertissements = doc?.avertissements ?? [];
	const ligne = ligneDeCible(cible, passages);
	return {
		ok: true,
		passages: passages.map((p) => ({ ...p, typeSource: cible.typeSource, date: dateDuJour, ligneContexte: ligne })),
		sections,
		secrets: secrets + masques,
		...(avertissements.length > 0 ? { avertissements } : {}),
	};
}

/**
 * Passages d'une partie découpée par `decouper`, pour la cible de la fiche qui la reçoit : même résultat que
 * `passagesDeMarkdown` sur le document de la partie (le préfixe ne dépend que du contexte et des titres du passage).
 */
export function passagesDePartie(cible: CibleExtraction, partie: PartieDecoupee): Extract<ResultatCible, { ok: true }> {
	const { contexte, masques, date } = contexteDe(cible, partie);
	const dateDuJour = jour(date);
	const ligne = ligneDeCible(cible, partie.passages);
	return {
		ok: true,
		passages: partie.passages.map((p) => ({ ...p, prefixe: prefixeDe(contexte, p.titres), typeSource: cible.typeSource, date: dateDuJour, ligneContexte: ligne })),
		sections: partie.sections,
		secrets: partie.secrets + masques,
		...(partie.avertissements !== undefined ? { avertissements: partie.avertissements } : {}),
	};
}

/** Contexte vide : le préfixe est refait par `passagesDePartie`, une fois la fiche nommée. */
const SANS_CONTEXTE: Contexte = { titre: '', date: null, auteur: null, ficheSource: '' };

/** Une pièce jointe d'une partie : son nom et sa position dans le fichier. */
type Piece = { nom: string; position: number };

function partieDe(extrait: DocumentExtrait, fil: string | null, piece: Piece | null): PartieDecoupee {
	const doc = plafonne(extrait);
	const { passages, sections, secrets } = decouperDocument(doc.markdown, SANS_CONTEXTE, doc.pages ?? undefined);
	const partie: PartieDecoupee = { fil, piece: piece?.nom ?? null, position: piece?.position ?? null, format: doc.format, titre: doc.titre, date: doc.date, auteur: doc.auteur, passages, sections, secrets };
	if (doc.avertissements !== undefined && doc.avertissements.length > 0) partie.avertissements = doc.avertissements;
	return partie;
}

/** Une pièce jointe à extraire à part, après son fichier : son nom (qui dit son format), sa position et où la retrouver. */
export type DemandePiece = Piece & { repere: ReperePiece };

/** Nom d'une pièce non indexée, avec sa position : deux pièces de même nom restent deux lignes. */
export const nomDePiece = (p: Piece): string => `${p.nom} (pièce ${p.position})`;

/**
 * Toutes les pièces jointes du fichier (écartées comprises) dans l'ordre où il les contient (plage de leur message, puis
 * rang dans le message), chacune avec sa position (1 = la première) : une boîte qui grandit par la fin garde la position de
 * ses anciennes pièces, et une limite qui change n'en décale aucune.
 */
function piecesDuFichier(fils: DocumentExtrait[]): (DemandePiece & { jointe: PieceJointe })[] {
	return fils
		.flatMap((d) => d.pieces)
		.sort((a, b) => a.repere.debut - b.repere.debut || a.repere.rang - b.repere.rang)
		.map((p, i) => ({ nom: p.nom, position: i + 1, repere: p.repere, jointe: p }));
}

/** « 2 pièces jointes non extraites » : le début de tout avertissement qui compte des pièces. */
function piecesNonExtraites(n: number): string {
	const s = n > 1 ? 's' : '';
	return `${n} pièce${s} jointe${s} non extraite${s}`;
}

/**
 * Pièces non extraites, dites par raison : « 2 pièces jointes non extraites (raison) : a, b », `NOMS_CITES_MAX` noms au plus ;
 * tous sont listés dans la fiche (« Pièces jointes non indexées »).
 */
function avertissementsParRaison(pieces: { nom: string; raison: string }[]): string[] {
	const parRaison = new Map<string, string[]>();
	for (const p of pieces) parRaison.set(p.raison, [...(parRaison.get(p.raison) ?? []), p.nom]);
	return [...parRaison].map(([raison, noms]) => `${piecesNonExtraites(noms.length)} (${raison}) : ${premiersNoms(noms)}`);
}
/**
 * Une pièce extraite (`caracteres` : la longueur de son texte), ou pourquoi elle ne l'est pas ; `plafond` : refusée parce que
 * le texte des pièces du fichier a atteint sa borne (`TEXTE_MAX_PIECES`), les suivantes le sont aussi.
 */
export type IssuePiece = { ok: true; partie: PartieDecoupee; caracteres: number } | { ok: false; motif: string; plafond?: true };

/** Le fichier découpé sans ses pièces jointes, et celles qui restent à extraire (dans l'ordre). */
export type DecoupeSansPieces = { decoupe: FichierDecoupe; aExtraire: DemandePiece[] };
/**
 * Les cibles extraites sans les pièces jointes : `aExtraire[i]`, la pièce de la cible `i` à extraire à part (son résultat
 * reste à faire), sinon null ; `fils` : clés des fils du fichier, s'il en a.
 */
export type ExtraitSansPieces = { resultats: ResultatCible[]; aExtraire: (DemandePiece | null)[]; fils?: string[] };

/**
 * Les deux temps d'une extraction : le fichier sans ses pièces jointes, puis ses pièces, une à une. Séparés pour que
 * `extractionIsolee` fasse le second dans d'autres fils : une pièce lourde ou corrompue n'échoue que pour elle.
 */
export interface EtapesExtraction {
	decouper(chemin: string, contenu: Contenu): Promise<DecoupeSansPieces>;
	extraire(chemin: string, contenu: Contenu, cibles: CibleExtraction[]): Promise<ExtraitSansPieces>;
	/**
	 * Extrait `demandes` dans l'ordre et rend chaque issue dès qu'elle est prête (`budget` : caractères encore admis). Résout
	 * null si toutes ont été rendues, sinon le motif de l'arrêt, dû à la première pièce non rendue.
	 */
	pieces(chemin: string, contenu: Contenu, demandes: DemandePiece[], budget: number, rendre: (issue: IssuePiece) => void): Promise<string | null>;
}

const plafondPieces = (budget: number): string => `texte des pièces jointes du fichier plafonné à ${budget} caractères : pièce non indexée`;

/**
 * Extrait des pièces jointes une à une, dans l'ordre, chacune son échec ; une pièce dont le texte dépasserait `budget` (le
 * reste du plafond du fichier) est refusée, et toutes les suivantes, sans être extraites. Chaque issue est rendue dès
 * qu'elle est prête : un fil isolé qui tombe sur l'une d'elles a déjà transmis les précédentes.
 */
export async function extrairePieces(
	extracteurs: Extracteurs,
	chemin: string,
	contenu: Contenu,
	demandes: DemandePiece[],
	budget: number,
	rendre: (issue: IssuePiece) => void,
): Promise<void> {
	const extracteur = extracteurs.pour(chemin);
	let reste = budget;
	for (const demande of demandes) {
		if (reste < 0) {
			rendre({ ok: false, motif: plafondPieces(budget), plafond: true });
			continue;
		}
		try {
			const pourPiece = extracteurs.pour(demande.nom);
			if (extracteur.piece === undefined) throw new ErreurExtraction(`Pièce jointe « ${demande.nom} » : le format de « ${chemin} » n'a pas de pièces jointes.`);
			// une pièce à la fois : son contenu est décodé, extrait, puis lâché avant la suivante
			const doc = plafonne(await pourPiece.extraire(demande.nom, contenuEnMemoire(await extracteur.piece(contenu, demande.repere))));
			if (doc.markdown.length > reste) {
				reste = -1;
				rendre({ ok: false, motif: plafondPieces(budget), plafond: true });
				continue;
			}
			reste -= doc.markdown.length;
			rendre({ ok: true, partie: partieDe(doc, null, demande), caracteres: doc.markdown.length });
		} catch (erreur) {
			rendre({ ok: false, motif: motifExtraction(erreur) });
		}
	}
}

/**
 * Découpe un fichier neuf en ses parties (voir `Extraction.decouper`), sans ses pièces jointes : celles qui seront lues
 * sont à extraire à part (`aExtraire`), chacune désignée par sa position ; les écartées au balayage (`ecartee` : trop
 * volumineuses, ou binaires sans extracteur) sont listées et dites, sans être relues.
 */
export async function decouperSansPieces(extracteurs: Extracteurs, chemin: string, contenu: Contenu): Promise<DecoupeSansPieces> {
	const extracteur = extracteurs.pour(chemin);
	try {
		const fils = extracteur.extraireTout === undefined ? [await extracteur.extraire(chemin, contenu)] : await extracteur.extraireTout(chemin, contenu);
		if (fils.length === 0) return { decoupe: { ok: false, motif: `Aucun document dans « ${chemin} ».` }, aExtraire: [] };
		const parties = fils.length === 1 ? [partieDe(fils[0]!, null, null)] : fils.map((d, i) => partieDe(d, d.cle ?? `fil-${i + 1}`, null));
		const aExtraire: DemandePiece[] = [];
		const ecartees: (Piece & { raison: string })[] = [];
		for (const { jointe, ...demande } of piecesDuFichier(fils)) {
			if (jointe.ecartee === null) aExtraire.push(demande);
			else ecartees.push({ nom: demande.nom, position: demande.position, raison: jointe.ecartee });
		}
		const avertissements = avertissementsParRaison(ecartees);
		// dit une fois, sur la première partie (le fichier, ou son premier fil)
		if (avertissements.length > 0) parties[0]!.avertissements = [...(parties[0]!.avertissements ?? []), ...avertissements];
		return { decoupe: { ok: true, format: fils[0]!.format, parties, autresPieces: ecartees.map(nomDePiece) }, aExtraire };
	} catch (erreur) {
		return { decoupe: { ok: false, motif: motifExtraction(erreur) }, aExtraire: [] };
	}
}

/** Le fil dont le premier message est le plus ancien (instant illisible : après les autres ; à égalité, le premier rendu). */
function plusAncien(docs: DocumentExtrait[]): DocumentExtrait {
	let choisi = docs[0]!;
	for (const d of docs.slice(1)) if (d.debut !== undefined && (choisi.debut === undefined || d.debut < choisi.debut)) choisi = d;
	return choisi;
}

/**
 * Extrait le fichier une fois (et ses fils une fois), puis découpe chaque cible, sauf les pièces jointes : elles sont
 * retrouvées par leur nom et laissées à extraire à part (`aExtraire`). Une cible en échec rend son motif.
 */
export async function extraireSansPieces(extracteurs: Extracteurs, chemin: string, contenu: Contenu, cibles: CibleExtraction[]): Promise<ExtraitSansPieces> {
	const extracteur = extracteurs.pour(chemin);
	let entier: Promise<DocumentExtrait> | null = null;
	let fils: Promise<DocumentExtrait[]> | null = null;
	/** Les fils du fichier, lus une fois (null si le format n'en a pas). */
	const tous = (): Promise<DocumentExtrait[]> | null => (extracteur.extraireTout === undefined ? null : (fils ??= extracteur.extraireTout(chemin, contenu)));
	const documentEntier = async (): Promise<DocumentExtrait> => {
		const t = tous();
		// Un seul fil : c'est le fichier entier, sans relire le fichier.
		if (t !== null && (await t).length === 1) return (await t)[0]!;
		return (entier ??= extracteur.extraire(chemin, contenu));
	};
	/** Pièces jointes du fichier entier (celles des fils, sans relire le fichier), avec leur position. */
	const piecesDuFichierEntier = async (): Promise<DemandePiece[]> => {
		const t = tous();
		return piecesDuFichier(t === null ? [await documentEntier()] : await t).map(({ jointe: _jointe, ...d }) => d);
	};
	const pieceDe = async (cible: CibleExtraction & { piece: string }): Promise<DemandePiece> => {
		const pieces = await piecesDuFichierEntier();
		const position = positionDeLaPiece(cible.piece, cible.positionPiece, pieces);
		const piece = pieces.find((p) => p.position === position);
		if (piece === undefined) {
			const ou = cible.positionPiece === null ? '' : ` (position ${cible.positionPiece})`;
			throw new ErreurExtraction(`Pièce jointe « ${cible.piece} »${ou} introuvable dans « ${chemin} ».`);
		}
		return piece;
	};
	const documentDe = async (cible: CibleExtraction): Promise<DocumentExtrait> => {
		const t = tous();
		if (cible.fil !== null && t !== null) {
			const docs = await t;
			// Clé stable (fiches récentes), ou rang (fiches d'avant les clés).
			const fil = typeof cible.fil === 'string' ? docs.find((d) => d.cle === cible.fil) : docs[cible.fil];
			if (fil === undefined) throw new ErreurExtraction(`Fil « ${cible.fil} » introuvable dans « ${chemin} ».`);
			return fil;
		}
		if (t !== null) {
			// Fiche d'un fichier qui n'avait qu'un fil et en a plusieurs maintenant : elle garde son fil, le plus ancien ; les
			// autres attendent leur fiche (avis « fils nouveaux »). Jamais le fichier entier sous ce titre.
			const docs = await t;
			if (docs.length > 1) return plusAncien(docs);
		}
		return documentEntier();
	};
	const resultats: ResultatCible[] = [];
	const aExtraire: (DemandePiece | null)[] = [];
	for (const cible of cibles) {
		try {
			if (cible.piece !== null) {
				aExtraire.push(await pieceDe({ ...cible, piece: cible.piece }));
				resultats.push({ ok: false, motif: 'pièce jointe à extraire à part' });
				continue;
			}
			const doc = plafonne(await documentDe(cible));
			resultats.push(passagesDeMarkdown(cible, doc.markdown, doc));
		} catch (erreur) {
			resultats.push({ ok: false, motif: motifExtraction(erreur) });
		}
		aExtraire.push(null);
	}
	const t = tous();
	let cles: string[] | undefined;
	try {
		cles = t === null ? undefined : (await t).flatMap((d) => (d.cle === undefined ? [] : [d.cle]));
	} catch {
		cles = undefined;
	}
	if (cles !== undefined) for (const r of resultats) if (r.ok) r.fils = cles;
	return { resultats, aExtraire, ...(cles !== undefined ? { fils: cles } : {}) };
}

/**
 * Les pièces `demandes`, une à une : à chaque arrêt d'`etapes.pieces` (fil isolé tombé), la pièce en cours échoue seule et
 * les suivantes sont reprises. Le plafond du texte des pièces vaut pour toutes, à travers les reprises.
 */
async function piecesUneAUne(etapes: EtapesExtraction, chemin: string, contenu: Contenu, demandes: DemandePiece[], budget: number): Promise<IssuePiece[]> {
	const issues: IssuePiece[] = [];
	let reste = budget;
	while (issues.length < demandes.length) {
		const arret = await etapes.pieces(chemin, contenu, demandes.slice(issues.length), reste, (issue) => {
			if (issues.length >= demandes.length) return;
			issues.push(issue);
			if (issue.ok) reste -= issue.caracteres;
			else if (issue.plafond === true) reste = -1;
		});
		if (issues.length < demandes.length) issues.push({ ok: false, motif: arret ?? 'extraction de la pièce interrompue' });
	}
	return issues;
}

/** Pièces refusées d'un fichier, dites en avertissements : chacune avec son motif, celles du plafond ensemble. */
function avertissementsPieces(demandes: DemandePiece[], issues: IssuePiece[], budget: number): string[] {
	const avertissements: string[] = [];
	let plafonnees = 0;
	issues.forEach((issue, i) => {
		if (issue.ok) return;
		if (issue.plafond === true) plafonnees++;
		else avertissements.push(`pièce jointe « ${nomDePiece(demandes[i]!)} » non extraite : ${issue.motif}`);
	});
	if (plafonnees > 0) avertissements.push(`${piecesNonExtraites(plafonnees)} : texte des pièces du fichier plafonné à ${budget} caractères`);
	return avertissements;
}

/**
 * Extraction en deux temps (voir `EtapesExtraction`) : le fichier, puis ses pièces jointes une à une, chacune pouvant échouer
 * seule ; une pièce refusée est listée avec les autres pièces non indexées et dite en avertissement. `textePiecesMax` : le
 * plafond du texte de toutes les pièces d'un fichier.
 */
export function extractionEnEtapes(etapes: EtapesExtraction, textePiecesMax: number = TEXTE_MAX_PIECES): Extraction {
	return {
		async decouper(chemin, contenu) {
			const { decoupe, aExtraire } = await etapes.decouper(chemin, contenu);
			if (!decoupe.ok || aExtraire.length === 0) return decoupe;
			const issues = await piecesUneAUne(etapes, chemin, contenu, aExtraire, textePiecesMax);
			const premiere = decoupe.parties[0]!;
			issues.forEach((issue, i) => {
				if (issue.ok) decoupe.parties.push(issue.partie);
				else decoupe.autresPieces.push(nomDePiece(aExtraire[i]!));
			});
			const avertissements = avertissementsPieces(aExtraire, issues, textePiecesMax);
			// dit une fois, sur la première partie (le fichier, ou son premier fil)
			if (avertissements.length > 0) premiere.avertissements = [...(premiere.avertissements ?? []), ...avertissements];
			return decoupe;
		},
		async extraire(chemin, contenu, cibles) {
			const { resultats, aExtraire, fils } = await etapes.extraire(chemin, contenu, cibles);
			const rangs = aExtraire.flatMap((d, i) => (d === null ? [] : [i]));
			if (rangs.length === 0) return resultats;
			const issues = await piecesUneAUne(etapes, chemin, contenu, rangs.map((i) => aExtraire[i]!), textePiecesMax);
			rangs.forEach((i, k) => {
				const issue = issues[k]!;
				if (!issue.ok) {
					resultats[i] = { ok: false, motif: issue.motif };
					return;
				}
				const r = passagesDePartie(cibles[i]!, issue.partie);
				if (fils !== undefined) r.fils = fils;
				resultats[i] = r;
			});
			return resultats;
		},
	};
}

/** Les deux temps dans le processus courant : `pieces` attrape l'échec de chaque pièce et ne s'arrête jamais. */
export function etapesLocales(extracteurs: Extracteurs): EtapesExtraction {
	return {
		decouper: (chemin, contenu) => decouperSansPieces(extracteurs, chemin, contenu),
		extraire: (chemin, contenu, cibles) => extraireSansPieces(extracteurs, chemin, contenu, cibles),
		async pieces(chemin, contenu, demandes, budget, rendre) {
			await extrairePieces(extracteurs, chemin, contenu, demandes, budget, rendre);
			return null;
		},
	};
}

/** Extraction dans le processus courant (tests, et outils qui n'ont pas besoin d'isolement). */
export function extractionLocale(extracteurs: Extracteurs, options: { textePiecesMax?: number } = {}): Extraction {
	return extractionEnEtapes(etapesLocales(extracteurs), options.textePiecesMax);
}

/** Découpe un fichier neuf en ses parties, pièces jointes comprises, dans le processus courant (voir `Extraction.decouper`). */
export function decouperFichier(extracteurs: Extracteurs, chemin: string, contenu: Contenu): Promise<FichierDecoupe> {
	return extractionLocale(extracteurs).decouper(chemin, contenu);
}
