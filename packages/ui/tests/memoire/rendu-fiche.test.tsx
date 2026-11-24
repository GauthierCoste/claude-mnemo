// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FournisseurToast } from '../../src/composants/Toast.tsx';
import { analyserCorps, CorpsFiche, rendreEnLigne } from '../../src/memoire/rendu-fiche.tsx';

afterEach(cleanup);

/** La fiche exemple du format (sans frontmatter : c'est le `corps`). */
const EXEMPLE = `# Module stocks

Synthèse : périmètre, échéances et décisions du module stocks.

## Informations
- [delai] Livraison du module stocks au 15/12/2026. | observe | src: [[sources/cdc-stocks-v3]] p.12 | appris 2026-11-20 | valide [2026-11-20,) | confiance 80 % ^f-0031
  > « La livraison du module stocks est fixée au 15 décembre 2026, recette incluse. »
- [regle] ~~Les inventaires se font le lundi.~~ | observe | src: [[sources/fil-inventaires]] 2026-09-02 | invalidé 2026-10-14 par ^f-0040 ^f-0018

## Relations
- concerne [[clients/<client>/<projet>]]
`;

describe('analyserCorps', () => {
	it('fiche exemple du format : titre sauté, catégorie, segments meta, ancre, citation, fait barré', () => {
		expect(analyserCorps(EXEMPLE)).toEqual([
			{ genre: 'paragraphe', texte: 'Synthèse : périmètre, échéances et décisions du module stocks.' },
			{ genre: 'titre2', texte: 'Informations' },
			{
				genre: 'puce',
				texte: 'Livraison du module stocks au 15/12/2026.',
				categorie: 'delai',
				meta: ['observe', 'src: [[sources/cdc-stocks-v3]] p.12', 'appris 2026-11-20', 'valide [2026-11-20,)', 'confiance 80 %'],
				barre: false,
				ancre: 'f-0031',
			},
			{ genre: 'citation', texte: '« La livraison du module stocks est fixée au 15 décembre 2026, recette incluse. »' },
			{
				genre: 'puce',
				texte: 'Les inventaires se font le lundi.',
				categorie: 'regle',
				meta: ['observe', 'src: [[sources/fil-inventaires]] 2026-09-02', 'invalidé 2026-10-14 par ^f-0040'],
				barre: true,
				ancre: 'f-0018',
			},
			{ genre: 'titre2', texte: 'Relations' },
			{ genre: 'puce', texte: 'concerne [[clients/<client>/<projet>]]', categorie: null, meta: [], barre: false, ancre: null },
		]);
	});

	it('seul le titre de la fiche (première ligne non vide en « # ») est sauté ; les autres « # » s’affichent comme titres', () => {
		expect(analyserCorps('\n# Note importée\n\n# Contexte\nTexte.\n# Décisions\n- Une')).toEqual([
			{ genre: 'titre2', texte: 'Contexte' },
			{ genre: 'paragraphe', texte: 'Texte.' },
			{ genre: 'titre2', texte: 'Décisions' },
			{ genre: 'puce', texte: 'Une', categorie: null, meta: [], barre: false, ancre: null },
		]);
		// sans titre en tête (le service n'en lit pas), un « # » tardif reste affiché
		expect(analyserCorps('Avant.\n# Contexte')).toEqual([
			{ genre: 'paragraphe', texte: 'Avant.' },
			{ genre: 'titre2', texte: 'Contexte' },
		]);
	});

	it('bloc de code : un seul bloc, retraits et lignes vides gardés ; liste numérotée : une liste, son premier numéro', () => {
		expect(analyserCorps('# T\n```sh\n  pnpm test\n\n  pnpm verifier\n```\n3. Un\n4. Deux\n\n5) Trois\nFin.\n1. Autre')).toEqual([
			{ genre: 'code', texte: '  pnpm test\n\n  pnpm verifier' },
			{ genre: 'liste', debut: 3, items: ['Un', 'Deux', 'Trois'] },
			{ genre: 'paragraphe', texte: 'Fin.' },
			{ genre: 'liste', debut: 1, items: ['Autre'] },
		]);
	});

	it('rendu : le bloc de code dans un <pre>, la liste numérotée dans un <ol> qui part de son premier numéro', () => {
		const { container } = render(
			<FournisseurToast>
				<CorpsFiche corps={'```\n  a\n    b\n```\n2. x\n3. y'} liens={{ sortants: [], entrants: [] }} ouvrir={() => {}} />
			</FournisseurToast>,
		);
		expect(container.querySelector('pre')?.textContent).toBe('  a\n    b');
		const ol = container.querySelector('ol')!;
		expect(ol.getAttribute('start')).toBe('2');
		expect([...ol.querySelectorAll('li')].map((li) => li.textContent)).toEqual(['x', 'y']);
	});

	it('hors de « ## Informations », une puce reste entière (ni catégorie, ni segments, ni ancre)', () => {
		expect(analyserCorps('## Notes\n- [x] a | b ^f-0001')).toEqual([
			{ genre: 'titre2', texte: 'Notes' },
			{ genre: 'puce', texte: '[x] a | b ^f-0001', categorie: null, meta: [], barre: false, ancre: null },
		]);
	});

	it('« | » sans espaces (lien avec alias) ne coupe pas le fait', () => {
		const [, puce] = analyserCorps('## Informations\n- [role] Voir [[personnes/Marc|Marc]] demain. | declare ^f-0002');
		expect(puce).toMatchObject({ texte: 'Voir [[personnes/Marc|Marc]] demain.', meta: ['declare'], ancre: 'f-0002' });
	});
});

