// Signal « liée à une fiche injectée à la main » : injecter une fiche (« Injecter dans la session ») dit un intérêt ; les fiches
// reliées directement à elle gagnent un poids qui s'efface de moitié tous les `demiVie` messages porteurs. Pur.

import type { Apport, Signal } from './note-des-pistes.ts';
import { voisinsDe } from './perimetre.ts';
import type { Arete } from './perimetre.ts';

/** Sous ce poids, le signal est ignoré : le geste est trop ancien pour dire encore quelque chose. */
export const SEUIL_POIDS_INJECTION = 0.02;
/** Poids cumulé au plus d'une fiche reliée à plusieurs fiches injectées : le geste aide, il ne remplace pas le sens. */
export const PLAFOND_POIDS_INJECTION = 0.4;

/** Une fiche injectée à la main dans la session et son âge : messages porteurs (non muets) depuis l'injection, 0 au message qui la porte. */
export type InjectionManuelle = { chemin: string; messages: number };
/** `poids` : poids au message de l'injection (`contexte.poidsInjection`) ; `demiVie` : en messages porteurs (`contexte.demiVieInjection`). */
export type ReglagesInjection = { poids: number; demiVie: number };

/** `poids × 0,5^(messages / demiVie)` ; 0 sous `SEUIL_POIDS_INJECTION`. */
export function poidsInjection(r: ReglagesInjection, messages: number): number {
	const poids = r.poids * 0.5 ** (Math.max(0, messages) / r.demiVie);
	return poids < SEUIL_POIDS_INJECTION ? 0 : poids;
}

/**
 * Le signal des fiches injectées à la main : chaque fiche reliée à une injectée par une relation ou un lien écrit, dans un sens
 * ou dans l'autre, à un saut (les arêtes du périmètre ; jamais la parenté de dossier), reçoit son poids ; les poids de plusieurs
 * injectées s'additionnent, jusqu'à `PLAFOND_POIDS_INJECTION`. `depuis` : l'injectée qui pèse le plus. Une fiche injectée deux
 * fois compte à son âge le plus jeune (la réinjection fait repartir le poids).
 */
export function signalInjection(injectees: readonly InjectionManuelle[], aretes: readonly Arete[], r: ReglagesInjection): Signal {
	const ages = new Map<string, number>();
	for (const { chemin, messages } of injectees) ages.set(chemin, Math.min(messages, ages.get(chemin) ?? Number.POSITIVE_INFINITY));
	const parVoisine = new Map<string, { somme: number; depuis: string; fort: number }>();
	for (const [source, messages] of [...ages].sort((a, b) => a[0].localeCompare(b[0]))) {
		const poids = poidsInjection(r, messages);
		if (poids === 0) continue;
		for (const voisine of voisinsDe(new Set([source]), aretes)) {
			if (voisine === source) continue;
			const cumul = parVoisine.get(voisine);
			if (cumul === undefined) parVoisine.set(voisine, { somme: poids, depuis: source, fort: poids });
			else {
				cumul.somme += poids;
				if (poids > cumul.fort) Object.assign(cumul, { depuis: source, fort: poids });
			}
		}
	}
	return {
		nom: 'liee',
		apport(chemin: string): Apport | null {
			const cumul = parVoisine.get(chemin);
			return cumul === undefined ? null : { signal: 'liee', poids: Math.min(PLAFOND_POIDS_INJECTION, cumul.somme), depuis: cumul.depuis };
		},
		designees: new Set(parVoisine.keys()),
	};
}
