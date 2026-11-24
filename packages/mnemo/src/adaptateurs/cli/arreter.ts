import { ROUTES } from '@mnemo/contrat';
import { requeteLocaleDetaillee } from '../../infra/modeles/http-local.ts';
import type { EchecLocal, ReponseLocale } from '../../infra/modeles/http-local.ts';
import { processusVivant } from '../../infra/service-local.ts';
import { AUCUNE_MEMOIRE, ErreurCli } from './erreurs.ts';
import { trouverRacine } from './racine.ts';
import { serviceVivant } from './service.ts';

/** L'arrêt propre laisse aux sessions le temps de s'arrêter (voir `commandeService`). */
const ATTENTE_ARRET_MS = 65_000;
/** Réponse de `POST /api/arret` (le service répond avant de s'arrêter). */
const ATTENTE_REPONSE_MS = 5000;

export type SuiteArret = 'accepte' | 'signal' | 'attendre' | { refus: string };

/**
 * SIGTERM seulement si le service ne peut pas avoir reçu la demande (connexion refusée) ou ne connaît pas la route (404) :
 * un second arrêt pendant le premier ferait sortir le service sans arrêter ses sessions.
 */
export function suiteDeLaDemande(r: ReponseLocale | EchecLocal): SuiteArret {
	if ('echec' in r) return r.echec === 'refusee' ? 'signal' : 'attendre';
	if (r.statut === 202) return 'accepte';
	if (r.statut === 404) return 'signal';
	return { refus: `Le service a refusé l'arrêt (statut ${r.statut}).` };
}

/**
 * `mnemo arreter [dossier]` : arrêt propre par l'API, avec le jeton du dossier (sous Windows, un signal tue sans arrêt propre).
 * Le signal ne sert que dans les cas de `suiteDeLaDemande`.
 */
export async function commandeArreter(args: string[]): Promise<void> {
	if (args.length > 1 || args.some((a) => a.startsWith('-'))) throw new ErreurCli('Usage : mnemo arreter [dossier]', 2);
	const depuis = args[0] ?? process.cwd();
	const racine = trouverRacine(depuis);
	if (racine === null) throw new ErreurCli(args[0] === undefined ? AUCUNE_MEMOIRE : `Aucune mémoire Mnemo trouvée depuis « ${depuis} ».`);
	const service = await serviceVivant(racine);
	if (service === null) {
		console.log(`Mnemo ne tourne pas pour ${racine}.`);
		return;
	}
	const suite = suiteDeLaDemande(await requeteLocaleDetaillee(service.port, ROUTES.arret, { cle: service.jeton, finMs: Date.now() + ATTENTE_REPONSE_MS, corps: {} }));
	if (typeof suite === 'object') throw new ErreurCli(suite.refus);
	if (suite === 'signal') process.kill(service.pid, 'SIGTERM');
	if (suite === 'attendre') console.log(`Le service n'a pas répondu à la demande d'arrêt en ${ATTENTE_REPONSE_MS / 1000} s : attente de son arrêt, ${ATTENTE_ARRET_MS / 1000} s au plus, sans signal.`);
	const fin = Date.now() + ATTENTE_ARRET_MS;
	while (processusVivant(service.pid) && Date.now() < fin) await new Promise((r) => setTimeout(r, 100));
	if (processusVivant(service.pid)) throw new ErreurCli(`Le service (pid ${service.pid}) ne s'est pas arrêté en ${ATTENTE_ARRET_MS / 1000} s.`);
	console.log(`Mnemo arrêté pour ${racine}.`);
}
