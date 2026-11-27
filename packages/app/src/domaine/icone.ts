/**
 * Icône de la barre des menus (macOS) ou de la zone de notification (Windows) et son infobulle, selon l'état agrégé. Sous
 * macOS, des images « template » (noir sur transparent, teintées par le système), le nom finissant par `Template` ; sous
 * Windows, qui ne teinte rien, la même image en blanc (`-clair`, sur une barre des tâches sombre) ou en noir (`-sombre`,
 * sur une barre claire). Chaque image : `<nom>.png` (16 px) et `<nom>@2x.png` (32 px).
 */
import type { SessionVue } from '@mnemo/contrat';
import type { EtatAgrege } from './etat.ts';
import { TEXTES_FR, type TextesApp } from './langue/textes.ts';
import type { PlateformeApp } from './plateforme.ts';
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

/** Variantes de Windows d'une image « template » : blanche (barre sombre) et noire (barre claire). */
export const VARIANTES_WINDOWS = ['-clair', '-sombre'] as const;

/** L'image de Windows qui correspond à l'image « template » `nom` : blanche sur une barre sombre, noire sur une claire. */
export function imageWindows(nom: string, barreSombre: boolean): string {
	return `${nom.replace(/Template$/u, '')}${barreSombre ? '-clair' : '-sombre'}`;
}

/** Toutes les images à produire (celles de macOS, puis leurs variantes de Windows), sans doublon. */
export function toutesLesImages(): string[] {
	const templates = [...new Set(Object.values(IMAGES_ICONE).flat())];
	return [...templates, ...templates.flatMap((nom) => [imageWindows(nom, true), imageWindows(nom, false)])];
}

/**
 * Image à montrer à la `pas`-ième étape de l'animation (0 pour une icône fixe). Sous Windows, `barreSombre` : la barre
 * des tâches est sombre (`nativeTheme.shouldUseDarkColorsForSystemIntegratedUI`).
 */
export function imageIcone(etat: EtatAgrege, pas: number, plateforme: PlateformeApp = 'darwin', barreSombre = false): string {
	const images = IMAGES_ICONE[etat];
	const nom = images[((pas % images.length) + images.length) % images.length]!;
	return plateforme === 'win32' ? imageWindows(nom, barreSombre) : nom;
}

/** Infobulle de l'icône : « Mnemo — » puis l'état en clair ; en erreur, la raison si elle est connue. */
export function infobulle(etat: EtatAgrege, sessions: readonly SessionVue[], raison: string | null, t: TextesApp = TEXTES_FR): string {
	const i = t.infobulle;
	const textes: Record<EtatAgrege, () => string> = {
		arrete: () => i.arrete,
		demarrage: () => i.demarrage,
		arret: () => i.arret,
		erreur: () => raison ?? i.erreur,
		attend: () => i.attend(sessions.filter(attendReponse).length),
		travaille: () => i.travaille(sessions.filter((s) => s.etat === 'travaille').length),
		repos: () => i.repos,
	};
	return i.ligne(textes[etat]());
}
