// Rapport texte du diagnostic de la mémoire (outil `diagnostiquer`) : comptes en tête, puis chaque rubrique non vide. Pur.
import type { Diagnostic, Rubrique } from './diagnostic.ts';
import { SEUIL_CATEGORIE_RARE, SEUIL_FICHE_CHARGEE } from './diagnostic.ts';

/** Nombre d'entrées montrées par rubrique quand la demande n'en fixe pas. */
export const LIMITE_PAR_RUBRIQUE = 20;

function titreDe(rubrique: Rubrique, seuilRappel: number): string {
	switch (rubrique) {
		case 'liens_casses':
			return 'Liens cassés';
		case 'fiches_isolees':
			return 'Fiches isolées (ni lien entrant ni sortant)';
		case 'sans_synthese':
			return 'Fiches sans synthèse';
		case 'dossiers':
			return 'Dossiers sans fiche ou à synthèse vide';
		case 'sous_seuil':
			return `Informations de confiance faible (sous ${Math.round(100 * seuilRappel)} %)`;
		case 'a_confirmer':
			return 'Informations à confirmer';
		case 'barrees':
			return 'Informations barrées';
		case 'perimees':
			return 'Fiches temporaires et informations périmées (plus injectées : supprimer, ou prolonger si elles restent vraies)';
		case 'doublons':
			return 'Doublons probables (même fiche)';
		case 'fiches_chargees':
			return `Fiches de plus de ${SEUIL_FICHE_CHARGEE} informations`;
		case 'sources_en_double':
			return 'Sources en double';
		case 'sources_non_citees':
			return 'Sources jamais citées';
		case 'categories_rares':
			return `Catégories rares (${SEUIL_CATEGORIE_RARE} emplois au plus)`;
		case 'nom_titre':
			return 'Nom de fichier différent du titre';
		case 'lots_en_attente':
			return 'Lots proposés en attente de l\'utilisateur';
	}
}

function rendre(d: Diagnostic, seuilRappel: number, limite: number, reduite: boolean): string {
	const lignes = [`Diagnostic de la mémoire : ${d.fiches} fiches, ${d.informations} informations.`];
	lignes.push(...d.rubriques.map((r) => `- ${r.rubrique} : ${r.entrees.length}`));
	if (reduite) lignes.push(`(${limite} entrées au plus par rubrique, pour tenir dans la réponse ; \`rubriques\` en montre moins à la fois)`);
	for (const r of d.rubriques) {
		if (r.entrees.length === 0) continue;
		lignes.push('', `## ${titreDe(r.rubrique, seuilRappel)} (${r.entrees.length})`);
		lignes.push(...r.entrees.slice(0, limite).map((e) => `- ${e}`));
		if (r.entrees.length > limite) lignes.push(`… ${r.entrees.length - limite} de plus`);
	}
	if (d.rubriques.every((r) => r.entrees.length === 0)) lignes.push('', 'Rien à signaler.');
	return lignes.join('\n');
}

/**
 * Rapport du diagnostic : une ligne de compte par rubrique, puis les `limite` premières entrées de chaque rubrique non vide.
 * Si le rapport dépasse `budget` caractères, la limite est divisée par deux jusqu'à ce qu'il tienne (les comptes restent
 * entiers), et le rapport le dit.
 */
export function rapportDeDiagnostic(d: Diagnostic, seuilRappel: number, limite: number, budget: number): string {
	let n = limite;
	let texte = rendre(d, seuilRappel, n, false);
	while (texte.length > budget && n > 1) {
		n = Math.max(1, Math.floor(n / 2));
		texte = rendre(d, seuilRappel, n, true);
	}
	return texte;
}
