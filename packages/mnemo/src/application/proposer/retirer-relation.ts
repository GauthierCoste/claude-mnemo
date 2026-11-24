import { normaliserCible } from '../../domaine/elements.ts';
import { resolveurDeLiens } from '../liens.ts';
import type { Dependances } from '../ports.ts';
import { aujourdhui, cheminDeFiche, cheminExistant, ecrireEtCommiter, lireFicheExistante, motifCheminInvalide, refuse, texteDeFiche } from '../commun.ts';
import type { Resultat } from '../commun.ts';

export type DemandeRetraitRelation = { genre: 'retirer_relation'; fiche: string; verbe: string; cible: string };

export async function proposerRetraitRelation(dep: Dependances, demande: DemandeRetraitRelation): Promise<Resultat> {
	const chemin = cheminDeFiche(demande.fiche);
	if (chemin === null) return refuse(motifCheminInvalide(demande.fiche));
	const variante = await cheminExistant(dep, chemin);
	if (variante !== null) return refuse(variante);
	const fiche = await lireFicheExistante(dep, chemin);
	if (typeof fiche === 'string') return refuse(fiche);

	const cible = demande.cible.trim();
	// comme tout lien : la cible désigne une fiche par son chemin, son nom ou son titre (le même résolveur que le graphe)
	const resoudre = resolveurDeLiens(await dep.index.titres());
	const ficheVisee = (texte: string): string | null => {
		const vers = normaliserCible(texte);
		return vers === null ? null : resoudre(vers);
	};
	const visee = ficheVisee(cible);
	const meme = (ecrite: string) => ecrite === cible || (visee !== null && ficheVisee(ecrite) === visee);
	const restantes = fiche.relations.filter((r) => !('verbe' in r && r.verbe === demande.verbe && meme(r.cible)));
	if (restantes.length === fiche.relations.length) {
		const presentes = fiche.relations.map((r) => ('verbe' in r ? `${r.verbe} [[${r.cible}]]` : r.brute));
		const liste = presentes.length === 0 ? 'aucune' : presentes.join(' ; ');
		return refuse(`Aucune relation « ${demande.verbe} [[${cible}]] » dans ${chemin}. Relations présentes : ${liste}.`);
	}
	fiche.relations = restantes;
	fiche.updated = aujourdhui(dep);
	const commit = await ecrireEtCommiter(dep, [{ chemin, texte: texteDeFiche(dep, fiche) }], `mnemo: retirer_relation ${chemin}`);
	return { statut: 'ecrit', fiche: chemin, aConfirmer: false, commit };
}
