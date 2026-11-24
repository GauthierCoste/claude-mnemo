import { AVERTISSEMENT, encadrer, estEncadre, neutraliser } from '../domaine/contexte.ts';
import { libelleEtendue } from '../domaine/etendue.ts';
import { libelleApports } from '../domaine/note-de-recherche.ts';
import { tronquerTexte } from '../domaine/texte.ts';
import type { Trouve, Voisins } from './chercher.ts';
import { avertissementsDe, ligneAvertissement } from '@mnemo/commun';
import type { AvecAvertissements } from '@mnemo/commun';
import type { Resultat } from './commun.ts';
import type { ResultatSource } from './extraire-source.ts';
import type { Lu } from './lire.ts';
import type { ResultatLotPropose } from './lots.ts';
import type { Listing } from './lister.ts';

/** Borne d'une sortie d'outil, en caractères. */
export const LIMITE_SORTIE = 20_000;

/** Une unité de sortie : son texte brut (une ou plusieurs lignes) et la source qui l'encadre, ou null si elle ne vient pas d'un document. */
type Unite = { texte: string; source: string | null };

const libre = (texte: string): Unite => ({ texte, source: null });

/** Rend une unité en neutralisant son contenu une seule fois (seul `encadrer` le fait pour une unité encadrée). */
const rendre = (source: string | null, lignes: string[]): string => (source === null ? lignes.map(neutraliser).join('\n') : encadrer(source, lignes));

const motReste = (n: number, mot: string): string => `… (${n} ${mot} de plus)`;

/** L'unité coupée à des lignes entières pour tenir dans `place` caractères (une ligne trop longue est coupée), cadre refermé ; null si rien ne tient. */
function couper(unite: Unite, place: number): string | null {
	const surcout = rendre(unite.source, ['…']).length;
	let reste = place - surcout - 1;
	const lignes: string[] = [];
	for (const ligne of unite.texte.split('\n')) {
		const taille = neutraliser(ligne).length + 1;
		if (taille > reste) {
			if (lignes.length === 0 && reste > 1) lignes.push(tronquerTexte(ligne, Math.floor(reste / 4)));
			break;
		}
		lignes.push(ligne);
		reste -= taille;
	}
	return lignes.length === 0 ? null : rendre(unite.source, [...lignes, '…']);
}

/**
 * Entête, puis les unités tant que le tout tient dans `budget` ; l'avertissement est mis une fois en tête si une unité gardée
 * est encadrée ; le reste est signalé « … (N résultats de plus) ». Les unités sont coupées entre elles ; seule une première
 * unité plus grande que le budget est coupée en elle-même.
 */
function assembler(entete: string[], unites: Unite[], budget: number, mot = 'résultats'): string {
	const tete = entete.map(neutraliser);
	let taille = tete.join('\n').length + (unites.some((u) => u.source !== null) ? AVERTISSEMENT.length + 2 : 0);
	const gardes: string[] = [];
	let encadre = false;
	for (const unite of unites) {
		const restantes = unites.length - gardes.length - 1;
		const mention = restantes > 0 ? motReste(restantes, mot).length + 1 : 0;
		let rendu: string | null = rendre(unite.source, unite.texte.split('\n'));
		if (taille + rendu.length + 1 + mention > budget) {
			rendu = gardes.length === 0 ? couper(unite, budget - taille - mention) : null;
			if (rendu === null) break;
		}
		gardes.push(rendu);
		encadre ||= unite.source !== null;
		taille += rendu.length + 1;
	}
	const reste = unites.length - gardes.length;
	return [...(encadre ? [AVERTISSEMENT, ''] : []), ...tete, ...gardes, ...(reste > 0 ? [motReste(reste, mot)] : [])].join('\n');
}

function validite(t: Trouve): string {
	return t.valideFin === null ? '' : `, valide jusqu'au ${t.valideFin}${t.finIncluse ? ' inclus' : ' exclu'}`;
}

/** Un élément est encadré s'il vient d'un document ; le contenu d'une fiche `source` l'est toujours (type inconnu à défaut). */
function sourceDeCadre(t: Trouve): string | null {
	if (t.genre === 'consigne') return null;
	// Un passage de document (fiche `source`) en est toujours tiré, quel que soit le type de sa source ; un passage d'une
	// autre fiche suit la règle de sa fiche (encadré seulement si elle cite un document).
	if (t.genre === 'passage' && t.typeFiche === 'source') return t.chemin;
	const typeSource = t.typeSource ?? (t.typeFiche === 'source' ? 'inconnue' : null);
	return estEncadre({ titre: '', lignes: [], source: null, typeSource, priorite: 0 }) ? (t.source ?? t.chemin) : null;
}

