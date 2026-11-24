// Fiche sans ses faits barrés (invalidés) : ce qui est injecté dans une session. Pur, sans module `node:`.
import { estTitreDesInformations } from './fiche.ts';

// Ligne de fait barré : `- [cat] ~~énoncé~~` (catégorie facultative), suivi de mentions ` | …` et de l'ancre ` ^f-NNNN` ;
// une fin de ligne `\r\n` est acceptée (le `\r` reste en fin de ligne après la coupe sur `\n`).
const RE_FAIT_BARRE = /^- (?:\[[^\]\n]+\] )?~~.{1,}~~(?: \| .*| \^f-\d{4,9})?\r?$/u;
// Lignes qui appartiennent au fait au-dessus : sa citation, ses corroborations (`  + src: …`) et leurs citations.
const RE_SUITE_DU_FAIT = /^ {2}(?:> |\+ src: )/u;
const RE_TITRE_DE_SECTION = /^## (.*?)\s*$/u;

/**
 * Le texte d'une fiche sans les faits barrés de sa section « Informations » ni les lignes qui les suivent : citations
 * (`  > « … »`) et corroborations (`  + src: …`). Le reste du texte est rendu tel quel, à l'octet près. Le barré reste
 * dans la fiche : seule l'injection l'omet ; `lire` rend la fiche entière.
 */
export function sansFaitsBarres(texte: string): string {
	const lignes = texte.split('\n');
	const gardees: string[] = [];
	let dansInformations = false;
	let apresBarre = false;
	for (const ligne of lignes) {
		const titre = RE_TITRE_DE_SECTION.exec(ligne);
		if (titre !== null) {
			dansInformations = estTitreDesInformations(titre[1]!);
			apresBarre = false;
		} else if (dansInformations && RE_FAIT_BARRE.test(ligne)) {
			apresBarre = true;
			continue;
		} else if (dansInformations && apresBarre && RE_SUITE_DU_FAIT.test(ligne)) {
			continue;
		} else {
			apresBarre = false;
		}
		gardees.push(ligne);
	}
	return gardees.join('\n');
}
