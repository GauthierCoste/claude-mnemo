// Confirmer une information « à confirmer » : décision de l'utilisateur. Pur, sans module `node:`.
import type { Fait } from './fait.ts';
import type { LigneDeFait } from './fiche.ts';

/** Fait non barré portant l'ancre, ou undefined. */
function faitVivant(lignes: readonly LigneDeFait[], ancre: string): Fait | undefined {
	for (const ligne of lignes) {
		if ('fait' in ligne && ligne.fait.ancre === ancre && !ligne.fait.barre) return ligne.fait;
	}
	return undefined;
}

/**
 * Confirme `fait` (à confirmer) parmi les informations `lignes` de sa fiche, en place : il perd « à confirmer » ; s'il
 * contredit une information vivante, elle est barrée dans la même écriture (`invalidé <jour> par ^<ancre>`, fin de validité
 * posée au plus tôt au jour même), la mention `contredit` restant pour l'historique. Rend les informations touchées.
 * L'appelant a vérifié que `fait` est à confirmer.
 */
export function confirmerFait(lignes: readonly LigneDeFait[], fait: Fait, jour: string): Fait[] {
	const touches: Fait[] = [fait];
	fait.aConfirmer = false;
	const contredit = fait.contredit === undefined ? undefined : faitVivant(lignes, fait.contredit);
	if (contredit !== undefined && contredit !== fait) {
		contredit.barre = true;
		contredit.invalideLe = jour;
		if (fait.ancre !== undefined) contredit.invalidePar = fait.ancre;
		if (contredit.valideFin === undefined) contredit.valideFin = contredit.valideDebut !== undefined && contredit.valideDebut > jour ? contredit.valideDebut : jour;
		touches.push(contredit);
	}
	return touches;
}
