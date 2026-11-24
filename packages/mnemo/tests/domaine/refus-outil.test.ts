import { describe, expect, it } from 'vitest';
import { CAUSES_NON_VERIFIEE, consignesVerifieesPossibles, estCauseNonVerifiee, refusDelai, refusSurErreur, reponseDe, selonIndicateur, texteDuRefus } from '../../src/domaine/refus-outil.ts';

const SUITE = ' ; des consignes vérifiées peuvent s\'appliquer ici, l\'action est donc refusée.';

describe('texteDuRefus', () => {
	it('action contraire : la consigne et son motif', () => {
		expect(texteDuRefus({ refus: true, consigne: 'Jamais de push forcé.', motif: 'git push --force*' })).toBe('Mnemo : consigne vérifiée « Jamais de push forcé. » (motif « git push --force* »).');
	});

	it('action non vérifiée : la raison, le détail s\'il y en a un, puis la suite à donner', () => {
		expect(texteDuRefus({ refus: true, cause: 'entree_trop_grosse', detail: null })).toBe(`Mnemo n'a pas pu vérifier cette action : son entrée dépasse 1 Mo${SUITE} Découpe-la en actions plus petites.`);
		expect(texteDuRefus(refusDelai())).toBe(`Mnemo n'a pas pu vérifier cette action : la vérification n'a pas fini dans son délai${SUITE} Réessaie-la dans un instant.`);
		// une consigne illisible se répare : réessayer ne servirait à rien
		expect(texteDuRefus({ refus: true, cause: 'consigne_illisible', detail: 'consignes/env.md' })).toBe(`Mnemo n'a pas pu vérifier cette action : une consigne vérifiée ne peut pas être appliquée (consignes/env.md)${SUITE} Demande à l'utilisateur de réparer cette consigne dans la mémoire.`);
		expect(texteDuRefus(refusSurErreur(new Error('database is locked')))).toBe(`Mnemo n'a pas pu vérifier cette action : erreur interne (database is locked)${SUITE} Réessaie-la ou demande à l'utilisateur.`);
	});

	it('chaque cause a son libellé ; une valeur hors de la liste n\'est pas une cause', () => {
		for (const cause of CAUSES_NON_VERIFIEE) expect(texteDuRefus({ refus: true, cause, detail: null }), cause).toMatch(/^Mnemo n'a pas pu vérifier cette action : \S/u);
		expect(estCauseNonVerifiee('entree_illisible')).toBe(true);
		expect(estCauseNonVerifiee('autre')).toBe(false);
		expect(estCauseNonVerifiee(undefined)).toBe(false);
	});
});

describe('vérification impossible : selon l\'indicateur des consignes vérifiées', () => {
	const delai = refusDelai();
	const accord = { refus: false, cause: 'delai_depasse', detail: null };

	it('aucune consigne vérifiée notée : accord (non vérifié) ; consignes notées : refus', () => {
		expect(selonIndicateur(delai, { genre: 'note', presentes: false, horodatageMs: 1 })).toEqual(accord);
		expect(selonIndicateur(delai, { genre: 'note', presentes: true, horodatageMs: 1 })).toEqual(delai);
	});

	it('indicateur illisible : refus ; absent alors que l\'index existe : refus ; installation neuve (ni l\'un ni l\'autre) : accord', () => {
		expect(selonIndicateur(delai, { genre: 'illisible' })).toEqual(delai);
		expect(selonIndicateur(delai, { genre: 'absent', indexExiste: true })).toEqual(delai);
		expect(selonIndicateur(delai, { genre: 'absent', indexExiste: false })).toEqual(accord);
	});

	it('consignesVerifieesPossibles : la même règle, pour le plugin', () => {
		expect(consignesVerifieesPossibles({ genre: 'note', presentes: false, horodatageMs: 1 })).toBe(false);
		expect(consignesVerifieesPossibles({ genre: 'note', presentes: true, horodatageMs: 1 })).toBe(true);
		expect(consignesVerifieesPossibles({ genre: 'illisible' })).toBe(true);
		expect(consignesVerifieesPossibles({ genre: 'absent', indexExiste: true })).toBe(true);
		expect(consignesVerifieesPossibles({ genre: 'absent', indexExiste: false })).toBe(false);
	});

	it('reponseDe : refus en texte, accord non vérifié en avis (journal), accord vérifié : rien', () => {
		expect(reponseDe(delai)).toEqual({ refus: texteDuRefus(delai) });
		expect(reponseDe({ refus: false })).toEqual({});
		expect(reponseDe({ refus: false, cause: 'erreur_interne', detail: 'database is locked' })).toEqual({
			avis: 'Mnemo n\'a pas pu vérifier cette action : erreur interne (database is locked) ; la mémoire ne contient aucune consigne vérifiée, l\'action est permise.',
		});
	});
});
