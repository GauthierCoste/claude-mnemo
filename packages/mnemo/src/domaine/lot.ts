// Lots d'informations proposés par l'archiviste, validés par l'utilisateur. Pur, sans module `node:`.
import { confianceActuelle, ajouterSource, TYPES_SANS_PLAFOND } from './confiance-cumulee.ts';
import { confirmerFait } from './confirmation.ts';
import { ecrireFait, faitsEgaux, lireFait, LONGUEUR_MAX_CITATION, LONGUEUR_MAX_FAIT } from './fait.ts';
import type { Corroboration, Fait } from './fait.ts';
import { retenirPlusHauteAncre } from './fiche.ts';
import type { Fiche, LigneDeFait } from './fiche.ts';
import { empreinte } from './empreinte.ts';
import { ancreDeLigneBrute, renvoisDeLigneBrute } from './renumerotation.ts';
import { confiance } from './regles.ts';
import type { Regles, TypeSource } from './regles.ts';

export const GENRES_LOT = ['fusionner', 'supprimer', 'confirmer'] as const;
export type GenreLot = (typeof GENRES_LOT)[number];

/** `fusionner` : `garder` reçoit les sources des `absorber`, qui disparaissent ; `supprimer`, `confirmer` : l'information `ancre`. */
export type LigneDeLot = { garder: string; absorber: string[] } | { ancre: string };

/** Lignes d'un lot au plus ; informations absorbées par une ligne au plus. */
export const LIGNES_MAX_LOT = 200;
export const ABSORBEES_MAX = 50;
/** Longueur maximale du motif d'un lot (une ligne). */
export const MOTIF_MAX_LOT = 500;

/**
 * Un lot proposé : `empreinte` du texte de la fiche à la proposition, `empreintes` de chaque information visée à la
 * proposition (ancre → `empreinteDInformation` ; absent : lot enregistré avant elles, jugé sur l'empreinte de la fiche entière),
 * `session` qui l'a proposé (null : hors session Mnemo). Les ancres sont nues (`f-0001`).
 */
export type Lot = {
	id: string;
	genre: GenreLot;
	fiche: string;
	lignes: LigneDeLot[];
	motif: string;
	empreinte: string;
	empreintes?: Record<string, string>;
	proposeMs: number;
	session: string | null;
};

/**
 * Sort d'un lot décidé : `valide` (`lignes` : indices appliqués, `commit`), `rejete` par l'utilisateur, `perime` (une
 * information visée a changé depuis la proposition, `lotPerime` : refusé à la validation, à reproposer), `deja_applique`
 * (toutes ses lignes étaient déjà dans l'état visé, par exemple confirmées une à une : retiré, rien à écrire ni à reproposer),
 * `fiche_absente` (sa fiche n'existe plus, supprimée ou déplacée : retiré, il n'a plus d'objet).
 */
export type DecisionLot = { sort: 'valide'; lignes: number[]; commit: string } | { sort: 'rejete' } | { sort: 'perime' } | { sort: 'deja_applique' } | { sort: 'fiche_absente' };
export type LotDecide = Lot & { decision: DecisionLot; decideMs: number };

/** Une source connue d'une information (clé d'indépendance, liens résolus par l'appelant ; type) — ordre de la fiche. */
export type SourceConnue = { cle: string; type: TypeSource };

/** Ce que l'application d'un lot doit savoir hors de la fiche : règles, jour, et sources de chaque information (par ancre). */
export type ContexteLot = { regles: Regles; jour: string; sources: ReadonlyMap<string, readonly SourceConnue[]> };

/**
 * Résultat de l'application : la fiche changée (en place), `suivies` (absorbée → gardée : liens et renvois à réécrire),
 * `retirees` (ancres disparues sans suite : un lien vers elles perd son ancre), ce qui a changé.
 */
export type LotApplique = { fiche: Fiche; suivies: Map<string, string>; retirees: Set<string>; changements: string[] };

/** Ancres d'une ligne de lot, dans l'ordre (gardée d'abord). */
export const ancresDeLigne = (ligne: LigneDeLot): string[] => ('ancre' in ligne ? [ligne.ancre] : [ligne.garder, ...ligne.absorber]);

const faitDe = (faits: readonly LigneDeFait[], ancre: string): Fait | undefined => {
	for (const l of faits) if ('fait' in l && l.fait.ancre === ancre) return l.fait;
	return undefined;
};

