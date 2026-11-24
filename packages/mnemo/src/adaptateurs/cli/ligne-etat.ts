import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROUTES } from '@mnemo/contrat';
import { DOSSIER_MEMOIRE } from '../../domaine/dossier-memoire.ts';
import { estObjet } from '../../domaine/valeurs.ts';
import { appelerService, lireService } from '../../infra/service-local.ts';
import type { ServiceLocal } from '../../infra/service-local.ts';
import { trouverRacine } from './racine.ts';

/**
 * `mnemo ligne-etat` : la ligne d'état des sessions lancées par Mnemo (`statusLine` de leur `settings.json`). Claude Code lui
 * donne sur stdin l'état de la session ; seul `rate_limits` (quotas du compte) part au service du dossier, pour la barre de
 * titre de l'interface. N'écrit rien : la ligne d'état de la session reste vide. Ne lit et n'envoie rien d'autre, ne
 * signale aucune erreur (Claude Code la relance à chaque réponse).
 */

/** Entrée de la ligne d'état : quelques kilo-octets ; au-delà, écartée. */
const ENTREE_MAX_OCTETS = 256 * 1024;
/** Claude Code annule une ligne d'état encore en cours quand la suivante part : lecture et envoi bornés. */
const DELAI_LECTURE_MS = 500;
const DELAI_SERVICE_MS = 300;

export type EnvoiQuotas = (service: ServiceLocal, corps: unknown) => Promise<unknown>;

/** Dossier Mnemo : `MNEMO_RACINE` (session lancée par Mnemo) s'il en est un, sinon en remontant depuis `cwd`. */
function racineDe(cwd: string, env: NodeJS.ProcessEnv): string | null {
	const declaree = env.MNEMO_RACINE;
	if (declaree !== undefined && declaree !== '' && existsSync(join(declaree, DOSSIER_MEMOIRE, 'SCHEMA.md'))) return declaree;
	return trouverRacine(cwd);
}

/** Envoie `rate_limits` de l'entrée au service du dossier, s'il y en a un et s'il tourne ; sans effet sinon. */
export async function transmettreQuotas(texte: string, env: NodeJS.ProcessEnv, cwdProcessus: string, envoyer: EnvoiQuotas, service: (racine: string) => ServiceLocal | null = lireService): Promise<boolean> {
	let entree: unknown;
	try {
		entree = JSON.parse(texte);
	} catch {
		return false;
	}
	if (!estObjet(entree) || !estObjet(entree.rate_limits)) return false;
	const racine = racineDe(typeof entree.cwd === 'string' && entree.cwd !== '' ? entree.cwd : cwdProcessus, env);
	const local = racine === null ? null : service(racine);
	if (local === null) return false;
	await envoyer(local, { rate_limits: entree.rate_limits });
	return true;
}

function lireEntree(): Promise<string | null> {
	return new Promise((resoudre) => {
		const morceaux: Buffer[] = [];
		let taille = 0;
		const terminer = (texte: string | null): void => {
			clearTimeout(minuteur);
			process.stdin.removeAllListeners();
			process.stdin.pause();
			resoudre(texte);
		};
		const minuteur = setTimeout(() => terminer(null), DELAI_LECTURE_MS);
		process.stdin.on('data', (m: Buffer) => {
			taille += m.byteLength;
			if (taille > ENTREE_MAX_OCTETS) terminer(null);
			else morceaux.push(m);
		});
		process.stdin.once('end', () => terminer(Buffer.concat(morceaux).toString('utf8')));
		process.stdin.once('error', () => terminer(null));
	});
}

export async function commandeLigneEtat(): Promise<void> {
	const texte = await lireEntree();
	if (texte !== null) {
		await transmettreQuotas(texte, process.env, process.cwd(), (service, corps) => appelerService(service, ROUTES.quotas, corps, DELAI_SERVICE_MS)).catch(() => false);
	}
	process.exit(0);
}
