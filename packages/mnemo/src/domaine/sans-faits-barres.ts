// Fiche sans ses faits barrés (invalidés) ni expirés : ce qui est injecté dans une session. Pur, sans module `node:`.
import { estExpire } from './elements.ts';
import { estTitreDesInformations } from './fiche.ts';

// Ligne de fait barré : `- [cat] ~~énoncé~~` (catégorie facultative), suivi de mentions ` | …` et de l'ancre ` ^f-NNNN` ;
// une fin de ligne `\r\n` est acceptée (le `\r` reste en fin de ligne après la coupe sur `\n`).
const RE_FAIT_BARRE = /^- (?:\[[^\]\n]+\] )?~~.{1,}~~(?: \| .*| \^f-\d{4,9})?\r?$/u;
// Lignes qui appartiennent au fait au-dessus : sa citation, ses corroborations (`  + src: …`) et leurs citations.
const RE_SUITE_DU_FAIT = /^ {2}(?:> |\+ src: )/u;
const RE_TITRE_DE_SECTION = /^## (.*?)\s*$/u;
// Mention de validité d'un fait : ` | valide [début,fin)` ou `…fin]` ; groupe 1 : la fin, groupe 2 : la borne.
const RE_VALIDITE = / \| valide \[(?:\d{4}-\d{2}-\d{2})?,(\d{4}-\d{2}-\d{2})?([)\]])/u;

/** Ligne de fait dont la validité est passée à `aujourdhui`. */
function faitExpire(ligne: string, aujourdhui: string | undefined): boolean {
	if (aujourdhui === undefined || !ligne.startsWith('- ')) return false;
	const v = RE_VALIDITE.exec(ligne);
	return v !== null && v[1] !== undefined && estExpire({ valideFin: v[1], finIncluse: v[2] === ']' }, aujourdhui);
}

/**
 * Le texte d'une fiche sans les faits barrés de sa section « Informations », ni, si `aujourdhui` est donné, ceux dont la
 * validité est passée, ni les lignes qui les suivent : citations (`  > « … »`) et corroborations (`  + src: …`). Le reste du
 * texte est rendu tel quel, à l'octet près. Le fait reste dans la fiche : seule l'injection l'omet ; `lire` rend la fiche entière.
 */
export function sansFaitsBarres(texte: string, aujourdhui?: string): string {
	const lignes = texte.split('\n');
	const gardees: string[] = [];
	let dansInformations = false;
	let apresBarre = false;
	for (const ligne of lignes) {
		const titre = RE_TITRE_DE_SECTION.exec(ligne);
		if (titre !== null) {
			dansInformations = estTitreDesInformations(titre[1]!);
			apresBarre = false;
		} else if (dansInformations && (RE_FAIT_BARRE.test(ligne) || faitExpire(ligne, aujourdhui))) {
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
