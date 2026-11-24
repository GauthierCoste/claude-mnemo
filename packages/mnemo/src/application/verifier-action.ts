import { lireConsigne } from '../domaine/consigne.ts';
import type { Regle } from '../domaine/consigne.ts';
import { lireFiche } from '../domaine/fiche.ts';
import { refusSurErreur, selonIndicateur } from '../domaine/refus-outil.ts';
import type { AccordNonVerifie } from '../domaine/refus-outil.ts';
import { verifier } from '../domaine/regles-verifiees.ts';
import type { ActionNonLue, ActionOutil, Verdict } from '../domaine/regles-verifiees.ts';
import type { Dependances } from './ports.ts';
import type { Position } from './position.ts';
import { consignesVerifiees } from './servir.ts';

/**
 * Consignes choisies dans l'index sans le synchroniser, règles relues dans leurs fiches : une fiche retirée
 * ou passée à un autre niveau depuis ne compte plus ; une fiche illisible se refuse, sa règle étant inconnue.
 */
export async function verifierAction(dep: Dependances, position: Position, action: ActionOutil | ActionNonLue, contexte: { racine: string; cwd: string; sansCasse: boolean }): Promise<Verdict | AccordNonVerifie> {
	let elements: Awaited<ReturnType<typeof consignesVerifiees>>;
	try {
		elements = await consignesVerifiees(dep, position);
	} catch (erreur) {
		// index illisible : on ne sait pas quelles consignes s'appliquent
		return selonIndicateur(refusSurErreur(erreur), await dep.indicateur.lire());
	}
	const regles: { texte: string; regle: Regle }[] = [];
	for (const element of elements) {
		const illisible: Verdict = { refus: true, cause: 'consigne_illisible', detail: element.chemin };
		try {
			const texte = await dep.coffre.lire(element.chemin);
			if (texte === null) continue;
			const fiche = lireFiche(element.chemin, texte);
			if (fiche.type !== 'consigne') continue;
			const consigne = lireConsigne(fiche);
			if (consigne.niveau !== 'verifiee') continue;
			if (consigne.regle === undefined) return illisible;
			regles.push({ texte: consigne.texte, regle: consigne.regle });
		} catch {
			return illisible;
		}
	}
	return verifier(regles, action, contexte);
}