/** Statut affiché : `servi` se lit « actif » (la valeur interne ne change pas). */
function statutAffiche(statut: Trouve['statut']): string {
	return statut === 'servi' ? 'actif' : statut;
}

/** Base et raisons d'un libellé « base · raisons » ; raisons absentes s'il n'y en a pas. */
function separerLibelle(libelle: string): [string, string | undefined] {
	const i = libelle.indexOf(' · ');
	return i < 0 ? [libelle, undefined] : [libelle.slice(0, i), libelle.slice(i + 3)];
}

function uniteDeTrouve(t: Trouve): Unite {
	// « 0,82 · projet courant, confiance 60 % » : la base devant l'id, les raisons après.
	const [base, raisons] = separerLibelle(libelleApports({ base: t.base, apports: t.apports }));
	const copies = t.copies ?? [];
	const signalees = copies.length === 0 ? '' : ` (+ ${copies.length} ${copies.length === 1 ? 'copie' : 'copies'} : ${copies.join(', ')})`;
	const entete = `- ${base} ${t.id} (${statutAffiche(t.statut)}${t.date === null ? '' : `, ${t.date}`}${validite(t)})${raisons === undefined ? '' : ` · ${raisons}`}${signalees}`;
	// Un passage : le contexte (titre du document › titres — date — auteur — fiche) et la page précèdent l'extrait ; élargi
	// (section, voisins), l'étendue servie aussi.
	const situation = t.genre === 'passage' ? [`  ${t.contexte}${t.page === null || t.page === undefined ? '' : ` — page ${t.page}`}`] : [];
	if (t.etendue !== undefined && t.etendue.mode !== 'passage') situation.push(`  Étendue : ${libelleEtendue(t.etendue)}`);
	const texte = [entete, ...situation, ...t.texte.split('\n').map((l) => `  ${l}`)].join('\n');
	const source = sourceDeCadre(t);
	return { texte, source };
}

/** Une ligne par résultat (base, id, statut, date, validité, raisons de la note, texte) ; les éléments tirés de documents sont encadrés. */
export function presenterTrouves(trouves: Trouve[], budget = LIMITE_SORTIE): string {
	if (trouves.length === 0) return 'Aucun résultat.';
	return assembler([], trouves.map(uniteDeTrouve), budget);
}

/** Identifiant, page, chemin des titres et statut d'un passage lu ; sa section suit. */
function enteteDePassage(p: NonNullable<Lu['passage']>): string[] {
	const details = [p.page === null ? null : `page ${p.page}`, p.statut === 'servi' ? null : p.statut].filter((d) => d !== null);
	const lignes = [`Passage visé : ${p.id}${details.length === 0 ? '' : ` (${details.join(', ')})`}`];
	if (p.titres.length > 0) lignes.push(`Section : ${p.titres.join(' › ')}`);
	return [...lignes, ''];
}

/** La fiche brute, entière et encadrée si elle vient d'un document ; coupée à une ligne près au-delà de la borne. */
export function presenterFiche(lu: Lu): string {
	const etendue = lu.etendue === undefined || lu.etendue.mode === 'passage' ? [] : [`Étendue : ${libelleEtendue(lu.etendue)}`];
	const vise =
		lu.passage !== undefined
			? [...enteteDePassage(lu.passage).slice(0, -1), ...etendue, '']
			: lu.fait === null
				? []
				: [...etendue, `Élément visé : ${lu.fait}`, ''];
	const lignes = vise.concat(lu.texte.replace(/\n$/u, '').split('\n'));
	const entete = lu.document === null ? [] : [AVERTISSEMENT, ''];
	const enveloppe = lu.document === null ? 0 : encadrer(lu.chemin, []).length;
	const mention = '… (tronqué)';
	let taille = entete.join('\n').length + enveloppe + mention.length + 2;
	const gardees: string[] = [];
	for (const ligne of lignes) {
		const longueur = neutraliser(ligne).length + 1;
		if (taille + longueur > LIMITE_SORTIE) break;
		gardees.push(ligne);
		taille += longueur;
	}
	if (gardees.length < lignes.length) gardees.push(mention);
	return [...entete, rendre(lu.document === null ? null : lu.chemin, gardees)].join('\n');
}

export function presenterListing(listing: Listing): string {
	const entete = [`Dossier : ${listing.dossier === '' ? '(racine)' : listing.dossier}`];
	if (listing.ficheDossier !== null) {
		entete.push(`Fiche du dossier : ${listing.ficheDossier.titre}`);
	}
	const unites: Unite[] = [
		...listing.sousDossiers.map((d) => libre(`- ${d}/`)),
		...listing.fiches.map((f): Unite => {
			const ligne = `- ${f.chemin} : ${f.titre} (${f.type})${f.aTraiter === true ? ' — à traiter' : ''}`;
			return f.type === 'source' ? { texte: ligne, source: f.chemin } : libre(ligne);
		}),
	];
	if (unites.length === 0) return [...entete, 'Dossier vide.'].map(neutraliser).join('\n');
	return assembler(entete, unites, LIMITE_SORTIE, 'entrées');
}