const CIBLES: Record<string, string> = { 'Module stocks': 'projets/erp-saas/Module stocks.md' };
const cibles = (ecrit: string) => CIBLES[ecrit] ?? null;

function rendreLigne(texte: string, ouvrir = vi.fn()) {
	const r = render(
		<FournisseurToast>
			<p data-testid="ligne">{rendreEnLigne(texte, cibles, ouvrir)}</p>
		</FournisseurToast>,
	);
	return { ...r, ouvrir, ligne: screen.getByTestId('ligne') };
}

describe('rendreEnLigne', () => {
	it('[[Module stocks]] résolu → lien `.wl` qui ouvre la fiche', () => {
		const { ouvrir } = rendreLigne('suit [[Module stocks]].');
		const lien = screen.getByRole('button', { name: 'Module stocks' });
		expect(lien.className).toContain('wl');
		expect(lien.className.split(' ')).not.toContain('x');
		fireEvent.click(lien);
		expect(ouvrir).toHaveBeenCalledWith('projets/erp-saas/Module stocks.md');
	});

	it('[[Absente]] non résolu → `.wl.x`, clic → toast « Fiche « Absente » absente »', () => {
		vi.useFakeTimers();
		try {
			const { ouvrir } = rendreLigne('voir [[Absente]]');
			const lien = screen.getByRole('button', { name: 'Absente' });
			expect(lien.className.split(' ')).toEqual(expect.arrayContaining(['wl', 'x']));
			act(() => fireEvent.click(lien));
			expect(ouvrir).not.toHaveBeenCalled();
			expect(screen.getByRole('status').textContent).toBe('Fiche « Absente » absente');
		} finally {
			vi.useRealTimers();
		}
	});

	it('[[cible|alias]] affiche l’alias ; la cible écrite entière est résolue', () => {
		const ouvrir = vi.fn();
		render(<p>{rendreEnLigne('[[Module stocks|le module]]', (e) => (e === 'Module stocks|le module' ? 'm.md' : null), ouvrir)}</p>);
		fireEvent.click(screen.getByRole('button', { name: 'le module' }));
		expect(ouvrir).toHaveBeenCalledWith('m.md');
	});

	it('`à confirmer` → puce d’avertissement ; `déclaré` → puce verte ; autre code → puce neutre', () => {
		const { ligne } = rendreLigne('a `à confirmer` b `déclaré` c `p. 4`');
		const puces = [...ligne.querySelectorAll('span')];
		expect(puces.map((p) => p.textContent)).toEqual(['à confirmer', 'déclaré', 'p. 4']);
		expect(puces[0]!.className).toContain('avertissement');
		expect(puces[1]!.className).toContain('succes');
		expect(puces[2]!.className).not.toMatch(/avertissement|succes/);
	});

	it('~~barré~~ → élément barré, liens compris', () => {
		const { ligne } = rendreLigne('~~ancien [[Module stocks]]~~ nouveau');
		const barre = ligne.querySelector('s')!;
		expect(barre.textContent).toBe('ancien Module stocks');
		expect(barre.querySelector('button')).not.toBeNull();
		expect(ligne.textContent).toBe('ancien Module stocks nouveau');
	});
});

