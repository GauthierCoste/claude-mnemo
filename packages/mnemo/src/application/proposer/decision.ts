import { ecrireFait, faitsEgaux, lireFait } from '../../domaine/fait.ts';
import type { Fait } from '../../domaine/fait.ts';
import { retenirPlusHauteAncre } from '../../domaine/fiche.ts';
import { confirmerFait } from '../../domaine/confirmation.ts';
import type { Dependances } from '../ports.ts';
import { ancreDeFait, aujourdhui, cheminDeFiche, cheminExistant, ecrireEtCommiter, lireFicheExistante, motifCheminInvalide, refuse, texteDeFiche } from '../commun.ts';
import type { Resultat } from '../commun.ts';

export type DemandeDecision = { genre: 'confirmer' | 'rejeter' | 'supprimer'; fiche: string; ancre: string };

const VERBES = { confirmer: 'confirme', rejeter: 'rejette', supprimer: 'supprime' } as const;

/**
 * Confirmer, rejeter ou supprimer une information : décision de l'utilisateur seul (`parUtilisateur` vrai pour un canal où il
 * parle lui-même : interface, ligne de commande). Par MCP, un agent ne tranche jamais ce qui attend l'humain.
 */
export async function proposerDecision(dep: Dependances, demande: DemandeDecision, parUtilisateur: boolean): Promise<Resultat> {
	if (!parUtilisateur) {
		return refuse(`${demande.genre[0]!.toUpperCase()}${demande.genre.slice(1)} une information est réservé à l'utilisateur, dans l'interface de Mnemo : signale-lui l'information ^${demande.ancre.replace(/^.*\^/u, '')} de ${demande.fiche}.`);
	}
	const chemin = cheminDeFiche(demande.fiche);
	if (chemin === null) return refuse(motifCheminInvalide(demande.fiche));
	const variante = await cheminExistant(dep, chemin);
	if (variante !== null) return refuse(variante);
	const fiche = await lireFicheExistante(dep, chemin);
	if (typeof fiche === 'string') return refuse(fiche);
	const vise = ancreDeFait(demande.ancre, chemin);
	if ('motif' in vise) return refuse(vise.motif);
	const ancre = vise.ancre;
	const index = fiche.faits.findIndex((l) => 'fait' in l && l.fait.ancre === ancre);
	if (index === -1) return refuse(`L'information ^${ancre} n'existe pas dans ${chemin}.`);
	const fait = (fiche.faits[index] as { fait: Fait }).fait;

	const date = aujourdhui(dep);
	const touches: Fait[] = [fait];
	if (demande.genre === 'confirmer') {
		if (!fait.aConfirmer) return refuse(`L'information ^${ancre} n'est pas « a confirmer » : déjà confirmée.`);
		// Confirmer une contradiction barre le fait contredit, dans la même écriture ; la mention reste pour l'historique.
		touches.splice(0, touches.length, ...confirmerFait(fiche.faits, fait, date));
	} else if (demande.genre === 'rejeter') {
		if (fait.barre) return refuse(`L'information ^${ancre} est déjà barrée.`);
		fait.barre = true;
		fait.aConfirmer = false;
		fait.invalideLe = date;
	} else {
		const avant = { ...fiche, faits: [...fiche.faits] };
		fiche.faits.splice(index, 1);
		// son numéro d'ancre ne resservira pas : un lien resté vers lui ne viserait jamais une autre information
		retenirPlusHauteAncre(avant, fiche);
		touches.length = 0;
	}
	for (const touche of touches) {
		const lignes = ecrireFait(touche);
		if (!faitsEgaux(lireFait(lignes[0]!, ...lignes.slice(1)), touche)) return refuse(`L'information ^${touche.ancre ?? '?'} ne survivrait pas à sa relecture depuis la fiche.`);
	}
	fiche.updated = date;
	const commit = await ecrireEtCommiter(dep, [{ chemin, texte: texteDeFiche(dep, fiche) }], `mnemo: ${VERBES[demande.genre]} ${chemin} ^${ancre}`);
	return { statut: 'ecrit', fiche: chemin, ancre, aConfirmer: false, commit };
}
