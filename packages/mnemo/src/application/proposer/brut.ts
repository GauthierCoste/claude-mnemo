import { empreinte } from '../../domaine/empreinte.ts';
import { lireFiche } from '../../domaine/fiche.ts';
import type { Fiche } from '../../domaine/fiche.ts';
import { cheminDeFiche, cheminExistant, commiter, motifCheminInvalide, refuse } from '../commun.ts';
import type { Resultat } from '../commun.ts';
import type { Dependances } from '../ports.ts';

/**
 * Édition brute d'une fiche (interface) : le texte entier, avec l'empreinte du texte lu. Genre réservé à l'utilisateur (route
 * HTTP du service), absent du schéma MCP : une session n'écrit jamais une fiche d'un bloc.
 */
export type DemandeBrut = { genre: 'brut'; chemin: string; texte: string; empreinte: string };

/** `conflit` : la fiche a changé depuis la lecture (empreinte différente) ; rien n'est écrit. */
export type ResultatBrut = Resultat | { statut: 'conflit'; motif: string };

const lisible = (chemin: string, texte: string): Fiche | string => {
	try {
		return lireFiche(chemin, texte);
	} catch (erreur) {
		return erreur instanceof Error ? erreur.message : String(erreur);
	}
};

/**
 * À appeler sous verrou. Refusé : chemin invalide, fiche absente, texte illisible, identifiant ou type changés (une fiche
 * illisible sur le disque peut être réparée : seul le nouveau texte doit se lire). Le texte est écrit tel quel, un commit.
 */
export async function proposerBrut(dep: Dependances, d: DemandeBrut): Promise<ResultatBrut> {
	const chemin = cheminDeFiche(d.chemin);
	if (chemin === null) return refuse(motifCheminInvalide(d.chemin));
	const variante = await cheminExistant(dep, chemin);
	if (variante !== null) return refuse(variante);
	const actuel = await dep.coffre.lire(chemin);
	if (actuel === null) return refuse(`La fiche ${chemin} n'existe pas.`);
	if (empreinte(actuel) !== d.empreinte) return { statut: 'conflit', motif: `La fiche ${chemin} a changé depuis sa lecture : recharge-la avant d'enregistrer.` };
	if (d.texte === actuel) return { statut: 'doublon', fiche: chemin };

	const nouvelle = lisible(chemin, d.texte);
	if (typeof nouvelle === 'string') return refuse(`Texte illisible : ${nouvelle}`);
	const ancienne = lisible(chemin, actuel);
	if (typeof ancienne !== 'string') {
		if (nouvelle.id !== ancienne.id) return refuse(`L'identifiant de la fiche (« id ») ne se change pas : garde « ${ancienne.id} ».`);
		if (nouvelle.type !== ancienne.type) return refuse(`Le type de la fiche ne se change pas ici : garde « ${ancienne.type} ».`);
	}

	await dep.coffre.ecrire(chemin, d.texte);
	const commit = await commiter(dep, `mnemo: brut ${chemin}`, [chemin]);
	return { statut: 'ecrit', fiche: chemin, aConfirmer: false, commit };
}
