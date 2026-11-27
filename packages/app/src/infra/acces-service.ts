/**
 * Ce que le suivi du service (`suivi-service.ts`) fait au monde, réuni en un port : lire `service.json`, interroger la santé,
 * démarrer par `ouvrir`, demander l'arrêt, ouvrir le flux WebSocket. `accesReel` le branche sur le vrai service d'une
 * configuration ; les tests du suivi en donnent un faux.
 */
import type { MessageServeur } from '@mnemo/contrat';
import type { Configuration } from '../domaine/configuration.ts';
import type { TextesApp } from '../domaine/langue/textes.ts';
import { demanderArret, santeService, type Sante, type SuiteArret } from './api-service.ts';
import { ouvrirClientWs } from './client-ws.ts';
import { demarrerService, type ResultatDemarrage } from './demarrage.ts';
import { lireServiceJson, processusVivant, type ServiceLocal } from './service-local.ts';

export type AccesService = {
	/** `.mnemo/service.json` de la racine, ou null. */
	lireService(): ServiceLocal | null;
	sante(s: ServiceLocal): Promise<Sante>;
	processusVivant(pid: number): boolean;
	/** `ouvrir` : démarre le service (ou trouve celui qui tourne) et rend celui qui répond. */
	demarrer(): Promise<ResultatDemarrage>;
	demanderArret(s: ServiceLocal): Promise<SuiteArret>;
	/**
	 * SIGTERM au processus du service (quand la demande d'arrêt n'a pas pu lui parvenir). Sous Windows, c'est un arrêt
	 * brutal (`TerminateProcess`) : le suivi n'y recourt qu'en dernier recours.
	 */
	signalerArret(pid: number): void;
	/** Flux des messages du service (reconnexion comprise), jusqu'à `fermer`. */
	ouvrirFlux(s: ServiceLocal, surMessage: (m: MessageServeur) => void): { fermer(): void };
};

/**
 * Accès au vrai service de `configuration`. `environnement` : celui que reçoit `ouvrir` (par défaut celui de l'app, `PATH`
 * et `MNEMO_PORT` remplacés par ceux de la configuration) ; `textes` : la langue courante des raisons d'échec.
 */
export function accesReel(
	configuration: Configuration,
	options: { environnement?: NodeJS.ProcessEnv; delaisReconnexionMs?: readonly number[]; textes?: () => TextesApp } = {},
): AccesService {
	return {
		lireService: () => lireServiceJson(configuration.racine),
		sante: (s) => santeService(s),
		processusVivant,
		demarrer: () => demarrerService(configuration, options.environnement ?? process.env, options.textes?.()),
		demanderArret: (s) => demanderArret(s, options.textes?.()),
		signalerArret(pid) {
			try {
				process.kill(pid, 'SIGTERM');
			} catch {
				// déjà mort
			}
		},
		ouvrirFlux: (s, surMessage) =>
			ouvrirClientWs({ port: s.port, jeton: s.jeton, surMessage, ...(options.delaisReconnexionMs === undefined ? {} : { delaisMs: options.delaisReconnexionMs }) }),
	};
}
