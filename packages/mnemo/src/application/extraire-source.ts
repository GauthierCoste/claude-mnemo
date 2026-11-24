// Référencer un document du dossier par une fiche `source` (jamais copié), puis indexer ses passages.
import { avecAvertissements, avertissementsDe, EMPLACEMENTS_PAR_DEFAUT, TAILLE_MAX_DOCUMENT, tailleLisible } from '@mnemo/commun';
import { cleDeCasse, nomDeFichier, nomDuFichier } from '../domaine/chemin.ts';
import type { ElementIndexe } from '../domaine/elements.ts';
import { lireFiche } from '../domaine/fiche.ts';
import type { Fiche } from '../domaine/fiche.ts';
import { estDocument, estTypeSource, TYPES_SOURCE } from '../domaine/regles.ts';
import type { TypeSource } from '../domaine/regles.ts';
import { masquerSecrets } from '../domaine/secrets.ts';
import { CLE_POSITION_PIECE, descripteurDeSource, EXTENSIONS_EMAIL, extensionDe, ficheDeLienSource, motifSiNonCherchable, positionDeLaPiece } from '../domaine/source.ts';
import type { DescripteurSource } from '../domaine/source.ts';
import { messageDErreur, tronquerTexte } from '../domaine/texte.ts';
import { contenuHache, debutDe } from './contenu.ts';
import type { Trouve } from './chercher.ts';
import {
	aujourdhui,
	cheminDeFiche,
	dossiersManquants,
	ecrireEtCommiter,
	enFichier,
	ficheVide,
	lireFicheExistante,
	motifTitreInvalide,
	sousVerrou,
} from './commun.ts';
import type { AvecAvertissements } from '@mnemo/commun';
import { passagesDePartie } from './extraire-passages.ts';
import { cibleDe } from './passages-sources.ts';
import type { OptionsPassages } from './passages-sources.ts';
import { ErreurFichier } from './ports.ts';
import type { Contenu, Dependances, DocumentOuvert, FichierDecoupe, PartieDecoupee, ResultatCible } from './ports.ts';
import { avertissementsPassages, SANS_EXTRACTION, synchroniser, synchroniserApresEcriture } from './synchroniser.ts';
import { LONGUEUR_MAX_TITRE } from '../domaine/titre.ts';
import { estFichierEntier, sourcesDuCoffre } from './sources.ts';

export type DemandeSource = { chemin: string; type?: TypeSource; version_de?: string; apresProches?: boolean };
export type ResultatSource =
	/**
	 * `passages` : passages indexés pour la fiche et ses filles (fils, pièces jointes) ; `filles` : leurs fiches.
	 * `avertissements` : fiche écrite mais passages non indexés (rattrapés à une recherche), index en échec, extraction
	 * incomplète (texte coupé à `TEXTE_MAX_DOCUMENT`, message trop gros écarté…).
	 */
	| ({ statut: 'ecrit'; fiche: string; passages: number; secrets: number; filles: string[]; commit: string } & AvecAvertissements)
	/**
	 * Le document a déjà sa fiche : même chemin, ou même empreinte exacte. `deplacee` : le fichier de cette fiche avait disparu
	 * et le document est le même, ailleurs : son `chemin` (et celui de ses fils) a été mis à jour, dans `commit`. `ajoutes` :
	 * un `.mbox` déjà référencé a grandi, ses nouveaux fils ont reçu leur fiche (`commit`). `note` : type ou version_de
	 * demandés mais différents de la fiche, laissée telle quelle.
	 */
	| ({ statut: 'deja'; fiche: string; deplacee?: true; ajoutes?: number; commit?: string; note?: string } & AvecAvertissements)
	/** Quasi-copie (≥ SEUIL_QUASI_COPIE de passages communs) d'une source existante : rien n'est écrit, sauf `apresProches`. */
	| { statut: 'proches'; proches: Trouve[] }
	| { statut: 'refuse'; motif: string };

/** Part de passages communs (Jaccard sur les ancres) à partir de laquelle un document est une quasi-copie. */
export const SEUIL_QUASI_COPIE = 0.9;
/** Formats dont un fichier contient plusieurs fils (chacun sa fiche). */
const EXTENSIONS_A_FILS: readonly string[] = ['.mbox'];
const TITRE_AUTRES_PIECES = 'Pièces jointes non indexées';

type Ecrite = { chemin: string; fiche: Fiche; partie: PartieDecoupee | null };
type Decoupe = Extract<FichierDecoupe, { ok: true }>;
/** Une source existante pour ce document ; `document` : le chemin qu'elle référence ; `donnees` : son frontmatter. */
type Existante = { fiche: string; document: string; parChemin: boolean; donnees: Record<string, unknown> };
/** `etat` : (mtime, taille) du fichier à la lecture qui a donné `empreinte` (la synchronisation qui suit ne le relit pas). */
type Demande = { chemin: string; empreinte: string; etat: EtatLu; type: TypeSource; versionDe: string | null };
type EtatLu = { mtimeMs: number; taille: number };
/** Une lecture du fichier : sa découpe (null si elle a échoué), son empreinte et son (mtime, taille), en un parcours. */
type Lecture = { decoupe: Decoupe | null; empreinte: string; etat: EtatLu };

