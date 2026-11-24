import { ecrireFiche, lireFiche } from '../../domaine/fiche.ts';
import type { Fiche, TypeFiche } from '../../domaine/fiche.ts';
import { appliquerCibles, avecModificationProposee, lireModificationProposee, nomsDesCibles, TYPES_A_CONFIRMER, validerCibles } from '../../domaine/modification.ts';
import type { Cibles } from '../../domaine/modification.ts';
import { CLE_DOSSIER_PROJET, estTypeDeLieu, TYPES_DE_LIEU_EN_CLAIR } from '../../domaine/elements.ts';
import { CLE_PORTEE } from '../../domaine/portee.ts';
import { estDocument } from '../../domaine/regles.ts';
import type { Dependances } from '../ports.ts';
import { aujourdhui, cheminDeFiche, cheminExistant, ecrireEtCommiter, lireFicheExistante, mentionDeSource, motifCheminInvalide, motifSourceInvalide, refuse, texteDeFiche } from '../commun.ts';
import type { Resultat, SourceProposee } from '../commun.ts';
import type { ReglagesNiveau } from './niveau.ts';

/**
 * Modification d'une fiche existante : synthèse, sections libres par titre (texte vide : retirée), type, titre, alias, lien
 * d'un dossier de projet (`dossier_projet`) et portée du lieu (`portee`), « » pour les retirer.
 * `appliquerProposition` / `retirerProposition` (utilisateur seulement, sans autre cible) : applique ou rejette la
 * modification qu'une session a proposée pour une consigne ou un profil.
 */
export type DemandeModification = {
	genre: 'modification';
	fiche: string;
	synthese?: string;
	sections?: Record<string, unknown>;
	type?: TypeFiche;
	titre?: string;
	alias?: string[];
	traitee?: boolean;
	dossier_projet?: string;
	portee?: string;
	appliquerProposition?: boolean;
	retirerProposition?: boolean;
	source: SourceProposee;
};

/** La fiche relue depuis son texte garde ce que la modification a écrit (rien ne se perd ni ne glisse d'une partie à l'autre). */
function survitALaRelecture(fiche: Fiche): boolean {
	try {
		const relue = lireFiche(fiche.chemin, ecrireFiche(fiche));
		return (
			relue.type === fiche.type &&
			relue.titre === fiche.titre &&
			relue.synthese === fiche.synthese &&
			JSON.stringify(relue.alias) === JSON.stringify(fiche.alias) &&
			JSON.stringify(relue.autresSections) === JSON.stringify(fiche.autresSections) &&
			relue.faits.length === fiche.faits.length &&
			relue.relations.length === fiche.relations.length &&
			JSON.stringify(relue.donnees) === JSON.stringify(fiche.donnees)
		);
	} catch {
		return false;
	}
}

const resume = (noms: string[]) => noms.join(', ');

/**
 * À appeler sous verrou. Même chemin de validation que les autres propositions : source, chemin, fiche existante ; un
 * document ne modifie jamais une consigne ni un profil ; changements de type limités (`motifDeType`). Sur une consigne ou un profil, une modification qui ne vient pas de
 * l'utilisateur (canal de confiance) est posée en proposition, à confirmer ; ailleurs, elle est appliquée. Un commit.
 */
export async function proposerModification(dep: Dependances, demande: DemandeModification, reglages: ReglagesNiveau = { appliquerDirectement: false }): Promise<Resultat> {
	const motifSource = motifSourceInvalide(demande.source);
	if (motifSource !== null) return refuse(motifSource);
	const mention = mentionDeSource(demande.source);
	if (typeof mention === 'string') return refuse(mention);
	const chemin = cheminDeFiche(demande.fiche);
	if (chemin === null) return refuse(motifCheminInvalide(demande.fiche));
	const variante = await cheminExistant(dep, chemin);
	if (variante !== null) return refuse(variante);
	const fiche = await lireFicheExistante(dep, chemin);
	if (typeof fiche === 'string') return refuse(fiche);

	const parUtilisateur = demande.source.type === 'utilisateur' && reglages.appliquerDirectement;
	const protegee = TYPES_A_CONFIRMER.includes(fiche.type);
	if (protegee && estDocument(demande.source.type)) return refuse(`Un document ne modifie pas une fiche de type ${fiche.type} (${chemin}).`);
	const date = aujourdhui(dep);

	const { appliquerProposition, retirerProposition, genre: _genre, fiche: _fiche, source: _source, ...brut } = demande;
	const decision = appliquerProposition === true ? 'appliquer' : retirerProposition === true ? 'retirer' : null;
	if (decision !== null) {
		if (appliquerProposition === true && retirerProposition === true) return refuse('appliquerProposition et retirerProposition s\'excluent.');
		if (Object.values(brut).some((v) => v !== undefined)) return refuse('appliquerProposition et retirerProposition se donnent seuls, sans autre cible.');
		if (!parUtilisateur) return refuse('Seul l\'utilisateur applique ou rejette une modification proposée (depuis l\'interface ou la ligne de commande, pas par un agent).');
		const proposee = lireModificationProposee(fiche.donnees);
		if (proposee === undefined) return refuse(`La fiche ${chemin} n'a aucune modification proposée.`);
		const sansProposition = { ...fiche, donnees: avecModificationProposee(fiche.donnees, undefined) };
		if (decision === 'retirer') {
			sansProposition.updated = date;
			const commit = await ecrireEtCommiter(dep, [{ chemin, texte: texteDeFiche(dep, sansProposition) }], `mnemo: rejette fiche ${chemin}`);
			return { statut: 'ecrit', fiche: chemin, aConfirmer: false, commit };
		}
		return appliquer(dep, sansProposition, proposee.cibles, date, true, parUtilisateur);
	}

	const cibles = validerCibles(brut);
	if (typeof cibles === 'string') return refuse(cibles);
	const motifType = motifDeType(fiche, cibles.type, parUtilisateur);
	if (motifType !== null) return refuse(motifType);
	const motifLien = motifDeLien(fiche, cibles);
	if (motifLien !== null) return refuse(motifLien);

	if (protegee && !parUtilisateur) {
		// validée comme si elle était appliquée : une proposition que la confirmation refuserait n'arrive pas au fil
		const { fiche: modifiee, changements } = appliquerCibles(fiche, cibles);
		if (changements.length === 0) return { statut: 'doublon', fiche: chemin };
		const motif = motifFicheModifiee(modifiee);
		if (motif !== null) return refuse(motif);
		const proposee = { ...fiche, updated: date, donnees: avecModificationProposee(fiche.donnees, { cibles, date, source: mention.mention }) };
		const relue = lireModificationProposee(lireFiche(chemin, ecrireFiche(proposee)).donnees);
		if (relue === undefined || JSON.stringify(relue.cibles) !== JSON.stringify(cibles)) return refuse('Cette modification ne survivrait pas à sa relecture depuis la fiche : reformule-la.');
		const commit = await ecrireEtCommiter(dep, [{ chemin, texte: texteDeFiche(dep, proposee) }], `mnemo: propose fiche ${chemin} (${resume(nomsDesCibles(cibles))})`);
		return { statut: 'ecrit', fiche: chemin, aConfirmer: true, commit, changements };
	}
	return appliquer(dep, fiche, cibles, date, false, parUtilisateur);
}

