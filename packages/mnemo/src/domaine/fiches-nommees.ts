import { DOSSIERS_FIXES, EMPLACEMENTS_PAR_DEFAUT, PROFIL_TRAVAIL, PROJET_PAR_DEFAUT, plier } from '@mnemo/commun';
import { MOTS_VIDES } from './requete.ts';

export type Nommable = { chemin: string; titre: string; alias: readonly string[] };

/**
 * Mots courants (pliés) qui servent de titre à des fiches de structure : les citer dans un message ne désigne pas la fiche.
 * Les noms de dossiers viennent de leurs constantes ; les autres mots sont propres à cette règle.
 */
export const VOCABULAIRE_COURANT: ReadonlySet<string> = new Set(
	[
		...Object.values(EMPLACEMENTS_PAR_DEFAUT),
		...Object.values(DOSSIERS_FIXES),
		PROJET_PAR_DEFAUT,
		PROFIL_TRAVAIL,
		'documents', 'clients', 'projets', 'pratiques', 'organisations', 'personnes', 'tests', 'test', 'notes', 'claude', 'code', 'memoire',
	].map(plier),
);

const LONGUEUR_MIN = 4;

/** Mots pliés séparés par un seul espace : ponctuation et tirets deviennent des espaces. */
function normaliser(texte: string): string {
	return plier(texte).split(/[^\p{L}\p{N}]+/u).filter((mot) => mot !== '').join(' ');
}

/** Un nom est retenu s'il a au moins un mot qui n'est ni un mot vide ni du vocabulaire courant (« Claude Code » : aucun). */
function retenu(nom: string): boolean {
	return (
		[...nom].length >= LONGUEUR_MIN &&
		!VOCABULAIRE_COURANT.has(nom) &&
		nom.split(' ').some((mot) => !MOTS_VIDES.has(mot) && !VOCABULAIRE_COURANT.has(mot))
	);
}

/** Chemins des fiches dont le titre ou un alias apparaît dans le message, en mots entiers, dans l'ordre de première apparition. */
export function fichesNommees(message: string, nommables: readonly Nommable[]): string[] {
	const texte = ` ${normaliser(message)} `;
	const trouvees: { chemin: string; position: number }[] = [];

	for (const { chemin, titre, alias } of nommables) {
		let premiere = -1;
		for (const brut of [titre, ...alias]) {
			const nom = normaliser(brut);
			if (!retenu(nom)) continue;
			const position = texte.indexOf(` ${nom} `);
			if (position !== -1 && (premiere === -1 || position < premiere)) premiere = position;
		}
		if (premiere !== -1) trouvees.push({ chemin, position: premiere });
	}

	return trouvees.sort((a, b) => a.position - b.position).map((t) => t.chemin);
}
