import { empreinte } from '../domaine/empreinte.ts';
import { ecrireFait } from '../domaine/fait.ts';
import type { Fait } from '../domaine/fait.ts';
import { lireFiche } from '../domaine/fiche.ts';
import type { Fiche } from '../domaine/fiche.ts';
import { reecrireLiens } from '../domaine/liens-ecrits.ts';
import { ancresDeLigne, appliquerLot, MOTIF_MAX_LOT } from '../domaine/lot.ts';
import type { ContexteLot, GenreLot, LigneDeLot, Lot, LotDecide, SourceConnue } from '../domaine/lot.ts';
import { ancreDeSuite, lienRenumerote } from '../domaine/renumerotation.ts';
import type { TypeSource } from '../domaine/regles.ts';
import type { AvecAvertissements } from '@mnemo/commun';
import { ancreDeFait, aujourdhui, avecIdentifiant, cheminDeFiche, cheminExistant, ecrireEtCommiter, motifCheminInvalide, sousVerrou, texteDeFiche } from './commun.ts';
import { motifIntouchable, reecrituresASignaler } from './entretien/garde.ts';
import { lireLaMemoire, relationsAssainies } from './entretien/memoire-lue.ts';
import type { MemoireLue } from './entretien/memoire-lue.ts';
import { sourcesDuFait } from './entretien/sources-du-fait.ts';
import type { Dependances } from './ports.ts';
import { chargerRegles } from './regles-du-coffre.ts';
import { reindexerApresEcriture } from './synchroniser.ts';

/**
 * Lot d'informations proposé par l'archiviste (`entretenir` › `proposer_lot`) sur la fiche `id` : enregistré dans l'état
 * local, jamais appliqué ici. Seul l'utilisateur le valide (ligne par ligne s'il veut) ou le rejette, par le service.
 */
export type DemandeLot = { action: 'proposer_lot'; id: string; genre: GenreLot; lignes: LigneDeLot[]; motif: string };

/** Lot enregistré : son identifiant ; `decides` : sort des lots décidés depuis la proposition précédente, les plus récents d'abord. */
export type ResultatLotPropose = { statut: 'lot_propose'; lot: string; fiche: string; genre: GenreLot; lignes: number; decides: LotDecide[] };

/** Une information telle qu'écrite dans la fiche (sa ligne, sa citation, ses corroborations) ; `lignes` vide : absente. */
export type InformationDuLot = { ancre: string; lignes: string[] };
/**
 * Une ligne d'un lot en attente, pour la revoir : `indice` (à renvoyer pour la valider), les informations visées telles
 * qu'elles sont (`avant`), et l'information qui reste une fois la ligne appliquée seule (`apres` : la gardée d'une fusion,
 * la confirmée ; null pour une suppression) ; `motif` : pourquoi elle ne s'appliquerait pas seule (null sinon).
 */
export type LigneDeLotDetaillee = { indice: number; ligne: LigneDeLot; avant: InformationDuLot[]; apres: InformationDuLot | null; motif: string | null };
/** Un lot en attente : `titre` de la fiche (null si illisible ou absente) ; `perime` : la fiche a changé depuis la proposition. */
export type LotDetaille = Omit<Lot, 'lignes' | 'empreinte'> & { titre: string | null; perime: boolean; lignes: LigneDeLotDetaillee[] };

export type ResultatValidationLot =
	| ({ statut: 'valide'; lot: string; fiche: string; commit: string; lignes: number[]; changements: string[] } & AvecAvertissements)
	/** Lot inconnu ou déjà décidé. */
	| { statut: 'inconnu'; motif: string }
	/** La fiche a changé depuis la proposition : le lot est écarté (sort `perime`), rien n'est écrit. */
	| { statut: 'perime'; motif: string }
	/** Choix de lignes invalide, ou lignes qui ne s'appliquent pas : le lot reste en attente, rien n'est écrit. */
	| { statut: 'refuse'; motif: string };

const VERBES: Record<GenreLot, string> = { fusionner: 'fusionne', supprimer: 'supprime', confirmer: 'confirme' };
/** Lots décidés rendus à l'archiviste avec sa nouvelle proposition. */
const DECIDES_RENDUS = 20;
/** Lots en attente de l'utilisateur, au plus : au-delà, une proposition est refusée (qu'il décide d'abord). */
export const LOTS_EN_ATTENTE_MAX = 50;
const PERIME = (chemin: string) => `La fiche ${chemin} a changé depuis la proposition du lot : il est écarté, l'archiviste le reproposera.`;

const refus = (motif: string) => ({ statut: 'refuse' as const, motif });

function lire(chemin: string, texte: string): Fiche | string {
	try {
		return lireFiche(chemin, texte);
	} catch (erreur) {
		return erreur instanceof Error ? erreur.message : String(erreur);
	}
}