/** Types qui ont leur propre chemin d'écriture : jamais posés ni retirés par une modification. */
const TYPES_HORS_MODIFICATION: readonly TypeFiche[] = TYPES_A_CONFIRMER;
/** Types tenus par leur outil (`extraire_source` : document, passages ; épisode : clé `session`) : changés par l'utilisateur seulement. */
const TYPES_DE_L_UTILISATEUR: readonly TypeFiche[] = ['source', 'episode'];

/** Motif de refus d'un changement de type, sinon null. Jamais vers ou depuis `consigne` / `profil`. Hors canal de l'utilisateur : jamais vers ou depuis `source` / `episode`. */
function motifDeType(fiche: Fiche, vise: TypeFiche | undefined, parUtilisateur: boolean): string | null {
	const actuel = fiche.type;
	if (vise === undefined || vise === actuel) return null;
	for (const type of [actuel, vise]) {
		if (TYPES_HORS_MODIFICATION.includes(type)) return `Le type « ${type} » ne se pose ni ne se retire par une modification : une fiche ${type} a son propre chemin d'écriture.`;
	}
	if (parUtilisateur) return null;
	for (const type of [actuel, vise]) {
		if (TYPES_DE_L_UTILISATEUR.includes(type)) return `Passer du type « ${actuel} » à « ${vise} » : seul l'utilisateur le fait (une fiche ${type} est tenue par son propre outil).`;
	}
	return null;
}

/**
 * Motif de refus du lien d'un lieu, sinon null : `dossier_projet` n'est lu que sur une fiche de lieu (`estTypeDeLieu`,
 * type après la modification) ; la portée d'une consigne se pose par le genre `consigne`.
 */
function motifDeLien(fiche: Fiche, cibles: Cibles): string | null {
	const type = cibles.type ?? fiche.type;
	if (cibles.dossier_projet !== undefined && cibles.dossier_projet !== '' && !estTypeDeLieu(type)) {
		return `« ${CLE_DOSSIER_PROJET} » se pose sur une fiche ${TYPES_DE_LIEU_EN_CLAIR} (${fiche.chemin} est de type « ${type} »).`;
	}
	if (cibles.portee !== undefined && type === 'consigne') return `La portée d'une consigne se change par le genre « consigne », pas par « ${CLE_PORTEE} » d'une modification.`;
	return null;
}

/** Motif de refus de la fiche une fois modifiée (texte de consigne vide, relecture infidèle), sinon null. */
function motifFicheModifiee(nouvelle: Fiche): string | null {
	if (nouvelle.type === 'consigne' && nouvelle.synthese.trim() === '') return 'Le texte d\'une consigne (sa synthèse) ne peut pas être vide.';
	if (!survitALaRelecture(nouvelle)) return 'Cette modification ne survivrait pas à sa relecture depuis la fiche : reformule le texte ou le titre.';
	return null;
}

/** Applique les cibles et commite ; `forcer` : écrire même sans changement de contenu (la proposition retirée en est un). */
async function appliquer(dep: Dependances, fiche: Fiche, cibles: Cibles, date: string, forcer: boolean, parUtilisateur: boolean): Promise<Resultat> {
	const motifType = motifDeType(fiche, cibles.type, parUtilisateur);
	if (motifType !== null) return refuse(motifType);
	const { fiche: nouvelle, changements } = appliquerCibles(fiche, cibles);
	if (changements.length === 0 && !forcer) return { statut: 'doublon', fiche: fiche.chemin };
	nouvelle.updated = date;
	const motif = motifFicheModifiee(nouvelle);
	if (motif !== null) return refuse(motif);
	const noms = nomsDesCibles(cibles);
	const commit = await ecrireEtCommiter(dep, [{ chemin: fiche.chemin, texte: texteDeFiche(dep, nouvelle) }], `mnemo: fiche ${fiche.chemin} (${resume(noms)})`);
	return { statut: 'ecrit', fiche: fiche.chemin, aConfirmer: false, commit, changements };
}
