/**
 * Contenu de l'onglet Documentation de la vue Réglages : une seule page, en sections (sommaire du panneau), registre neutre et
 * technique. Chaque affirmation est vérifiée dans le code du service (`packages/mnemo`) ; les chiffres sont les valeurs par
 * défaut (`domaine/reglages.ts`, `domaine/regles.ts`). Les textes viennent de la liste `documentation` d'une langue ; ce
 * fichier en fixe la structure (sections, blocs, ordre). Dans un texte, `**gras**` et `` `code` `` sont rendus comme tels. Le
 * tableau des capacités prend noms, symboles et caractère toujours actif dans `profils/hooks.ts` ; la liste n'en donne que
 * l'effet, par hook.
 */
import type { EvenementHookVue } from '@mnemo/contrat';
import { TEXTES, type Textes } from '../langue/textes.ts';

export type BlocDoc =
	| { genre: 'definitions'; termes: readonly (readonly [string, string])[] }
	| { genre: 'etapes'; etapes: readonly string[] }
	| { genre: 'tableau'; legende: string; colonnes: readonly string[]; lignes: readonly (readonly string[])[] }
	| { genre: 'capacites'; effets: Readonly<Record<EvenementHookVue, string>> }
	| { genre: 'intertitre'; texte: string }
	| { genre: 'note'; texte: string };

export type SectionDoc = { id: string; titre: string; blocs: readonly BlocDoc[] };

/** Les sections de la documentation, avec les textes d'une langue (le français par défaut). */
export function sectionsDoc(t: Textes['documentation'] = TEXTES.fr.documentation): readonly SectionDoc[] {
	return [
		{ id: 'doc-principe', titre: t.principe.titre, blocs: [{ genre: 'definitions', termes: t.principe.termes }] },
		{
			id: 'doc-session',
			titre: t.session.titre,
			blocs: [
				{ genre: 'capacites', effets: t.session.effets },
				{ genre: 'note', texte: t.session.sansSouffle },
				{ genre: 'note', texte: t.session.projet },
			],
		},
		{ id: 'doc-agents', titre: t.agents.titre, blocs: [{ genre: 'definitions', termes: t.agents.termes }] },
		{
			id: 'doc-rappel',
			titre: t.rappel.titre,
			blocs: [
				{ genre: 'etapes', etapes: t.rappel.etapes },
				{ genre: 'tableau', legende: t.rappel.legende, colonnes: t.rappel.colonnes, lignes: t.rappel.lignes },
				{ genre: 'note', texte: t.rappel.note },
			],
		},
		{
			id: 'doc-recherche',
			titre: t.recherche.titre,
			blocs: [{ genre: 'tableau', legende: t.recherche.legende, colonnes: t.recherche.colonnes, lignes: t.recherche.lignes }],
		},
		{
			id: 'doc-confiance',
			titre: t.confiance.titre,
			blocs: [
				{ genre: 'note', texte: t.confiance.formule },
				{ genre: 'tableau', legende: t.confiance.legendeSources, colonnes: t.confiance.colonnesSources, lignes: t.confiance.lignesSources },
				{ genre: 'definitions', termes: t.confiance.termes },
				{ genre: 'intertitre', texte: t.confiance.consignes },
				{ genre: 'tableau', legende: t.confiance.legendeNiveaux, colonnes: t.confiance.colonnesNiveaux, lignes: t.confiance.lignesNiveaux },
				{ genre: 'note', texte: t.confiance.montee },
			],
		},
		{ id: 'doc-archiviste', titre: t.archiviste.titre, blocs: [{ genre: 'definitions', termes: t.archiviste.termes }] },
	];
}

/** Les sections avec leurs textes français, pour un appelant qui n'a pas la langue. */
export const SECTIONS_DOC: readonly SectionDoc[] = sectionsDoc();