/** Les ancres nues des lignes, chacune lue comme `ancreDeFait` (« f-0001 », « ^f-0001 », « chemin#^f-0001 ») ; motif sinon. */
function lignesNormalisees(lignes: readonly LigneDeLot[], chemin: string): LigneDeLot[] | string {
	const nue = (brut: string): string | { motif: string } => {
		const r = ancreDeFait(brut, chemin);
		return 'motif' in r ? r : r.ancre;
	};
	const sortie: LigneDeLot[] = [];
	for (const [i, ligne] of lignes.entries()) {
		const ancres = ancresDeLigne(ligne).map(nue);
		const faute = ancres.find((a) => typeof a !== 'string');
		if (faute !== undefined) return `ligne ${i + 1} : ${(faute as { motif: string }).motif}`;
		const [premiere, ...reste] = ancres as string[];
		sortie.push('ancre' in ligne ? { ancre: premiere! } : { garder: premiere!, absorber: reste });
	}
	return sortie;
}

/** Contexte d'application : règles du coffre, jour, et sources de chaque information ancrée (liens résolus par `memoire`). */
async function contexteDe(dep: Dependances, fiche: Fiche, designee: MemoireLue['designee'] | undefined): Promise<ContexteLot> {
	const cache = new Map<string, TypeSource>();
	const sources = new Map<string, SourceConnue[]>();
	for (const l of fiche.faits) {
		if ('fait' in l && l.fait.ancre !== undefined) sources.set(l.fait.ancre, await sourcesDuFait(dep, l.fait, designee, cache));
	}
	return { regles: await chargerRegles(dep), jour: aujourdhui(dep), sources };
}

/** Motif de refus d'une fiche que les lots ne touchent pas (consigne, profil, chemin fixe), sinon null. */
const motifFiche = (chemin: string, fiche: Fiche): string | null => motifIntouchable(chemin, fiche.type, [], false);

/**
 * Enregistre un lot proposé par l'archiviste, sans rien écrire dans la mémoire : ancres validées et lot essayé sur la fiche
 * telle qu'elle est (il doit s'appliquer en entier), empreinte de la fiche notée. Refusé : fiche absente, illisible, consigne,
 * profil, chemin fixe ; motif vide ou de plusieurs lignes ; ligne invalide ; information déjà visée par un lot en attente ;
 * `LOTS_EN_ATTENTE_MAX` lots déjà en attente. Un lot en attente sur la même fiche, proposé sur un autre texte (la fiche a
 * changé depuis), est écarté (`perime`) : il ne bloque plus rien. Rend l'identifiant du lot et le sort des lots décidés depuis la proposition précédente.
 */
export async function proposerLot(dep: Dependances, demande: DemandeLot): Promise<ResultatLotPropose | { statut: 'refuse'; motif: string }> {
	const chemin = cheminDeFiche(demande.id);
	if (chemin === null) return refus(motifCheminInvalide(demande.id));
	const motif = demande.motif.trim();
	if (motif === '') return refus('Le motif est vide : dis en une ligne pourquoi ce lot (« 11 doublons de la réunion du 3 »).');
	if (motif.length > MOTIF_MAX_LOT || /[\r\n]/u.test(motif)) return refus(`Le motif tient sur une ligne de ${MOTIF_MAX_LOT} caractères au plus.`);
	const lignes = lignesNormalisees(demande.lignes, chemin);
	if (typeof lignes === 'string') return refus(lignes);
	const variante = await cheminExistant(dep, chemin);
	if (variante !== null) return refus(variante);

	const memoire = await lireLaMemoire(dep);
	const texte = memoire.textes.get(chemin);
	if (texte === undefined) return refus(`La fiche ${chemin} n'existe pas.`);
	const fiche = lire(chemin, texte);
	if (typeof fiche === 'string') return refus(fiche);
	const intouchable = motifFiche(chemin, fiche);
	if (intouchable !== null) return refus(intouchable);
	const essai = appliquerLot(fiche, demande.genre, lignes, await contexteDe(dep, fiche, memoire.designee));
	if ('motif' in essai) return refus(essai.motif);

	const empreinteFiche = empreinte(texte);
	const enAttente: Lot[] = [];
	for (const autre of await dep.lots.enAttente()) {
		if (autre.fiche === chemin && autre.empreinte !== empreinteFiche) await dep.lots.decider(autre.id, { sort: 'perime' }, dep.systeme.maintenant().getTime());
		else enAttente.push(autre);
	}
	if (enAttente.length >= LOTS_EN_ATTENTE_MAX) return refus(`${enAttente.length} lots attendent déjà l'utilisateur (${LOTS_EN_ATTENTE_MAX} au plus) : signale-les-lui, et propose la suite après ses décisions.`);
	const visees = new Set(lignes.flatMap(ancresDeLigne));
	for (const autre of enAttente) {
		if (autre.fiche !== chemin) continue;
		const commune = autre.lignes.flatMap(ancresDeLigne).find((a) => visees.has(a));
		if (commune !== undefined) return refus(`Le lot ${autre.id}, en attente de l'utilisateur, vise déjà ^${commune} de ${chemin} : attends sa décision.`);
	}
	const decidesTous = await dep.lots.decides(-1, 200);
	const precedente = Math.max(-1, ...enAttente.map((l) => l.proposeMs), ...decidesTous.map((l) => l.proposeMs));
	const lot: Lot = { id: dep.systeme.nouvelId(), genre: demande.genre, fiche: chemin, lignes, motif, empreinte: empreinteFiche, proposeMs: dep.systeme.maintenant().getTime(), session: dep.origine?.session ?? null };
	await dep.lots.enregistrer(lot);
	const decides = decidesTous.filter((l) => l.decideMs >= precedente).slice(0, DECIDES_RENDUS);
	return { statut: 'lot_propose', lot: lot.id, fiche: chemin, genre: lot.genre, lignes: lignes.length, decides };
}

