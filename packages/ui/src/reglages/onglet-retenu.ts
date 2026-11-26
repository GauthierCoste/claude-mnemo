/**
 * Onglet de la vue Réglages retenu dans ce navigateur (le dernier ouvert), et la demande d'ouvrir une section précise depuis
 * une autre vue (« Voir dans Réglages » de la Nouvelle session : Système › Moteurs) : la vue Réglages, montée ensuite, s'y
 * ouvre.
 */

export type OngletReglages = 'profils' | 'systeme' | 'app-claude';
export const ONGLETS_REGLAGES: readonly OngletReglages[] = ['profils', 'systeme', 'app-claude'];
const CLE_ONGLET = 'mnemo.reglages.onglet';

export function ongletRetenu(): OngletReglages {
	try {
		const v = localStorage.getItem(CLE_ONGLET);
		return ONGLETS_REGLAGES.find((o) => o === v) ?? 'profils';
	} catch {
		return 'profils';
	}
}

export function retenirOnglet(o: OngletReglages): void {
	try {
		localStorage.setItem(CLE_ONGLET, o);
	} catch {
		// stockage indisponible : l'onglet n'est pas retenu
	}
}

/** Section de Réglages › Système demandée depuis une autre vue, lue au montage de l'onglet puis oubliée. */
let sectionSystemeDemandee: 'moteurs' | null = null;

/** Retient l'onglet Système et demande sa section Moteurs : à appeler juste avant d'aller à la vue Réglages. */
export function demanderMoteursDansReglages(): void {
	retenirOnglet('systeme');
	sectionSystemeDemandee = 'moteurs';
}

/** La section demandée, sans l'oublier (lue dans un initialiseur d'état, que React peut appeler deux fois). */
export const sectionSystemeALire = (): 'moteurs' | null => sectionSystemeDemandee;

/** Oublie la section demandée, une fois l'onglet monté. */
export function oublierSectionSysteme(): void {
	sectionSystemeDemandee = null;
}
