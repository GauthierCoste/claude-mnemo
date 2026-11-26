/**
 * `mnemo banc contexte --apprendre` : apprend la note de confiance sur les jugements du banc (spec classement vivant § 4.3),
 * écrit les coefficients de la mémoire (`.mnemo/coefficients-note.json`, que le service charge) et le rapport, en texte et en
 * JSON, dans `.mnemo/` (local, aucun texte de fiche ni de message). `--module <chemin>` écrit aussi le module de données
 * TypeScript (développement : la valeur par défaut du dépôt), jamais sous `node_modules`. `--module <chemin> --depart` (D2 du
 * 26/11) : les poids de départ livrés avec Mnemo, seulement le module, en modèles de départ ; rien n'est écrit dans `.mnemo/`.
 */
import { rename, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { apprendreNote, jeuDApprentissage } from '../../application/apprendre-note.ts';
import type { RapportDApprentissage } from '../../application/apprendre-note.ts';
import { rapportEnTexte } from '../../application/rapport-apprentissage.ts';
import type { CasContexte } from '../../application/banc-contexte.ts';
import { DOSSIER_LOCAL } from '../../domaine/dossier-memoire.ts';
import { enModelesDeDepart, jsonDeCoefficients, moduleDeCoefficients } from '../../domaine/modele-de-note.ts';
import type { EchelleDesSignaux, IdentiteDesModeles } from '../../domaine/modele-de-note.ts';
import { fichierDesCoefficients } from '../../infra/coefficients-note-fichier.ts';
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
 * Apprend sur les cas du banc et écrit les coefficients (`.mnemo/coefficients-note.json`, et le module `module` s'il est donné)
 * et le rapport (`.mnemo/apprentissage-note.txt` et `.json`). `empreinteDe` : empreintes actuelles des fiches (null : non
 * vérifiées) ; `installes` : identité des modèles installés. `depart` : seulement le module (obligatoire), ses modèles appris
 * marqués de départ (`enModelesDeDepart`) ; ni coefficients ni rapport dans `.mnemo/`.
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
		module?: string;
		depart?: boolean;
		graines?: readonly number[];
	},
): Promise<{ rapport: RapportDApprentissage; texte: string }> {
	const module = options.module === undefined ? undefined : verifierCheminDuModule(options.module);
	if (options.depart === true && module === undefined) throw new ErreurCli('--depart : le module à écrire manque (--module <chemin>).');
	const jeu = jeuDApprentissage(cas, options.empreinteDe, { empreintes: options.empreintes, installes: options.installes });
	const rapport = apprendreNote(jeu, { date: options.date, ...(options.graines === undefined ? {} : { graines: options.graines }), ...(options.echelle === undefined ? {} : { echelle: options.echelle }) });
	if (options.depart === true) {
		const depart = { ...rapport, coefficients: enModelesDeDepart(rapport.coefficients) };
		await ecrireEntier(module!, moduleDeCoefficients(depart.coefficients));
		return { rapport: depart, texte: rapportEnTexte(depart, [module!]) };
	}
	const coefficients = fichierDesCoefficients(racine);
	await ecrireEntier(coefficients, jsonDeCoefficients(rapport.coefficients));
	if (module !== undefined) await ecrireEntier(module, moduleDeCoefficients(rapport.coefficients));
	const texte = rapportEnTexte(rapport, [coefficients, ...(module === undefined ? [] : [module])]);
	await ecrireEntier(join(racine, DOSSIER_LOCAL, 'apprentissage-note.json'), `${JSON.stringify(rapport, null, 2)}\n`);
	await ecrireEntier(join(racine, DOSSIER_LOCAL, 'apprentissage-note.txt'), `${texte}\n`);
	return { rapport, texte };
}