const SORTS = { valide: 'validé', rejete: 'rejeté', perime: 'écarté (la fiche avait changé : à reproposer)' } as const;

/** Lot enregistré (`proposer_lot`), puis le sort des lots décidés depuis la proposition précédente. */
export function presenterLotPropose(r: ResultatLotPropose): string {
	const tete = `Lot ${r.lot} proposé : ${r.genre}, ${r.lignes} ligne(s) dans ${r.fiche}. Rien n'est écrit : l'utilisateur le valide (ou une partie) dans Mnemo.`;
	const sorts = r.decides.map((l) => `- lot ${l.id} (${l.genre}, ${l.fiche}) : ${SORTS[l.decision.sort]}${l.decision.sort === 'valide' ? `, ${l.decision.lignes.length}/${l.lignes.length} ligne(s), commit ${l.decision.commit}` : ''}`);
	return borne(neutraliser(sorts.length === 0 ? tete : `${tete}\nLots décidés depuis ta proposition précédente :\n${sorts.join('\n')}`));
}

export function presenterResultat(resultat: Resultat): string {
	return texteAvecAvertissements(texteDuResultat(resultat), avertissementsDe(resultat));
}

/** `texte`, puis une ligne « Avertissement : … » par avertissement, gardée entière : c'est `texte` qui est coupé s'il le faut. */
function texteAvecAvertissements(texte: string, r: AvecAvertissements): string {
	const lignes = (r.avertissements ?? []).map((a) => `\n${neutraliser(ligneAvertissement(a))}`).join('');
	return borne(tronquerTexte(texte, Math.max(0, LIMITE_SORTIE - lignes.length), 'utf16') + lignes);
}

