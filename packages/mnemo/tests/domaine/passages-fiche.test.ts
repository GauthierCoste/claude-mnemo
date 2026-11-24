import { describe, expect, it } from 'vitest';
import { elementsDeFiche } from '../../src/domaine/elements.ts';
import { lireFiche } from '../../src/domaine/fiche.ts';
import { ANCRE_SYNTHESE, ancreDeSection, passagesDeFiche } from '../../src/domaine/passages-fiche.ts';
import { LIGNE_CONTEXTE_MAX, ligneDeContexte, TAILLE_BLOC_MAX } from '../../src/domaine/passages.ts';

const FICHE = `---
id: 01ABC
type: sujet
updated: 2026-05-01
---
# Stocks

Gestion des stocks de l'entrepôt.

## Informations
- [montant] Le plafond est de 500 € | src: utilisateur ^f-0001

## Notes importées
Le transporteur Ravel passe le mardi.

## Conventions de l'équipe
Les inventaires tournants se font par allée.

### Détail
Allée B d'abord.

## Relations
- concerne [[clients/c/x]]
`;

describe('passagesDeFiche', () => {
	const fiche = lireFiche('projets/p/stocks.md', FICHE);
	const passages = passagesDeFiche(fiche);

	it('découpe les seuls textes libres (synthèse, sections), jamais les informations ni les relations', () => {
		// Un sous-titre ouvre un passage, comme dans un document : son ancre est le titre le plus profond.
		expect(passages.map((p) => p.ancre)).toEqual(['synthese', 'notes-importees', 'conventions-de-l-equipe', 'detail']);
		expect(passages[3]!.titres).toEqual(["Conventions de l'équipe", 'Détail']);
		const tout = passages.map((p) => p.texte).join('\n');
		expect(tout).toContain("Gestion des stocks de l'entrepôt.");
		expect(tout).toContain('Ravel passe le mardi');
		expect(tout).toContain('Allée B');
		expect(tout).not.toContain('plafond');
		expect(tout).not.toContain('concerne');
	});

	it('préfixe de contexte stable : titre › titres, sans date ni référence (une écriture change `updated`)', () => {
		expect(passages[0]!.prefixe).toBe('Stocks');
		expect(passages[1]!.prefixe).toBe('Stocks › Notes importées');
		expect(passages[3]!.prefixe).toBe("Stocks › Conventions de l'équipe › Détail");
		expect(passages[1]!.titres).toEqual(['Notes importées']);
	});

	it('seul `updated` change : passages identiques (ancres, préfixes, textes)', () => {
		const autreJour = lireFiche('projets/p/stocks.md', FICHE.replace('updated: 2026-05-01', 'updated: 2026-11-22'));
		expect(passagesDeFiche(autreJour)).toEqual(passages);
	});

	it('ancres lisibles : titre de section sans accents ni ponctuation ; synthèse : #synthese', () => {
		expect(ANCRE_SYNTHESE).toBe('synthese');
		expect(ancreDeSection("Conventions de l'équipe")).toBe('conventions-de-l-equipe');
		expect(ancreDeSection('  CLAUDE.md — Règles  ')).toBe('claude-md-regles');
		expect(ancreDeSection('!!!')).toBe('section');
	});

	const long = (n: number) => Array.from({ length: n }, (_, i) => `Paragraphe ${i} : ${'mot '.repeat(40 + (i % 7) * 9)}fin ${i}.`).join('\n\n');

	it('plusieurs passages sous un même titre : ancre départagée par un court hachage du contenu, jamais par un rang', () => {
		const f = lireFiche('a.md', `# A\n\n## Notes\n${long(40)}\n\n## Notes\nAutre.\n`);
		const ancres = passagesDeFiche(f).map((p) => p.ancre);
		expect(ancres.length).toBeGreaterThan(3);
		for (const a of ancres) expect(a).toMatch(/^notes~[0-9a-f]{6}$/u);
		expect(new Set(ancres).size).toBe(ancres.length);
	});

	it('deux passages au même texte sous un même titre : ancres distinctes', () => {
		const f = lireFiche('a.md', '# A\n\n## Notes\nMême texte.\n\n## Notes\nMême texte.\n');
		const ancres = passagesDeFiche(f).map((p) => p.ancre);
		expect(ancres).toHaveLength(2);
		expect(ancres[0]).toMatch(/^notes~[0-9a-f]{6}$/u);
		expect(ancres[1]).toBe(`${ancres[0]}-2`);
	});

	it('un paragraphe inséré en tête d\'une longue section ne change que le passage touché', () => {
		const avant = passagesDeFiche(lireFiche('a.md', `# A\n\n## Notes\n${long(60)}\n`));
		const apres = passagesDeFiche(lireFiche('a.md', `# A\n\n## Notes\nNouveau paragraphe en tête.\n\n${long(60)}\n`));
		expect(avant.length).toBeGreaterThan(10);
		const cles = (ps: typeof avant) => new Set(ps.map((p) => `${p.ancre}|${p.prefixe}|${p.texte}`));
		const a = cles(avant);
		const b = cles(apres);
		expect([...a].filter((k) => !b.has(k))).toHaveLength(1);
		expect([...b].filter((k) => !a.has(k))).toHaveLength(1);
	});

	it('une section « Synthèse » ne prend pas l\'ancre de la synthèse', () => {
		const f = lireFiche('a.md', '# A\n\nIntro.\n\n## Synthèse\nRésumé final.\n');
		expect(passagesDeFiche(f).map((p) => p.ancre)).toEqual(['synthese', 'section-synthese']);
	});

	it('fiche `source` : la section « Contenu » (déjà des passages de document) est laissée aux documents', () => {
		const f = lireFiche('sources/n.md', '---\ntype: source\ntype_source: note\n---\n# N\n\nRésumé.\n\n## Contenu\n```\ntexte amorcé\n```\n');
		expect(passagesDeFiche(f).map((p) => p.ancre)).toEqual(['synthese']);
	});

	it('fiche de 200 Ko de texte libre : tout est couvert, en passages de taille bornée, sans erreur', () => {
		const paragraphes = Array.from({ length: 1000 }, (_, i) => `Paragraphe numéro ${i} jeton${i}x ${'texte libre '.repeat(15)}`);
		const corps = paragraphes.join('\n\n');
		expect(corps.length).toBeGreaterThan(200_000);
		const f = lireFiche('projets/p/claude.md', `# CLAUDE.md du projet\n\n## Contenu collé\n${corps}\n`);
		const ps = passagesDeFiche(f);
		expect(ps.length).toBeGreaterThan(80);
		expect(ps.length).toBeLessThan(400);
		for (const p of ps) expect(p.texte.length).toBeLessThanOrEqual(TAILLE_BLOC_MAX);
		const tout = ps.map((p) => p.texte).join('\n');
		for (let i = 0; i < 1000; i++) expect(tout).toContain(`jeton${i}x`);
	});
});

