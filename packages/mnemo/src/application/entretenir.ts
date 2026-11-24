import { sousVerrou } from './commun.ts';
import type { Resultat } from './commun.ts';
import { corrigerLien } from './entretien/corriger-lien.ts';
import type { DemandeCorrectionLien } from './entretien/corriger-lien.ts';
import { corroborer } from './entretien/corroborer.ts';
import type { DemandeCorroboration } from './entretien/corroborer.ts';
import { deplacerInformations } from './entretien/deplacer-informations.ts';
import type { DemandeDeplacementInformations } from './entretien/deplacer-informations.ts';
import { fusionnerFiches } from './entretien/fusionner.ts';
import type { DemandeFusion } from './entretien/fusionner.ts';
import { supprimerFiche } from './entretien/supprimer.ts';
import type { DemandeSuppression, RefusCitee } from './entretien/supprimer.ts';
import { retoucherInformation } from './entretien/retoucher.ts';
import type { DemandeRetouche } from './entretien/retoucher.ts';
import { proposerLot } from './lots.ts';
import type { DemandeLot, ResultatLotPropose } from './lots.ts';
import type { Dependances } from './ports.ts';
import { reindexerApresEcriture } from './synchroniser.ts';

export type { DemandeCorrectionLien, DemandeCorroboration, DemandeDeplacementInformations, DemandeFusion, DemandeLot, DemandeRetouche, DemandeSuppression, RefusCitee, ResultatLotPropose };
/** Ménage de la mémoire par l'archiviste. Renommer ou déplacer une fiche ou un dossier : `deplacer`. */
export type DemandeEntretien = DemandeSuppression | DemandeFusion | DemandeCorrectionLien | DemandeCorroboration | DemandeRetouche | DemandeDeplacementInformations | DemandeLot;
/** `lot_propose` (`proposer_lot`) : le lot est enregistré, rien n'est écrit dans la mémoire. */
export type ResultatEntretien = Resultat | RefusCitee | ResultatLotPropose;

/**
 * Une action d'entretien : sous verrou, un commit `mnemo: <action> <chemin>`, puis l'index remis à jour. `proposer_lot`
 * n'écrit rien (le lot attend l'utilisateur) : ni verrou, ni commit.
 */
export async function entretenir(dep: Dependances, demande: DemandeEntretien): Promise<ResultatEntretien> {
	if (demande.action === 'proposer_lot') return proposerLot(dep, demande);
	const resultat = await sousVerrou<Resultat | RefusCitee>(dep, () => {
		switch (demande.action) {
			case 'supprimer':
				return supprimerFiche(dep, demande);
			case 'fusionner':
				return fusionnerFiches(dep, demande);
			case 'corriger_lien':
				return corrigerLien(dep, demande);
			case 'corroborer':
				return corroborer(dep, demande);
			case 'retoucher_information':
				return retoucherInformation(dep, demande);
			case 'deplacer_informations':
				return deplacerInformations(dep, demande);
		}
	});
	if (resultat.statut === 'ecrit') return { ...resultat, ...(await reindexerApresEcriture(dep)) };
	return resultat;
}
