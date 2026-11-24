import type { Trouve } from './chercher.ts';
import type { Dependances } from './ports.ts';
import { chargerRegles } from './regles-du-coffre.ts';
import { motifConsigneInvalide, proposerConsigne } from './proposer/consigne.ts';
import type { DemandeConsigne } from './proposer/consigne.ts';
import { proposerDecision } from './proposer/decision.ts';
import type { DemandeDecision } from './proposer/decision.ts';
import { motifFaitInvalide, proposerFait } from './proposer/fait.ts';
import type { DemandeFait } from './proposer/fait.ts';
import { proposerEpisode } from './proposer/episode.ts';
import type { DemandeEpisode } from './proposer/episode.ts';
import { proposerFiche } from './proposer/fiche.ts';
import { proposerNiveau } from './proposer/niveau.ts';
import type { DemandeNiveau, ReglagesNiveau } from './proposer/niveau.ts';
import type { DemandeFiche } from './proposer/fiche.ts';
import { proposerBrut } from './proposer/brut.ts';
import type { DemandeBrut, ResultatBrut } from './proposer/brut.ts';
import { proposerRelation } from './proposer/relation.ts';
import { proposerRetraitRelation } from './proposer/retirer-relation.ts';
import type { DemandeRetraitRelation } from './proposer/retirer-relation.ts';
import { proposerRetraitDossier } from './proposer/dossier.ts';
import { proposerModification } from './proposer/modification.ts';
import type { DemandeModification } from './proposer/modification.ts';
import type { DemandeRetraitDossier } from './proposer/dossier.ts';
import type { DemandeRelation } from './proposer/relation.ts';
import { prochesDeConsigne, prochesDeFait } from './proposer/proches.ts';
import { sousVerrou } from './commun.ts';
import { masquerSecrets } from '../domaine/secrets.ts';
import { reindexerApresEcriture } from './synchroniser.ts';
import type { Resultat, SourceProposee } from './commun.ts';

export { chargerRegles };
export type { DemandeBrut, ResultatBrut };
export type { DemandeConsigne, DemandeDecision, DemandeEpisode, DemandeFait, DemandeFiche, DemandeNiveau, DemandeModification, DemandeRelation, DemandeRetraitDossier, DemandeRetraitRelation, ReglagesNiveau, Resultat, SourceProposee };
export type Demande = DemandeFait | DemandeFiche | DemandeRelation | DemandeConsigne | DemandeNiveau | DemandeDecision | DemandeEpisode | DemandeModification | DemandeRetraitDossier | DemandeRetraitRelation;

/**
 * Éléments très proches (quasi-doublons) à montrer avant d'écrire, sinon null. Lecture seule, hors
 * verrou, après la validation de la demande (une demande invalide est refusée par le chemin d'écriture) ; une écriture
 * concurrente entre cette recherche et le verrou n'est pas détectée. `remplace` et `apresProches` sautent la recherche.
 */
async function prochesAvantEcriture(dep: Dependances, demande: Demande): Promise<Resultat | null> {
	let proches: Trouve[] | null;
	try {
		proches = await chercherProches(dep, demande);
	} catch {
		return null; // l'index ne doit jamais empêcher d'écrire : pas de proches
	}

	return proches !== null && proches.length > 0 ? { statut: 'proches', genre: demande.genre === 'consigne' ? 'consigne' : 'fait', proches } : null;
}

async function chercherProches(dep: Dependances, demande: Demande): Promise<Trouve[] | null> {
	if (demande.genre === 'fait' && demande.remplace === undefined && demande.apresProches !== true && motifFaitInvalide(demande) === null) {
		return prochesDeFait(dep, demande);
	}
	if (demande.genre === 'consigne' && demande.apresProches !== true && motifConsigneInvalide(demande) === null) {
		return prochesDeConsigne(dep, demande);
	}
	return null;
}

const masquer = (texte: string): string => masquerSecrets(texte).texte;

