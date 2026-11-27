/**
 * Résumé rapide d'une fiche, pour juger d'un coup d'œil si elle convient (aperçu du panneau Contexte) : son type, son
 * dossier, sa synthèse (le texte avant la première section) et ses premières informations, non barrées. Texte brut : les
 * `[[liens]]` deviennent leur alias ou le nom de leur cible, le gras et le code perdent leurs marques.
 */
import type { FicheVue } from '@mnemo/contrat';
import { analyserCorps, TITRE_INFORMATIONS } from './rendu-fiche.tsx';

/** Informations montrées dans l'aperçu ; les autres sont comptées. */
export const INFORMATIONS_APERCU = 3;

export type InformationResumee = { texte: string; categorie: string | null; ancre: string | null };

export type ResumeFiche = {
	type: string;
	/** Synthèse en un paragraphe ('' : la fiche n'en a pas). */
	synthese: string;
	/** Les premières informations non barrées (l'information visée d'abord, si elle en est). */
	informations: InformationResumee[];
	/** Informations non barrées de la fiche, montrées ou non. */
	total: number;
};

/** Dossier d'une fiche (relatif à la racine de la mémoire) ; '' : la racine. */
export const dossierDe = (chemin: string): string => chemin.slice(0, Math.max(0, chemin.lastIndexOf('/')));

/** `[[cible|alias]]` → alias, `[[dossier/Nom.md]]` → Nom ; `**gras**`, `*italique*`, `` `code` `` → leur texte. */
export function texteBrut(texte: string): string {
	return texte
		.replace(/\[\[([^[\]|]+)\|([^[\]]+)\]\]/gu, '$2')
		.replace(/\[\[([^[\]]+)\]\]/gu, (_, cible: string) => cible.slice(cible.lastIndexOf('/') + 1).replace(/\.md$/u, ''))
		.replace(/\*\*([^*]+)\*\*/gu, '$1')
		.replace(/(^|[^*\w])\*([^*\s][^*]*)\*/gu, '$1$2')
		.replace(/`([^`]+)`/gu, '$1')
		.trim();
}

/** Le résumé de `fiche` ; `ancre` : l'information visée par la ligne (`f-0003`), placée en tête si elle est là. */
export function resumerFiche(fiche: Pick<FicheVue, 'type' | 'corps'>, ancre: string | null = null): ResumeFiche {
	const synthese: string[] = [];
	const informations: InformationResumee[] = [];
	let section: string | null = null;
	for (const ligne of analyserCorps(fiche.corps)) {
		if (ligne.genre === 'titre2') {
			section = ligne.texte;
			continue;
		}
		if (section === null) {
			if (ligne.genre === 'paragraphe' || ligne.genre === 'citation' || ligne.genre === 'puce') synthese.push(ligne.texte);
			else if (ligne.genre === 'liste') synthese.push(...ligne.items);
			continue;
		}
		if (section === TITRE_INFORMATIONS && ligne.genre === 'puce' && !ligne.barre && ligne.texte !== '') informations.push({ texte: texteBrut(ligne.texte), categorie: ligne.categorie, ancre: ligne.ancre });
	}
	const visee = ancre === null ? -1 : informations.findIndex((i) => i.ancre === ancre);
	const ordonnees = visee <= 0 ? informations : [informations[visee]!, ...informations.slice(0, visee), ...informations.slice(visee + 1)];
	return { type: fiche.type, synthese: texteBrut(synthese.join(' ')), informations: ordonnees.slice(0, INFORMATIONS_APERCU), total: informations.length };
}