describe('contenu hostile (la mémoire est une donnée)', () => {
	const HOSTILE = `# Piège

<img src=x onerror=alert(1)>

## Faits
- [regle] <script>alert(1)</script> | declare | src: [[<b>x</b>]] ^f-0001
  > <img src=y onerror=alert(2)>
- [[<b>x</b>]] et \`<b>code</b>\` et ~~<script>z</script>~~
`;

	it('aucun élément img, script ni b créé ; le texte est affiché tel quel', () => {
		const ouvrir = vi.fn();
		const { container } = render(
			<FournisseurToast>
				<CorpsFiche corps={HOSTILE} liens={{ sortants: [{ ecrit: '<b>x</b>', chemin: null, verbe: null }], entrants: [] }} ouvrir={ouvrir} />
			</FournisseurToast>,
		);
		expect(container.querySelectorAll('img, script, b')).toHaveLength(0);
		const texte = container.textContent ?? '';
		expect(texte).toContain('<img src=x onerror=alert(1)>');
		expect(texte).toContain('<script>alert(1)</script>');
		expect(texte).toContain('<img src=y onerror=alert(2)>');
		expect(texte).toContain('<b>code</b>');
		expect(texte).toContain('<script>z</script>');
		expect(screen.getAllByRole('button', { name: '<b>x</b>' }).length).toBe(2);
	});

	it('liens piégés et HTML brut : aucun lien, cadre ni gestionnaire d’événement créé ; le texte reste lisible', () => {
		const PIEGES = `# Liens

Voir [x](javascript:alert(1)) et [y](data:text/html,<script>alert(2)</script>) et <https://exemple.fr>.
<a href="javascript:alert(3)" onclick="alert(4)">clic</a>
<iframe src="https://evil.example"></iframe><svg onload=alert(5)></svg><form action="https://evil.example"><button>Envoyer</button></form>
<style>body{display:none}</style><meta http-equiv="refresh" content="0;url=https://evil.example">

## Informations
- [regle] [[javascript:alert(6)]] et [z](vbscript:msgbox) | declare ^f-0001
`;
		const ouvrir = vi.fn();
		const { container } = render(
			<FournisseurToast>
				<CorpsFiche corps={PIEGES} liens={{ sortants: [{ ecrit: 'javascript:alert(6)', chemin: null, verbe: null }], entrants: [] }} ouvrir={ouvrir} />
			</FournisseurToast>,
		);
		expect(container.querySelectorAll('a, iframe, svg, form, style, meta, script, img, object, embed')).toHaveLength(0);
		expect(container.querySelectorAll('[href], [src], [action], [srcdoc]')).toHaveLength(0);
		const gestionnaires = [...container.querySelectorAll('*')].flatMap((e) => [...e.attributes].map((a) => a.name)).filter((n) => n.startsWith('on'));
		expect(gestionnaires).toEqual([]);
		const texte = container.textContent ?? '';
		expect(texte).toContain('[x](javascript:alert(1))');
		expect(texte).toContain('<a href="javascript:alert(3)" onclick="alert(4)">clic</a>');
		expect(texte).toContain('<iframe src="https://evil.example"></iframe>');
		// un lien de fiche n'est jamais une adresse : un clic cherche une fiche, ne navigue nulle part
		fireEvent.click(screen.getByRole('button', { name: 'javascript:alert(6)' }));
		expect(ouvrir).not.toHaveBeenCalled();
	});

	it('aucun puits à HTML ni à adresse dans le code de l’interface (innerHTML, href, src, eval, javascript:…)', () => {
		const SRC = join(import.meta.dirname, '..', '..', 'src');
		const fichiers = (d: string): string[] => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? fichiers(join(d, n)) : [join(d, n)]));
		const fautes = fichiers(SRC)
			.filter((f) => /\.(ts|tsx)$/.test(f))
			// HTML interprété, adresses posées à la main, code évalué, contenu de cadre : aucun, nulle part
			.filter((f) =>
				/dangerouslySetInnerHTML|\.innerHTML|\.outerHTML|insertAdjacentHTML|createContextualFragment|DOMParser|document\.write|srcdoc|\bhref\s*[=:]|\.src\s*=|\beval\(|new Function|javascript:/.test(
					readFileSync(f, 'utf8'),
				),
			)
			.map((f) => relative(SRC, f));
		expect(fautes).toEqual([]);
	});
});

describe('analyse linéaire (contenu hostile)', () => {
	const duree = (f: () => void) => {
		const debut = performance.now();
		f();
		return performance.now() - debut;
	};
	for (const [nom, texte] of [
		['100 Ko de « [ »', '['.repeat(100_000)],
		['100 Ko de « [[a »', '[[a'.repeat(33_334)],
		['« ~~ » jamais refermé sur 100 Ko', `~~${'a~'.repeat(50_000)}`],
		['« ` » jamais refermé sur 100 Ko', `\`${'a'.repeat(100_000)}`],
	] as const) {
		it(`${nom} : rendreEnLigne et analyserCorps en moins de 100 ms`, () => {
			expect(duree(() => rendreEnLigne(texte, () => null, () => {}))).toBeLessThan(100);
			expect(duree(() => analyserCorps(`## Faits\n- [x] ${texte} | declare ^f-0001\n${texte}`))).toBeLessThan(100);
		});
	}
});

