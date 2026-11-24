// Extraction des documents en arrière-plan : la recherche synchronise les fiches et sert l'index tel quel, puis réveille cette file.
import { synchroniser } from './synchroniser.ts';
import type { Dependances, ExtractionDifferee } from './ports.ts';
import { messageDErreur } from '../domaine/texte.ts';

export type FileExtraction = ExtractionDifferee & {
	/** Résout quand plus rien ne tourne (ni n'est demandé). */
	calme(): Promise<void>;
	/** Plus aucun tour lancé ; résout quand celui en cours, s'il y en a un, est fini. */
	arreter(): Promise<void>;
};

/**
 * File d'extraction des documents d'un processus qui dure (service, serveur MCP) : chaque réveil demande une synchronisation
 * complète (documents changés réextraits, dans leurs fils isolés), faite à part, une à la fois ; des réveils pendant qu'elle
 * tourne n'en relancent qu'une ensuite. Une recherche n'attend donc jamais l'extraction d'un document, même de plusieurs
 * Go : elle sert l'index tel quel (anciens passages), et le trouve à jour une fois l'extraction finie. Un échec est
 * journalisé et n'arrête pas la file. `avis` : ceux des tours passés pas encore lus, rendus une seule fois.
 */
export function extractionDifferee(dep: Dependances, journal: (message: string) => void = () => {}): FileExtraction {
	let enCours: Promise<void> | null = null;
	let encore = false;
	let arrete = false;
	let avis: Record<string, string> = {};
	const tourner = async (): Promise<void> => {
		do {
			encore = false;
			try {
				// cumulés d'un tour à l'autre : un avis n'est produit qu'à la relecture du fichier, il ne doit pas se perdre
				// parce qu'un tour suivant (réveil pendant celui-ci) ne relit plus rien
				const bilan = await synchroniser(dep);
				// fusionnés après l'attente : ceux lus pendant le tour restent lus
				avis = { ...avis, ...(bilan.avis ?? {}) };
			} catch (erreur) {
				journal(`extraction des documents en arrière-plan : ${messageDErreur(erreur)}`);
			}
		} while (encore && !arrete);
	};
	const calme = async (): Promise<void> => {
		while (enCours !== null) await enCours;
	};
	return {
		reveiller() {
			if (arrete) return;
			if (enCours !== null) {
				encore = true;
				return;
			}
			enCours = tourner().finally(() => {
				enCours = null;
			});
		},
		avis() {
			// rendus une fois : la recherche qui les lit les transmet
			const lus = avis;
			avis = {};
			return lus;
		},
		calme,
		arreter() {
			arrete = true;
			return calme();
		},
	};
}
