/**
 * Préférences de l'app (`preferences.json` dans le dossier de l'app, à côté de `config.json`) : ce qu'elle retient seule,
 * jamais écrit par `mnemo`. Le choix de « Quitter Mnemo » quand « Ne plus demander » est coché, les bornes de la
 * fenêtre, et les nouvelles versions : chercher ou non (« Chercher les nouvelles versions »), la date de la dernière
 * recherche et la dernière version publiée lue (gardée pour le menu jusqu'à la recherche suivante) ; la dernière langue
 * connue (celle de l'interface, ou choisie dans l'assistant), pour ce qui s'affiche sans page ni service. Un fichier abîmé ou d'une autre version ne bloque rien : chaque valeur illisible reprend sa valeur par défaut.
 */
import { estLangue, type Langue } from '@mnemo/commun';
import { type Bornes, validerBornes } from './fenetre.ts';
import { estPageDeVersion, lireVersion, type VersionPubliee } from './version.ts';

/** `demander` : la boîte à chaque fois ; `arreter` : arrêter le service en quittant ; `laisser` : le laisser tourner. */
export type ChoixQuitter = 'demander' | 'arreter' | 'laisser';

export type Preferences = {
	quitter: ChoixQuitter;
	fenetre: Bornes | null;
	chercherVersions: boolean;
	/** Date (ms) de la dernière recherche de version, réussie ou non. */
	verificationVersionsMs: number | null;
	versionPubliee: VersionPubliee | null;
	/** Dernière langue connue ; null : jamais connue (la langue du système s'applique). */
	langue: Langue | null;
};

export const PREFERENCES_DEFAUT: Preferences = { quitter: 'demander', fenetre: null, chercherVersions: true, verificationVersionsMs: null, versionPubliee: null, langue: null };

function versionPubliee(brut: unknown): VersionPubliee | null {
	if (typeof brut !== 'object' || brut === null) return null;
	const { version, url } = brut as Record<string, unknown>;
	if (typeof version !== 'string' || lireVersion(version) === null || typeof url !== 'string' || !estPageDeVersion(url)) return null;
	return { version, url };
}

const CHOIX: readonly ChoixQuitter[] = ['demander', 'arreter', 'laisser'];

/** Préférences depuis le JSON lu (déjà analysé, ou null si absent ou illisible). */
export function lirePreferences(brut: unknown): Preferences {
	if (typeof brut !== 'object' || brut === null || Array.isArray(brut)) return PREFERENCES_DEFAUT;
	const objet = brut as Record<string, unknown>;
	const quitter = CHOIX.find((c) => c === objet['quitter']) ?? PREFERENCES_DEFAUT.quitter;
	const verification = objet['verificationVersionsMs'];
	return {
		quitter,
		fenetre: validerBornes(objet['fenetre']),
		chercherVersions: typeof objet['chercherVersions'] === 'boolean' ? objet['chercherVersions'] : PREFERENCES_DEFAUT.chercherVersions,
		verificationVersionsMs: typeof verification === 'number' && Number.isFinite(verification) ? verification : null,
		versionPubliee: versionPubliee(objet['versionPubliee']),
		langue: estLangue(objet['langue']) ? objet['langue'] : null,
	};
}
