import { describe, expect, it } from 'vitest';
import { decouper, TAILLE_BLOC_MAX, TAILLE_MAX, TAILLE_MIN } from '../../src/domaine/passages.ts';
import type { Contexte } from '../../src/domaine/passages.ts';
import { borne, croissance } from '../aides/charge.ts';

const ctx: Contexte = { titre: 'Rapport', date: '2026-03-01', auteur: 'Ada', ficheSource: 'sources/rapport.md' };
const para = (n: number, mot = 'mot') => Array.from({ length: n }, (_, i) => `${mot}${i}`).join(' ');

describe('constantes', () => {
	it('valent celles du jalon', () => {
		expect([TAILLE_MIN, TAILLE_MAX, TAILLE_BLOC_MAX]).toEqual([800, 2000, 8000]);
	});
});

describe('decouper : structure', () => {
	it('porte le chemin des titres sur trois niveaux', () => {
		const md = `# A\n\n${para(150, 'a')}\n\n## B\n\n${para(150, 'b')}\n\n### C\n\n${para(150, 'c')}\n\n## D\n\n${para(150, 'd')}\n`;
		const ps = decouper(md, ctx);
		expect(ps.map((p) => p.titres)).toEqual([['A'], ['A', 'B'], ['A', 'B', 'C'], ['A', 'D']]);
		expect(ps.map((p) => p.position)).toEqual([0, 1, 2, 3]);
	});

	it('un changement de titre ferme le passage', () => {
		const ps = decouper('# A\n\npetit\n\n# B\n\nautre\n', ctx);
		expect(ps).toHaveLength(2);
		expect(ps[0]!.texte).toContain('petit');
		expect(ps[0]!.texte).not.toContain('autre');
	});

	it('ne garde jamais un passage fait seulement de titres (un e-mail au corps vide n’a aucun passage)', () => {
		const ps = decouper('# A\n\n## B\n\ncorps\n', ctx);
		expect(ps).toHaveLength(1);
		expect(ps[0]!.titres).toEqual(['A', 'B']);
		expect(decouper('# Seul\n', ctx)).toEqual([]);
		expect(decouper('# Sujet\n\n## Marc — 2026-03-02\n', ctx)).toEqual([]);
		expect(decouper('  \n\n', ctx)).toEqual([]);
	});

	it('accumule les blocs jusqu’à TAILLE_MAX et tout passage reste ≤ TAILLE_MAX', () => {
		const md = Array.from({ length: 40 }, (_, i) => para(40, `p${i}x`)).join('\n\n');
		const ps = decouper(md, ctx);
		expect(ps.length).toBeGreaterThan(1);
		for (const p of ps) expect(p.texte.length).toBeLessThanOrEqual(TAILLE_MAX);
		expect(ps.slice(0, -1).every((p) => p.texte.length >= TAILLE_MIN)).toBe(true);
	});

	it('fusionne un petit passage avec le suivant de la même section quand cela tient', () => {
		const ps = decouper(`# A\n\n${'x'.repeat(100)}\n\n${'y'.repeat(1500)}\n\n${'z'.repeat(1900)}\n`, ctx);
		expect(ps).toHaveLength(2);
		expect(ps[0]!.texte).toContain('x'.repeat(100));
		expect(ps[0]!.texte).toContain('y'.repeat(1500));
		expect(ps[1]!.texte).toBe('z'.repeat(1900));
	});

	it('ne fusionne pas quand le tout dépasserait TAILLE_MAX', () => {
		const ps = decouper(`# A\n\n${'x'.repeat(100)}\n\n${'y'.repeat(1990)}\n`, ctx);
		expect(ps).toHaveLength(2);
		for (const p of ps) expect(p.texte.length).toBeLessThanOrEqual(TAILLE_MAX);
	});

	it('ne coupe jamais un tableau de 3 000 caractères', () => {
		const lignes = Array.from({ length: 60 }, (_, i) => `| ligne ${i} | ${'v'.repeat(30)} |`);
		const tableau = ['| a | b |', '|---|---|', ...lignes].join('\n');
		expect(tableau.length).toBeGreaterThan(2500);
		const ps = decouper(`# T\n\nintro\n\n${tableau}\n\nfin\n`, ctx);
		expect(ps.filter((p) => p.texte.includes(tableau))).toHaveLength(1);
	});

	it('ne coupe jamais une liste', () => {
		const liste = Array.from({ length: 80 }, (_, i) => `- élément ${i} ${'w'.repeat(30)}\n  suite ${i}`).join('\n');
		expect(liste.length).toBeGreaterThan(2000);
		const ps = decouper(`# L\n\n${liste}\n`, ctx);
		expect(ps.filter((p) => p.texte.includes(liste))).toHaveLength(1);
	});

	it('coupe entre les éléments une liste plus grande que TAILLE_BLOC_MAX', () => {
		const items = Array.from({ length: 400 }, (_, i) => `- élément ${i} ${'w'.repeat(30)}`);
		const ps = decouper(items.join('\n'), ctx);
		expect(ps.length).toBeGreaterThan(1);
		for (const p of ps) {
			expect(p.texte.length).toBeLessThanOrEqual(TAILLE_MAX);
			for (const l of p.texte.split('\n')) expect(l).toMatch(/^- élément \d+ w{30}$/u);
		}
		expect(ps.flatMap((p) => p.texte.split('\n'))).toEqual(items);
	});

	it('coupe un bloc de code de 10 000 caractères par lignes, clôtures rouvertes', () => {
		const code = Array.from({ length: 400 }, (_, i) => `const v${i} = ${i};  // ${'c'.repeat(8)}`);
		const brut = '```ts\n' + code.join('\n') + '\n```';
		expect(brut.length).toBeGreaterThan(TAILLE_BLOC_MAX);
		const ps = decouper(`# C\n\n${brut}\n`, ctx);
		const codes = ps.filter((p) => p.texte.includes('const v'));
		expect(codes.length).toBeGreaterThan(1);
		for (const p of codes) {
			expect(p.texte.length).toBeLessThanOrEqual(TAILLE_MAX);
			expect(p.texte).toMatch(/```ts\n/u);
			expect(p.texte.trimEnd().endsWith('```')).toBe(true);
		}
		expect(codes.flatMap((p) => p.texte.split('\n')).filter((l) => l.startsWith('const'))).toEqual(code);
	});

	it('garde entier un bloc de code entre 2 000 et 8 000 caractères', () => {
		const code = '```\n' + Array.from({ length: 150 }, (_, i) => `ligne ${i} ${'x'.repeat(20)}`).join('\n') + '\n```';
		expect(code.length).toBeGreaterThan(TAILLE_MAX);
		const ps = decouper(`# C\n\n${code}\n`, ctx);
		expect(ps.filter((p) => p.texte.includes(code))).toHaveLength(1);
	});

	it('un # dans un bloc de code n’est pas un titre', () => {
		const ps = decouper('# A\n\n```sh\n# commentaire\necho 1\n```\n', ctx);
		expect(ps).toHaveLength(1);
		expect(ps[0]!.titres).toEqual(['A']);
	});

	it('coupe un paragraphe géant sans dépasser TAILLE_MAX', () => {
		const ps = decouper(para(3000, 'g'), ctx);
		for (const p of ps) expect(p.texte.length).toBeLessThanOrEqual(TAILLE_MAX);
		expect(ps.length).toBeGreaterThan(3);
	});
});

describe('decouper : section, préfixe, ancres', () => {
	it('section = titre le plus bas avec son corps jusqu’au titre de même niveau ou supérieur', () => {
		const md = `# A\n\nintro\n\n## B\n\ncorps b\n\n### C\n\ncorps c\n\n## D\n\ncorps d\n`;
		const ps = decouper(md, ctx);
		const b = ps.find((p) => p.titres.join('/') === 'A/B')!;
		expect(b.section).toContain('## B');
		expect(b.section).toContain('corps c');
		expect(b.section).not.toContain('corps d');
		expect(b.section).not.toContain('intro');
	});

	it('section bornée à 8 000 caractères', () => {
		const md = '# A\n\n' + Array.from({ length: 30 }, (_, i) => para(120, `s${i}`)).join('\n\n');
		const ps = decouper(md, ctx);
		for (const p of ps) expect(p.section.length).toBeLessThanOrEqual(TAILLE_BLOC_MAX);
		expect(ps[0]!.section.length).toBe(TAILLE_BLOC_MAX);
	});

	it('préfixe : titre, titres, date, auteur, fiche ; nuls omis ; hors ancre', () => {
		const [p] = decouper('# A\n\n## B\n\ntexte\n', ctx);
		expect(p!.prefixe).toBe('Rapport › A › B — 2026-03-01 — Ada — sources/rapport.md');
		const [q] = decouper('texte', { ...ctx, date: null, auteur: null });
		expect(q!.prefixe).toBe('Rapport — sources/rapport.md');
		const [r] = decouper('# A\n\ntexte', ctx);
		const [s] = decouper('# A\n\ntexte', { ...ctx, auteur: 'Bob' });
		expect(r!.ancre).toBe(s!.ancre);
	});

	it('ancre p-xxxxxxxx stable, sensible au texte, insensible aux espaces', () => {
		const a = decouper('# A\n\nbonjour le monde\n', ctx)[0]!;
		const b = decouper('# A\n\nbonjour le monde\n', ctx)[0]!;
		const c = decouper('# A\n\nbonjour  le monde.\n', ctx)[0]!;
		const d = decouper('# A\n\nbonjour   le\nmonde\n', ctx)[0]!;
		expect(a.ancre).toMatch(/^p-[0-9a-f]{8}$/u);
		expect(a.ancre).toBe(b.ancre);
		expect(a.ancre).not.toBe(c.ancre);
		expect(a.ancre).toBe(d.ancre);
	});

	it('doublon exact de texte : ~1', () => {
		const t = 'x'.repeat(1500);
		const ps = decouper(`${t}\n\n${t}\n`, ctx);
		expect(ps).toHaveLength(2);
		expect(ps[1]!.ancre).toBe(`${ps[0]!.ancre}~1`);
		const trois = decouper(`${t}\n\n${t}\n\n${t}\n`, ctx);
		expect(trois.map((p) => p.ancre.split('~')[1])).toEqual([undefined, '1', '2']);
	});
});

describe('decouper : pages et secrets', () => {
	it('page du premier caractère du passage ; null sans pages', () => {
		const p1 = 'a'.repeat(1500);
		const p2 = 'b'.repeat(1500);
		const md = `${p1}\n\n${p2}\n`;
		const ps = decouper(md, ctx, [0, p1.length + 2]);
		expect(ps.map((p) => p.page)).toEqual([1, 2]);
		expect(decouper(md, ctx).map((p) => p.page)).toEqual([null, null]);
	});

	it('masque les secrets avant de couper et garde les pages justes', () => {
		const secret = 'sk-' + 'a'.repeat(300);
		const p1 = `clé ${secret} fin\n\n${'a '.repeat(700)}`;
		const p2 = 'suite ' + 'b '.repeat(700);
		const md = `${p1}\n\n${p2}\n`;
		const ps = decouper(md, ctx, [0, p1.length + 2]);
		expect(ps.map((p) => p.texte).join('')).not.toContain('sk-');
		expect(ps[0]!.texte).toContain('[secret masqué]');
		expect(ps[ps.length - 1]!.page).toBe(2);
		expect(ps[0]!.page).toBe(1);
	});

	it('reste linéaire sur de gros documents (temps de 2n / temps de n < 3, médiane de 3)', () => {
		const cas: [string, (n: number) => string, number][] = [
			['titres', (n) => '# t\n'.repeat(n), 125_000],
			['bloc de code', (n) => '```\n' + 'x\n'.repeat(n) + '```\n', 250_000],
			['liste', (n) => '- a\n'.repeat(n), 100_000],
			['tableau', (n) => '| a |\n'.repeat(n), 75_000],
			['paragraphe', (n) => '# t\n\n' + 'mot '.repeat(n), 125_000],
		];
		for (const [nom, entree, n] of cas) {
			const { rapport, ms2n } = croissance(entree, (md) => decouper(md, ctx), n);
			expect(rapport, nom).toBeLessThan(3);
			expect(ms2n, nom).toBeLessThan(borne(1000));
		}
	}, 60_000);
});