/** Valeurs de données masquées : chaînes, et chaînes des listes ; le reste tel quel. */
function donneesMasquees(donnees: Record<string, unknown>): Record<string, unknown> {
	const r: Record<string, unknown> = {};
	for (const [cle, valeur] of Object.entries(donnees)) {
		if (typeof valeur === 'string') r[cle] = masquer(valeur);
		else if (Array.isArray(valeur)) r[cle] = valeur.map((v: unknown) => (typeof v === 'string' ? masquer(v) : v));
		else r[cle] = valeur;
	}
	return r;
}

/**
 * La demande, secrets reconnus masqués dans tout texte qu'elle fait écrire (texte, citation, source, titre, synthèse, données) :
 * un secret n'entre jamais dans l'historique git. Les autres genres masquent eux-mêmes (modification, épisode) ou n'écrivent
 * que des chemins et des ancres.
 */
function demandeMasquee(demande: Demande): Demande {
	const source = (s: SourceProposee): SourceProposee => ({ ...s, ref: masquer(s.ref) });
	switch (demande.genre) {
		case 'fait':
			return { ...demande, texte: masquer(demande.texte), source: source(demande.source), ...(demande.citation === undefined ? {} : { citation: masquer(demande.citation) }) };
		case 'consigne':
			return { ...demande, texte: masquer(demande.texte), source: source(demande.source) };
		case 'fiche':
			return {
				...demande,
				titre: masquer(demande.titre),
				...(demande.synthese === undefined ? {} : { synthese: masquer(demande.synthese) }),
				...(demande.donnees === undefined ? {} : { donnees: donneesMasquees(demande.donnees) }),
			};
		default:
			return demande;
	}
}

/**
 * Point d'entrée unique des écritures : validation avant toute écriture, un commit par demande, index à jour ensuite (sinon
 * un avertissement).
 * `appliquerDirectement` (genres `niveau`, `modification`, `confirmer`, `rejeter`, `supprimer`) : vrai seulement pour un canal
 * de l'utilisateur (CLI, service HTTP) ; par défaut, et toujours par MCP, une montée de niveau, ou la modification d'une
 * consigne ou d'un profil, reste une proposition, et une décision sur une information est refusée.
 */
export async function proposer(dep: Dependances, demandeBrute: Demande, reglages: ReglagesNiveau = { appliquerDirectement: false }): Promise<Resultat> {
	const demande = demandeMasquee(demandeBrute);
	const proches = await prochesAvantEcriture(dep, demande);
	if (proches !== null) return proches;
	const resultat = await sousVerrou(dep, async () => {
		switch (demande.genre) {
			case 'fait':
				return proposerFait(dep, demande);
			case 'fiche':
				return proposerFiche(dep, demande);
			case 'relation':
				return proposerRelation(dep, demande);
			case 'retirer_relation':
				return proposerRetraitRelation(dep, demande);
			case 'consigne':
				return proposerConsigne(dep, demande);
			case 'niveau':
				return proposerNiveau(dep, demande, reglages);
			case 'episode':
				return proposerEpisode(dep, demande);
			case 'confirmer':
			case 'rejeter':
			case 'supprimer':
				return proposerDecision(dep, demande, reglages.appliquerDirectement);
			case 'modification':
				return proposerModification(dep, demande, reglages);
			case 'retirer_dossier':
				return proposerRetraitDossier(dep, demande);
		}
	});
	// un dossier retiré peut avoir emporté sa fiche de dossier : l'index la perd aussi
	if (resultat.statut === 'ecrit' || resultat.statut === 'repetition' || resultat.statut === 'retire') return { ...resultat, ...(await reindexerApresEcriture(dep)) };
	return resultat;
}

/**
 * Édition brute d'une fiche par l'utilisateur (interface, route HTTP seulement) : sous verrou, un commit, index à jour ensuite.
 * Hors de `Demande` : ni le schéma MCP ni `validerDemande` ne la connaissent.
 */
export async function ecrireBrut(dep: Dependances, demande: DemandeBrut): Promise<ResultatBrut> {
	const resultat = await sousVerrou(dep, () => proposerBrut(dep, demande));
	if (resultat.statut === 'ecrit') return { ...resultat, ...(await reindexerApresEcriture(dep)) };
	return resultat;
}
