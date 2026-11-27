/**
 * `mnemo banc contexte --apprendre` : apprend la note de confiance sur les jugements du banc (spec classement vivant § 4.3) et
 * l'enregistre comme le bouton « Apprendre la note » du service (`enregistrerApprentissage`) : un niveau sans paire jugée garde
 * le modèle actuel ; les coefficients de la mémoire (`.mnemo/coefficients-note.json`, que le service charge), l'actuel gardé
 * comme modèle d'avant (`coefficients-note.avant.json`) ; le rapport, en texte et en JSON ; une ligne d'historique manuelle
 * (`entrainements.json`). Tout dans `.mnemo/` (local, aucun texte de fiche ni de message). `--module <chemin>` écrit aussi le
 * module de données TypeScript (développement : la valeur par défaut du dépôt), jamais sous `node_modules`. `--module <chemin>
 * --depart` (D2 du 26/11) : les poids de départ livrés avec Mnemo, seulement le module, en modèles de départ ; rien n'est écrit
 * dans `.mnemo/`.
 */
import { rename, writeFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { apprendreNote, jeuDApprentissage } from '../../application/apprendre-note.ts';
import type { RapportDApprentissage } from '../../application/apprendre-note.ts';
import { rapportEnTexte } from '../../application/rapport-apprentissage.ts';
import type { CasContexte } from '../../application/banc-contexte.ts';
import { enregistrerApprentissage } from '../../application/entrainement.ts';
import { echelleDesSignaux, enModelesDeDepart, moduleDeCoefficients } from '../../domaine/modele-de-note.ts';
import type { ReglageDInjection } from '../../domaine/acceptation-note.ts';
import type { EchelleDesSignaux, IdentiteDesModeles } from '../../domaine/modele-de-note.ts';
import { modelesDeNote } from '../../domaine/note-de-confiance.ts';
import { REGLAGES_PAR_DEFAUT } from '../../domaine/reglages.ts';
import { fichierDesCoefficients, lireCoefficientsDuDossier } from '../../infra/coefficients-note-fichier.ts';
import { fichiersDeLaNote, historiqueDuDossier } from '../../infra/fichiers-entrainement.ts';
import { ErreurCli } from './erreurs.ts';

export { fichierDesCoefficients, ggufInstalles } from '../../infra/coefficients-note-fichier.ts';
export { rapportEnTexte };

/** Un module de développement ne s'écrit jamais dans une installation (`node_modules`). */
export function verifierCheminDuModule(chemin: string): string {
	const absolu = resolve(chemin);
	if (absolu.split(sep).includes('node_modules')) throw new ErreurCli(`--module : refusé sous node_modules (${absolu}).`);
	return absolu;
}

async function ecrireEntier(fichier: string, texte: string): Promise<void> {
	const provisoire = `${fichier}.${process.pid}.tmp`;
	await writeFile(provisoire, texte);
	await rename(provisoire, fichier);
}

/**
 * Apprend sur les cas du banc et l'enregistre comme le service : coefficients (`.mnemo/coefficients-note.json`, l'actuel gardé
 * comme modèle d'avant ; un niveau sans paire jugée garde son modèle actuel), rapport (`.mnemo/apprentissage-note.txt` et
 * `.json`), ligne d'historique manuelle ; le module `module` s'il est donné, avec les mêmes coefficients. `empreinteDe` :
 * empreintes actuelles des fiches (null : non vérifiées) ; `installes` : identité des modèles installés ; `echelle` : celle de la
 * mémoire (défaut : celle des réglages par défaut, comme l'apprentissage). `depart` : seulement le module (obligatoire), ses
 * modèles appris marqués de départ (`enModelesDeDepart`) ; ni coefficients, ni rapport, ni historique dans `.mnemo/`.
 */
export async function apprendreAuBanc(
	racine: string,
	cas: readonly CasContexte[],
	options: {
		empreinteDe: ReadonlyMap<string, string> | null;
		empreintes: 'exclure' | 'garder';
		date: string;
		installes: IdentiteDesModeles;
		/** Échelle des signaux de la mémoire (ses réglages du signal de session), enregistrée avec les modèles. */
		echelle?: EchelleDesSignaux;
		/** Réglage d'injection de la mémoire, où la note se mesure ; défaut : seuil de 90 %. */
		reglage?: ReglageDInjection;
		module?: string;
		depart?: boolean;
		graines?: readonly number[];
	},
): Promise<{ rapport: RapportDApprentissage; texte: string }> {
	const module = options.module === undefined ? undefined : verifierCheminDuModule(options.module);
	if (options.depart === true && module === undefined) throw new ErreurCli('--depart : le module à écrire manque (--module <chemin>).');
	const echelle = options.echelle ?? echelleDesSignaux(REGLAGES_PAR_DEFAUT.contexte);
	const jeu = jeuDApprentissage(cas, options.empreinteDe, { empreintes: options.empreintes, installes: options.installes });
	const rapport = apprendreNote(jeu, { date: options.date, echelle, ...(options.reglage === undefined ? {} : { reglage: options.reglage }), ...(options.graines === undefined ? {} : { graines: options.graines }) });
	if (options.depart === true) {
		const depart = { ...rapport, coefficients: enModelesDeDepart(rapport.coefficients) };
		await ecrireEntier(module!, moduleDeCoefficients(depart.coefficients));
		return { rapport: depart, texte: rapportEnTexte(depart, [module!]) };
	}
	const fichiers = fichiersDeLaNote(racine);
	const aussi = module === undefined ? [] : [module];
	const { coefficients } = await enregistrerApprentissage(
		{
			note: {
				// les modèles actuels de la mémoire, comme le service les lit (fichier, sinon le module livré)
				modeles: async () => modelesDeNote(lireCoefficientsDuDossier(racine).coefficients, options.installes, echelle),
				installes: () => options.installes,
				echelle: () => echelle,
				ecrire: fichiers.ecrire,
				ecrireRapport: (r, remplace) => fichiers.ecrireRapport(r, remplace, aussi),
			},
			historique: historiqueDuDossier(racine),
		},
		rapport,
		{ date: options.date, origine: 'manuel' },
	);
	if (module !== undefined) await ecrireEntier(module, moduleDeCoefficients(coefficients));
	return { rapport, texte: rapportEnTexte(rapport, [fichierDesCoefficients(racine), ...aussi]) };
}