describe('texte bidirectionnel isolé', () => {
	it('U+202E dans un lien et une puce : le texte est dans un <bdi>', () => {
		const { container } = render(<p>{rendreEnLigne('[[abc\u202Edef]] `x\u202Ey`', () => 'a.md', () => {})}</p>);
		const bdis = [...container.querySelectorAll('bdi')].map((b) => b.textContent);
		expect(bdis).toEqual(['abc\u202Edef', 'x\u202Ey']);
	});
});

describe('corroborations', () => {
	const corps = `# T

## Informations
- [delai] Livraison au 15/12/2026. | observe ^f-0001
  > « Citation. »
  + src: [[sources/mails]] 2026-11-05 | corroboré 2026-11-24
  > « Autre citation. »
  + src: session 7f3a | corroboré 2026-11-25
`;

	it('analyserCorps : une corroboration par ligne `+ src:`, sa citation derrière elle, jamais un paragraphe', () => {
		const lignes = analyserCorps(corps);
		expect(lignes.map((l) => l.genre)).toEqual(['titre2', 'puce', 'citation', 'corroboration', 'citation', 'corroboration']);
		expect(lignes[3]).toEqual({ genre: 'corroboration', source: '[[sources/mails]] 2026-11-05', le: '2026-11-24' });
		expect(lignes[5]).toEqual({ genre: 'corroboration', source: 'session 7f3a', le: '2026-11-25' });
	});

	it('CorpsFiche : source (lien résolu), date et citation sous l’information ; rien de « | corroboré » en texte brut', () => {
		const ouvrir = vi.fn();
		const liens = { sortants: [{ ecrit: 'sources/mails', chemin: 'sources/mails.md' }], entrants: [] } as unknown as Parameters<typeof CorpsFiche>[0]['liens'];
		const { container } = render(
			<FournisseurToast>
				<CorpsFiche corps={corps} liens={liens} ouvrir={ouvrir} />
			</FournisseurToast>,
		);
		const lignes = [...container.querySelectorAll('[data-genre="corroboration"]')];
		expect(lignes.map((l) => l.textContent)).toEqual(['src: sources/mails 2026-11-05corroboré 2026-11-24', 'src: session 7f3acorroboré 2026-11-25']);
		fireEvent.click(lignes[0]!.querySelector('button')!);
		expect(ouvrir).toHaveBeenCalledWith('sources/mails.md');
		expect([...container.querySelectorAll('blockquote')].map((b) => b.textContent)).toEqual(['« Citation. »', '« Autre citation. »']);
		expect(container.querySelector('p')).toBeNull();
	});
});

describe('CorpsFiche', () => {
	it('information : puce de catégorie, segments en puces (declare vert, a confirmer ambre), ancre masquée, citation, information barrée', () => {
		const corps = `# T

## Informations
- [delai] Livraison au 15/12/2026. | declare | a confirmer ^f-0031
  > « Citation. »
- [regle] ~~Ancien.~~ | observe ^f-0018
`;
		const { container } = render(<CorpsFiche corps={corps} liens={{ sortants: [], entrants: [] }} ouvrir={() => {}} />);
		expect(container.querySelector('h1')).toBeNull();
		expect(screen.getByRole('heading', { level: 3, name: 'Informations' })).toBeTruthy();
		// les barrées sont repliées par défaut : on les déplie
		fireEvent.click(container.querySelector('[data-groupe="[barrees]"] button')!);
		const [fait, barre] = [...container.querySelectorAll('[data-genre="puce"]')];
		const puces = [...fait!.querySelectorAll('span')].map((p) => [p.textContent, p.className]);
		expect(puces[0]![0]).toBe('delai');
		expect(puces.find(([t]) => t === 'déclaré')![1]).toContain('succes');
		expect(puces.find(([t]) => t === 'à confirmer')![1]).toContain('avertissement');
		expect(container.textContent).not.toContain('f-0031');
		expect(container.querySelector('blockquote')!.textContent).toBe('« Citation. »');
		expect(barre!.querySelector('s')!.textContent).toBe('Ancien.');
		expect(barre!.className).toContain('barre');
	});
});

