/**
 * Pont entre la page de l'assistant et le processus principal : canaux IPC, ce que le preload expose (`window.assistant`),
 * les réponses, et la validation de ce qui vient de la page (jamais cru sur parole : la page ne donne aucun chemin, et ses
 * choix sont relus ici).
 */
import type { LigneInit, PosteVerifie } from '@mnemo/contrat';
import type { ChoixInstallation, DossierChoisi } from './assistant.ts';
import type { ResultatInstallation } from './assistant-lignes.ts';
import type { PlateformeApp } from './plateforme.ts';

export const CANAUX_ASSISTANT = {
	verifierPoste: 'assistant:verifier-poste',
	choisirDossier: 'assistant:choisir-dossier',
	installer: 'assistant:installer',
	ligne: 'assistant:ligne',
	terminer: 'assistant:terminer',
} as const;

/**
 * Échec de la vérification, et sa cause : `sansMnemo`, ni configuration ni Mnemo dans le paquet (l'erreur dit comment
 * installer l'app) ; `provisoire`, l'app tourne depuis l'image disque ou une translocation (la page demande de la glisser
 * dans Applications) ; `echec`, `mnemo verifier-poste` n'a pas répondu.
 */
export type ReponsePoste = { ok: true; poste: PosteVerifie } | { ok: false; erreur: string; cause: 'sansMnemo' | 'provisoire' | 'echec' };
/** `annule` : le sélecteur a été fermé sans choix ; `erreur` : le dossier choisi ne convient pas. */
export type ReponseDossier = { ok: true; dossier: DossierChoisi } | { ok: false; annule: true } | { ok: false; annule: false; erreur: string };
export type ReponseTerminer = { ok: true } | { ok: false; erreur: string };

/** Ce que le preload expose à la page, et rien d'autre. */
export type ApiAssistant = {
	/** La plateforme de l'app (textes, liens et choix de la page), en lecture seule. */
	readonly plateforme: PlateformeApp;
	verifierPoste(): Promise<ReponsePoste>;
	choisirDossier(): Promise<ReponseDossier>;
	/** Lance `init` sur le dossier choisi ; `surLigne` reçoit chaque ligne validée ; rend la fin du processus. */
	installer(choix: ChoixInstallation, surLigne: (ligne: LigneInit) => void): Promise<ResultatInstallation>;
	/** Écrit la configuration et ouvre l'interface. */
	terminer(): Promise<ReponseTerminer>;
};

const CLES_CHOIX = ['mcp', 'commande', 'modeles', 'ouvrirALaSession'] as const;

/** Choix venus de la page : un objet aux quatre clés booléennes exactement ; sinon null (refusé). */
export function validerChoix(brut: unknown): ChoixInstallation | null {
	if (typeof brut !== 'object' || brut === null || Array.isArray(brut)) return null;
	const o = brut as Record<string, unknown>;
	const cles = Object.keys(o);
	if (cles.length !== CLES_CHOIX.length || !CLES_CHOIX.every((c) => typeof o[c] === 'boolean')) return null;
	return { mcp: o['mcp'] as boolean, commande: o['commande'] as boolean, modeles: o['modeles'] as boolean, ouvrirALaSession: o['ouvrirALaSession'] as boolean };
}

/** Liens que la page peut ouvrir (dans le navigateur par défaut) : installer Claude Code, installer git (macOS, Windows). */
export const LIENS_EXTERNES = {
	claude: 'https://code.claude.com/docs/en/setup',
	git: 'https://git-scm.com/downloads/mac',
	gitWindows: 'https://git-scm.com/downloads/win',
} as const;

/** Seuls les liens de `LIENS_EXTERNES`, à l'identique, sortent de la fenêtre. */
export function lienAutorise(url: string): boolean {
	return (Object.values(LIENS_EXTERNES) as string[]).includes(url);
}
