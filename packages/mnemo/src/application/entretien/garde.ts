import { DOSSIERS_FIXES } from '@mnemo/commun';
import { cleDeCasse, positionDeFiche } from '../../domaine/chemin.ts';
import { analyserFiche } from '../../domaine/fiche.ts';

/**
 * Motif de refus d'une fiche que l'entretien ne touche pas (supprimée, absorbée ou recevant une fusion), sinon null :
 * profil et skills (chemin fixe), consigne (elle ne change qu'avec l'accord de l'utilisateur). `disparait` : la fiche
 * disparaîtrait ; la fiche d'un dossier qui contient d'autres fiches est alors refusée aussi.
 */
export function motifIntouchable(chemin: string, type: string, toutes: Iterable<string>, disparait: boolean): string | null {
	if (type === 'profil') return `${chemin} est un profil : il se gère avec les profils, pas par l'entretien.`;
	if (type === 'consigne') return `${chemin} est une consigne : elle ne change qu'avec l'accord de l'utilisateur (\`proposer\`, genre \`modification\` ou \`niveau\`).`;
	const fixe = Object.values(DOSSIERS_FIXES).find((d) => cleDeCasse(chemin).startsWith(`${cleDeCasse(d)}/`));
	if (fixe !== undefined) return `${chemin} est sous ${fixe}/, au chemin fixe : l'entretien n'y touche pas.`;
	const dossier = positionDeFiche(chemin);
	if (disparait && dossier !== chemin && [...toutes].some((c) => c !== chemin && cleDeCasse(c).startsWith(`${cleDeCasse(dossier)}/`))) {
		return `${chemin} est la fiche du dossier ${dossier}, qui contient d'autres fiches : les ranger ailleurs (\`deplacer\`) ou les retirer d'abord.`;
	}
	return null;
}

/**
 * Parmi les fiches dont des liens sont réécrits par une suppression ou une fusion, celles que l'entretien ne modifie pas
 * d'ordinaire (consigne, profil, chemin fixe) : réécrites quand même (sinon leurs liens seraient cassés), mais à signaler.
 */
export function reecrituresASignaler(textes: ReadonlyMap<string, string>, chemins: string[]): string[] {
	return chemins.filter((chemin) => motifIntouchable(chemin, analyserFiche(chemin, textes.get(chemin) ?? '').fiche.type, [], false) !== null);
}
