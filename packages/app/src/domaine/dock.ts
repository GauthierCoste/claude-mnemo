/** Icône du Dock : sa pastille (le nombre de sessions qui attendent une réponse) et son image, à la couleur de l’interface. */
import type { SessionVue } from '@mnemo/contrat';
import { attendReponse } from './sessions.ts';

/** Texte de la pastille : le nombre de sessions qui attendent une réponse ; vide (pas de pastille) à 0. */
export function pastilleDock(sessions: readonly SessionVue[]): string {
	const n = sessions.filter(attendReponse).length;
	return n === 0 ? '' : String(n);
}

/** Taille maximale de l'icône reçue de la page (une icône de 512 px pèse quelques dizaines de Ko). */
export const TAILLE_MAX_ICONE_PAGE = 2_000_000;

const PNG_DATA = /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/u;

/**
 * Icône du Dock tirée des icônes de la page (`page-favicon-updated`) : l'interface redessine la sienne à la couleur
 * principale (réglage `interface.accent`) en PNG `data:`. La première de cette forme, sous la taille maximale ; null sinon
 * (icône d'origine de la page, adresse ou format inattendus : le Dock garde son icône).
 */
export function iconeDockDeLaPage(adresses: readonly string[]): string | null {
	return adresses.find((a) => a.length <= TAILLE_MAX_ICONE_PAGE && PNG_DATA.test(a)) ?? null;
}
