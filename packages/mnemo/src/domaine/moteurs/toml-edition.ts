import type { Plage } from './toml-lecture.ts';

/**
 * Édition du texte d'un fichier TOML d'un moteur, aux places lues par `toml-lecture.ts` : un bloc ajouté, remplacé ou retiré,
 * le reste tel quel (commentaires, ordre, forme), les fins de ligne du fichier gardées.
 */

/** Fin de ligne du texte : `\r\n` si sa première ligne finit ainsi, sinon `\n`. */
export function finDeLigneDe(texte: string): '\n' | '\r\n' {
	const n = texte.indexOf('\n');
	return n > 0 && texte[n - 1] === '\r' ? '\r\n' : '\n';
}

/** Le bloc (écrit en `\n`) avec les fins de ligne du texte. */
const commeLeTexte = (bloc: string, texte: string): string => (finDeLigneDe(texte) === '\n' ? bloc : bloc.replace(/\r?\n/gu, '\r\n'));

/** Lignes vides en fin de texte (après un saut de ligne, ou au début). */
const LIGNES_VIDES_FINALES = /(^|\r?\n)(?:[ \t]*\r?\n)+$/u;

/**
 * Le texte sans les plages données (triées ou non, sans chevauchement), ni les lignes vides juste avant chacune (celle qui
 * séparait un bloc ajouté par `avecBlocALaFin`) : un bloc ajouté puis retiré rend le texte d'avant.
 */
export function sansPlages(texte: string, plages: readonly Plage[]): string {
	let resultat = '';
	let i = 0;
	// un bloc retiré en tête du fichier n'y laisse pas les lignes vides qui le suivaient
	const suite = (fin: number): string => (resultat === '' && i > 0 ? texte.slice(i, fin).replace(/^(?:[ \t]*\r?\n)+/u, '') : texte.slice(i, fin));
	for (const p of [...plages].sort((a, b) => a.debut - b.debut)) {
		resultat = `${resultat}${suite(p.debut)}`.replace(LIGNES_VIDES_FINALES, '$1');
		i = p.fin;
	}
	return resultat + suite(texte.length);
}

/** Le texte suivi de `bloc`, séparé par une ligne vide ; le bloc prend les fins de ligne du texte. */
export function avecBlocALaFin(texte: string, bloc: string): string {
	const base = texte.replace(/\s+$/u, '');
	if (base === '') return bloc;
	const fin = finDeLigneDe(texte);
	return `${base}${fin}${fin}${commeLeTexte(bloc, texte)}`;
}

/** Le texte avec `bloc` à la place de la première plage, les autres retirées ; le bloc prend les fins de ligne du texte. */
export function avecPlagesRemplacees(texte: string, plages: readonly Plage[], bloc: string): string {
	const [premiere, ...autres] = [...plages].sort((a, b) => a.debut - b.debut);
	if (premiere === undefined) return avecBlocALaFin(texte, bloc);
	const apres = sansPlages(texte.slice(premiere.fin), autres.map((p) => ({ debut: p.debut - premiere.fin, fin: p.fin - premiere.fin })));
	return `${texte.slice(0, premiere.debut)}${commeLeTexte(bloc, texte)}${apres}`;
}
