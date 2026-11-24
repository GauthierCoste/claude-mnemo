import { avecConsigne, lireConsigne } from '../../domaine/consigne.ts';
import type { Consigne, Niveau, Regle } from '../../domaine/consigne.ts';
import { ecrireFiche, lireFiche } from '../../domaine/fiche.ts';
import type { Fiche } from '../../domaine/fiche.ts';
import { motifRegleInvalide } from '../../domaine/regles-verifiees.ts';
import type { Dependances } from '../ports.ts';
import { aujourdhui, cheminDeFiche, cheminExistant, ecrireEtCommiter, lireFicheExistante, mentionDeSource, motifCheminInvalide, motifSourceInvalide, refuse, texteDeFiche } from '../commun.ts';
import type { Resultat, SourceProposee } from '../commun.ts';

/**
 * Réglage de l'appelant : `appliquerDirectement` vrai seulement pour un canal où parle l'utilisateur lui-même (CLI, service
 * HTTP). Faux (défaut, et toujours pour le serveur MCP, où seul un agent appelle) : la source déclarée ne suffit pas, toute
 * demande devient une `proposition` et `retirerProposition` est refusé.
 */
export type ReglagesNiveau = { appliquerDirectement: boolean };

/**
 * Niveau ou règle d'une consigne existante. Venue d'une session : posée en `proposition`, à
 * confirmer, sans rien changer d'autre ; de l'utilisateur : appliquée, la proposition effacée. `retirerProposition`
 * (utilisateur seulement, sans `niveau` ni `regle`) : la proposition est rejetée.
 */
export type DemandeNiveau = { genre: 'niveau'; fiche: string; niveau?: Niveau; regle?: Regle; retirerProposition?: boolean; source: SourceProposee };

const SOURCES: readonly string[] = ['utilisateur', 'session'];

const memeRegle = (a: Regle | undefined, b: Regle | undefined) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** La fiche relue depuis son texte donne la même consigne (proposition comprise). */
function survitALaRelecture(fiche: Fiche): boolean {
	try {
		const relue = lireFiche(fiche.chemin, ecrireFiche(fiche));
		return relue.type === 'consigne' && JSON.stringify(lireConsigne(relue)) === JSON.stringify(lireConsigne(fiche));
	} catch {
		return false;
	}
}

export async function proposerNiveau(dep: Dependances, demande: DemandeNiveau, reglages: ReglagesNiveau = { appliquerDirectement: false }): Promise<Resultat> {
	// Sécurité : le niveau d'une consigne vient de l'utilisateur ou d'une session, jamais d'un document.
	if (!SOURCES.includes(demande.source.type)) return refuse(`Le niveau d'une consigne ne peut venir que de l'utilisateur ou d'une session, pas d'une source « ${demande.source.type} ».`);
	const motifSource = motifSourceInvalide(demande.source);
	if (motifSource !== null) return refuse(motifSource);
	const mention = mentionDeSource(demande.source);
	if (typeof mention === 'string') return refuse(mention);
	const retirer = demande.retirerProposition === true;
	if (retirer && (demande.niveau !== undefined || demande.regle !== undefined)) return refuse('retirerProposition rejette la proposition : sans « niveau » ni « regle ».');
	// l'utilisateur seul applique ou rejette : sa source déclarée ne compte que sur un canal de confiance
	const parUtilisateur = demande.source.type === 'utilisateur' && reglages.appliquerDirectement;
	if (retirer && !parUtilisateur) return refuse('Seul l\'utilisateur rejette une proposition de niveau (depuis l\'interface ou la ligne de commande, pas par un agent).');
	if (!retirer && demande.niveau === undefined && demande.regle === undefined) return refuse('Rien à changer : donne « niveau », « regle », ou « retirerProposition ».');
	if (demande.regle !== undefined) {
		const motif = motifRegleInvalide(demande.regle);
		if (motif !== null) return refuse(`Règle invalide : ${motif}`);
	}

	const chemin = cheminDeFiche(demande.fiche);
	if (chemin === null) return refuse(motifCheminInvalide(demande.fiche));
	const variante = await cheminExistant(dep, chemin);
	if (variante !== null) return refuse(variante);
	const fiche = await lireFicheExistante(dep, chemin);
	if (typeof fiche === 'string') return refuse(fiche);
	if (fiche.type !== 'consigne') return refuse(`La fiche ${chemin} n'est pas une consigne.`);
	const actuelle = lireConsigne(fiche);
	const date = aujourdhui(dep);

	let suivante: Consigne;
	let action: string;
	if (retirer) {
		if (actuelle.proposition === undefined) return refuse(`La consigne ${chemin} n'a aucune proposition de niveau à rejeter.`);
		suivante = { ...actuelle };
		delete suivante.proposition;
		action = 'rejette niveau';
	} else {
		const niveau = demande.niveau ?? actuelle.niveau;
		const regle = demande.regle ?? actuelle.regle;
		// `verifiee` exige une règle vérifiable (celle demandée, sinon celle de la consigne)
		if (niveau === 'verifiee' && (regle === undefined || motifRegleInvalide(regle) !== null)) {
			return refuse('Le niveau « verifiee » exige une règle valide (« chemins_interdits » ou « commandes_interdites », 1 à 20 motifs).');
		}
		if (!parUtilisateur && niveau === actuelle.niveau && memeRegle(regle, actuelle.regle)) {
			return refuse(`Rien à proposer : la consigne ${chemin} est déjà à ce niveau, avec cette règle.`);
		}
		if (!parUtilisateur) {
			suivante = { ...actuelle, proposition: { niveau, ...(demande.regle === undefined ? {} : { regle: demande.regle }), date, source: mention.mention } };
			action = 'propose niveau';
		} else {
			suivante = { ...actuelle, niveau };
			if (regle !== undefined) suivante.regle = regle;
			delete suivante.proposition;
			action = 'niveau';
		}
	}

	const nouvelle = avecConsigne(fiche, suivante);
	// comparées sous la forme lue (ordre des clés fixé par `lireConsigne`)
	if (JSON.stringify(lireConsigne(nouvelle)) === JSON.stringify(actuelle)) return refuse(`Rien à changer : la consigne ${chemin} est déjà ainsi (proposition comprise).`);
	nouvelle.updated = date;
	if (!survitALaRelecture(nouvelle)) return refuse('Ce niveau ne survivrait pas à sa relecture depuis la fiche.');
	const commit = await ecrireEtCommiter(dep, [{ chemin, texte: texteDeFiche(dep, nouvelle) }], `mnemo: ${action} ${chemin}`);
	return { statut: 'ecrit', fiche: chemin, aConfirmer: action === 'propose niveau', commit };
}
