import type { OptionsModele, Sens } from '../../src/application/ports.ts';
import { empreinte } from '../../src/domaine/empreinte.ts';

export const DIMENSION_FAUSSE = 1024;

/** Vecteur déterministe (non normalisé) d'un texte : un générateur pseudo-aléatoire semé par l'empreinte du texte. */
export function vecteurFaux(texte: string, dimension = DIMENSION_FAUSSE): Float32Array {
	let graine = Number.parseInt(empreinte(texte).slice(0, 8), 16) >>> 0;
	const v = new Float32Array(dimension);
	for (let i = 0; i < dimension; i++) {
		// mulberry32
		graine = (graine + 0x6d2b79f5) >>> 0;
		let t = graine;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		v[i] = ((((t ^ (t >>> 14)) >>> 0) / 4294967296) - 0.5) * 3;
	}
	return v;
}

/**
 * Faux modèle de sens : vecteurs déterministes, appels notés. `delaiMs` : durée de chaque appel ; un appel dont le budget est
 * plus court rend null au bout du budget (comme le vrai client). `panne` : toujours null. `nom` : identité du modèle (null : absent).
 */
export type FauxSens = Sens & {
	appels: { textes: string[]; options: OptionsModele }[];
	nom: string | null;
	delaiMs: number;
	panne: boolean;
	dimension: number;
};

export function fauxSens(nom: string | null = 'faux@000000000001'): FauxSens {
	const sens: FauxSens = {
		appels: [],
		nom,
		delaiMs: 0,
		panne: false,
		dimension: DIMENSION_FAUSSE,
		modele: () => sens.nom,
		async vecteurs(textes, options) {
			sens.appels.push({ textes: [...textes], options: { ...options } });
			if (sens.nom === null || sens.panne) return null;
			if (sens.delaiMs > 0) {
				await new Promise((r) => setTimeout(r, Math.min(sens.delaiMs, Math.max(0, options.budgetMs))));
				if (sens.delaiMs > options.budgetMs) return null;
			}
			return textes.map((t) => vecteurFaux(t, sens.dimension));
		},
	};
	return sens;
}
