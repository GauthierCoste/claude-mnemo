import { describe, expect, it } from 'vitest';
import { LONGUEUR_MAX_TITRE, motifTitre } from '../../src/domaine/titre.ts';

describe('motifTitre', () => {
	it.each([
		['vide', '  ', 'Le titre est vide.'],
		['trop long', 'a'.repeat(LONGUEUR_MAX_TITRE + 1), `Le titre dépasse ${LONGUEUR_MAX_TITRE} caractères.`],
		['sur deux lignes', 'a\nb', 'Le titre doit tenir sur une seule ligne.'],
		['titre Markdown', '# Titre', 'Le titre ne doit pas commencer par « # ».'],
	])('refuse un titre %s', (_cas, titre, motif) => expect(motifTitre('Le titre', titre)).toBe(motif));

	it('accepte un titre à la longueur limite, rogné', () => expect(motifTitre('Le titre', ` ${'a'.repeat(LONGUEUR_MAX_TITRE)} `)).toBeNull());
});