/**
 * Empreinte d'une information de la fiche : celle de ses lignes telles que Mnemo les écrit (la ligne du fait, sa citation,
 * ses corroborations, `ecrireFait`) ; null si l'ancre ne nomme aucune information lisible.
 */
export function empreinteDInformation(faits: readonly LigneDeFait[], ancre: string): string | null {
	const fait = faitDe(faits, ancre);
	return fait === undefined ? null : empreinte(ecrireFait(fait).join('\n'));
}

/** Empreinte de chaque information visée par les lignes (ancre → empreinte) ; une ancre sans information n'y est pas. */
export function empreintesDesInformations(lignes: readonly LigneDeLot[], faits: readonly LigneDeFait[]): Record<string, string> {
	const empreintes: Record<string, string> = {};
	for (const ancre of lignes.flatMap(ancresDeLigne)) {
		const e = empreinteDInformation(faits, ancre);
		if (e !== null) empreintes[ancre] = e;
	}
	return empreintes;
}

/**
 * La ligne est-elle déjà dans l'état que le lot vise, sans lui ? `confirmer` : l'information est là, vivante et plus à
 * confirmer ; `supprimer` : elle n'est plus dans la fiche ; `fusionner` : la gardée est là et les absorbées n'y sont plus.
 */
export function ligneDejaAppliquee(genre: GenreLot, ligne: LigneDeLot, faits: readonly LigneDeFait[]): boolean {
	if ('ancre' in ligne) {
		const fait = faitDe(faits, ligne.ancre);
		return genre === 'supprimer' ? fait === undefined : fait !== undefined && !fait.barre && !fait.aConfirmer;
	}
	return faitDe(faits, ligne.garder) !== undefined && ligne.absorber.every((a) => faitDe(faits, a) === undefined);
}

/** Toutes les lignes du lot sont déjà dans l'état visé (`ligneDejaAppliquee`) : il n'a plus d'objet. Faux sans fiche lisible. */
export function lotDejaApplique(lot: Pick<Lot, 'genre' | 'lignes'>, faits: readonly LigneDeFait[] | null): boolean {
	return faits !== null && lot.lignes.every((l) => ligneDejaAppliquee(lot.genre, l, faits));
}

/**
 * Un lot est périmé quand ce qu'il vise a changé depuis sa proposition : fiche absente (`texte` null) ou illisible (`faits`
 * null), ou une information visée disparue ou réécrite (`empreintes`). Un ajout ou un changement ailleurs dans la fiche ne
 * le périme pas : les contrôles d'application (`appliquerLot`) se font de toute façon sur la fiche actuelle. Une ligne déjà
 * dans l'état visé (`ligneDejaAppliquee`, par exemple confirmée à la main) ne le périme pas : son information a changé
 * comme le lot le voulait ; un lot dont toutes les lignes le sont n'est pas périmé mais déjà appliqué (`lotDejaApplique`).
 * Lot sans `empreintes` (enregistré avant elles) : périmé dès que le texte de la fiche a changé.
 */
export function lotPerime(lot: Pick<Lot, 'genre' | 'lignes' | 'empreinte' | 'empreintes'>, texte: string | null, faits: readonly LigneDeFait[] | null): boolean {
	if (texte === null) return true;
	if (lotDejaApplique(lot, faits)) return false;
	if (lot.empreintes === undefined) return empreinte(texte) !== lot.empreinte;
	if (faits === null) return true;
	const restantes = lot.lignes.filter((l) => !ligneDejaAppliquee(lot.genre, l, faits));
	return restantes.flatMap(ancresDeLigne).some((ancre) => {
		const avant = lot.empreintes![ancre];
		return avant === undefined || empreinteDInformation(faits, ancre) !== avant;
	});
}

/**
 * Premier défaut des lignes d'un lot au regard des informations de la fiche, sinon null : forme selon le genre, ancre
 * absente ou d'une ligne illisible, ancre nommée deux fois dans le lot ; `fusionner` : gardée et absorbées vivantes (non
 * barrées), une absorbée à confirmer qui contredit une autre information refusée (trancher d'abord), gardée qui contredit
 * une absorbée refusée ; `confirmer` : information vivante et à confirmer. Une ligne illisible qui renvoie à une
 * information retirée est refusée (elle ne se réécrit pas).
 */
