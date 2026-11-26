/**
 * Ce que l'app montre du suivi, calculé en un point : icône et infobulle de la barre des menus, son menu, la pastille du
 * Dock. La couche Electron l'affiche tel quel à chaque changement.
 */
import type { SessionVue } from '@mnemo/contrat';
import { pastilleDock } from './dock.ts';
import { type EtatAgrege, etatAgrege } from './etat.ts';
import { infobulle } from './icone.ts';
import { type ElementMenu, type EntreeMenu, modeleMenu } from './menu.ts';
import type { VieService } from './vie-service.ts';

export type VueApp = { etat: EtatAgrege; infobulle: string; menu: ElementMenu[]; pastille: string };

/** Ce que le menu montre hors du service : l'ouverture à l'ouverture de session, la version, les nouvelles versions. */
export type ReglagesMenu = Pick<EntreeMenu, 'ouvertureSession' | 'version' | 'nouvelleVersion' | 'chercherVersions'>;

/** `sessions` null (aucune liste reçue) : aucune session. */
export function vueApp(vie: VieService, sessions: readonly SessionVue[] | null, reglages: ReglagesMenu): VueApp {
	const liste = sessions ?? [];
	const etat = etatAgrege(vie.etat, liste);
	return {
		etat,
		infobulle: infobulle(etat, liste, vie.raison),
		menu: modeleMenu({ ...reglages, vie: vie.etat, raison: vie.raison, sessions: liste }),
		pastille: pastilleDock(liste),
	};
}