const informationDe = (fiche: Fiche, ancre: string): InformationDuLot => {
	let fait: Fait | undefined;
	for (const l of fiche.faits) if ('fait' in l && l.fait.ancre === ancre) fait = l.fait;
	return { ancre, lignes: fait === undefined ? [] : ecrireFait(fait) };
};

/**
 * Les lots en attente, les plus anciens d'abord, chacun avec ses lignes à revoir (avant, après) sur la fiche telle qu'elle
 * est. La mémoire n'est lue en entier (résolution des liens des sources) que si un lot de fusion attend.
 */
export async function lotsEnAttente(dep: Dependances): Promise<LotDetaille[]> {
	const lots = await dep.lots.enAttente();
	const memoire = lots.some((l) => l.genre === 'fusionner') ? await lireLaMemoire(dep) : null;
	const detailles: LotDetaille[] = [];
	for (const lot of lots) {
		const { lignes, empreinte: empreinteLot, ...reste } = lot;
		const texte = memoire?.textes.get(lot.fiche) ?? (await dep.coffre.lire(lot.fiche));
		const fiche = texte === null || texte === undefined ? null : lire(lot.fiche, texte);
		const lue = typeof fiche === 'string' ? null : fiche;
		const contexte = lue === null ? null : await contexteDe(dep, lue, memoire?.designee);
		detailles.push({
			...reste,
			titre: lue?.titre ?? null,
			perime: texte === null || texte === undefined || empreinte(texte) !== empreinteLot,
			lignes: lignes.map((ligne, indice) => {
				if (lue === null || contexte === null) return { indice, ligne, avant: ancresDeLigne(ligne).map((ancre) => ({ ancre, lignes: [] })), apres: null, motif: `La fiche ${lot.fiche} est absente ou illisible.` };
				const avant = ancresDeLigne(ligne).map((ancre) => informationDe(lue, ancre));
				const seule = lireFiche(lot.fiche, texte as string);
				const r = appliquerLot(seule, lot.genre, [ligne], contexte);
				if ('motif' in r) return { indice, ligne, avant, apres: null, motif: r.motif };
				return { indice, ligne, avant, apres: lot.genre === 'supprimer' ? null : informationDe(seule, ancresDeLigne(ligne)[0]!), motif: null };
			}),
		});
	}
	return detailles;
}

/** Motif d'un choix de lignes invalide (vide, en double, hors du lot, non entier), sinon null. */
function motifDuChoix(indices: readonly number[], nombre: number): string | null {
	if (indices.length === 0) return 'Aucune ligne choisie : coche au moins une ligne, ou rejette le lot.';
	if (new Set(indices).size !== indices.length) return 'Une ligne est choisie deux fois.';
	const hors = indices.find((i) => !Number.isInteger(i) || i < 0 || i >= nombre);
	return hors === undefined ? null : `Ligne ${String(hors)} : hors du lot (indices de 0 à ${nombre - 1}).`;
}

/**
 * Valide un lot (utilisateur seulement, par le service) : applique les lignes `indices` (toutes ou une partie) en un commit
 * `mnemo: <verbe> <n> information(s) <fiche>`, sous verrou, puis réindexe. Refusé (lot gardé) : choix invalide, lignes qui
 * ne s'appliquent pas. La fiche a changé depuis la proposition : le lot est écarté (`perime`), à reproposer. Les liens
 * `[[fiche#^f-X]]` de toute la mémoire vers une absorbée visent la gardée ; vers une supprimée, ils perdent leur ancre ; une
 * relation devenue doublon d'une autre, ou relation de la fiche vers elle-même, est retirée (`relationsAssainies`).
 */