describe('elementsDeFiche : passages de fiche', () => {
	it('ajoute un élément `passage` par passage, cité chemin#ancre, après la fiche et ses informations', () => {
		const r = elementsDeFiche('projets/p/stocks.md', FICHE);
		expect(r.elements.map((e) => e.genre)).toEqual(['fiche', 'fait', 'passage', 'passage', 'passage', 'passage']);
		const notes = r.elements[3]!;
		expect(notes.id).toBe('projets/p/stocks.md#notes-importees');
		expect(notes.chemin).toBe('projets/p/stocks.md');
		expect(notes.typeFiche).toBe('sujet');
		expect(notes.texte).toContain('Ravel');
		expect(notes.contexte).toBe('Stocks › Notes importées');
		expect(notes.statut).toBe('servi');
		expect(notes.date).toBe('2026-05-01');
	});

	it("une consigne n'a pas de passages (son texte est l'élément consigne)", () => {
		const c = elementsDeFiche('consignes/c.md', '---\ntype: consigne\nniveau: toujours\nportee: globale\n---\n# C\n\nToujours tester.\n\n## Pourquoi\nParce que.\n');
		expect(c.elements.map((e) => e.genre)).toEqual(['consigne']);
	});
});

describe('ligne de contexte (préfixe indexé, jamais servi)', () => {
	it('ligneDeContexte : premières lignes utiles, sans titres ni clôtures de code, secrets masqués, 300 caractères au plus', () => {
		expect(ligneDeContexte('# Titre\n\n```\nReprise de l’extranet.\n```\nSuite du texte.')).toBe('Reprise de l’extranet. Suite du texte.');
		expect(ligneDeContexte('Clé : sk-abcdefghijklmnopqrstuvwxyz0123')).toBe('Clé : [secret masqué]');
		const longue = ligneDeContexte(`${'mot '.repeat(200)}fin`);
		expect([...longue].length).toBeLessThanOrEqual(LIGNE_CONTEXTE_MAX);
		expect(longue.endsWith('…')).toBe(true);
		expect(ligneDeContexte('## Seulement un titre\n\n---\n')).toBe('');
	});

	it('un passage de section porte la synthèse de sa fiche ; un passage de la synthèse, aucune', () => {
		const passages = passagesDeFiche(lireFiche('a.md', FICHE));
		expect(passages.find((p) => p.ancre === ANCRE_SYNTHESE)!.ligneContexte).toBe('');
		for (const p of passages.filter((x) => x.ancre !== ANCRE_SYNTHESE)) expect(p.ligneContexte, p.ancre).toBe("Gestion des stocks de l'entrepôt.");
		const element = elementsDeFiche('a.md', FICHE).elements.find((e) => e.id === 'a.md#notes-importees')!;
		expect(element.ligneContexte).toBe("Gestion des stocks de l'entrepôt.");
		// le contexte servi ne change pas
		expect(element.contexte).toBe('Stocks › Notes importées');
	});

	it('synthèse longue ou porteuse de secret : masquée et coupée', () => {
		const fiche = FICHE.replace("Gestion des stocks de l'entrepôt.", `Mot de passe sk-abcdefghijklmnopqrstuvwxyz0123 ${'x'.repeat(400)}`);
		const ligne = passagesDeFiche(lireFiche('a.md', fiche)).find((p) => p.ancre !== ANCRE_SYNTHESE)!.ligneContexte;
		expect(ligne).toContain('[secret masqué]');
		expect(ligne).not.toContain('sk-abc');
		expect([...ligne].length).toBeLessThanOrEqual(LIGNE_CONTEXTE_MAX);
	});
});

describe('information corroborée', () => {
	it('ses lignes de corroboration appartiennent à l\'information : aucune ne devient un passage', () => {
		const texte = FICHE.replace(
			'^f-0001\n',
			'^f-0001\n  > « cinq cents »\n  + src: [[sources/b]] | corroboré 2026-11-24\n  > « 500 € au plus »\n  + src: [[sources/c]] | corroboré 2026-11-25\n',
		);
		const fiche = lireFiche('projets/p/stocks.md', texte);
		expect(passagesDeFiche(fiche)).toEqual(passagesDeFiche(lireFiche('projets/p/stocks.md', FICHE)));
	});
});
