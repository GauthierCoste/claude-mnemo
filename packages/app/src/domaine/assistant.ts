/**
 * Assistant d'installation (premier lancement, ou dossier Mnemo disparu) : ses étapes, les choix par défaut, la commande
 * `init` qu'il lance, la lecture de `mnemo verifier-poste --json`, et l'enchaînement des étapes vu par la page (une fonction
 * pure de la suite des événements).
 */
import type { LigneInit, PosteVerifie } from '@mnemo/contrat';
import { appliquerLigne, installationVide, peutTerminer, type EtatInstallation, type ResultatInstallation } from './assistant-lignes.ts';
import type { PlateformeApp } from './plateforme.ts';

export const ETAPES_ASSISTANT = ['verifications', 'dossier', 'choix', 'installation', 'termine'] as const;
export type EtapeAssistant = (typeof ETAPES_ASSISTANT)[number];

/** Ce que l'assistant demande ; `ouvrirALaSession` ne regarde que l'app (`app.setLoginItemSettings`), pas `init`. */
export type ChoixInstallation = { mcp: boolean; commande: boolean; modeles: boolean; ouvrirALaSession: boolean };

/** Déclarer à Claude Code, installer la commande, ouvrir à l'ouverture de session : oui ; télécharger les modèles : non. */
export const CHOIX_PAR_DEFAUT: Readonly<ChoixInstallation> = Object.freeze({ mcp: true, commande: true, modeles: false, ouvrirALaSession: true });

/** Choix proposés par la page, dans l'ordre : sous Windows, pas de commande « mnemo » (elle ne s'y installe pas). */
export function choixProposes(plateforme: PlateformeApp): (keyof ChoixInstallation)[] {
	return plateforme === 'win32' ? ['mcp', 'modeles', 'ouvrirALaSession'] : ['mcp', 'commande', 'modeles', 'ouvrirALaSession'];
}

/** Choix de départ : `CHOIX_PAR_DEFAUT`, sans la commande sous Windows. */
export function choixParDefaut(plateforme: PlateformeApp): ChoixInstallation {
	return { ...CHOIX_PAR_DEFAUT, ...(plateforme === 'win32' ? { commande: false } : {}) };
}

/** Les choix tels qu'ils sont menés sur la plateforme : sous Windows, jamais la commande (même demandée). */
export function choixPourPlateforme(choix: ChoixInstallation, plateforme: PlateformeApp): ChoixInstallation {
	return plateforme === 'win32' ? { ...choix, commande: false } : choix;
}

/** Taille des modèles locaux à télécharger, comme la dit `mnemo init`. */
export const TAILLE_MODELES = 'environ 1,3 Go';

/** Dossier de la mémoire sous la racine (`DOSSIER_MEMOIRE` du service, dont l'app ne dépend pas). */
export const DOSSIER_MEMOIRE = '_mnemo';

/** Dossier retenu par le processus principal : `racine` absolue ; `memoireExistante` : `_mnemo/SCHEMA.md` y est déjà. */
export type DossierChoisi = { racine: string; memoireExistante: boolean };

/** Node et `main.ts` qui lancent `mnemo`, et le `PATH` à leur donner (celui du terminal : `git`, `claude`). */
export type ExecutableMnemo = { node: string; main: string; path: string };

/**
 * Arguments de `<node>` : `<main> init <racine> --json` et un choix explicite par étape (aucune question, aucun défaut
 * implicite) ; jamais le lanceur (l'app le remplace).
 */
export function argumentsInit(main: string, racine: string, choix: ChoixInstallation): string[] {
	return [main, 'init', racine, '--json', choix.mcp ? '--mcp' : '--sans-mcp', choix.modeles ? '--modeles' : '--sans-modeles', choix.commande ? '--commande' : '--sans-commande', '--sans-lanceur'];
}

/** Arguments de `<node>` pour la vérification du poste. */
export function argumentsVerifierPoste(main: string): string[] {
	return [main, 'verifier-poste', '--json'];
}

const objet = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const texteFacultatif = (v: unknown): boolean => v === undefined || typeof v === 'string';

/** Sortie de `mnemo verifier-poste --json` (sa première ligne non vide), validée ; null si elle n'a pas la forme attendue. */
export function lirePoste(sortie: string): PosteVerifie | null {
	const ligne = sortie.split('\n').find((l) => l.trim() !== '');
	if (ligne === undefined) return null;
	let brut: unknown;
	try {
		brut = JSON.parse(ligne);
	} catch {
		return null;
	}
	if (!objet(brut) || !objet(brut['git']) || !objet(brut['claude']) || !objet(brut['node'])) return null;
	const { git, claude, node } = brut as { git: Record<string, unknown>; claude: Record<string, unknown>; node: Record<string, unknown> };
	if (typeof git['ok'] !== 'boolean' || !texteFacultatif(git['version']) || !texteFacultatif(git['motif'])) return null;
	if (typeof claude['ok'] !== 'boolean' || !texteFacultatif(claude['chemin']) || !texteFacultatif(claude['motif'])) return null;
	if (typeof node['version'] !== 'string') return null;
	const poste: PosteVerifie = { git: { ok: git['ok'] }, claude: { ok: claude['ok'] }, node: { version: node['version'] } };
	if (typeof git['version'] === 'string') poste.git.version = git['version'];
	if (typeof git['motif'] === 'string') poste.git.motif = git['motif'];
	if (typeof claude['chemin'] === 'string') poste.claude.chemin = claude['chemin'];
	if (typeof claude['motif'] === 'string') poste.claude.motif = claude['motif'];
	return poste;
}