export async function validerLot(dep: Dependances, id: string, indices: readonly number[]): Promise<ResultatValidationLot> {
	const resultat = await sousVerrou<ResultatValidationLot>(dep, async () => {
		const lot = await dep.lots.lire(id);
		if (lot === null) return { statut: 'inconnu', motif: `Le lot ${id} n'existe pas ou a déjà été décidé.` };
		const motifChoix = motifDuChoix(indices, lot.lignes.length);
		if (motifChoix !== null) return refus(motifChoix);
		const chemin = lot.fiche;
		const memoire = await lireLaMemoire(dep);
		const texte = memoire.textes.get(chemin);
		const perime = async (motif: string): Promise<ResultatValidationLot> => {
			await dep.lots.decider(lot.id, { sort: 'perime' }, dep.systeme.maintenant().getTime());
			return { statut: 'perime', motif };
		};
		if (texte === undefined || empreinte(texte) !== lot.empreinte) return perime(PERIME(chemin));
		const fiche = lire(chemin, texte);
		if (typeof fiche === 'string') return perime(`${fiche} Le lot est écarté.`);
		// la fiche est devenue consigne ou profil, ou a été rangée sous un chemin fixe : le lot n'a plus d'objet
		const intouchable = motifFiche(chemin, fiche);
		if (intouchable !== null) return perime(`${intouchable} Le lot est écarté.`);
		const choisis = [...indices].sort((a, b) => a - b);
		const applique = appliquerLot(fiche, lot.genre, choisis.map((i) => lot.lignes[i]!), await contexteDe(dep, fiche, memoire.designee));
		if ('motif' in applique) return refus(applique.motif);

		// liens vers une information qui disparaît : vers la gardée (fusion), ou sans ancre (suppression)
		const touchees = new Set([...applique.suivies.keys(), ...applique.retirees]);
		const reecrire = (t: string) =>
			reecrireLiens(t, (cible, suite) => {
				if (memoire.designee(cible) !== chemin) return null;
				const ancre = ancreDeSuite(suite);
				return ancre !== null && touchees.has(ancre) ? lienRenumerote(cible, suite, chemin, chemin, applique.suivies) : null;
			});
		// une relation devenue relation vers la fiche elle-même, ou en double d'une autre, est retirée (comme `fusionner`)
		const aEcrire = [{ chemin, texte: relationsAssainies(dep, memoire, chemin, reecrire(texteDeFiche(dep, applique.fiche))) }];
		for (const [autre, t] of memoire.textes) {
			if (autre === chemin) continue;
			const neuf = reecrire(t);
			if (neuf !== t) aEcrire.push({ chemin: autre, texte: avecIdentifiant(dep, autre, relationsAssainies(dep, memoire, autre, neuf)) });
		}
		const n = choisis.length;
		const commit = await ecrireEtCommiter(dep, aEcrire, `mnemo: ${VERBES[lot.genre]} ${n} information${n > 1 ? 's' : ''} ${chemin}`);
		const note = await dep.lots.decider(lot.id, { sort: 'valide', lignes: choisis, commit }, dep.systeme.maintenant().getTime());
		const changements = [...applique.changements, ...(aEcrire.length > 1 ? [`liens réécrits dans ${aEcrire.length - 1} autre(s) fiche(s)`] : [])];
		const aSignaler = reecrituresASignaler(memoire.textes, aEcrire.slice(1).map((f) => f.chemin));
		const avertissements = [
			...(aSignaler.length > 0 ? [`à signaler à l'utilisateur : liens réécrits dans ${aSignaler.join(', ')}`] : []),
			...(note ? [] : [`Le lot ${lot.id} a été décidé ailleurs pendant sa validation : ses lignes sont pourtant appliquées (commit ${commit}).`]),
		];
		return { statut: 'valide', lot: lot.id, fiche: chemin, commit, lignes: choisis, changements, ...(avertissements.length > 0 ? { avertissements } : {}) };
	});
	if (resultat.statut !== 'valide') return resultat;
	const avertissements = [...(resultat.avertissements ?? []), ...((await reindexerApresEcriture(dep)).avertissements ?? [])];
	return { ...resultat, ...(avertissements.length > 0 ? { avertissements } : {}) };
}

/**
 * Rejette un lot en attente (utilisateur seulement) : il disparaît, rien n'est écrit ; false s'il est inconnu ou déjà décidé.
 * Sous le verrou des écritures : jamais au milieu de sa validation (un lot appliqué n'est jamais noté rejeté).
 */
export async function rejeterLot(dep: Dependances, id: string): Promise<boolean> {
	return sousVerrou(dep, () => dep.lots.decider(id, { sort: 'rejete' }, dep.systeme.maintenant().getTime()));
}