function texteDuResultat(resultat: Resultat): string {
	switch (resultat.statut) {
		case 'ecrit': {
			const tete = `Écrit : ${resultat.fiche}${resultat.ancre === undefined ? '' : `#^${resultat.ancre}`}${resultat.aConfirmer ? ' (à confirmer)' : ''} — commit ${resultat.commit}.`;
			const changements = resultat.changements ?? [];
			const suite = changements.length === 0 ? '' : ` ${resultat.aConfirmer ? 'Proposé, en attente de l\'utilisateur' : 'Changé'} : ${changements.join(' ; ')}.`;
			return borne(neutraliser(`${tete}${suite}`));
		}
		case 'doublon':
			// une information déjà là (son ancre) : la même dite par une autre source la corrobore
			return neutraliser(`Doublon : déjà présent dans ${resultat.fiche}${resultat.ancre === undefined ? '' : `#^${resultat.ancre}`} ; rien n'est écrit.${resultat.ancre === undefined ? '' : ' Autre source : `corroborer`.'}`);
		case 'repetition': {
			const niveau = resultat.niveauPropose === null ? '' : ` Niveau proposé : ${resultat.niveauPropose}.`;
			return neutraliser(`Répétition notée dans ${resultat.fiche} (${resultat.repetitions} fois) — commit ${resultat.commit}.${niveau}`);
		}
		case 'refuse':
			return neutraliser(`Refusé : ${resultat.motif}`);
		case 'retire':
			return neutraliser(`Dossier retiré : ${resultat.dossier}${resultat.commit === null ? ' (rien de suivi par git : aucun commit).' : ` — commit ${resultat.commit}.`}`);
		case 'proches': {
			const suite =
				resultat.genre === 'fait'
					? 'Rappelle avec apresProches à true pour ajouter quand même, ou avec remplace (l\'identifiant de l\'information visée) pour la remplacer.'
					: 'Rappelle avec apresProches à true pour ajouter quand même, ou renonce.';
			const tete = `Rien n'est écrit : ${resultat.proches.length} élément(s) très proche(s) existent déjà. ${suite}`;
			return `${tete}\n${presenterTrouves(resultat.proches, LIMITE_SORTIE - tete.length - 1)}`;
		}
	}
}

const borne = (texte: string): string => tronquerTexte(texte, LIMITE_SORTIE, 'utf16');

/**
 * Bilan de `extraire_source`, en français : une ligne par statut ; les noms tirés d'un document sont neutralisés ou encadrés.
 * `syntaxe` : comment rappeler après des proches (`apres_proches: true` pour l'outil MCP, `--apres-proches` en ligne de commande).
 */
export function presenterSource(resultat: ResultatSource, options: { syntaxe?: 'mcp' | 'cli' } = {}): string {
	switch (resultat.statut) {
		case 'ecrit': {
			const details = [`${resultat.passages} passage${resultat.passages > 1 ? 's' : ''} indexé${resultat.passages > 1 ? 's' : ''}`];
			if (resultat.secrets > 0) details.push(`${resultat.secrets} secret${resultat.secrets > 1 ? 's' : ''} masqué${resultat.secrets > 1 ? 's' : ''}`);
			if (resultat.filles.length > 0) details.push(`filles : ${resultat.filles.join(', ')}`);
			return texteAvecAvertissements(neutraliser(`Source écrite : ${resultat.fiche} (${details.join(' ; ')}) — commit ${resultat.commit}.`), resultat);
		}
		case 'deja': {
			const ajoutes = resultat.ajoutes ?? 0;
			const suite =
				ajoutes > 0
					? ` ; ${ajoutes} nouveau${ajoutes > 1 ? 'x' : ''} fil${ajoutes > 1 ? 's' : ''} référencé${ajoutes > 1 ? 's' : ''} — commit ${resultat.commit}.`
					: resultat.commit !== undefined && resultat.deplacee !== true
						? ` ; nouvelles pièces jointes référencées — commit ${resultat.commit}.`
						: " ; rien d'autre n'est écrit.";
			const note = resultat.note === undefined ? '' : ` (${resultat.note})`;
			return texteAvecAvertissements(neutraliser(`Source déjà référencée : ${resultat.fiche}${resultat.deplacee === true ? ' (déplacée : chemin mis à jour)' : ''}${suite}${note}`), resultat);
		}
		case 'proches': {
			const tete = 'Rien n\'est écrit. Document très proche de :';
			const suite = `Si c'est bien un document différent, rappelle avec \`${options.syntaxe === 'cli' ? '--apres-proches' : 'apres_proches: true'}\`.`;
			const corps = presenterTrouves(resultat.proches, LIMITE_SORTIE - tete.length - suite.length - 2);
			return `${tete}\n${corps}\n${suite}`;
		}
		case 'refuse':
			return borne(neutraliser(`Refusé : ${resultat.motif}`));
	}
}

/**
 * Liens sans doublon : une même fiche (`fiche(l)`) liée par une relation typée et par un lien simple ne garde que la
 * relation typée ; deux liens identiques n'en font qu'un. L'ordre est conservé.
 */
function dedoublonner(liens: Voisins['sortants'], fiche: (l: Voisins['sortants'][number]) => string): Voisins['sortants'] {
	const typees = new Set(liens.filter((l) => l.verbe !== null).map(fiche));
	const vus = new Set<string>();
	return liens.filter((l) => {
		if (l.verbe === null && typees.has(fiche(l))) return false;
		const cle = `${fiche(l)}\u0000${l.verbe ?? ''}`;
		if (vus.has(cle)) return false;
		vus.add(cle);
		return true;
	});
}

/**
 * Les cibles de liens sortants viennent de la fiche, donc parfois d'un document : seules celles qui désignent une fiche
 * existante sont écrites (les autres sont comptées) ; ce qui sort d'une fiche document est encadré.
 */
export function presenterVoisins(v: Voisins): string {
	const existants = new Set(v.existants);
	const documents = new Set(v.documents);
	const cadre = (chemin: string, texte: string): Unite => (documents.has(chemin) ? { texte, source: chemin } : libre(texte));
	const sortants = dedoublonner(v.sortants, (l) => l.vers);
	const entrants = dedoublonner(v.entrants, (l) => l.de);
	const visibles = sortants.filter((l) => existants.has(l.vers));
	const absents = sortants.length - visibles.length;
	const entete = [`Fiche : ${v.fiche} (${sortants.length} lien(s) sortant(s), ${entrants.length} entrant(s))`];
	if (absents > 0) entete.push(`${absents} liens vers des fiches absentes`);
	const unites = [
		...visibles.map((l) => cadre(l.de, `- sortant : ${l.verbe ?? 'lien'} → ${l.vers}`)),
		...entrants.map((l) => cadre(l.de, `- entrant : ${l.de} (${l.verbe ?? 'lien'})`)),
	];
	return assembler(entete, unites, LIMITE_SORTIE, 'liens');
}

/** Ligne « Documents à compléter : <fiche> — N fils nouveaux (relance extraire_source) » ; vide sans avis. Noms neutralisés. */
export function presenterAvis(avis: Record<string, string>): string {
	const entrees = Object.entries(avis);
	if (entrees.length === 0) return '';
	const liste = entrees.map(([fiche, motif]) => `${fiche} — ${motif.replace(/ : relancer extraire_source$/u, '')}`).join(' ; ');
	return borne(neutraliser(`Documents à compléter : ${liste} (relance extraire_source)`));
}
