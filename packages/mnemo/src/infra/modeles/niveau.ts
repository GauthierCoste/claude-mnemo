import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { estNiveauModeles, NIVEAU_MODELES_PAR_DEFAUT, niveauRetireUnModele } from '@mnemo/commun';
import type { NiveauModeles } from '@mnemo/commun';
import { dossierServeurs } from './dossier.ts';
import { journaliser } from './journal.ts';
import { arreterServeurs, ecrireJson, preparerDossierServeurs, verrouModeles } from './serveurs.ts';
import type { ResultatArret } from './serveurs.ts';

/** Niveau des modèles de la machine, dans `serveurs/` (à côté de l'état du gardien qu'il borne). */
export const FICHIER_NIVEAU = 'niveau.json';

/**
 * Niveau rangé dans `dossier` (`serveurs/`) ; absent ou illisible : `complets`. Une lecture d'un petit fichier, faite à chaque
 * appel aux modèles : un changement vaut dès l'appel suivant, sans cache à invalider.
 */
export async function lireNiveau(dossier: string): Promise<NiveauModeles> {
	try {
		const brut = JSON.parse(await readFile(join(dossier, FICHIER_NIVEAU), 'utf8')) as { niveau?: unknown } | null;
		return estNiveauModeles(brut?.niveau) ? brut.niveau : NIVEAU_MODELES_PAR_DEFAUT;
	} catch {
		return NIVEAU_MODELES_PAR_DEFAUT;
	}
}

/** Niveau des modèles de la machine (celle de `env` : `MNEMO_MODELES` isole les tests). */
export function niveauMachine(env: NodeJS.ProcessEnv = process.env, plateforme: NodeJS.Platform = process.platform): Promise<NiveauModeles> {
	return lireNiveau(dossierServeurs(env, plateforme, homedir()));
}

/** Changement de niveau : l'ancien, et l'arrêt des serveurs s'il a fallu les arrêter (null sinon). */
export type ChangementNiveau = { ancien: NiveauModeles; niveau: NiveauModeles; arret: ResultatArret | null };

/**
 * Range le niveau de la machine (`serveurs/niveau.json`, d'un coup, droits 0600, sous le verrou des modèles). S'il retire un
 * modèle par rapport à l'ancien, le gardien en marche est arrêté (`arreterServeurs`) : le prochain usage le relance avec les
 * seuls modèles permis. S'il en ajoute un, rien n'est lancé.
 */
export async function changerNiveau(env: NodeJS.ProcessEnv, niveau: NiveauModeles, plateforme: NodeJS.Platform = process.platform): Promise<ChangementNiveau> {
	const dossier = dossierServeurs(env, plateforme, homedir());
	await preparerDossierServeurs(dossier);
	const ancien = await verrouModeles(dossier).avec(async () => {
		const avant = await lireNiveau(dossier);
		await ecrireJson(join(dossier, FICHIER_NIVEAU), { niveau });
		return avant;
	});
	if (ancien !== niveau) await journaliser(dossier, `niveau des modèles : ${ancien} → ${niveau}`);
	// hors du verrou : l'arrêt le prend lui-même (registre des serveurs lancés)
	const arret = niveauRetireUnModele(ancien, niveau) ? await arreterServeurs(dossier, env) : null;
	return { ancien, niveau, arret };
}
