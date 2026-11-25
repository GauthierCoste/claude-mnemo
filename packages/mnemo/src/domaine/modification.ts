// Modification d'une fiche existante (synthèse, sections libres, type, titre, alias, lien de lieu) : validation, application, résumé. Pur.
import { suivreBlocsDeCode } from './blocs-de-code.ts';
import { estTitreDesInformations, estTypeFiche, FORME_TYPE_FICHE } from './fiche.ts';
import type { Fiche, TypeFiche } from './fiche.ts';
import { masquerSecrets } from './secrets.ts';
import { CLE_DOSSIER_PROJET, CLE_PERIME_LE } from './elements.ts';
import { estDate } from './fait.ts';
import { CLE_PORTEE } from './portee.ts';
import { dossierProjetPropose, porteeDeLieuProposee } from './rattachement.ts';
import { CLE_A_TRAITER } from './source.ts';
import { tronquerTexte } from './texte.ts';
import { estObjet } from './valeurs.ts';
import { motifTitre } from './titre.ts';

/**
 * Ce qu'une modification change. `sections` : titre → texte (texte vide : la section est retirée ; absente : créée).
 * `traitee` : retire le marqueur `a_traiter` (la fiche a été traitée par l'archiviste). `dossier_projet` et `portee` : le
 * lien d'un dossier de projet vers ce lieu et la portée qu'il déclare (« » les retire). `perime_le` : le jour où la fiche
 * temporaire cesse d'être vraie (« » le retire). Jamais la section des informations ni celle des relations (elles ont leurs
 * propres propositions), jamais le frontmatter hors de `type`, `alias`, du titre, de ce marqueur et de ces trois clés.
 */
export type Cibles = {
	synthese?: string;
	sections?: Record<string, string>;
	type?: TypeFiche;
	titre?: string;
	alias?: string[];
	traitee?: true;
	dossier_projet?: string;
	portee?: string;
	perime_le?: string;
};

/** Modification venue d'une session sur une fiche protégée, en attente de l'utilisateur (frontmatter). */
export type ModificationProposee = { cibles: Cibles; date: string; source: string };

/** Clé du frontmatter qui porte la modification proposée. */
export const CLE_MODIFICATION_PROPOSEE = 'modification_proposee';

/** Types de fiche qui guident les sessions : une modification venue d'une session y attend l'utilisateur. */
export const TYPES_A_CONFIRMER: readonly TypeFiche[] = ['consigne', 'profil'];

const SECTIONS_MAX = 50;
const ALIAS_MAX = 50;
const APERCU = 40;

const masquer = (texte: string): string => masquerSecrets(texte).texte;