export function motifDesLignes(genre: GenreLot, lignes: readonly LigneDeLot[], faits: readonly LigneDeFait[]): string | null {
	if (lignes.length === 0) return 'Le lot est vide : au moins une ligne attendue.';
	if (lignes.length > LIGNES_MAX_LOT) return `Le lot a ${lignes.length} lignes, ${LIGNES_MAX_LOT} au plus : le découper.`;
	const illisibles = new Set<string>();
	for (const l of faits) if ('brute' in l) for (const b of l.brute) {
		const a = ancreDeLigneBrute(b);
		if (a !== undefined) illisibles.add(a);
	}
	const vues = new Set<string>();
	for (const [i, ligne] of lignes.entries()) {
		const n = `ligne ${i + 1}`;
		if (genre === 'fusionner' && !('garder' in ligne)) return `${n} : une fusion s'écrit { garder, absorber }.`;
		if (genre !== 'fusionner' && !('ancre' in ligne)) return `${n} : ${genre} s'écrit { ancre }.`;
		if ('garder' in ligne && (ligne.absorber.length === 0 || ligne.absorber.length > ABSORBEES_MAX)) return `${n} : de 1 à ${ABSORBEES_MAX} informations à absorber.`;
		for (const ancre of ancresDeLigne(ligne)) {
			if (vues.has(ancre)) return `${n} : l'information ^${ancre} est déjà nommée dans le lot.`;
			vues.add(ancre);
			if (illisibles.has(ancre)) return `${n} : l'information ^${ancre} est une ligne illisible : la corriger d'abord.`;
			const fait = faitDe(faits, ancre);
			if (fait === undefined) return `${n} : l'information ^${ancre} n'existe pas dans la fiche.`;
			if (genre !== 'supprimer' && fait.barre) return `${n} : l'information ^${ancre} est barrée.`;
			if (genre === 'confirmer' && !fait.aConfirmer) return `${n} : l'information ^${ancre} n'est pas à confirmer.`;
		}
		if ('garder' in ligne) {
			const gardee = faitDe(faits, ligne.garder)!;
			if (gardee.contredit !== undefined && ligne.absorber.includes(gardee.contredit)) return `${n} : ^${ligne.garder} contredit ^${gardee.contredit} : ce ne sont pas des doublons.`;
			for (const ancre of ligne.absorber) {
				const absorbee = faitDe(faits, ancre)!;
				if (gardee.aConfirmer && !absorbee.aConfirmer) return `${n} : ^${ancre} est confirmée et ^${ligne.garder} à confirmer : garder plutôt la confirmée (une fusion ne confirme rien).`;
				if (absorbee.aConfirmer && absorbee.contredit !== undefined) return `${n} : ^${ancre} est une contradiction à confirmer (de ^${absorbee.contredit}) : à trancher par l'utilisateur avant toute fusion.`;
			}
		}
	}
	if (genre !== 'confirmer') {
		const partent = new Set(lignes.flatMap((l) => ('ancre' in l ? [l.ancre] : l.absorber)));
		for (const l of faits) {
			if (!('brute' in l)) continue;
			const renvoi = l.brute.flatMap(renvoisDeLigneBrute).find((a) => partent.has(a) && !l.brute.some((b) => ancreDeLigneBrute(b) === a));
			if (renvoi !== undefined) return `Une ligne illisible de la fiche renvoie à l'information ^${renvoi}, qui disparaîtrait : la corriger d'abord.`;
		}
	}
	return null;
}

/**
 * Le seul endroit où des informations quittent une fiche par un lot (fusion, suppression) : les lignes des ancres
 * `ancres` sont retirées de `fiche.faits`, le reste garde son ordre ; si la plus haute ancre part, `ancre_max` la retient
 * (`retenirPlusHauteAncre`) : son numéro ne resservira pas, un lien resté vers elle ne viserait jamais une autre information.
 */
export function retirerInformations(fiche: Fiche, ancres: ReadonlySet<string>): void {
	const avant = { ...fiche, faits: [...fiche.faits] };
	fiche.faits = fiche.faits.filter((l) => !('fait' in l && l.fait.ancre !== undefined && ancres.has(l.fait.ancre)));
	retenirPlusHauteAncre(avant, fiche);
}