const refuse = (motif: string): ResultatSource => ({ statut: 'refuse', motif });
const message = messageDErreur;
const masque = (texte: string): string => masquerSecrets(texte).texte;
const RE_SUFFIXE = / \(\d+\)\.md$/u;

/** Descripteur gardé dans l'index (JSON), ou null s'il est vide ou illisible. */
function descripteurIndexe(json: string): { source: DescripteurSource; fichier: string | null } | null {
	if (json === '') return null;
	try {
		return JSON.parse(json) as { source: DescripteurSource; fichier: string | null };
	} catch {
		return null;
	}
}

/** Titre de fiche tiré d'une métadonnée de document : secrets masqués, une ligne, borné ; `repli` s'il ne convient pas. */
function titreSur(brut: string | null, repli: string): string {
	const net = masque((brut ?? '').replace(/\s+/gu, ' ').trim()).replace(/^#+\s*/u, '');
	const titre = tronquerTexte(net, LONGUEUR_MAX_TITRE, 'utf16').trim();
	return motifTitreInvalide(titre) === null ? titre : repli;
}

/** Métadonnée à écrire dans le frontmatter : secrets masqués, une ligne ; null si vide. */
function metadonnee(valeur: string | null): string | null {
	const net = valeur?.replace(/\s+/gu, ' ').trim() ?? '';
	return net === '' ? null : masque(net);
}

/**
 * Source qui a déjà ce document (après une synchronisation sans extraction ; les fiches sont relues, pas seulement l'index) :
 * d'abord celle qui référence le même chemin (à la casse près : le document a pu changer, il sera réextrait), sinon celle
 * de même empreinte — celle de l'index (fichier extrait) si connue, sinon la clé `empreinte` de la fiche. Seules les
 * fiches du fichier entier comptent (pas un fil, pas une pièce jointe) ; à égalité, la fiche sans suffixe « (n) », puis
 * l'ordre des chemins. `empreinte` null (pas encore lue) : par le chemin seulement. Null s'il n'y en a pas.
 */
async function sourceExistante(dep: Dependances, chemin: string, empreinte: string | null): Promise<Existante | null> {
	await synchroniser(dep, SANS_EXTRACTION);
	const empreintesIndex = new Map((await dep.index.sources()).map((s) => [s.fiche, s.empreinteFichier]));
	const cle = cleDeCasse(chemin);
	const parChemin: Existante[] = [];
	const parEmpreinte: Existante[] = [];
	for (const { chemin: fiche, fiche: lue, d } of await sourcesDuCoffre(dep)) {
		if (!estFichierEntier(d)) continue;
		const existante = { fiche, document: d.document, parChemin: false, donnees: lue.donnees };
		// L'empreinte de l'index (fichier extrait) l'emporte ; la clé `empreinte` de la fiche ne sert que si l'index n'en a pas
		// (fiche jamais extraite, ou fichier disparu : c'est le cas d'un déplacement).
		const sienne = empreintesIndex.get(fiche) ?? (typeof lue.donnees['empreinte'] === 'string' ? lue.donnees['empreinte'] : null);
		if (cleDeCasse(d.document) === cle) parChemin.push({ ...existante, parChemin: true });
		else if (empreinte !== null && sienne === empreinte) parEmpreinte.push(existante);
	}
	const rang = (e: Existante) => (RE_SUFFIXE.test(e.fiche) ? 1 : 0);
	const premiere = (liste: Existante[]) => liste.sort((a, b) => rang(a) - rang(b) || a.fiche.localeCompare(b.fiche))[0] ?? null;
	return premiere(parChemin) ?? premiere(parEmpreinte);
}

/** Vrai si le fichier référencé n'existe plus (un chemin refusé ou illisible n'est pas « disparu »). */
async function fichierDisparu(dep: Dependances, chemin: string): Promise<boolean> {
	try {
		return (await dep.documents.etat(chemin)) === null;
	} catch {
		return false;
	}
}

/**
 * Le fichier d'une source a été déplacé (même contenu, ailleurs) : son `chemin` et celui de ses fils sont réécrits sous
 * verrou, en un commit, puis ces sources et leurs pièces jointes sont resynchronisées (une extraction). Sous le verrou, si
 * plus aucune fiche ne référence l'ancien chemin (un autre processus l'a fait), rien n'est écrit.
 */
async function deplacer(dep: Dependances, existante: Existante, nouveau: string, lu: Lecture): Promise<ResultatSource> {
	const ecrit = await sousVerrou(dep, async () => {
		const sources = await sourcesDuCoffre(dep);
		const ancien = cleDeCasse(existante.document);
		const aReecrire = sources.filter((s) => s.d.document !== null && cleDeCasse(s.d.document) === ancien);
		if (aReecrire.length === 0) return null;
		const jour = aujourdhui(dep);
		for (const s of aReecrire) {
			s.fiche.donnees['chemin'] = nouveau;
			s.fiche.updated = jour;
		}
		const fichiers = aReecrire.map((s) => enFichier(dep, s.fiche));
		const commit = await ecrireEtCommiter(dep, fichiers, `mnemo: source ${existante.fiche} déplacée`);
		const reecrites = new Set(aReecrire.map((s) => s.chemin));
		const filles = sources.filter((s) => s.d.parente !== null && reecrites.has(s.d.parente));
		const textes = [...fichiers, ...filles.map((s) => ({ chemin: s.chemin, texte: enFichier(dep, s.fiche).texte }))];
		return { commit, aSynchroniser: new Set([...reecrites, ...filles.map((s) => s.chemin)]), textes };
	});
	if (ecrit === null) return { statut: 'deja', fiche: existante.fiche };
	// le fichier vient d'être découpé pour le reconnaître : ses passages servent tels quels
	const dejaExtraites = lu.decoupe === null ? {} : { dejaExtraites: { fichier: nouveau, empreinte: lu.empreinte, etat: lu.etat, resultats: resultatsDesParties(ecrit.textes, lu.decoupe.parties).resultats } };
	const synchro = await synchroniserSans(dep, { extraire: true, seulement: ecrit.aSynchroniser, ...dejaExtraites });
	return { statut: 'deja', fiche: existante.fiche, deplacee: true, commit: ecrit.commit, ...avertissementsDe(synchro) };
}

/**
 * Synchronise sans laisser une erreur de l'index annuler une écriture faite : ses avertissements, plus un par fiche de
 * `fiches` dont les passages n'ont pas pu être indexés.
 */
async function synchroniserSans(dep: Dependances, options: OptionsPassages, fiches: ReadonlySet<string> = new Set()): Promise<AvecAvertissements> {
	const r = await synchroniserApresEcriture(dep, options);
	if (!('bilan' in r)) return r;
	return avecAvertissements(avertissementsPassages(r.bilan, fiches));
}

/**
 * Sources existantes dont le document est une quasi-copie de celui-ci : ancres de passages communes (Jaccard) ≥ seuil,
 * comptées par fichier (les fils d'un `.mbox` ensemble, pièces jointes à part). `versionDe` (et son fichier) est exclu :
 * une nouvelle version ressemble à la précédente par nature.
 */
async function quasiCopies(dep: Dependances, decoupe: Decoupe, versionDe: string | null): Promise<Trouve[]> {
	const ancres = [...new Set(decoupe.parties.filter((p) => p.piece === null).flatMap((p) => p.passages.map((x) => x.ancre)))];
	if (ancres.length === 0) return [];
	const communes = new Map((await dep.index.ancresCommunes(ancres)).map((c) => [c.fiche, c.communes]));
	if (communes.size === 0) return [];

	const groupes = new Map<string, { fiches: { fiche: string; fil: number | string | null }[]; total: number; communes: number }>();
	let exclu: string | null = null;
	for (const s of await dep.index.sources()) {
		const lu = descripteurIndexe(s.descripteur);
		if (lu === null || lu.source.piece !== null) continue;
		const cle = lu.fichier ?? s.fiche;
		if (s.fiche === versionDe) exclu = cle;
		const groupe = groupes.get(cle) ?? { fiches: [], total: 0, communes: 0 };
		groupe.fiches.push({ fiche: s.fiche, fil: lu.source.fil });
		groupe.total += s.passages;
		groupe.communes += communes.get(s.fiche) ?? 0;
		groupes.set(cle, groupe);
	}

	const proches: Trouve[] = [];
	for (const [cle, g] of groupes) {
		if (cle === exclu || g.communes === 0) continue;
		const similarite = g.communes / (ancres.length + g.total - g.communes);
		if (similarite < SEUIL_QUASI_COPIE) continue;
		const fiche = g.fiches.sort((a, b) => Number(a.fil !== null) - Number(b.fil !== null) || a.fiche.localeCompare(b.fiche))[0]!.fiche;
		const e: ElementIndexe | null = await dep.index.element(fiche);
		if (e === null) continue;
		const { niveau: _niveau, dossierProjet: _dossier, ficheCitee: _citee, ...trouve } = e;
		// la similarité des passages tient lieu de note : aucun poids
		proches.push({ ...trouve, score: similarite, base: similarite, apports: [] });
	}
	return proches.sort((a, b) => b.score - a.score);
}

/** Premier chemin libre (à la casse près, fiche ou dossier) parmi `<base>.md`, `<base> (2).md`… */
function cheminLibre(dossier: string, nom: string, pris: (chemin: string) => boolean): string {
	for (let n = 1; ; n++) {
		const chemin = cheminDeFiche(`${dossier}/${n === 1 ? nom : `${nom} (${n})`}.md`);
		if (chemin !== null && !pris(chemin)) return chemin;
	}
}

/** Réserve des chemins libres, à la casse près, parmi les fiches du coffre (fiche ou dossier de même nom = pris). */
type Nommeur = { reserver(dossier: string, nom: string): string; bloquer(chemin: string): void };
export async function nommeur(dep: Dependances): Promise<Nommeur> {
	const existantes = (await dep.coffre.toutesLesFiches()).map(cleDeCasse);
	const reservees = new Set<string>();
	const pris = (candidat: string): boolean => {
		const cle = cleDeCasse(candidat);
		const dossier = cle.replace(/\.md$/u, '/');
		return reservees.has(cle) || existantes.some((e) => e === cle || e.startsWith(dossier));
	};
	return {
		reserver(dossier, nom) {
			const c = cheminLibre(dossier, nom, pris);
			reservees.add(cleDeCasse(c));
			return c;
		},
		bloquer: (chemin) => void reservees.add(cleDeCasse(chemin)),
	};
}

/** Type de source d'un document sans type demandé : `email` pour un courriel, sinon `inconnue`. */
export const typeSourceParDefaut = (chemin: string): TypeSource => (EXTENSIONS_EMAIL.includes(extensionDe(chemin) ?? '') ? 'email' : 'inconnue');

/** Titre d'une source tiré du nom de son fichier (sans extension), quand le document n'en donne pas. */
export const titreDuFichier = (chemin: string): string => titreSur(nomDuFichier(chemin), 'sans-titre');

/** Frontmatter d'une partie de document : format, type, date et auteur (masqués). */
function donneesDocument(partie: PartieDecoupee, type: TypeSource): Record<string, unknown> {
	const d: Record<string, unknown> = { format: partie.format, type_source: type };
	const date = metadonnee(partie.date);
	const auteur = metadonnee(partie.auteur);
	if (date !== null) d['date'] = date;
	if (auteur !== null) d['auteur'] = auteur;
	return d;
}

/** Ce que les filles d'une source partagent : son fichier, son lien, son dossier. */
type Parente = { chemin: string; empreinte: string; type: TypeSource; principal: string };

const dossierDesFilles = (principal: string): string => principal.replace(/\.md$/u, '');
const lienVers = (fiche: string): string => `[[${fiche.replace(/\.md$/u, '')}]]`;

/** Fiches des fils (clé stable dans `fil`) et des pièces jointes d'une source, nommées dans son dossier. */
function fichesFilles(dep: Dependances, parente: Parente, fils: PartieDecoupee[], pieces: PieceANommer[], noms: Nommeur): Ecrite[] {
	const { chemin, empreinte, type, principal } = parente;
	const dossier = dossierDesFilles(principal);
	const lien = lienVers(principal);
	const ecrites: Ecrite[] = [];
	if (fils.length + pieces.length === 0) return ecrites;
	// La fiche du dossier des filles porte le nom du dossier : aucune fille ne la prend (qu'elle existe déjà ou non).
	noms.bloquer(`${dossier}/${nomDuFichier(principal)}.md`);
	for (const [i, fil] of fils.entries()) {
		const titreFil = titreSur(fil.titre, `Fil ${i + 1}`);
		const c = noms.reserver(dossier, nomDeFichier(titreFil));
		const donnees = { chemin, empreinte, ...donneesDocument(fil, type), fil: fil.fil, source_parente: lien };
		ecrites.push({ chemin: c, fiche: ficheVide(dep, c, 'source', titreFil, donnees), partie: fil });
	}
	for (const piece of pieces) {
		const titrePiece = titreSur(piece.piece, 'Pièce jointe');
		const c = noms.reserver(dossier, nomDeFichier(titrePiece));
		const donnees = { source_parente: lien, piece: piece.piece, [CLE_POSITION_PIECE]: piece.position, ...donneesDocument(piece, type) };
		ecrites.push({ chemin: c, fiche: ficheVide(dep, c, 'source', titrePiece, donnees), partie: piece });
	}
	return ecrites;
}
type PieceANommer = PartieDecoupee & { piece: string; position: number };

/**
 * Fiches écrites, plus les fiches de dossier manquantes : à écrire en un commit ; motif si un dossier existe à la casse près.
 * Le dossier des filles d'une source porte le titre du document : il en porte aussi le type (`type_source`), pour être
 * encadré comme lui.
 */
async function avecDossiers(dep: Dependances, ecrites: Ecrite[], type: TypeSource, autres: Fiche[] = []): Promise<{ chemin: string; texte: string }[] | string> {
	const aEcrire = [...ecrites.map((e) => enFichier(dep, e.fiche)), ...autres.map((f) => enFichier(dep, f))];
	const dossiersVus = new Set<string>(aEcrire.map((e) => e.chemin));
	// le dossier des filles est celui qui porte le nom d'une fiche écrite (`<doc>.md` → `<doc>/`), ou un de ses sous-dossiers
	const racinesDesFilles = ecrites.map((e) => e.chemin.replace(/\.md$/u, ''));
	const dossierDesFilles = (ficheDuDossier: string): boolean => {
		const dossier = ficheDuDossier.slice(0, ficheDuDossier.lastIndexOf('/'));
		return racinesDesFilles.some((r) => dossier === r || dossier.startsWith(`${r}/`));
	};
	for (const e of ecrites) {
		const dossiers = await dossiersManquants(dep, e.chemin);
		if (typeof dossiers === 'string') return dossiers;
		for (const dossier of dossiers) {
			if (dossiersVus.has(dossier.chemin)) continue;
			dossiersVus.add(dossier.chemin);
			if (dossierDesFilles(dossier.chemin)) dossier.donnees['type_source'] = type;
			aEcrire.push(enFichier(dep, dossier));
		}
	}
	return aEcrire;
}

const estPiece = (p: PartieDecoupee): p is PieceANommer => p.piece !== null && p.position !== null;

/** Position, parmi les pièces découpées, de la pièce que désigne le descripteur d'une fiche (`positionDeLaPiece`). */
const positionParmi = (d: DescripteurSource & { piece: string }, pieces: PieceANommer[]): number | null =>
	positionDeLaPiece(d.piece, d.positionPiece, pieces.map((p) => ({ nom: p.piece, position: p.position })));

/**
 * Sous verrou : fiche principale, une fiche par fil (s'il y en a plusieurs), une fille par pièce jointe, fiches de dossier
 * manquantes, en un commit. Rend le texte des fiches écrites, ou un motif de refus (dossier existant à la casse près).
 */
async function ecrireFiches(dep: Dependances, demande: Demande, decoupe: Decoupe): Promise<{ commit: string; ecrites: Ecrite[]; textes: Map<string, string> } | string> {
	const { chemin, empreinte, type, versionDe } = demande;
	const noms = await nommeur(dep);
	const contenu = decoupe.parties.filter((p) => p.piece === null);
	const unSeul = contenu.length === 1 ? contenu[0]! : null;
	const titre = titreSur(unSeul?.titre ?? null, titreDuFichier(chemin));
	const principal = noms.reserver(EMPLACEMENTS_PAR_DEFAUT.sources, nomDeFichier(titre));

	const donneesPrincipal: Record<string, unknown> = { chemin, empreinte, ...(unSeul === null ? { format: decoupe.format, type_source: type } : donneesDocument(unSeul, type)) };
	if (versionDe !== null) donneesPrincipal['version_de'] = lienVers(versionDe);
	if (unSeul === null) donneesPrincipal['fils'] = contenu.length;
	const fichePrincipale = ficheVide(dep, principal, 'source', titre, donneesPrincipal);
	noterAutresPieces(fichePrincipale, decoupe.autresPieces);

	const ecrites: Ecrite[] = [
		{ chemin: principal, fiche: fichePrincipale, partie: unSeul },
		...fichesFilles(dep, { chemin, empreinte, type, principal }, unSeul === null ? contenu : [], decoupe.parties.filter(estPiece), noms),
	];
	const aEcrire = await avecDossiers(dep, ecrites, type);
	if (typeof aEcrire === 'string') return aEcrire;
	const commit = await ecrireEtCommiter(dep, aEcrire, `mnemo: source ${principal}`);
	return { commit, ecrites, textes: new Map(aEcrire.map((f) => [f.chemin, f.texte])) };
}

/** Section « Pièces jointes non indexées » de la fiche principale (noms masqués), complétée sans doublon. */
function noterAutresPieces(fiche: Fiche, noms: string[]): void {
	if (noms.length === 0) return;
	const lignes = noms.map((p) => `- ${masque(p).replace(/\s+/gu, ' ')}`);
	const section = fiche.autresSections.find((s) => s.titre === TITRE_AUTRES_PIECES);
	if (section === undefined) fiche.autresSections.push({ titre: TITRE_AUTRES_PIECES, corps: lignes.join('\n') });
	else section.corps = [...new Set([...section.corps.split('\n'), ...lignes])].join('\n');
}

/**
 * Passages déjà extraits pour chaque fiche d'un fichier (la cible que la synchronisation en tirera), d'après les parties
 * découpées : fil par sa clé, pièce jointe par sa position (`positionDeLaPiece`), fichier entier si une seule partie. Une fiche sans partie (conteneur,
 * fil disparu) n'y est pas : la synchronisation la traite comme d'habitude.
 */
function resultatsDesParties(fiches: { chemin: string; texte: string }[], parties: PartieDecoupee[]): { resultats: Map<string, ResultatCible>; secrets: number } {
	const resultats = new Map<string, ResultatCible>();
	let secrets = 0;
	const contenu = parties.filter((p) => p.piece === null);
	for (const f of fiches) {
		let d: DescripteurSource | null;
		try {
			d = descripteurDeSource(lireFiche(f.chemin, f.texte));
		} catch {
			continue;
		}
		if (d === null || d.conteneur || (d.document === null && d.parente === null)) continue;
		const pieces = parties.filter(estPiece);
		const partie =
			d.piece !== null
				? pieces.find((p) => p.position === positionParmi({ ...d, piece: d.piece! }, pieces))
				: d.fil !== null
					? contenu.find((p) => p.fil === d.fil)
					: contenu.length === 1
						? contenu[0]
						: undefined;
		if (partie === undefined) continue;
		const r = passagesDePartie(cibleDe(f.chemin, d), partie);
		resultats.set(f.chemin, r);
		secrets += r.secrets;
	}
	return { resultats, secrets };
}

/**
 * Un `.mbox` déjà référencé (même chemin) a pu grandir : les fils (et pièces jointes) sans fiche reçoivent la leur, sous
 * verrou, en un commit ; la fiche du fichier devient (ou reste) conteneur, `fils` à jour. Puis ces sources sont
 * synchronisées avec les passages extraits ici. Rien de nouveau (ou fiches de fils à l'ancienne, par rang) : null.
 */
async function completerFils(dep: Dependances, existante: Existante, demande: Demande, decoupe: Decoupe): Promise<({ ajoutes: number; commit: string } & AvecAvertissements) | null> {
	const contenu = decoupe.parties.filter((p) => p.piece === null);
	if (contenu.length < 2 && !decoupe.parties.some(estPiece)) return null;
	const ecrit = await sousVerrou(dep, async () => {
		const sources = await sourcesDuCoffre(dep);
		const principale = sources.find((s) => s.chemin === existante.fiche);
		if (principale === undefined || principale.d.document === null) return null;
		const cle = cleDeCasse(principale.d.document);
		const duFichier = sources.filter((s) => (s.d.document !== null && cleDeCasse(s.d.document) === cle) || s.d.parente === existante.fiche);
		if (duFichier.some((s) => typeof s.d.fil === 'number')) return null;
		const clesConnues = new Set(duFichier.flatMap((s) => (typeof s.d.fil === 'string' ? [s.d.fil] : [])));
		const pieces = decoupe.parties.filter(estPiece);
		const piecesConnues = new Set(duFichier.flatMap((s) => (s.d.piece === null ? [] : [positionParmi({ ...s.d, piece: s.d.piece }, pieces)])));
		const nouveauxFils = contenu.length < 2 ? [] : contenu.filter((p) => p.fil !== null && !clesConnues.has(p.fil));
		const nouvellesPieces = pieces.filter((p) => !piecesConnues.has(p.position));
		if (nouveauxFils.length === 0 && nouvellesPieces.length === 0) return null;

		const noms = await nommeur(dep);
		const parente = { chemin: principale.d.document, empreinte: demande.empreinte, type: principale.d.typeSource, principal: existante.fiche };
		const ecrites = fichesFilles(dep, parente, nouveauxFils, nouvellesPieces, noms);
		const fiche = principale.fiche;
		// `fils` : le nombre réel de fils du fichier (un fil réuni à un autre par une réponse n'en est plus un).
		if (contenu.length >= 2) fiche.donnees['fils'] = contenu.length;
		fiche.updated = aujourdhui(dep);
		noterAutresPieces(fiche, decoupe.autresPieces);
		const aEcrire = await avecDossiers(dep, ecrites, parente.type, [fiche]);
		if (typeof aEcrire === 'string') return null;
		// Une fiche seule qui devient conteneur couvrait déjà un fil (le plus ancien) : il reçoit sa fiche, sans être nouveau.
		const ajoutes = nouveauxFils.length - (nouveauxFils.length > 0 && !principale.d.conteneur && clesConnues.size === 0 ? 1 : 0);
		const quoi =
			ajoutes > 0
				? ajoutes > 1 ? `${ajoutes} fils ajoutés` : '1 fil ajouté'
				: nouveauxFils.length > 0
					? 'fils séparés'
					: nouvellesPieces.length > 1 ? `${nouvellesPieces.length} pièces jointes ajoutées` : '1 pièce jointe ajoutée';
		const commit = await ecrireEtCommiter(dep, aEcrire, `mnemo: source ${existante.fiche} — ${quoi}`);
		const autres = duFichier.filter((s) => s.chemin !== existante.fiche).map((s) => ({ chemin: s.chemin, texte: enFichier(dep, s.fiche).texte }));
		return { commit, ajoutes, fiches: [...aEcrire, ...autres] };
	});
	if (ecrit === null) return null;
	const { resultats } = resultatsDesParties(ecrit.fiches, decoupe.parties);
	const seulement = new Set(ecrit.fiches.map((f) => f.chemin));
	const synchro = await synchroniserSans(dep, { extraire: true, seulement, dejaExtraites: { fichier: demande.chemin, empreinte: demande.empreinte, etat: demande.etat, resultats } });
	return { ajoutes: ecrit.ajoutes, commit: ecrit.commit, ...avertissementsDe(synchro) };
}

/** Ce que la demande précisait (type, version_de) et que la fiche existante ne dit pas : laissé tel quel, signalé. */
function noteDifferences(existante: Existante, demande: DemandeSource, versionDe: string | null): string | null {
	const differents: string[] = [];
	if (demande.type !== undefined && existante.donnees['type_source'] !== demande.type) differents.push('type');
	if (versionDe !== null && ficheDeLienSource(existante.donnees['version_de']) !== versionDe) differents.push('version_de');
	return differents.length === 0 ? null : `déjà référencée ; ${differents.join(' et ')} inchangé${differents.length > 1 ? 's' : ''} — modifie la fiche ${existante.fiche}`;
}

/**
 * `deja` pour une source existante. Son fichier disparu (même contenu, ailleurs) : déplacée vers `chemin`. Même chemin et
 * fichier à plusieurs fils : `lire` (découpe et empreinte, en un seul parcours) donne les fils nouveaux, qui reçoivent leur
 * fiche (`ajoutes`) ; sinon le fichier n'est pas lu.
 */
async function dejaPour(
	dep: Dependances,
	existante: Existante,
	demande: Omit<Demande, 'empreinte' | 'etat'>,
	brute: DemandeSource,
	lire: () => Promise<Lecture | ResultatSource>,
): Promise<ResultatSource> {
	let resultat: ResultatSource = { statut: 'deja', fiche: existante.fiche };
	if (!existante.parChemin && (await fichierDisparu(dep, existante.document))) {
		const lecture = await lire();
		if ('statut' in lecture) return lecture;
		resultat = await deplacer(dep, existante, demande.chemin, lecture);
	} else if (existante.parChemin && EXTENSIONS_A_FILS.includes(extensionDe(demande.chemin)!)) {
		const lecture = await lire();
		if ('statut' in lecture) return lecture;
		const { decoupe, empreinte, etat } = lecture;
		const ajout = decoupe === null ? null : await completerFils(dep, existante, { ...demande, empreinte, etat }, decoupe);
		if (ajout !== null) resultat = { statut: 'deja', fiche: existante.fiche, ajoutes: ajout.ajoutes, commit: ajout.commit, ...avertissementsDe(ajout) };
	}
	const note = noteDifferences(existante, brute, demande.versionDe);
	if (note !== null && resultat.statut === 'deja') resultat.note = note;
	return resultat;
}

/**
 * Référence un document du dossier Mnemo par une fiche `sources/<titre>.md` (le document n'est jamais copié), puis indexe
 * ses passages. Dans l'ordre : chemin (racine, « ./ » toléré, ni `_mnemo/` ni `.mnemo/`, rien de caché, pas de lien
 * symbolique, ≤ `TAILLE_MAX_DOCUMENT` (10 Go) ; gardé dans sa casse sur le disque) ; une source qui a déjà ce chemin, ou la même
 * empreinte → `deja` (même empreinte et son fichier disparu : la source est déplacée vers ce chemin) ; extraction (une fois,
 * hors verrou ; document vide, ou binaire sans extracteur dédié → refus) ; quasi-copie → `proches` (sauf `apresProches`) ; écriture sous verrou, après une
 * nouvelle vérification des doublons (un autre processus a pu écrire entre-temps), en un commit ; enfin synchronisation de
 * ces seules sources, avec les passages déjà extraits.
 */
export async function extraireSource(dep: Dependances, demande: DemandeSource): Promise<ResultatSource> {
	let chemin = demande.chemin.replace(/\\/gu, '/').replace(/^(?:\.\/)+/u, '');
	const type: TypeSource = demande.type ?? typeSourceParDefaut(chemin);
	if (!estTypeSource(type)) return refuse(`Type de source inconnu : « ${String(type)} » (attendu l'un de ${TYPES_SOURCE.join(', ')}).`);
	if (!estDocument(type)) {
		return refuse(`Le type « ${type} » désigne une personne ou une session, pas un document : choisis un type de document (${TYPES_SOURCE.filter(estDocument).join(', ')}).`);
	}

	let versionDe: string | null = null;
	if (demande.version_de !== undefined) {
		const cible = ficheDeLienSource(demande.version_de);
		if (cible === null) return refuse(`version_de doit désigner une fiche source, « chemin » ou « [[chemin]] » : « ${demande.version_de} ».`);
		const fiche = await lireFicheExistante(dep, cible);
		if (typeof fiche === 'string') return refuse(`version_de : ${fiche}`);
		if (fiche.type !== 'source') return refuse(`version_de : ${cible} n'est pas une fiche source.`);
		versionDe = cible;
	}

	let ouvert: DocumentOuvert | null;
	let etatLu: EtatLu;
	try {
		const etat = await dep.documents.etat(chemin);
		if (etat === null) return refuse(`Document introuvable : « ${chemin} ».`);
		etatLu = etat;
		if (etat.taille > TAILLE_MAX_DOCUMENT) return refuse(`Document trop volumineux : « ${chemin} » (plus de ${tailleLisible(TAILLE_MAX_DOCUMENT)}).`);
		// La fiche garde le chemin tel qu'il est écrit sur le disque : « Docs/CDC.md » et « docs/cdc.md » sont le même fichier.
		chemin = (await dep.documents.cheminReel(chemin)) ?? chemin;
		ouvert = await dep.documents.ouvrir(chemin);
	} catch (erreur) {
		return refuse(erreur instanceof ErreurFichier ? erreur.message : `Lecture impossible : « ${chemin} » (${message(erreur)}).`);
	}
	if (ouvert === null) return refuse(`Document introuvable : « ${chemin} ».`);

	// Le document est lu par l'extraction à sa demande, haché pendant ce même parcours, jamais chargé d'un bloc ; fermé ensuite.
	let empreinte: string;
	let decoupe: FichierDecoupe;
	const lecture = (erreur: unknown) => refuse(`Lecture impossible : « ${chemin} » (${message(erreur)}).`);
	try {
		let debut: Uint8Array;
		try {
			debut = await debutDe(ouvert);
		} catch (erreur) {
			return lecture(erreur);
		}
		// un binaire sans extracteur est refusé sur ses premiers octets, avant toute lecture du reste
		const motif = motifSiNonCherchable(chemin, debut);
		if (motif !== null) return refuse(motif);
		const lu = contenuHache(ouvert);
		const decouperEtHacher = async (): Promise<{ decoupe: FichierDecoupe; empreinte: string } | ResultatSource> => {
			const d = await dep.extraction.decouper(chemin, lu.contenu);
			try {
				return { decoupe: d, empreinte: await lu.empreinte() };
			} catch (erreur) {
				return lecture(erreur);
			}
		};
		// déjà référencé par ce chemin : rien n'est extrait (sauf une boîte, pour ses fils nouveaux)
		const parChemin = await sourceExistante(dep, chemin, null);
		if (parChemin !== null) {
			return await dejaPour(dep, parChemin, { chemin, type, versionDe }, demande, async () => {
				const decoupee = await decouperEtHacher();
				return 'statut' in decoupee ? decoupee : { decoupe: decoupee.decoupe.ok ? decoupee.decoupe : null, empreinte: decoupee.empreinte, etat: etatLu };
			});
		}
		const decoupee = await decouperEtHacher();
		if ('statut' in decoupee) return decoupee;
		({ decoupe, empreinte } = decoupee);
		const avant = await sourceExistante(dep, chemin, empreinte);
		const deja = decoupe.ok ? decoupe : null;
		if (avant !== null) return await dejaPour(dep, avant, { chemin, type, versionDe }, demande, async () => ({ decoupe: deja, empreinte, etat: etatLu }));
	} finally {
		await ouvert.fermer();
	}
	const pourDeja: Demande = { chemin, empreinte, etat: etatLu, type, versionDe };
	if (!decoupe.ok) return refuse(decoupe.motif);
	if (decoupe.parties.every((p) => p.passages.length === 0)) {
		// ce que l'extraction a dit (pages scannées, texte écarté…) explique le vide
		const pourquoi = decoupe.parties.flatMap((p) => p.avertissements ?? []);
		return refuse(`Document vide : aucun texte n'a pu être extrait de « ${chemin} »${pourquoi.length > 0 ? ` (${pourquoi.join(' ; ')})` : ''}.`);
	}

	if (demande.apresProches !== true) {
		const proches = await quasiCopies(dep, decoupe, versionDe);
		if (proches.length > 0) return { statut: 'proches', proches };
	}

	const ecriture = await sousVerrou(dep, async () => {
		// Un autre processus a pu référencer ce document pendant l'extraction : alors rien n'est écrit.
		const pendant = await sourceExistante(dep, chemin, empreinte);
		if (pendant !== null) return pendant;
		return ecrireFiches(dep, { chemin, empreinte, etat: etatLu, type, versionDe }, decoupe);
	});
	if (typeof ecriture === 'string') return refuse(ecriture);
	if ('fiche' in ecriture) return dejaPour(dep, ecriture, pourDeja, demande, async () => ({ decoupe, empreinte, etat: etatLu }));
	const { commit, ecrites, textes } = ecriture;

	// Passages déjà extraits, pour la cible que la synchronisation tirera de chaque fiche écrite : rien n'est extrait deux fois.
	const { resultats, secrets } = resultatsDesParties([...textes].map(([c, texte]) => ({ chemin: c, texte })), decoupe.parties);
	const sources = new Set(ecrites.map((e) => e.chemin));
	const avertissements = [...((await synchroniserSans(dep, { extraire: true, seulement: sources, dejaExtraites: { fichier: chemin, empreinte, etat: etatLu, resultats } }, sources)).avertissements ?? [])];
	let passages = 0;
	try {
		for (const s of await dep.index.sources()) if (sources.has(s.fiche)) passages += s.passages;
	} catch (erreur) {
		if (avertissements.length === 0) avertissements.push(`passages non comptés : index indisponible (${message(erreur)})`);
	}
	// une pièce jointe dit son nom ; le fichier lui-même, non
	const incompletes = decoupe.parties.flatMap((p) => (p.avertissements ?? []).map((a) => (p.piece === null ? a : `${p.piece} : ${a}`)));
	if (incompletes.length > 0) avertissements.push(`extraction incomplète : ${incompletes.join(' ; ')}`);
	return { statut: 'ecrit', fiche: ecrites[0]!.chemin, passages, secrets, filles: ecrites.slice(1).map((e) => e.chemin), commit, ...avecAvertissements(avertissements) };
}