/** Première ligne, hors bloc de code, qui ouvre une section (`## `) ou un titre (`# `), sinon null. */
function titreHorsCode(texte: string): string | null {
	const dansCode = suivreBlocsDeCode();
	for (const ligne of texte.split(/\r\n|\r|\n/u)) {
		if (!dansCode(ligne) && /^#{1,2} /u.test(ligne)) return ligne;
	}
	return null;
}

/** Vrai pour un titre de section que la modification ne touche jamais (informations, relations), à la casse près. */
function estSectionReservee(titre: string): boolean {
	const t = titre.trim();
	const minuscule = t.toLowerCase();
	return estTitreDesInformations(t) || ['informations', 'faits', 'relations'].includes(minuscule);
}

/**
 * Cibles valides (rognées, secrets masqués), ou le motif du premier refus. `sections` vient d'un objet JSON libre : chaque
 * valeur doit être une chaîne.
 */
export function validerCibles(brut: {
	synthese?: unknown;
	sections?: unknown;
	type?: unknown;
	titre?: unknown;
	alias?: unknown;
	traitee?: unknown;
	dossier_projet?: unknown;
	portee?: unknown;
	perime_le?: unknown;
}): Cibles | string {
	const cibles: Cibles = {};
	if (brut.perime_le !== undefined) {
		const jour = typeof brut.perime_le === 'string' ? brut.perime_le.trim() : null;
		if (jour === null || (jour !== '' && !estDate(jour))) return `« ${CLE_PERIME_LE} » est une date AAAA-MM-JJ (le jour où la fiche cesse d'être vraie), ou « » pour la retirer.`;
		cibles.perime_le = jour;
	}
	if (brut.dossier_projet !== undefined) {
		const lu = dossierProjetPropose(brut.dossier_projet);
		if ('motif' in lu) return lu.motif;
		cibles.dossier_projet = lu.valeur;
	}
	if (brut.portee !== undefined) {
		const lue = porteeDeLieuProposee(brut.portee);
		if ('motif' in lue) return lue.motif;
		cibles.portee = lue.valeur;
	}
	if (brut.traitee !== undefined) {
		if (brut.traitee !== true) return '« traitee » vaut true (retire le marqueur « à traiter ») ou s\'omet.';
		cibles.traitee = true;
	}
	if (brut.titre !== undefined) {
		if (typeof brut.titre !== 'string') return 'Le titre doit être une chaîne.';
		const motif = motifTitre('Le titre de la fiche', brut.titre);
		if (motif !== null) return motif;
		cibles.titre = masquer(brut.titre.trim());
	}
	if (brut.type !== undefined) {
		if (!estTypeFiche(brut.type)) return `Type de fiche mal formé : « ${String(brut.type)} » (attendu : ${FORME_TYPE_FICHE}).`;
		cibles.type = brut.type;
	}
	if (brut.synthese !== undefined) {
		if (typeof brut.synthese !== 'string') return 'La synthèse doit être une chaîne.';
		const titre = titreHorsCode(brut.synthese);
		if (titre !== null) return `La synthèse ne doit pas contenir de titre « # » ou « ## » hors bloc de code (« ${tronquerTexte(titre, APERCU)} ») : une section passe par « sections ».`;
		cibles.synthese = masquer(brut.synthese.trim());
	}
	if (brut.sections !== undefined) {
		if (!estObjet(brut.sections)) return '« sections » doit être un objet { titre: texte }.';
		const entrees = Object.entries(brut.sections);
		if (entrees.length > SECTIONS_MAX) return `Au plus ${SECTIONS_MAX} sections par modification.`;
		const sections: Record<string, string> = {};
		for (const [titreBrut, texte] of entrees) {
			const motif = motifTitre(`Le titre de section « ${tronquerTexte(titreBrut, APERCU)} »`, titreBrut);
			if (motif !== null) return motif;
			const titre = masquer(titreBrut.trim());
			if (estSectionReservee(titre)) return `La section « ${titre} » ne se modifie pas ainsi : les informations et les relations ont leurs propres propositions (genres fait, confirmer, rejeter, supprimer, relation).`;
			if (typeof texte !== 'string') return `Section « ${titre} » : le texte doit être une chaîne (vide pour retirer la section).`;
			const ligne = titreHorsCode(texte);
			if (ligne !== null && /^## /u.test(ligne)) return `Section « ${titre} » : pas de titre « ## » hors bloc de code (« ${tronquerTexte(ligne, APERCU)} ») ; une autre section est une autre clé de « sections ».`;
			if (Object.hasOwn(sections, titre)) return `Section « ${titre} » donnée deux fois.`;
			sections[titre] = masquer(texte.trim());
		}
		cibles.sections = sections;
	}
	if (brut.alias !== undefined) {
		if (!Array.isArray(brut.alias)) return '« alias » doit être une liste de textes.';
		if (brut.alias.length > ALIAS_MAX) return `Au plus ${ALIAS_MAX} alias.`;
		const alias: string[] = [];
		for (const a of brut.alias) {
			if (typeof a !== 'string') return 'Chaque alias doit être une chaîne.';
			const motif = motifTitre(`L'alias « ${tronquerTexte(a, APERCU)} »`, a);
			if (motif !== null) return motif;
			const net = masquer(a.trim());
			if (!alias.includes(net)) alias.push(net);
		}
		cibles.alias = alias;
	}
	return Object.keys(cibles).length === 0
		? `Rien à modifier : donne « synthese », « sections », « type », « titre », « alias », « traitee », « ${CLE_DOSSIER_PROJET} », « ${CLE_PORTEE} » ou « ${CLE_PERIME_LE} ».`
		: cibles;
}

/** Noms des cibles, pour le message de commit (« synthese, section Conventions, type »). */
export function nomsDesCibles(cibles: Cibles): string[] {
	const noms: string[] = [];
	if (cibles.synthese !== undefined) noms.push('synthese');
	for (const titre of Object.keys(cibles.sections ?? {})) noms.push(`section ${titre}`);
	if (cibles.type !== undefined) noms.push('type');
	if (cibles.titre !== undefined) noms.push('titre');
	if (cibles.alias !== undefined) noms.push('alias');
	if (cibles.traitee !== undefined) noms.push('traitee');
	if (cibles.dossier_projet !== undefined) noms.push(CLE_DOSSIER_PROJET);
	if (cibles.portee !== undefined) noms.push(CLE_PORTEE);
	if (cibles.perime_le !== undefined) noms.push(CLE_PERIME_LE);
	return noms;
}

const apercu = (texte: string): string => {
	const net = texte.replace(/\s+/gu, ' ').trim();
	if (net === '') return '(vide)';
	return `« ${Array.from(net).length > APERCU ? `${tronquerTexte(net, APERCU)}…` : net} »`;
};
const listeAlias = (alias: string[]): string => (alias.length === 0 ? '(aucun)' : alias.join(', '));

/** Index de la section de ce titre : exact d'abord, sinon à la casse près ; -1 si absente. */
function indexDeSection(fiche: Fiche, titre: string): number {
	const exact = fiche.autresSections.findIndex((s) => s.titre === titre);
	if (exact !== -1) return exact;
	const cle = titre.toLowerCase();
	return fiche.autresSections.findIndex((s) => s.titre.toLowerCase() === cle);
}

/**
 * Fiche modifiée (copie ; l'originale n'est pas touchée) et ce qui a changé, en résumé court (« type : sujet → dossier »).
 * Une cible qui ne change rien n'apparaît pas dans `changements` ; aucun changement : rien à écrire.
 */
export function appliquerCibles(fiche: Fiche, cibles: Cibles): { fiche: Fiche; changements: string[] } {
	const nouvelle: Fiche = structuredClone(fiche);
	const changements: string[] = [];
	if (cibles.synthese !== undefined && cibles.synthese !== fiche.synthese) {
		changements.push(`synthèse : ${apercu(fiche.synthese)} → ${apercu(cibles.synthese)}`);
		nouvelle.synthese = cibles.synthese;
	}
	for (const [titre, texte] of Object.entries(cibles.sections ?? {})) {
		const index = indexDeSection(nouvelle, titre);
		if (texte === '') {
			if (index === -1) continue;
			const [retiree] = nouvelle.autresSections.splice(index, 1);
			if (nouvelle.ordre !== undefined) nouvelle.ordre = nouvelle.ordre.filter((t) => t !== retiree!.titre);
			changements.push(`section « ${retiree!.titre} » : retirée`);
		} else if (index === -1) {
			nouvelle.autresSections.push({ titre, corps: texte });
			nouvelle.ordre?.push(titre);
			changements.push(`section « ${titre} » : créée`);
		} else if (nouvelle.autresSections[index]!.corps !== texte) {
			nouvelle.autresSections[index]!.corps = texte;
			changements.push(`section « ${nouvelle.autresSections[index]!.titre} » : remplacée`);
		}
	}
	if (cibles.type !== undefined && cibles.type !== fiche.type) {
		changements.push(`type : ${fiche.type} → ${cibles.type}`);
		nouvelle.type = cibles.type;
	}
	if (cibles.titre !== undefined && cibles.titre !== fiche.titre) {
		changements.push(`titre : ${apercu(fiche.titre)} → ${apercu(cibles.titre)}`);
		nouvelle.titre = cibles.titre;
	}
	if (cibles.alias !== undefined && JSON.stringify(cibles.alias) !== JSON.stringify(fiche.alias)) {
		changements.push(`alias : ${listeAlias(fiche.alias)} → ${listeAlias(cibles.alias)}`);
		nouvelle.alias = [...cibles.alias];
	}
	if (cibles.traitee === true && Object.hasOwn(nouvelle.donnees, CLE_A_TRAITER)) {
		delete nouvelle.donnees[CLE_A_TRAITER];
		changements.push('à traiter : marqueur retiré');
	}
	for (const cle of [CLE_DOSSIER_PROJET, CLE_PORTEE, CLE_PERIME_LE] as const) {
		const vise = cibles[cle];
		if (vise === undefined) continue;
		const actuel = typeof fiche.donnees[cle] === 'string' ? (fiche.donnees[cle] as string) : '';
		if (vise === actuel) continue;
		if (vise === '') delete nouvelle.donnees[cle];
		else nouvelle.donnees[cle] = vise;
		changements.push(`${cle} : ${actuel === '' ? '(aucun)' : actuel} → ${vise === '' ? '(retiré)' : vise}`);
	}
	return { fiche: nouvelle, changements };
}

/** Modification proposée lue dans les données d'une fiche ; absente si elle manque ou est invalide (on n'applique pas à moitié). */
export function lireModificationProposee(donnees: Record<string, unknown>): ModificationProposee | undefined {
	const valeur = donnees[CLE_MODIFICATION_PROPOSEE];
	if (!estObjet(valeur)) return undefined;
	const { date, source, ...reste } = valeur;
	if (typeof date !== 'string' || typeof source !== 'string') return undefined;
	const cibles = validerCibles(reste);
	if (typeof cibles === 'string') return undefined;
	return { cibles, date, source };
}

/** Données de la fiche portant la modification proposée (`undefined` : retirée). */
export function avecModificationProposee(donnees: Record<string, unknown>, proposition: ModificationProposee | undefined): Record<string, unknown> {
	const suivantes = { ...donnees };
	if (proposition === undefined) {
		delete suivantes[CLE_MODIFICATION_PROPOSEE];
	} else {
		suivantes[CLE_MODIFICATION_PROPOSEE] = { ...structuredClone(proposition.cibles), date: proposition.date, source: proposition.source };
	}
	return suivantes;
}
