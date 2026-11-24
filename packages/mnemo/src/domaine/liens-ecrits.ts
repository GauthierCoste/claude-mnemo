import { suivreBlocsDeCode } from './blocs-de-code.ts';

/** Lien `[[cible#…|…]]` tel qu'écrit ; groupe 1 : la cible, groupe 2 : la suite (`#section`, `#^ancre`, `|alias`). */
const RE_LIEN = /\[\[([^\]|#]+)((?:#[^\]|]*)?(?:\|[^\]]*)?)\]\]/gu;

export const sansMd = (chemin: string): string => chemin.replace(/\.md$/u, '');

/**
 * Réécrit les liens `[[…]]` hors des blocs de code : `remplacer` reçoit la cible et la suite telles qu'écrites et rend le
 * texte qui remplace le lien entier, ou null pour le garder. Le reste du texte est conservé octet pour octet.
 */
export function reecrireLiens(texte: string, remplacer: (cible: string, suite: string) => string | null): string {
	const morceaux = texte.split(/(\r\n|\r|\n)/u);
	const dansCode = suivreBlocsDeCode();
	for (let i = 0; i < morceaux.length; i += 2) {
		const ligne = morceaux[i]!;
		if (dansCode(ligne)) continue;
		morceaux[i] = ligne.replace(RE_LIEN, (tout, cible: string, suite: string) => remplacer(cible, suite) ?? tout);
	}
	return morceaux.join('');
}

/** Liens écrits hors des blocs de code, dans l'ordre du texte. */
export function liensEcrits(texte: string): { cible: string; suite: string }[] {
	const liens: { cible: string; suite: string }[] = [];
	reecrireLiens(texte, (cible, suite) => {
		liens.push({ cible, suite });
		return null;
	});
	return liens;
}

/** Partie `|alias` de la suite d'un lien (avec la barre), ou « ». */
export const aliasDeSuite = (suite: string): string => {
	const barre = suite.indexOf('|');
	return barre === -1 ? '' : suite.slice(barre);
};

/**
 * Alias d'affichage d'un lien `[[cible…]]` vers la fiche `ancienne` (chemin), réécrit vers une autre fiche : le sien, sinon
 * la cible écrite quand elle n'était pas le chemin (titre, alias, nom), pour que le texte affiché ne change pas.
 */
export const aliasGarde = (cible: string, suite: string, ancienne: string): string => {
	const alias = aliasDeSuite(suite);
	if (alias !== '') return alias;
	const ecrite = cible.trim();
	return sansMd(ecrite) === sansMd(ancienne) ? '' : `|${ecrite}`;
};
