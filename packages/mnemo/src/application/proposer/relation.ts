import type { Dependances } from '../ports.ts';
import { aujourdhui, cheminDeFiche, cheminExistant, ecrireEtCommiter, lireFicheExistante, motifCheminInvalide, refuse, texteDeFiche } from '../commun.ts';
import type { Resultat } from '../commun.ts';

export type DemandeRelation = { genre: 'relation'; fiche: string; verbe: string; cible: string };

const RE_VERBE = /^[\p{Ll}\p{N}_]{1,40}$/u;

export async function proposerRelation(dep: Dependances, demande: DemandeRelation): Promise<Resultat> {
	const chemin = cheminDeFiche(demande.fiche);
	if (chemin === null) return refuse(motifCheminInvalide(demande.fiche));
	if (!RE_VERBE.test(demande.verbe)) return refuse(`Verbe invalide : « ${demande.verbe} » (minuscules, chiffres ou « _ », 40 caractères au plus).`);
	const cible = demande.cible.trim();
	if (cible === '') return refuse('La cible de la relation est vide.');
	if (cible.includes(']]') || /[\r\n]/u.test(demande.cible)) return refuse('La cible de la relation ne doit contenir ni « ]] » ni saut de ligne.');

	const variante = await cheminExistant(dep, chemin);
	if (variante !== null) return refuse(variante);
	const fiche = await lireFicheExistante(dep, chemin);
	if (typeof fiche === 'string') return refuse(fiche);
	if (fiche.relations.some((r) => 'verbe' in r && r.verbe === demande.verbe && r.cible === cible)) return { statut: 'doublon', fiche: chemin };
	fiche.relations.push({ verbe: demande.verbe, cible });
	fiche.updated = aujourdhui(dep);
	const commit = await ecrireEtCommiter(dep, [{ chemin, texte: texteDeFiche(dep, fiche) }], `mnemo: relation ${chemin}`);
	return { statut: 'ecrit', fiche: chemin, aConfirmer: false, commit };
}
