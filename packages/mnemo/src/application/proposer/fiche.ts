import { CLES_DE_CONSIGNE } from '../../domaine/consigne.ts';
import { CLE_DOSSIER_PROJET, CLE_PERIME_LE, estTypeDeLieu, TYPES_DE_LIEU_EN_CLAIR } from '../../domaine/elements.ts';
import { estDate } from '../../domaine/fait.ts';
import { CLE_PORTEE } from '../../domaine/portee.ts';
import { dossierProjetPropose, porteeDeLieuProposee } from '../../domaine/rattachement.ts';
import { CLES_RESERVEES, ecrireFiche, lireFiche } from '../../domaine/fiche.ts';
import { CLE_MODIFICATION_PROPOSEE } from '../../domaine/modification.ts';
import type { TypeFiche } from '../../domaine/fiche.ts';
import type { Dependances } from '../ports.ts';
import { cheminDeFiche, dossiersManquants, ecrireEtCommiter, enFichier, ficheVide, motifCheminInvalide, motifCollision, motifTitreInvalide, motifTypeInvalide, refuse } from '../commun.ts';
import type { Resultat } from '../commun.ts';

export type DemandeFiche = { genre: 'fiche'; chemin: string; type: TypeFiche; titre: string; synthese?: string; donnees?: Record<string, unknown> };

const TYPES_PROTEGES: readonly string[] = ['consigne', 'profil'];
/** Données qui désignent un épisode (`session`, `projet`) ou une note amorcée (`origine`), où qu'ils soient rangés : écrites par Mnemo seul. */
const CLES_D_IDENTIFICATION: readonly string[] = ['session', 'projet', 'origine'];

/** Motif de refus des clés données dans les données (`dossier_projet`, `portee`, `perime_le` : mêmes valeurs qu'une modification), sinon null. */
function motifDuLien(type: TypeFiche, donnees: Record<string, unknown>): string | null {
	if (Object.hasOwn(donnees, CLE_DOSSIER_PROJET)) {
		const lu = dossierProjetPropose(donnees[CLE_DOSSIER_PROJET]);
		if ('motif' in lu) return lu.motif;
		if (lu.valeur !== donnees[CLE_DOSSIER_PROJET]) return `« ${CLE_DOSSIER_PROJET} » : écris-le « ${lu.valeur} » (séparé par « / », sans « / » aux extrémités).`;
		if (!estTypeDeLieu(type)) return `« ${CLE_DOSSIER_PROJET} » se pose sur une fiche ${TYPES_DE_LIEU_EN_CLAIR}.`;
	}
	if (Object.hasOwn(donnees, CLE_PORTEE)) {
		const lue = porteeDeLieuProposee(donnees[CLE_PORTEE]);
		if ('motif' in lue) return lue.motif;
		if (lue.valeur !== donnees[CLE_PORTEE]) return `« ${CLE_PORTEE} » : écris-la « ${lue.valeur} ».`;
	}
	if (Object.hasOwn(donnees, CLE_PERIME_LE)) {
		const jour = donnees[CLE_PERIME_LE];
		if (typeof jour !== 'string' || !estDate(jour)) return `« ${CLE_PERIME_LE} » est une date AAAA-MM-JJ : le jour où la fiche temporaire cesse d'être vraie.`;
	}
	return null;
}

export async function proposerFiche(dep: Dependances, demande: DemandeFiche): Promise<Resultat> {
	const chemin = cheminDeFiche(demande.chemin);
	if (chemin === null) return refuse(motifCheminInvalide(demande.chemin));
	const motifType = motifTypeInvalide(demande.type);
	if (motifType !== null) return refuse(motifType);
	// Sécurité : consignes et profils guident les sessions ; ils ont leur propre chemin d'écriture.
	if (TYPES_PROTEGES.includes(demande.type)) return refuse(`Une fiche de type « ${demande.type} » ne se crée pas par le genre « fiche ».`);
	const motifTitre = motifTitreInvalide(demande.titre);
	if (motifTitre !== null) return refuse(motifTitre);
	const titre = demande.titre.trim();
	const synthese = (demande.synthese ?? '').trim();
	if (/^#{1,2} /mu.test(synthese)) return refuse('La synthèse ne doit pas contenir de titre « # » ou « ## ».');
	const donnees = demande.donnees ?? {};
	const reservee = Object.keys(donnees).find((cle) => CLES_RESERVEES.includes(cle) || (CLES_DE_CONSIGNE.includes(cle) && cle !== CLE_PORTEE) || cle === CLE_MODIFICATION_PROPOSEE || CLES_D_IDENTIFICATION.includes(cle));
	if (reservee !== undefined) return refuse(`La clé « ${reservee} » est gérée par Mnemo : elle ne peut pas figurer dans les données.`);
	const motifLien = motifDuLien(demande.type, donnees);
	if (motifLien !== null) return refuse(motifLien);
	const collision = await motifCollision(dep, chemin);
	if (collision !== null) return refuse(collision);

	const fiche = ficheVide(dep, chemin, demande.type, titre, structuredClone(donnees));
	fiche.synthese = synthese;
	const texte = ecrireFiche(fiche);
	try {
		const relue = lireFiche(chemin, texte);
		if (relue.titre !== titre || relue.synthese !== synthese || JSON.stringify(relue.donnees) !== JSON.stringify(fiche.donnees)) throw new Error('différence');
	} catch {
		return refuse('Cette fiche ne survivrait pas à sa relecture : reformule le titre, la synthèse ou les données.');
	}
	const dossiers = await dossiersManquants(dep, chemin);
	if (typeof dossiers === 'string') return refuse(dossiers);
	const aEcrire = [enFichier(dep, fiche), ...dossiers.map((f) => enFichier(dep, f))];
	const commit = await ecrireEtCommiter(dep, aEcrire, `mnemo: fiche ${chemin}`);
	return { statut: 'ecrit', fiche: chemin, aConfirmer: false, commit };
}
