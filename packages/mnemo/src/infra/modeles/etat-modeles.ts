import { homedir } from 'node:os';
import { posix, win32 } from 'node:path';
import { modelesPermis } from '@mnemo/commun';
import type { EtatModele, EtatModeles } from '../../application/ports.ts';
import { lireActivites } from './activite.ts';
import { dossierModeles, dossierServeurs } from './dossier.ts';
import { lireNiveau } from './niveau.ts';
import { piecesInstallees } from './pieces-installees.ts';
import type { PiecesInstallees } from './pieces-installees.ts';
import { AGE_MAX_DEMARRAGE_MS, echecsALaSuite, lireEtatServeurs, pauseApresEchecs, pidVivant, verifierServeur } from './serveurs.ts';
import type { EtatServeurs, TypeServeur } from './serveurs.ts';

/** Vérification d'un serveur pour l'état : brève (un serveur prêt répond tout de suite, et n'est vérifié qu'une fois). */
const LECTURE_ETAT_MS = 300;

/** `env` : celui de la machine (`MNEMO_MODELES` isole les tests, `MNEMO_LLAMA_SERVEUR` remplace le moteur) ; `plateforme`, `arch` : pour les pièces. */
export type OptionsEtatModeles = { env?: NodeJS.ProcessEnv; plateforme?: NodeJS.Platform; arch?: string };

const age = (depuis: string, maintenant: number) => maintenant - (Date.parse(depuis) || 0);

/**
 * Phase du gardien d'après `modeles.json` : aucun état, ou gardien mort, `arrete` ; un échec plus récent que sa pause
 * (1 min, puis 5, puis 15 après des échecs à la suite), `echec`
 * (comme un gardien mort en plein démarrage récent, qui n'a pas pu l'écrire : les appels ne le relancent pas pendant ce
 * temps) ; un démarrage bloqué depuis plus de 3 min, `echec` aussi (un autre peut le remplacer).
 */
export function phaseDuGardien(etat: EtatServeurs | null, maintenant: number = Date.now()): EtatModeles['gardien'] {
	if (etat === null) return 'arrete';
	const { pid, depuis, etat: phase } = etat.gardien;
	// en échec tant que dure la pause des relances automatiques (elle s'allonge avec les échecs à la suite)
	if (phase === 'echec' || (phase === 'demarrage' && !pidVivant(pid))) return age(depuis, maintenant) < pauseApresEchecs(echecsALaSuite(etat)) ? 'echec' : 'arrete';
	if (!pidVivant(pid)) return 'arrete';
	if (phase === 'demarrage') return age(depuis, maintenant) < AGE_MAX_DEMARRAGE_MS ? 'demarrage' : 'echec';
	return 'pret';
}

/** Même dossier (chemins résolus ; casse ignorée sous Windows, où le disque ne la distingue pas). */
export function memeDossier(a: string, b: string, plateforme: NodeJS.Platform = process.platform): boolean {
	if (plateforme === 'win32') return win32.resolve(a).toLowerCase() === win32.resolve(b).toLowerCase();
	return posix.resolve(a) === posix.resolve(b);
}

/** Pièces installées de la machine (`env` : `MNEMO_MODELES` isole les tests). */
export function lirePiecesInstallees(options: OptionsEtatModeles = {}): Promise<PiecesInstallees> {
	const env = options.env ?? process.env;
	const plateforme = options.plateforme ?? process.platform;
	return piecesInstallees(dossierModeles(env, plateforme, homedir()), plateforme, options.arch ?? process.arch);
}

/**
 * État des modèles de la machine vu du dossier Mnemo `racine`, pour l'interface : pièces installées (`pieces` : déjà lues,
 * sinon lues ici), niveau, gardien, état de chaque modèle (prêt : servi par un gardien vivant, serveur vérifié avec sa clé),
 * appels en cours (`ceDossier` : faits pour `racine`). Une lecture brève, qui ne lance rien ; les fichiers d'activité des
 * processus morts sont retirés au passage (`lireActivites`).
 */
export async function lireEtatModeles(racine: string, options: OptionsEtatModeles = {}, deja: { pieces?: PiecesInstallees } = {}): Promise<EtatModeles> {
	const env = options.env ?? process.env;
	const plateforme = options.plateforme ?? process.platform;
	const serveurs = dossierServeurs(env, plateforme, homedir());
	const [pieces, niveau, etat, activites] = await Promise.all([
		deja.pieces ?? lirePiecesInstallees(options),
		lireNiveau(serveurs),
		lireEtatServeurs(serveurs),
		lireActivites(serveurs),
	]);
	const remplacant = env['MNEMO_LLAMA_SERVEUR'];
	const moteur = pieces.moteur !== null || (remplacant !== undefined && remplacant !== '');
	const permis = modelesPermis(niveau);
	const finMs = Date.now() + LECTURE_ETAT_MS;
	const etatDe = async (type: TypeServeur): Promise<EtatModele> => {
		if (!moteur || pieces[type] === null) return 'absent';
		if (!permis[type]) return 'exclu';
		const entree = etat?.[type];
		if (etat === null || entree === undefined || !pidVivant(etat.gardien.pid)) return 'arrete';
		return (await verifierServeur(entree, finMs)) ? 'pret' : 'arrete';
	};
	const [sens, reranker] = await Promise.all([etatDe('sens'), etatDe('reranker')]);
	const gardien = phaseDuGardien(etat);
	const inactiviteMs = etat?.gardien.inactiviteMs;
	return {
		installes: moteur && (pieces.sens !== null || pieces.reranker !== null),
		niveau,
		gardien,
		// le délai du gardien en marche (celui du dossier qui l'a lancé) ; aucun quand il est arrêté ou en échec
		inactiviteMinutes: (gardien === 'demarrage' || gardien === 'pret') && inactiviteMs !== undefined ? Math.round(inactiviteMs / 60_000) : null,
		sens,
		reranker,
		pieces,
		activites: activites.map(({ operation, session, dossier, depuisMs, avancement }) => ({ operation, session, ceDossier: memeDossier(dossier, racine, plateforme), depuisMs, avancement })),
	};
}
