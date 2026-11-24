import { describe, expect, it } from 'vitest';
import { dedoublonner } from '../../src/domaine/dedoublonner.ts';
import type { GenreElement } from '../../src/domaine/elements.ts';

const e = (id: string, genre: GenreElement, texte: string, source: string | null = null) => ({ id, chemin: id.split('#')[0]!, genre, texte, source });

describe('dedoublonner', () => {
	it('une fiche et ses deux passages : une seule entrée, sans copie', () => {
		const r = dedoublonner([e('a.md', 'fiche', 'Titre'), e('a.md#p-1', 'passage', 'Un'), e('a.md#p-2', 'passage', 'Deux')]);
		expect(r).toHaveLength(1);
		expect(r[0]!.copies).toEqual([]);
	});

	it('fiche en tête, passage plus bas : le meilleur passage est montré, à la place de la fiche', () => {
		const r = dedoublonner([e('a.md', 'fiche', 'Tapir'), e('b.md#^f-0001', 'fait', 'Autre'), e('a.md#p-2', 'passage', 'Le tapir arrive lundi'), e('a.md#p-3', 'passage', 'Mardi')]);
		expect(r.map((x) => x.id)).toEqual(['a.md#p-2', 'b.md#^f-0001']);
		// sans passage, la fiche reste
		expect(dedoublonner([e('a.md', 'fiche', 'Tapir')]).map((x) => x.id)).toEqual(['a.md']);
	});

	it('deux faits d’une même fiche, même de texte identique : deux entrées', () => {
		const r = dedoublonner([e('a.md#^f-0001', 'fait', 'Alpha'), e('a.md#^f-0002', 'fait', 'Alpha'), e('a.md#^f-0003', 'fait', 'Beta')]);
		expect(r.map((x) => x.id)).toEqual(['a.md#^f-0001', 'a.md#^f-0002', 'a.md#^f-0003']);
	});

	it('trois sources de même texte : une entrée, deux copies', () => {
		const r = dedoublonner([e('s/a.md', 'fiche', 'Règle  de POSE'), e('s/b.md', 'fiche', 'règle de pose'), e('s/c.md#p-1', 'passage', 'Règle de pose')]);
		expect(r.map((x) => x.id)).toEqual(['s/a.md']);
		expect(r[0]!.copies).toEqual(['s/b.md', 's/c.md']);
	});

	it('l’entrée montrée : la copie citée par un fait des résultats, sinon la plus récente, sinon la mieux classée', () => {
		const d = (id: string, date: string | null) => ({ ...e(id, 'fiche', 'Même texte'), date });
		const citee = dedoublonner([
			d('s/a.md', '2026-01-01'),
			{ ...e('x.md#^f-0001', 'fait', 'Un', '[[s/b]]'), date: null },
			d('s/b.md', '2025-01-01'),
		]);
		// la copie citée est montrée (puis descend sous son fait)
		expect(citee.map((x) => x.id)).toEqual(['x.md#^f-0001', 's/b.md']);
		expect(citee[1]!.copies).toEqual(['s/a.md']);
		const recente = dedoublonner([d('s/a.md', '2025-01-01'), d('s/b.md', '2026-01-01'), d('s/c.md', null)]);
		expect(recente.map((x) => x.id)).toEqual(['s/b.md']);
		expect(recente[0]!.copies).toEqual(['s/a.md', 's/c.md']);
		expect(dedoublonner([d('s/a.md', null), d('s/b.md', null)])[0]!.id).toBe('s/a.md');
	});

	it('`mieuxClasse` : le mieux classé du groupe, dont la note fixe la place de l’entrée (décroissante comme la liste)', () => {
		const note = (id: string, genre: GenreElement, texte: string, n: number, date: string | null = null) => ({ ...e(id, genre, texte), date, n });
		const r = dedoublonner([
			note('a.md', 'fiche', 'Tapir', 0.9),
			note('s/x.md', 'fiche', 'Même texte', 0.8, '2025-01-01'),
			note('a.md#p-2', 'passage', 'Le tapir arrive lundi', 0.7),
			note('s/y.md', 'fiche', 'Même texte', 0.6, '2026-01-01'),
			note('b.md#^f-0001', 'fait', 'Autre', 0.5),
		]);
		// montrés : le passage (à la place de la fiche), la copie la plus récente (à la place de la mieux classée)
		expect(r.map((x) => [x.id, x.mieuxClasse.id])).toEqual([
			['a.md#p-2', 'a.md'],
			['s/y.md', 's/x.md'],
			['b.md#^f-0001', 'b.md#^f-0001'],
		]);
		const affichees = r.map((x) => x.mieuxClasse.n);
		expect(affichees).toEqual([...affichees].sort((a, b) => b - a));
	});

	it('la source citée descend juste sous le dernier fait qui la cite', () => {
		const r = dedoublonner([
			e('sources/r.md', 'fiche', 'Règle'),
			e('x.md#^f-0001', 'fait', 'Un', '[[sources/r]]'),
			e('y.md#^f-0001', 'fait', 'Deux'),
			e('z.md#^f-0001', 'fait', 'Trois', '[[sources/r.md]]'),
			e('w.md#^f-0001', 'fait', 'Quatre'),
		]);
		expect(r.map((x) => x.id)).toEqual(['x.md#^f-0001', 'y.md#^f-0001', 'z.md#^f-0001', 'sources/r.md', 'w.md#^f-0001']);
	});

	it('contenu répété : une copie du voisinage de la position est montrée avant la copie citée ou la plus récente', () => {
		const d = (id: string, date: string, voisin: boolean) => ({ ...e(id, 'fait', 'Même texte'), date, voisin });
		const r = dedoublonner([d('a.md#^f-0001', '2026-01-01', false), d('b.md#^f-0001', '2025-01-01', true), d('c.md#^f-0001', '2026-06-01', false)]);
		expect(r.map((x) => [x.id, x.mieuxClasse.id, x.copies])).toEqual([['b.md#^f-0001', 'a.md#^f-0001', ['a.md', 'c.md']]]);
		// deux copies du voisinage : la plus récente des deux
		const deux = dedoublonner([d('a.md#^f-0001', '2026-01-01', true), d('b.md#^f-0001', '2025-01-01', true), d('c.md#^f-0001', '2026-06-01', false)]);
		expect(deux[0]!.id).toBe('a.md#^f-0001');
	});

	it('`citee` (résolue par l’appelant, par titre par exemple) remplace la lecture du lien écrit', () => {
		const d = (id: string, date: string) => ({ ...e(id, 'fiche', 'Même texte'), date });
		const r = dedoublonner([d('s/a.md', '2026-01-01'), { ...e('x.md#^f-0001', 'fait', 'Un', '[[Copie B]]'), date: null, citee: 's/b.md' }, d('s/b.md', '2025-01-01')]);
		expect(r.map((x) => x.id)).toEqual(['x.md#^f-0001', 's/b.md']);
		expect(r[1]!.copies).toEqual(['s/a.md']);
	});

	it('`memeDate` (chronologie) : un même texte n’est regroupé qu’à date égale', () => {
		const d = (id: string, date: string) => ({ ...e(id, 'passage', 'Même texte'), date });
		const classes = [d('s/a.md#p-1', '2026-09-01'), d('s/b.md#p-1', '2025-01-15'), d('s/c.md#p-1', '2026-09-01')];
		expect(dedoublonner(classes).map((x) => x.id)).toHaveLength(1);
		expect(dedoublonner(classes, { memeDate: true }).map((x) => [x.id, x.copies])).toEqual([
			['s/a.md#p-1', ['s/c.md']],
			['s/b.md#p-1', []],
		]);
	});

	it('par contenu, seulement dans un même genre : un fait et un passage, deux consignes de même texte restent distincts', () => {
		const r = dedoublonner([e('a.md#^f-0001', 'fait', 'Règle de pose'), e('s/b.md#p-1', 'passage', 'règle de pose')]);
		expect(r.map((x) => x.id)).toEqual(['a.md#^f-0001', 's/b.md#p-1']);
		const consignes = dedoublonner([e('c/un.md', 'consigne', 'Toujours répondre en français'), e('c/deux.md', 'consigne', 'Toujours répondre en français')]);
		expect(consignes.map((x) => [x.id, x.copies])).toEqual([
			['c/un.md', []],
			['c/deux.md', []],
		]);
	});
});
