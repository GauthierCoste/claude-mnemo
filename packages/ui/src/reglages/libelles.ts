/**
 * Libellés des réglages venus du service (route `reglages`, en français) dans la langue de l'interface : libellé,
 * explication, unité et libellé de chaque choix, pris dans la liste de textes par la clé du réglage (et la valeur du choix).
 * Une clé ou un choix que la liste ne connaît pas garde le texte du service.
 */
import type { ChampReglageVue } from '@mnemo/contrat';
import type { Textes } from '../langue/textes.ts';

type TexteChamp = { readonly libelle: string; readonly explication: string; readonly unite?: string; readonly choix?: Readonly<Record<string, string>> };

const texteDe = (t: Textes, cle: string): TexteChamp | undefined => {
	const champs: Readonly<Record<string, TexteChamp>> = t.reglages.champs;
	return Object.hasOwn(champs, cle) ? champs[cle] : undefined;
};

/** Le champ dans la langue de `t` ; ses valeurs ne changent pas. */
export function champTraduit(champ: ChampReglageVue, t: Textes): ChampReglageVue {
	const texte = texteDe(t, champ.cle);
	if (texte === undefined) return champ;
	const choix = texte.choix;
	return {
		...champ,
		libelle: texte.libelle,
		explication: texte.explication,
		...(champ.unite !== undefined && texte.unite !== undefined ? { unite: texte.unite } : {}),
		...(champ.choix !== undefined && choix !== undefined
			? { choix: champ.choix.map((x) => (Object.hasOwn(choix, x.valeur) ? { ...x, libelle: choix[x.valeur]! } : x)) }
			: {}),
	};
}

export const champsTraduits = (champs: readonly ChampReglageVue[], t: Textes): ChampReglageVue[] => champs.map((x) => champTraduit(x, t));