describe('informations groupées par catégorie', () => {
	const CORPS = `# T

Synthèse.

## Informations
- [delai] Livraison au 15/12/2026. | declare ^f-0001
  > « Citation de la livraison. »
- [regle] Toute migration a un down(). | declare ^f-0002
- [delai] Recette le 10/12/2026. | observe ^f-0003
- Sans catégorie. | declare ^f-0004
- [delai] ~~Livraison au 01/12/2026.~~ | observe | invalidé 2026-11-02 par ^f-0001 ^f-0005

## Notes
- [x] une puce libre
`;
	const rendre = (corps = CORPS) => render(<CorpsFiche corps={corps} liens={{ sortants: [], entrants: [] }} ouvrir={() => {}} />);
	const groupes = (container: HTMLElement) =>
		[...container.querySelectorAll('[data-groupe]')].map((g) => ({
			titre: g.querySelector('button')!.textContent,
			ouvert: g.querySelector('button')!.getAttribute('aria-expanded') === 'true',
			elements: g.querySelectorAll('[data-genre="puce"]').length,
		}));

	it('un groupe par catégorie (titre = catégorie + nombre), dans l’ordre d’apparition ; les barrées à la fin, repliées', () => {
		const { container } = rendre();
		expect(groupes(container)).toEqual([
			{ titre: 'delai2', ouvert: true, elements: 2 },
			{ titre: 'regle1', ouvert: true, elements: 1 },
			{ titre: 'sans catégorie1', ouvert: true, elements: 1 },
			{ titre: 'retirées ou périmées1', ouvert: false, elements: 0 },
		]);
		// la citation suit son information, dans son groupe
		const delai = container.querySelector('[data-groupe="delai"]')!;
		expect(delai.querySelector('blockquote')!.textContent).toBe('« Citation de la livraison. »');
		// hors de la section des informations, rien n’est groupé
		expect(screen.getByText('[x] une puce libre')).toBeTruthy();
	});

	it('un groupe se replie et se déplie ; le groupe des barrées se déplie à la demande', () => {
		const { container } = rendre();
		const delai = container.querySelector('[data-groupe="delai"] button')!;
		fireEvent.click(delai);
		expect(groupes(container)[0]).toEqual({ titre: 'delai2', ouvert: false, elements: 0 });
		fireEvent.click(delai);
		expect(groupes(container)[0]!.elements).toBe(2);
		const barrees = container.querySelector('[data-groupe="[barrees]"] button')!;
		fireEvent.click(barrees);
		const ouvert = container.querySelector('[data-groupe="[barrees]"]')!;
		expect(ouvert.querySelector('s')!.textContent).toBe('Livraison au 01/12/2026.');
	});

	it('une catégorie nommée comme un groupe réservé reste un groupe à part', () => {
		const corps = CORPS.replace('[regle] Toute', '[barrees] Toute').replace('- Sans catégorie.', '- [sans-categorie] Avec catégorie.\n- Sans catégorie.');
		const { container } = rendre(corps);
		expect(groupes(container)).toEqual([
			{ titre: 'delai2', ouvert: true, elements: 2 },
			{ titre: 'barrees1', ouvert: true, elements: 1 },
			{ titre: 'sans-categorie1', ouvert: true, elements: 1 },
			{ titre: 'sans catégorie1', ouvert: true, elements: 1 },
			{ titre: 'retirées ou périmées1', ouvert: false, elements: 0 },
		]);
	});

	it("l'état replié suit la catégorie, pas la position : une nouvelle catégorie en tête ne le décale pas", () => {
		const vue = rendre();
		fireEvent.click(vue.container.querySelector('[data-groupe="delai"] button')!);
		const avecNouvelle = CORPS.replace('## Informations\n', '## Informations\n- [budget] Plafond de 500 €. | declare ^f-0006\n');
		vue.rerender(<CorpsFiche corps={avecNouvelle} liens={{ sortants: [], entrants: [] }} ouvrir={() => {}} />);
		expect(groupes(vue.container).map((g) => [g.titre, g.ouvert])).toEqual([
			['budget1', true],
			['delai2', false],
			['regle1', true],
			['sans catégorie1', true],
			['retirées ou périmées1', false],
		]);
	});

	it('« ## Faits » (ancien titre) : affiché « Informations », groupé de même', () => {
		const { container } = rendre(CORPS.replace('## Informations', '## Faits'));
		expect(screen.getByRole('heading', { level: 3, name: 'Informations' })).toBeTruthy();
		expect(groupes(container).map((g) => g.titre)).toEqual(['delai2', 'regle1', 'sans catégorie1', 'retirées ou périmées1']);
	});
});
