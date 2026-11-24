import { describe, expect, it } from 'vitest';
import { elementsDeFiche, estExpire } from '../../src/domaine/elements.ts';

const FICHE = `---
id: 01ABC
type: sujet
alias: [Stocks, Inventaire]
updated: 2026-05-01
---
# Stocks

Gestion des stocks.

## Faits
- [montant] Le plafond est de 500 € | src: utilisateur le 3 mai | appris 2026-05-03 | confiance 80 % ^f-0031
  > « 500 euros maximum »
- ~~Ancien entrepôt à Lyon~~ | src: [[sources/compte-rendu]] ^f-0032
- Livraison le lundi | a confirmer | valide [,2026-12-31] ^f-0033

## Relations
- concerne [[clients/c/x]]
`;

describe('elementsDeFiche', () => {
	const r = elementsDeFiche('projets/p/stocks.md', FICHE);
	it('produit une fiche et un élément par fait', () => {
		expect(r.elements.map((e) => e.genre)).toEqual(['fiche', 'fait', 'fait', 'fait', 'passage']);
		expect(r.elements[4]!.id).toBe('projets/p/stocks.md#synthese');
		expect(r.alias).toEqual(['Stocks', 'Inventaire']);
		const [fiche, f1, f2, f3] = r.elements;
		expect(fiche!.id).toBe('projets/p/stocks.md');
		expect(fiche!.texte).toBe('Stocks\n\nGestion des stocks.');
		expect(fiche!.date).toBe('2026-05-01');
		expect(f1!.id).toBe('projets/p/stocks.md#^f-0031');
		expect(f1!.texte).toBe('Le plafond est de 500 €\n500 euros maximum');
		expect(f1!.categorie).toBe('montant');
		expect(f1!.confiance).toBe(0.8);
		expect(f1!.date).toBe('2026-05-03');
		expect(f1!.typeSource).toBe('utilisateur');
		expect(f1!.statut).toBe('servi');
		expect(f2!.statut).toBe('invalide');
		expect(f2!.typeSource).toBeNull();
		expect(f2!.source).toBe('[[sources/compte-rendu]]');
		expect(f3!.statut).toBe('a_confirmer');
		expect(f3!.valideFin).toBe('2026-12-31');
		expect(f3!.finIncluse).toBe(true);
	});
	it('humanise le contexte', () => {
		const c = elementsDeFiche('projets/verdure/transport/vente/catalogue.md', '# Catalogue\n');
		expect(c.elements[0]!.contexte).toBe('projets › verdure › transport › vente › Catalogue');
		expect(r.elements[0]!.contexte).toBe('projets › p › Stocks › Stocks › Inventaire');
	});
	it('extrait les liens normalisés', () => {
		expect(r.liens).toContainEqual({ de: 'projets/p/stocks.md', vers: 'clients/c/x.md', verbe: 'concerne' });
		expect(r.liens).toContainEqual({ de: 'projets/p/stocks.md', vers: 'sources/compte-rendu.md', verbe: null });
		const t = elementsDeFiche('a.md', '# A\n\nVoir [[x|libellé]], [[y#^f-1]], [[https://ex.com/z]].\n\n```\n[[code]]\n```\n');
		expect(t.liens.map((l) => l.vers)).toEqual(['x.md', 'y.md']);
	});
	it('lit une consigne', () => {
		const c = elementsDeFiche('consignes/c.md', '---\ntype: consigne\nniveau: toujours\nportee: projet:p\nsource: utilisateur hier\nupdated: 2026-01-02\n---\n# C\n\nToujours tester.\n');
		expect(c.elements).toHaveLength(1);
		expect(c.elements[0]).toMatchObject({ genre: 'consigne', niveau: 'toujours', portee: 'projet:p', texte: 'Toujours tester.', typeSource: 'utilisateur', date: '2026-01-02' });
	});
	it('une consigne de portée mal écrite a la portée « invalide »', () => {
		for (const portee of ['projets:vela', 'projet', 'bizarre:x']) {
			const c = elementsDeFiche('consignes/c.md', `---\ntype: consigne\nniveau: toujours\nportee: ${portee}\nupdated: 2026-01-02\n---\n# C\n\nToujours tester.\n`);
			expect(c.elements[0]!.portee).toBe('invalide');
		}
	});
	it('donne le type de document d\'une fiche source, et le titre', () => {
		const source = (extra: string) => elementsDeFiche('sources/m.md', `---\ntype: source\n${extra}updated: 2026-01-02\n---\n# Mail\n`);
		expect(source('type_source: email\n').typeDocument).toBe('email');
		expect(source('type_source: bizarre\n').typeDocument).toBe('inconnue');
		expect(source('').typeDocument).toBe('inconnue');
		expect(r.typeDocument).toBeNull();
		expect(r.titre).toBe('Stocks');
		expect(elementsDeFiche('d/mon fichier.md', '---\nnon terminé').titre).toBe('mon fichier');
	});
	it('ne lève pas pour une fiche illisible', () => {
		for (const texte of ['\u0000\u0001�� binaire', '---\ntype: inconnu\n---\n# X\n', '---\nnon terminé']) {
			const r = elementsDeFiche('dossier/mon fichier.md', texte);
			// un texte sans frontmatter se lit (sa synthèse donne un passage) : seul compte qu'il n'y ait qu'une fiche, sans fait
			expect(r.elements.filter((e) => e.genre !== 'passage')).toHaveLength(1);
			expect(r.elements[0]!.genre).toBe('fiche');
		}
		expect(elementsDeFiche('d/mon fichier.md', '\u0000\u0001 binaire').elements[0]!.texte).toContain('mon fichier');
	});
});

