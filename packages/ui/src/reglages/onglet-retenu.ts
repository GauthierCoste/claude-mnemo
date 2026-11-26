/**
 * Onglet de la vue Réglages retenu dans ce navigateur (le dernier ouvert), et la demande d'ouvrir une section précise depuis
 * une autre vue (« Voir dans Réglages » de la Nouvelle session : Réglages › Branchements) : la vue Réglages, montée ensuite,
 * s'y ouvre. Une valeur retenue avant la 1.9 (`profils`, `systeme`, `app-claude`) mène à l'onglet qui a repris son contenu.
 */

export type OngletReglages = 'agents' | 'reglages' | 'documentation';
export const ONGLETS_REGLAGES: readonly OngletReglages[] = ['agents', 'reglages', 'documentation'];
const CLE_ONGLET = 'mnemo.reglages.onglet';

/** Anciens onglets (avant la 1.9) : où leur contenu est passé. */
const ANCIENS: Readonly<Record<string, OngletReglages>> = { profils: 'agents', systeme: 'reglages', 'app-claude': 'reglages' };

export function ongletRetenu(): OngletReglages {
	try {
		const v = localStorage.getItem(CLE_ONGLET);
		if (v === null) return 'agents';
		return ONGLETS_REGLAGES.find((o) => o === v) ?? ANCIENS[v] ?? 'agents';
	} catch {
		return 'agents';
	}
}

export function retenirOnglet(o: OngletReglages): void {
	try {
		localStorage.setItem(CLE_ONGLET, o);
	} catch {
		// stockage indisponible : l'onglet n'est pas retenu
	}
}

/** Sections de l'onglet Réglages, dans l'ordre de son panneau. */
export type SectionReglages = 'branchements' | 'memoire' | 'systeme';

/** Section de l'onglet Réglages demandée depuis une autre vue, lue au montage de l'onglet puis oubliée. */
let sectionDemandee: SectionReglages | null = null;

/** Retient l'onglet Réglages et demande sa section Branchements : à appeler juste avant d'aller à la vue Réglages. */
export function demanderBranchementsDansReglages(): void {
	retenirOnglet('reglages');
	sectionDemandee = 'branchements';
}

/** La section demandée, sans l'oublier (lue dans un initialiseur d'état, que React peut appeler deux fois). */
export const sectionDemandeeALire = (): SectionReglages | null => sectionDemandee;

/** Oublie la section demandée, une fois l'onglet monté. */
export function oublierSectionDemandee(): void {
	sectionDemandee = null;
}
