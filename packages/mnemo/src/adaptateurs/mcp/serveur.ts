import { isAbsolute, relative, sep } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { PROFIL_TRAVAIL, PROJET_PAR_DEFAUT } from '@mnemo/commun';
import { extractionDifferee } from '../../application/extraction-differee.ts';
import { modelesDeSession, niveauPropreDe } from '../../application/modeles-de-session.ts';
import { positionDuProjet } from '../../application/position.ts';
import type { Position } from '../../application/position.ts';
import type { Dependances } from '../../application/ports.ts';
import { CONSIGNE_TRAVAIL_PAR_DEFAUT, lireProfil } from '../../application/profil.ts';
import { estUuid } from '../../domaine/session.ts';
import { dependancesReelles, etatParesseux } from '../../infra/systeme.ts';
import { instructions, INSTRUCTIONS_SESSION, SANS_MEMOIRE } from './instructions.ts';
import { enregistrerOutils } from './outils.ts';
import { phraseDesTypes, typesDuCoffre } from '../../application/types-du-coffre.ts';
import { versionMnemo } from '../../infra/version.ts';

const IDENTITE = { name: 'mnemo', version: versionMnemo() };
// Outils déclarés d'emblée : `tools/list` répond (liste vide) même quand aucune mémoire ne couvre le dossier.
const CAPACITES = { capabilities: { tools: {} } };

/** Journal du serveur : sur stderr, jamais sur stdout (réservé au protocole). */
export function journal(message: string): void {
	process.stderr.write(`mnemo mcp : ${message}\n`);
}

const messageDe = (erreur: unknown) => (erreur instanceof Error ? erreur.message : String(erreur));

/** Chemin du dossier de projet relatif à la racine Mnemo, séparé par « / » ; « » s'il est hors de la racine (ou absent). */
export function relatifDuProjet(racineDossier: string, dossierProjet: string | null): string {
	if (dossierProjet === null) return '';
	const r = relative(racineDossier, dossierProjet);
	if (r === '' || isAbsolute(r) || r === '..' || r.startsWith(`..${sep}`)) return '';
	return r.split(sep).join('/');
}

/** Session Mnemo qui a lancé ce `claude` (`MNEMO_SESSION`, uuid valide, et `MNEMO_PROJET`, sinon `divers`), ou null. */
export function origineDeSession(env: Record<string, string | undefined>): { session: string; projet: string } | null {
	const session = env.MNEMO_SESSION;
	if (session === undefined || !estUuid(session)) return null;
	const projet = env.MNEMO_PROJET;
	return { session, projet: projet === undefined || projet === '' ? PROJET_PAR_DEFAUT : projet };
}

/** Instructions d'une session lancée hors de Mnemo : profil `travail`, position, consignes ; repli sur le profil par défaut. */
async function instructionsHorsSession(dep: Dependances, position: Position): Promise<string> {
	try {
		return await instructions(dep, position, await lireProfil(dep, PROFIL_TRAVAIL, CONSIGNE_TRAVAIL_PAR_DEFAUT));
	} catch (erreur) {
		journal(`consignes illisibles, profil par défaut seul (${messageDe(erreur)}).`);
		return CONSIGNE_TRAVAIL_PAR_DEFAUT;
	}
}

/**
 * Serveur MCP d'une session Claude Code. Sans racine : aucun outil, une phrase d'instructions. Sinon les onze outils, et des
 * instructions calculées ici, une fois (statiques pour la session : une consigne ajoutée en cours de session est servie
 * par `contexte` et par les hooks, pas par les instructions). Rien ne doit empêcher le démarrage : position et
 * instructions ont un repli. L'index des dépendances créées ici est fermé à la fermeture du serveur.
 * `origine` (session lancée par Mnemo) : instructions réduites à une ligne, les écritures portent la session et son projet,
 * l'état des sessions est lu (en lecture seule) pour l'épisode de la session, et les modèles suivent le niveau de la session.
 */
export async function creerServeur(options: {
	racineDossier: string | null;
	dossierProjet: string | null;
	dep?: Dependances;
	origine?: { session: string; projet: string } | null;
}): Promise<McpServer> {
	const { racineDossier, dossierProjet } = options;
	if (racineDossier === null) return new McpServer(IDENTITE, { ...CAPACITES, instructions: SANS_MEMOIRE });

	const dep = options.dep ?? dependancesReelles(racineDossier);
	// documents changés réextraits à part, réveillée par la recherche (qui ne les attend jamais) ; arrêtée à la fermeture
	const differee = options.dep === undefined ? extractionDifferee(dep, journal) : null;
	if (differee !== null) dep.extractionDifferee = differee;
	const origine = options.origine ?? null;
	// l'épisode d'une session prend son début, son profil et sa branche dans l'état des sessions (ouvert au premier usage)
	const etat = origine !== null && dep.sessions === undefined ? etatParesseux(racineDossier) : null;
	if (origine !== null) dep.origine = origine;
	if (etat !== null) dep.sessions = etat;
	// ses modèles bornés par le niveau propre de la session, relu à chaque appel (changé en cours de session : vaut aussitôt)
	if (origine !== null && dep.sessions !== undefined) {
		const { sens, reranker } = modelesDeSession(dep, niveauPropreDe(dep.sessions, origine.session));
		dep.sens = sens;
		dep.reranker = reranker;
	}
	let position: Position = { chemin: '' };
	try {
		position = { chemin: (await positionDuProjet(dep, relatifDuProjet(racineDossier, dossierProjet))).chemin };
	} catch (erreur) {
		journal(`position du projet introuvable, racine de la mémoire retenue (${messageDe(erreur)}).`);
	}
	const texte = origine !== null ? INSTRUCTIONS_SESSION : await instructionsHorsSession(dep, position);

	const serveur = new McpServer(IDENTITE, { ...CAPACITES, instructions: texte });
	// une session lancée par Mnemo : sa position est celle de l'état, qui change quand son dossier est rattaché en cours de route
	const positionCourante = async (): Promise<Position> => {
		const session = origine === null || dep.sessions === undefined ? null : await dep.sessions.lire(origine.session).catch(() => null);
		return session === null ? position : { chemin: session.position };
	};
	const types = await typesDuCoffre(dep).catch(() => []);
	enregistrerOutils(serveur, dep, positionCourante, journal, phraseDesTypes(types));
	serveur.server.onclose = () => {
		void differee?.arreter();
		if (options.dep === undefined) {
			dep.index.fermer();
			dep.lots.fermer();
		}
		etat?.fermer();
	};
	return serveur;
}