describe('identifiants des faits', () => {
	const ids = (t: string) => elementsDeFiche('a.md', t).elements.filter((e) => e.genre === 'fait').map((e) => e.id);
	it('fait sans ancre : empreinte de l\'énoncé, stable si l\'ordre change', () => {
		const [x, y] = ids('# A\n\n## Faits\n- Un\n- Deux\n');
		expect(x).toMatch(/^a\.md#~[0-9a-f]{8}$/u);
		expect(x).not.toBe(y);
		expect(ids('# A\n\n## Faits\n- Zéro\n- Un\n- Deux\n').slice(1)).toEqual([x, y]);
	});
	it('même énoncé sans ancre : suffixe ~2', () => {
		const [x, y] = ids('# A\n\n## Faits\n- Un\n- Un\n');
		expect(y).toBe(`${x}~2`);
	});
	it('ancre dupliquée : suffixe ~2', () => {
		expect(ids('# A\n\n## Faits\n- Un ^f-0001\n- Deux ^f-0001\n')).toEqual(['a.md#^f-0001', 'a.md#^f-0001~2']);
	});
	it('fiche lisible sans titre : nom du fichier', () => {
		expect(elementsDeFiche('d/mon fichier.md', 'Juste un texte.\n').elements[0]!.texte).toBe('mon fichier\n\nJuste un texte.');
	});
});

describe('portée déclarée par une fiche', () => {
	const avec = (portee: string, type = 'dossier') => `---\nid: 01ABC\ntype: ${type}\nportee: ${portee}\nupdated: 2026-05-01\n---\n# Lumen\n`;
	it('l\'élément fiche porte la portée nommée déclarée par sa clé « portee »', () => {
		expect(elementsDeFiche('travail/lumen/lumen.md', avec('projet:Lumen')).elements[0]!.portee).toBe('projet:Lumen');
		expect(elementsDeFiche('travail/acme.md', avec('client:Acme', 'entite')).elements[0]!.portee).toBe('client:Acme');
	});
	it('absente, globale ou mal écrite : aucune', () => {
		expect(elementsDeFiche('a/a.md', FICHE).elements[0]!.portee).toBeNull();
		expect(elementsDeFiche('a/a.md', avec('globale')).elements[0]!.portee).toBeNull();
		expect(elementsDeFiche('a/a.md', avec('equipe:x')).elements[0]!.portee).toBeNull();
	});
});

describe('estExpire', () => {
	const jour = '2026-11-22';
	it('fin exclusive « ) » : expiré dès le jour de fin ; inclusive « ] » : le lendemain', () => {
		expect(estExpire({ valideFin: '2026-11-22', finIncluse: false }, jour)).toBe(true);
		expect(estExpire({ valideFin: '2026-11-23', finIncluse: false }, jour)).toBe(false);
		expect(estExpire({ valideFin: '2026-11-22', finIncluse: true }, jour)).toBe(false);
		expect(estExpire({ valideFin: '2026-11-21', finIncluse: true }, jour)).toBe(true);
	});
	it('sans fin (ou fin illisible) : jamais expiré', () => {
		expect(estExpire({ valideFin: null, finIncluse: false }, jour)).toBe(false);
		expect(estExpire({ valideFin: 'bientôt', finIncluse: false }, jour)).toBe(false);
	});
});

describe('information corroborée', () => {
	const texte = FICHE.replace(
		'  > « 500 euros maximum »\n',
		'  > « 500 euros maximum »\n  + src: [[sources/devis]] | corroboré 2026-11-24\n  > « plafond de cinq cents euros »\n  + src: [[sources/mail-achats]] | corroboré 2026-11-25\n',
	);
	const r = elementsDeFiche('projets/p/stocks.md', texte);

	it('cherche aussi les citations de ses corroborations, la première source restant la source de l\'élément', () => {
		const f1 = r.elements[1]!;
		expect(f1.texte).toBe('Le plafond est de 500 €\n500 euros maximum\nplafond de cinq cents euros');
		expect(f1.source).toBe('utilisateur le 3 mai');
	});

	it('lie la fiche aux sources de ses corroborations', () => {
		expect(r.liens).toContainEqual({ de: 'projets/p/stocks.md', vers: 'sources/devis.md', verbe: null });
		expect(r.liens).toContainEqual({ de: 'projets/p/stocks.md', vers: 'sources/mail-achats.md', verbe: null });
	});
});