/** Les mentions de source d'une information, dans l'ordre de `sourcesDuFait` : sa première (datée `jour`), puis ses corroborations. */
function mentionsDe(fait: Fait, jour: string): Corroboration[] {
	const premiere: Corroboration[] = fait.source === undefined ? [] : [{ source: fait.source, le: jour, ...(fait.citation === undefined ? {} : { citation: fait.citation }) }];
	return [...premiere, ...(fait.corroborations ?? []).map((c) => ({ ...c }))];
}

/**
 * Verse dans `gardee` les sources de `absorbee` comme corroborations (citations comprises ; sa première source datée du
 * jour, ses corroborations gardant leur date) ; une source de même clé que l'une de la gardée (ou déjà versée) n'est pas
 * ajoutée. Confiance : si toutes les sources de l'absorbée sont nouvelles, sa confiance (écrite, sinon celle de sa première
 * source) s'ajoute comme une part (`ajouterSource`) ; si certaines sont déjà là, seule chacune des nouvelles s'ajoute, avec
 * la confiance qu'elle donnerait seule (type × nature de l'absorbée). Plafond levé si une source `utilisateur` ou `contrat`
 * est sur l'une ou l'autre. Rend les mentions versées ; `sourcesGardee` est complété.
 */
function verser(gardee: Fait, absorbee: Fait, sourcesGardee: SourceConnue[], sourcesAbsorbee: readonly SourceConnue[], ctx: ContexteLot): Corroboration[] {
	const mentions = mentionsDe(absorbee, ctx.jour);
	const nouvelles: { mention: Corroboration; source: SourceConnue }[] = [];
	const cles = new Set(sourcesGardee.map((s) => s.cle));
	mentions.forEach((mention, i) => {
		const source = sourcesAbsorbee[i];
		if (source === undefined || cles.has(source.cle)) return;
		cles.add(source.cle);
		nouvelles.push({ mention, source });
	});
	if (nouvelles.length === 0) return [];
	const sansPlafond = [...sourcesGardee, ...sourcesAbsorbee].some((s) => TYPES_SANS_PLAFOND.includes(s.type));
	let actuelle = confianceActuelle(ctx.regles, gardee, sourcesGardee) / 100;
	if (nouvelles.length === sourcesAbsorbee.length) {
		const part = confianceActuelle(ctx.regles, absorbee, sourcesAbsorbee) / 100;
		actuelle = ajouterSource(actuelle, { confiance: part, type: sourcesAbsorbee[0]!.type }, sansPlafond);
	} else {
		for (const { source } of nouvelles) actuelle = ajouterSource(actuelle, { confiance: confiance(ctx.regles, source.type, absorbee.nature ?? 'declare') / 100, type: source.type }, sansPlafond);
	}
	gardee.confiance = Math.round(100 * actuelle);
	gardee.corroborations = [...(gardee.corroborations ?? []), ...nouvelles.map((n) => n.mention)];
	sourcesGardee.push(...nouvelles.map((n) => n.source));
	return nouvelles.map((n) => n.mention);
}

/**
 * Applique les lignes `lignes` d'un lot de genre `genre` à `fiche` (lue depuis le texte dont l'empreinte est celle du lot),
 * en place ; motif si l'une ne s'applique pas (rien n'est alors à écrire).
 * - `fusionner` : sources versées (`verser`), puis absorbées retirées ; les renvois de la fiche vers une absorbée
 *   (`contredit`, `invalidé … par`) visent la gardée.
 * - `supprimer` : informations retirées ; un renvoi vers l'une d'elles est effacé d'une information barrée ou décidée
 *   (`invalidé <jour>` reste ; la mention `contredit` d'une contradiction tranchée part) ; une information vivante encore
 *   à confirmer qui contredit une supprimée fait refuser le lot (la contradiction n'aurait plus d'objet : la trancher d'abord).
 * - `confirmer` : comme Confirmer (`confirmerFait`).
 * Chaque information touchée doit survivre à sa relecture ; chaque corroboration versée par une fusion tient sa ligne
 * (`+ src: … | corroboré …`) dans `LONGUEUR_MAX_FAIT` et sa citation dans `LONGUEUR_MAX_CITATION`, comme `corroborer`
 * (les autres lignes d'une information ne sont pas bornées : son texte l'est à l'écriture, ses mentions non).
 */
