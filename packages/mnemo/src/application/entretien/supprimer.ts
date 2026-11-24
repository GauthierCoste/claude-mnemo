import { analyserFiche, lireFiche } from '../../domaine/fiche.ts';
import { aliasGarde, reecrireLiens, sansMd } from '../../domaine/liens-ecrits.ts';
import { originesImportees, verserOrigines } from '../../domaine/origines-importees.ts';
import { aujourdhui, avecIdentifiant, cheminDeFiche, cheminExistant, ecrireEtCommiter, motifCheminInvalide, refuse, texteDeFiche } from '../commun.ts';
import type { Resultat } from '../commun.ts';
import type { Dependances } from '../ports.ts';
import { motifIntouchable, reecrituresASignaler } from './garde.ts';
import { lireLaMemoire, relationsAssainies } from './memoire-lue.ts';

/** `redirection` : fiche vers laquelle les liens entrants sont réécrits ; sans elle, une fiche encore citée n'est pas supprimée. */
export type DemandeSuppression = { action: 'supprimer'; id: string; redirection?: string };
/** Suppression refusée parce que d'autres fiches citent encore la fiche (`citeePar`, chemins triés). */
export type RefusCitee = { statut: 'refuse'; motif: string; citeePar: string[] };

const LISTE_MAX = 20;
const liste = (chemins: string[]): string =>
	chemins.length <= LISTE_MAX ? chemins.join(', ') : `${chemins.slice(0, LISTE_MAX).join(', ')} et ${chemins.length - LISTE_MAX} autres`;

/**
 * Supprime une fiche, en un commit. Citée par d'autres fiches, elle n'est supprimée qu'avec une `redirection` : chaque lien
 * qui la désigne (par chemin, nom, titre ou alias) est réécrit vers la fiche de redirection, sans son `#section` ou
 * `#^ancre` (qui n'existent pas là-bas), texte affiché gardé (son alias, ou la cible écrite par titre, alias ou nom) ;
 * leurs relations devenues identiques sont dédoublonnées. Aucune fiche de renvoi ni alias n'est laissé à sa place. Avec une
 * redirection, les origines d'import de la fiche (notes de Claude Code qu'elle portait) sont ajoutées à celles de la
 * fiche de redirection, avec leur empreinte : un réimport ne la recrée pas tant que la note n'a pas changé. Sans
 * redirection, une note importée qui existe encore dans Claude Code revient au prochain import.
 * Appelant sous verrou.
 */
export async function supprimerFiche(dep: Dependances, demande: DemandeSuppression): Promise<Resultat | RefusCitee> {
	const chemin = cheminDeFiche(demande.id);
	if (chemin === null) return refuse(motifCheminInvalide(demande.id));
	const variante = await cheminExistant(dep, chemin);
	if (variante !== null) return refuse(variante);
	const memoire = await lireLaMemoire(dep);
	const texte = memoire.textes.get(chemin);
	if (texte === undefined) return refuse(`La fiche ${chemin} n'existe pas.`);
	const intouchable = motifIntouchable(chemin, analyserFiche(chemin, texte).fiche.type, memoire.textes.keys(), true);
	if (intouchable !== null) return refuse(intouchable);

	let redirection: string | null = null;
	if (demande.redirection !== undefined && demande.redirection.trim() !== '') {
		redirection = cheminDeFiche(demande.redirection.trim());
		if (redirection === null) return refuse(motifCheminInvalide(demande.redirection));
		const autre = await cheminExistant(dep, redirection);
		if (autre !== null) return refuse(autre);
		if (!memoire.textes.has(redirection)) return refuse(`La fiche de redirection ${redirection} n'existe pas.`);
		if (redirection === chemin) return refuse('La redirection doit être une autre fiche que la fiche supprimée.');
	}

	const citeePar = memoire.citeePar(chemin);
	if (citeePar.length > 0 && redirection === null) {
		return { statut: 'refuse', motif: `${chemin} est encore citée par : ${liste(citeePar)}. Donne une \`redirection\` (la fiche vers laquelle réécrire leurs liens), ou corrige ces liens d'abord.`, citeePar };
	}

	const aEcrire: { chemin: string; texte: string }[] = [];
	let origines: string[] = [];
	if (redirection !== null) {
		const vers = sansMd(redirection);
		for (const citante of citeePar) {
			const neuf = reecrireLiens(memoire.textes.get(citante)!, (cible, suite) => (memoire.designee(cible) === chemin ? `[[${vers}${aliasGarde(cible, suite, chemin)}]]` : null));
			aEcrire.push({ chemin: citante, texte: avecIdentifiant(dep, citante, relationsAssainies(dep, memoire, citante, neuf)) });
		}
		const aVerser = originesImportees(analyserFiche(chemin, texte).fiche);
		if (aVerser.size > 0) {
			const dejaEcrite = aEcrire.find((f) => f.chemin === redirection);
			let cible;
			try {
				cible = lireFiche(redirection, dejaEcrite?.texte ?? memoire.textes.get(redirection)!);
			} catch (erreur) {
				return refuse(`La fiche de redirection ne peut pas recevoir les origines d'import de ${chemin} : ${erreur instanceof Error ? erreur.message : String(erreur)}`);
			}
			const motif = motifIntouchable(redirection, cible.type, [], false);
			if (motif !== null) return refuse(`${motif} Elle ne peut pas recevoir les origines d'import de ${chemin} : choisis une autre redirection.`);
			origines = verserOrigines(cible, aVerser);
			if (origines.length > 0) {
				cible.updated = aujourdhui(dep);
				const reecrite = { chemin: redirection, texte: texteDeFiche(dep, cible) };
				if (dejaEcrite === undefined) aEcrire.push(reecrite);
				else dejaEcrite.texte = reecrite.texte;
			}
		}
	}
	const commit = await ecrireEtCommiter(dep, aEcrire, `mnemo: supprime ${chemin}`, [chemin]);
	const aSignaler = reecrituresASignaler(memoire.textes, redirection === null ? [] : citeePar);
	const changements = [
		'fiche supprimée',
		...(citeePar.length === 0 || redirection === null ? [] : [`liens redirigés vers ${redirection} dans : ${liste(citeePar)}`]),
		...(origines.length === 0 ? [] : [`origines d'import reportées sur ${redirection!} : ${origines.join(', ')}`]),
		...(aSignaler.length === 0 ? [] : [`à signaler à l'utilisateur : liens réécrits dans ${liste(aSignaler)}`]),
	];
	return { statut: 'ecrit', fiche: chemin, aConfirmer: false, commit, changements };
}
