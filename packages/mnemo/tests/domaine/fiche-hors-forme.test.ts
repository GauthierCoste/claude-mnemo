import { describe, expect, it } from 'vitest';
import { elementsDeFiche } from '../../src/domaine/elements.ts';
import { analyserFiche, lireFiche } from '../../src/domaine/fiche.ts';

const CORPS = '# Réunion budget\n\nLe tarif journalier est revu.\n\n## Informations\n- Livraison en mars | declare | src: utilisateur oral | appris 2026-11-20 ^f-0001\n\n## Relations\n- concerne [[clients/acme]]\n';

describe('fiche hors de sa forme : tout est lu, rien ne lève', () => {
	it('type mal formé : lue comme un sujet, avec une anomalie ; lireFiche la refuse toujours', () => {
		const texte = `---\ntype: Réunion\n---\n${CORPS}`;
		const { fiche, anomalies } = analyserFiche('notes/r.md', texte);
		expect(fiche.type).toBe('sujet');
		expect(fiche.titre).toBe('Réunion budget');
		expect(fiche.faits).toHaveLength(1);
		expect(anomalies).toEqual([{ genre: 'type', message: expect.stringContaining('« Réunion »') }]);
		expect(() => lireFiche('notes/r.md', texte)).toThrow(/notes\/r\.md : type de fiche mal formé « Réunion »/u);
	});

	it('frontmatter illisible (deux-points non cité) : le corps qui suit est lu', () => {
		const texte = `---\ntitre: Réunion: budget\n---\n${CORPS}`;
		const { fiche, anomalies } = analyserFiche('notes/r.md', texte);
		expect(fiche.titre).toBe('Réunion budget');
		expect(fiche.synthese).toBe('Le tarif journalier est revu.');
		expect(anomalies.map((a) => a.genre)).toEqual(['entete']);
		expect(() => lireFiche('notes/r.md', texte)).toThrow(/frontmatter illisible/u);
	});

	it('frontmatter non terminé : tout le texte est du corps', () => {
		const { fiche, anomalies } = analyserFiche('n.md', '---\ntitre: x\nLe tarif journalier est revu.\n');
		expect(fiche.synthese).toContain('Le tarif journalier est revu.');
		expect(anomalies.map((a) => a.genre)).toEqual(['entete']);
	});

	it('ligne d\'Informations ou de Relations hors grammaire : gardée, signalée, sans refus', () => {
		const texte = '# T\n\n## Informations\n- Tarif journalier | 650 € HT\n* Livraison en mars\n\n## Relations\n- client de Acme\n';
		const { anomalies } = analyserFiche('t.md', texte);
		expect(anomalies).toEqual([
			{ genre: 'ligne', message: '2 lignes de « Informations » hors de la forme attendue (« - Tarif journalier | 650 € HT »)' },
			{ genre: 'ligne', message: 'une ligne de « Relations » hors de la forme attendue (« - client de Acme »)' },
		]);
		expect(() => lireFiche('t.md', texte)).not.toThrow();
	});
});

describe('elementsDeFiche : une fiche hors de sa forme est indexée comme texte', () => {
	const textes = (r: ReturnType<typeof elementsDeFiche>) => r.elements.map((e) => e.texte).join('\n');

	it('type mal formé : synthèse, informations et liens indexés ; contenu encadré (origine inconnue)', () => {
		const r = elementsDeFiche('notes/r.md', `---\ntype: Réunion\n---\n${CORPS}`);
		expect(textes(r)).toContain('Le tarif journalier est revu.');
		expect(r.elements.filter((e) => e.genre === 'fait').map((e) => e.texte)).toEqual(['Livraison en mars']);
		expect(r.liens.map((l) => l.vers)).toEqual(['clients/acme.md']);
		expect(r.typeDocument).toBe('inconnue');
		expect(r.anomalies).toEqual([expect.stringMatching(/type de fiche mal formé « Réunion ».* : lue comme un sujet$/u)]);
	});

	it('frontmatter illisible : le corps est indexé, l\'anomalie est rendue', () => {
		const r = elementsDeFiche('notes/r.md', `---\ntitre: Réunion: budget\n---\n${CORPS}`);
		expect(r.titre).toBe('Réunion budget');
		expect(textes(r)).toContain('Le tarif journalier est revu.');
		expect(r.anomalies).toEqual([expect.stringMatching(/^frontmatter illisible : .* : propriétés ignorées, contenu indexé comme texte$/u)]);
	});

	it('ligne d\'Informations hors grammaire : dans un passage de la fiche', () => {
		const r = elementsDeFiche('t.md', '# T\n\nSynthèse.\n\n## Informations\n- Tarif journalier | 650 € HT\n');
		const passages = r.elements.filter((e) => e.genre === 'passage');
		expect(passages.map((p) => p.texte).join('\n')).toContain('Tarif journalier | 650 € HT');
		expect(r.typeDocument).toBeNull();
		expect(r.anomalies).toHaveLength(1);
	});

	it('fiche bien formée : aucune anomalie', () => {
		expect(elementsDeFiche('a.md', `---\ntype: sujet\n---\n${CORPS}`).anomalies).toEqual([]);
	});
});