export function appliquerLot(fiche: Fiche, genre: GenreLot, lignes: readonly LigneDeLot[], ctx: ContexteLot): LotApplique | { motif: string } {
	const motif = motifDesLignes(genre, lignes, fiche.faits);
	if (motif !== null) return { motif };
	const suivies = new Map<string, string>();
	const retirees = new Set<string>();
	const touches = new Set<Fait>();
	const changements: string[] = [];
	const versees: { ancre: string; mention: Corroboration }[] = [];
	const fait = (ancre: string) => faitDe(fiche.faits, ancre)!;

	if (genre === 'fusionner') {
		for (const ligne of lignes as { garder: string; absorber: string[] }[]) {
			const gardee = fait(ligne.garder);
			const sources = [...(ctx.sources.get(ligne.garder) ?? [])];
			let nombre = 0;
			for (const ancre of ligne.absorber) {
				const mentions = verser(gardee, fait(ancre), sources, ctx.sources.get(ancre) ?? [], ctx);
				for (const mention of mentions) versees.push({ ancre: ligne.garder, mention });
				nombre += mentions.length;
				suivies.set(ancre, ligne.garder);
			}
			touches.add(gardee);
			changements.push(`^${ligne.absorber.join(', ^')} fusionnée(s) dans ^${ligne.garder} (${nombre} source(s) ajoutée(s)${gardee.confiance === undefined ? '' : `, confiance ${gardee.confiance} %`})`);
		}
		retirerInformations(fiche, new Set(suivies.keys()));
		for (const l of fiche.faits) {
			if (!('fait' in l)) continue;
			for (const champ of ['contredit', 'invalidePar'] as const) {
				const vers = l.fait[champ] === undefined ? undefined : suivies.get(l.fait[champ]);
				if (vers === undefined) continue;
				if (vers === l.fait.ancre) delete l.fait[champ];
				else l.fait[champ] = vers;
				touches.add(l.fait);
			}
		}
	} else if (genre === 'supprimer') {
		for (const ligne of lignes as { ancre: string }[]) retirees.add(ligne.ancre);
		retirerInformations(fiche, retirees);
		for (const l of fiche.faits) {
			if (!('fait' in l)) continue;
			const f = l.fait;
			if (f.contredit !== undefined && retirees.has(f.contredit)) {
				if (f.aConfirmer && !f.barre) return { motif: `L'information ^${f.ancre ?? '?'}, à confirmer, contredit ^${f.contredit} : trancher d'abord cette contradiction (ou supprimer les deux).` };
				delete f.contredit;
				touches.add(f);
			}
			if (f.invalidePar !== undefined && retirees.has(f.invalidePar)) {
				delete f.invalidePar;
				touches.add(f);
			}
		}
		changements.push(`supprimée(s) : ^${[...retirees].join(', ^')}`);
	} else {
		for (const ligne of lignes as { ancre: string }[]) {
			const visee = fait(ligne.ancre);
			// une confirmation précédente du lot a pu la barrer (deux contradictions l'une de l'autre) : une seule se confirme
			if (visee.barre || !visee.aConfirmer) return { motif: `L'information ^${ligne.ancre} est barrée par une autre confirmation de ce lot : ne confirme que l'une des deux.` };
			for (const f of confirmerFait(fiche.faits, visee, ctx.jour)) touches.add(f);
		}
		changements.push(`confirmée(s) : ^${lignes.map((l) => (l as { ancre: string }).ancre).join(', ^')}`);
	}

	for (const { ancre, mention } of versees) {
		if (mention.citation !== undefined && mention.citation.length > LONGUEUR_MAX_CITATION) return { motif: `Une citation versée dans ^${ancre} dépasse ${LONGUEUR_MAX_CITATION} caractères.` };
		if (ecrireFait({ texte: '-', finIncluse: false, aConfirmer: false, barre: false, corroborations: [mention] })[1]!.length > LONGUEUR_MAX_FAIT) {
			return { motif: `Une source versée dans ^${ancre} dépasserait ${LONGUEUR_MAX_FAIT} caractères sur sa ligne (« + src: … | corroboré … »).` };
		}
	}
	for (const f of touches) {
		const ecrites = ecrireFait(f);
		if (!faitsEgaux(lireFait(ecrites[0]!, ...ecrites.slice(1)), f)) return { motif: `L'information ^${f.ancre ?? '?'} ne survivrait pas à sa relecture depuis la fiche.` };
	}
	fiche.updated = ctx.jour;
	return { fiche, suivies, retirees, changements };
}
