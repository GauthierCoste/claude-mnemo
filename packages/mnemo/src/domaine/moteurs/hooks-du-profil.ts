import type { EvenementHook } from '../session.ts';

/** Hooks qui tiennent l'état de la session (pilote, bilan, interface) : toujours actifs, quel que soit le profil. */
export const HOOKS_D_ETAT: readonly EvenementHook[] = ['debut', 'message', 'arret', 'fin'];
/** Hooks qui servent un contexte : `--sans-contexte` quand le profil ne les demande pas. */
export const HOOKS_DE_CONTEXTE: readonly EvenementHook[] = ['debut', 'message', 'apres_outil'];

/**
 * Ce que fait un hook dans une session dont le profil demande `demandes` : `actif` ; `sans_contexte` (hook d'état non
 * demandé qui servirait un contexte : l'état seulement) ; `absent` (ni demandé ni hook d'état : comme s'il n'était pas
 * déclaré, aucun effet).
 */
export function effetDuHook(evenement: EvenementHook, demandes: readonly EvenementHook[]): 'actif' | 'sans_contexte' | 'absent' {
	if (demandes.includes(evenement)) return 'actif';
	if (!HOOKS_D_ETAT.includes(evenement)) return 'absent';
	return HOOKS_DE_CONTEXTE.includes(evenement) ? 'sans_contexte' : 'actif';
}

const EVENEMENTS: readonly EvenementHook[] = ['debut', 'message', 'outil', 'apres_outil', 'arret', 'fin'];

/** Hooks du profil dans une variable d'environnement (`MNEMO_HOOKS`) : leurs noms séparés par des virgules. */
export const texteDesHooks = (hooks: readonly EvenementHook[]): string => hooks.join(',');

/** Hooks lus dans `MNEMO_HOOKS` ; null : variable absente ou illisible (tous les hooks valent alors comme demandés). */
export function hooksDuTexte(texte: string | undefined): EvenementHook[] | null {
	if (texte === undefined) return null;
	const noms = texte.split(',').filter((n) => n !== '');
	if (!noms.every((n) => (EVENEMENTS as readonly string[]).includes(n))) return null;
	return noms as EvenementHook[];
}
