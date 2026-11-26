/**
 * Icône de la barre des menus et son infobulle, selon l'état agrégé. Les images sont des images « template » de macOS
 * (noir sur transparent) : `<nom>.png` (16 px) et `<nom>@2x.png` (32 px), le nom finissant par `Template`.
 */
import type { SessionVue } from '@mnemo/contrat';
import type { EtatAgrege } from './etat.ts';
import { attendReponse } from './sessions.ts';

/** Intervalle entre deux images d'une icône animée. */
export const INTERVALLE_ANIMATION_MS = 500;

/** Images de chaque état (sans extension) ; deux images : icône animée. Le démarrage et l'arrêt s'animent comme le travail. */
export const IMAGES_ICONE: Record<EtatAgrege, readonly string[]> = {
	arrete: ['etat-arreteTemplate'],
	erreur: ['etat-erreurTemplate'],
	attend: ['etat-attendTemplate'],
	travaille: ['etat-travaille-1Template', 'etat-travaille-2Template'],
	demarrage: ['etat-travaille-1Template', 'etat-travaille-2Template'],
	arret: ['etat-travaille-1Template', 'etat-travaille-2Template'],
	repos: ['etat-reposTemplate'],
};

/** Toutes les images à produire, sans doublon. */
export function toutesLesImages(): string[] {
	return [...new Set(Object.values(IMAGES_ICONE).flat())];
}

/** Image à montrer à la `pas`-ième étape de l'animation (0 pour une icône fixe). */
export function imageIcone(etat: EtatAgrege, pas: number): string {
	const images = IMAGES_ICONE[etat];
	return images[((pas % images.length) + images.length) % images.length]!;
}

const pluriel = (n: number, singulier: string, plurielle: string): string => `${n} ${n > 1 ? plurielle : singulier}`;

/** Infobulle de l'icône : « Mnemo — » puis l'état en clair ; en erreur, la raison si elle est connue. */
export function infobulle(etat: EtatAgrege, sessions: readonly SessionVue[], raison: string | null): string {
	const attendent = sessions.filter(attendReponse).length;
	const travaillent = sessions.filter((s) => s.etat === 'travaille').length;
	const textes: Record<EtatAgrege, string> = {
		arrete: 'service arrêté',
		demarrage: 'démarrage du service…',
		arret: 'arrêt du service…',
		erreur: raison ?? 'le service ne répond pas',
		attend: pluriel(attendent, 'session attend ta réponse', 'sessions attendent ta réponse'),
		travaille: pluriel(travaillent, 'session travaille', 'sessions travaillent'),
		repos: 'aucune session active',
	};
	return `Mnemo — ${textes[etat]}`;
}