/** Le poste permet de continuer : git et Claude Code sont là. */
export function posteSuffisant(poste: PosteVerifie): boolean {
	return poste.git.ok && poste.claude.ok;
}

/**
 * État de la page. `poste` : null tant que rien n'est revenu ; `erreurPoste` : la vérification n'a pas pu se faire (Mnemo
 * introuvable, sortie illisible) ; `verification` : une vérification est en cours ; `deplacer` : l'app tourne depuis un
 * emplacement provisoire (image disque, translocation) : la page demande seulement de la glisser dans Applications, et
 * plus rien n'avance.
 */
export type EtatAssistant = {
	plateforme: PlateformeApp;
	etape: EtapeAssistant;
	verification: boolean;
	deplacer: boolean;
	poste: PosteVerifie | null;
	erreurPoste: string | null;
	dossier: DossierChoisi | null;
	erreurDossier: string | null;
	choix: ChoixInstallation;
	installation: EtatInstallation | null;
};

export type EvenementAssistant =
	| { type: 'verification' }
	| { type: 'poste'; poste: PosteVerifie }
	| { type: 'erreur-poste'; message: string }
	| { type: 'provisoire' }
	| { type: 'dossier'; dossier: DossierChoisi }
	| { type: 'erreur-dossier'; message: string }
	| { type: 'choix'; cle: keyof ChoixInstallation; valeur: boolean }
	| { type: 'continuer' }
	| { type: 'retour' }
	| { type: 'installer' }
	| { type: 'ligne'; ligne: LigneInit }
	| { type: 'fin-installation'; resultat: ResultatInstallation };

export function etatInitial(plateforme: PlateformeApp): EtatAssistant {
	return { plateforme, etape: 'verifications', verification: false, deplacer: false, poste: null, erreurPoste: null, dossier: null, erreurDossier: null, choix: choixParDefaut(plateforme), installation: null };
}

/** Peut-on passer à l'étape suivante (bouton « Continuer ») ? */
export function peutContinuer(etat: EtatAssistant): boolean {
	if (etat.deplacer) return false;
	if (etat.etape === 'verifications') return !etat.verification && etat.poste !== null && posteSuffisant(etat.poste);
	if (etat.etape === 'dossier') return etat.dossier !== null;
	return false;
}

/** Installation finie sans mémoire créée : on revient aux choix pour réessayer. */
export function peutReessayer(etat: EtatAssistant): boolean {
	const i = etat.installation;
	return etat.etape === 'installation' && i !== null && !i.enCours && !peutTerminer(i);
}

/** Étape suivante de la page ; un événement hors de propos (continuer trop tôt, ligne hors installation) ne change rien. */
export function evoluer(etat: EtatAssistant, e: EvenementAssistant): EtatAssistant {
	if (etat.deplacer) return etat;
	switch (e.type) {
		case 'verification':
			return etat.etape === 'verifications' ? { ...etat, verification: true, erreurPoste: null } : etat;
		case 'poste':
			return { ...etat, verification: false, poste: e.poste, erreurPoste: null };
		case 'erreur-poste':
			return { ...etat, verification: false, poste: null, erreurPoste: e.message };
		case 'provisoire':
			return { ...etat, verification: false, deplacer: true, poste: null, erreurPoste: null };
		case 'dossier':
			return etat.etape === 'dossier' ? { ...etat, dossier: e.dossier, erreurDossier: null } : etat;
		case 'erreur-dossier':
			return etat.etape === 'dossier' ? { ...etat, erreurDossier: e.message } : etat;
		case 'choix':
			return etat.etape === 'choix' ? { ...etat, choix: choixPourPlateforme({ ...etat.choix, [e.cle]: e.valeur }, etat.plateforme) } : etat;
		case 'continuer':
			if (!peutContinuer(etat)) return etat;
			return { ...etat, etape: etat.etape === 'verifications' ? 'dossier' : 'choix' };
		case 'retour':
			if (etat.etape === 'dossier') return { ...etat, etape: 'verifications' };
			if (etat.etape === 'choix') return { ...etat, etape: 'dossier' };
			if (peutReessayer(etat)) return { ...etat, etape: 'choix', installation: null };
			return etat;
		case 'installer':
			return etat.etape === 'choix' && etat.dossier !== null ? { ...etat, etape: 'installation', installation: installationVide(etat.plateforme) } : etat;
		case 'ligne':
			return etat.etape === 'installation' && etat.installation !== null ? { ...etat, installation: appliquerLigne(etat.installation, e.ligne) } : etat;
		case 'fin-installation': {
			if (etat.etape !== 'installation' || etat.installation === null) return etat;
			const installation = finirInstallation(etat.installation, e.resultat);
			return { ...etat, installation, etape: peutTerminer(installation) ? 'termine' : 'installation' };
		}
	}
}

/** Fin du processus : la ligne `fin` reçue (ou celle du résultat, si la page a manqué une ligne), sinon l'erreur. */
function finirInstallation(i: EtatInstallation, r: ResultatInstallation): EtatInstallation {
	const fin = i.fin ?? r.fin;
	const erreur = r.erreur ?? (fin === null ? 'L’installation s’est arrêtée sans finir.' : null);
	return { ...i, fin, erreur, enCours: false };
}
