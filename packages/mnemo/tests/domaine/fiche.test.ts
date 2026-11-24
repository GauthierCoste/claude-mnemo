import { describe, expect, it } from 'vitest';
import { ecrireFiche, lireFiche, prochaineAncre } from '../../src/domaine/fiche.ts';

const EXEMPLE = `---
id: 01JD0000000000000000000000
type: sujet
alias: [CDC stocks]
updated: 2026-11-22
---
# Module stocks

Synthèse : périmètre, échéances et décisions du module stocks.

## Informations
- [delai] Livraison du module stocks au 15/12/2026. | observe | src: [[sources/cdc-stocks-v3]] p.12 | appris 2026-11-20 | valide [2026-11-20,) | confiance 80 % ^f-0031
  > « La livraison du module stocks est fixée au 15 décembre 2026, recette incluse. »
- [regle] ~~Les inventaires se font le lundi.~~ | observe | src: [[sources/fil-inventaires]] 2026-09-02 | invalidé 2026-10-14 par ^f-0040 ^f-0018

## Relations
- concerne [[clients/acme/portail]]
`;

describe('lireFiche / ecrireFiche', () => {
	it("lit et réécrit à l'identique la fiche d'exemple du format", () => {
		const fiche = lireFiche('projets/stocks/stocks.md', EXEMPLE);
		expect(fiche).toMatchObject({
			chemin: 'projets/stocks/stocks.md',
			id: '01JD0000000000000000000000',
			type: 'sujet',
			alias: ['CDC stocks'],
			updated: '2026-11-22',
			titre: 'Module stocks',
			synthese: 'Synthèse : périmètre, échéances et décisions du module stocks.',
			relations: [{ verbe: 'concerne', cible: 'clients/acme/portail' }],
		});
		expect(fiche.faits).toHaveLength(2);
		expect(ecrireFiche(fiche)).toBe(EXEMPLE);
	});

	it('conserve une ligne de fait illisible, octet pour octet et à sa place', () => {
		const texte = EXEMPLE.replace('\n\n## Relations', '\n- [regle] texte | mention inconnue\n  > « citation orpheline »\n- [x] Dernier fait. ^f-0050\n\n## Relations');
		const fiche = lireFiche('a.md', texte);
		expect(fiche.faits[2]).toEqual({ brute: ['- [regle] texte | mention inconnue', '  > « citation orpheline »'] });
		expect(ecrireFiche(fiche)).toBe(texte);
	});

	it('lit une fiche en CRLF et la réécrit en LF', () => {
		const fiche = lireFiche('a.md', EXEMPLE.replace(/\n/gu, '\r\n'));
		expect(fiche.faits).toHaveLength(2);
		expect(fiche.synthese).toBe('Synthèse : périmètre, échéances et décisions du module stocks.');
		const ecrit = ecrireFiche(fiche);
		expect(ecrit).not.toContain('\r');
		expect(ecrit).toBe(EXEMPLE);
	});

	it('conserve une section inconnue et les clés inconnues du frontmatter', () => {
		const texte = EXEMPLE
			.replace('updated: 2026-11-22\n', 'updated: 2026-11-22\nportee: projet\nniveau: toujours\n')
			+ '\n## Notes\nUne note libre.\n\n- puce\n';
		const fiche = lireFiche('a.md', texte);
		expect(fiche.donnees).toEqual({ portee: 'projet', niveau: 'toujours' });
		expect(fiche.autresSections).toEqual([{ titre: 'Notes', corps: 'Une note libre.\n\n- puce' }]);
		expect(ecrireFiche(fiche)).toBe(texte);
	});

	it("garde l'ordre d'origine des sections d'une fiche retouchée à la main", () => {
		const texte = '---\nid: x\ntype: sujet\nupdated: 2026-01-01\n---\n# T\n\n## Notes\nlibre\n\n## Informations\n- Un fait. ^f-0001\n';
		expect(ecrireFiche(lireFiche('a.md', texte))).toBe(texte);
	});

	it('ignore un faux titre de section dans un bloc de code', () => {
		const texte = '---\nid: x\ntype: sujet\nupdated: 2026-01-01\n---\n# T\n\n## Notes\n```\n## Informations\n```\n';
		const fiche = lireFiche('a.md', texte);
		expect(fiche.faits).toEqual([]);
		expect(ecrireFiche(fiche)).toBe(texte);
	});

	it('type par défaut sujet, sans frontmatter', () => {
		expect(lireFiche('a.md', '# Titre\n').type).toBe('sujet');
		expect(lireFiche('a.md', '---\nid: x\nupdated: 2026-01-01\n---\n# Titre\n').type).toBe('sujet');
	});

	it('lit un type libre ; refuse un type mal formé et un frontmatter invalide', () => {
		expect(lireFiche('a.md', '---\ntype: recette\n---\n# T\n').type).toBe('recette');
		expect(() => lireFiche('a.md', '---\ntype: Truc Bizarre\n---\n# T\n')).toThrow(/type de fiche mal formé/u);
		expect(() => lireFiche('a.md', '---\ntype: [\n---\n# T\n')).toThrow(/a\.md/u);
	});

	it("n'écrit pas une section absente et vide", () => {
		const fiche = lireFiche('a.md', '---\nid: x\ntype: sujet\nupdated: 2026-01-01\n---\n# T\n');
		expect(ecrireFiche(fiche)).toBe('---\nid: x\ntype: sujet\nupdated: 2026-01-01\n---\n# T\n');
		fiche.faits.push({ brute: ['- ?'] });
		expect(ecrireFiche(fiche)).toContain('\n\n## Informations\n- ?\n');
	});
});

describe('lignes retouchées à la main', () => {
	it('conserve une ligne de relation illisible, à sa place', () => {
		const texte = EXEMPLE.replace('- concerne [[clients/acme/portail]]\n', '- concerne [[clients/acme/portail]]\n- dépend de portail\n- suit [[a|b]]\n');
		const fiche = lireFiche('a.md', texte);
		expect(fiche.relations[1]).toEqual({ brute: '- dépend de portail' });
		expect(ecrireFiche(fiche)).toBe(texte);
	});

	it('conserve une ligne vide entre deux faits ou deux relations', () => {
		const texte = EXEMPLE
			.replace('^f-0031\n', '^f-0031\n\n')
			.replace('- concerne [[clients/acme/portail]]\n', '- concerne [[clients/acme/portail]]\n\n- suit [[autre]]\n');
		const fiche = lireFiche('a.md', texte);
		expect(ecrireFiche(fiche)).toBe(texte);
	});
});

describe('titre et préambule', () => {
	const SANS_TITRE = '---\nid: X\ntype: sujet\n---\nIntroduction libre.\n\n## Informations\n- Un fait. | declare ^f-0001\n\n## Notes\n```bash\n# installer les dépendances\npnpm install\n```\n';

	it('sans titre, un « # » dans un bloc de code ne devient pas le titre', () => {
		const fiche = lireFiche('a.md', SANS_TITRE);
		expect(fiche.titre).toBe('');
		expect(fiche.synthese).toBe('Introduction libre.');
		expect(fiche.faits).toHaveLength(1);
		expect(fiche.autresSections).toEqual([{ titre: 'Notes', corps: '```bash\n# installer les dépendances\npnpm install\n```' }]);
		expect(ecrireFiche(fiche)).toBe(SANS_TITRE);
	});

	it('le titre est la première ligne non vide du corps', () => {
		const fiche = lireFiche('a.md', '---\ntype: sujet\n---\n\n# Titre\n\nSynthèse.\n');
		expect(fiche.titre).toBe('Titre');
		expect(fiche.synthese).toBe('Synthèse.');
	});

	it('conserve le texte placé avant un titre tardif', () => {
		const texte = '---\ntype: sujet\n---\nPréambule écrit à la main.\n\n# Titre tardif\n\nSynthèse.\n\n## Informations\n- Un fait. ^f-0001\n';
		const fiche = lireFiche('a.md', texte);
		expect(fiche.titre).toBe('');
		expect(ecrireFiche(fiche)).toBe(texte);
		expect(ecrireFiche(fiche)).toContain('Préambule écrit à la main.');
	});
});

describe('prochaineAncre', () => {
	it('prend le maximum + 1 sur 4 chiffres', () => {
		const fiche = lireFiche('a.md', '# T\n\n## Informations\n- A. ^f-0031\n- B. ^f-0009\n- cassé | ??? ^f-0040\n');
		expect(prochaineAncre(fiche)).toBe('f-0041');
	});

	it('commence à f-0001 sur une fiche vide', () => {
		expect(prochaineAncre(lireFiche('a.md', '# T\n'))).toBe('f-0001');
	});

	it('compte les ancres des faits lisibles', () => {
		expect(prochaineAncre(lireFiche('a.md', '# T\n\n## Informations\n- A. ^f-0031\n- B. ^f-0009\n'))).toBe('f-0032');
	});
});

describe('« ## Informations » (ancien « ## Faits »)', () => {
	const corps = '- [delai] Livraison au 15/12. | observe ^f-0001\n- Réunion le lundi. ^f-0002\n';
	const avec = (titre: string) => `---\nid: x\ntype: sujet\nupdated: 2026-01-01\n---\n# T\n\nSynthèse.\n\n## ${titre}\n${corps}\n## Notes\nlibre\n`;

	it('lit « ## Informations » et « ## Informations » de la même façon', () => {
		const ancienne = lireFiche('a.md', avec('Faits'));
		const nouvelle = lireFiche('a.md', avec('Informations'));
		expect(ancienne.faits).toEqual(nouvelle.faits);
		expect(ancienne.faits).toHaveLength(2);
		expect(ancienne.autresSections).toEqual(nouvelle.autresSections);
		expect(ancienne.autresSections).toEqual([{ titre: 'Notes', corps: 'libre' }]);
	});

	it('écrit toujours « ## Informations », à la place de la section lue', () => {
		expect(ecrireFiche(lireFiche('a.md', avec('Faits')))).toBe(avec('Informations'));
		const neuve = lireFiche('a.md', '---\nid: x\ntype: sujet\nupdated: 2026-01-01\n---\n# T\n');
		neuve.faits.push({ brute: ['- ?'] });
		expect(ecrireFiche(neuve)).toContain('\n\n## Informations\n- ?\n');
		expect(ecrireFiche(neuve)).not.toContain('## Faits');
	});

	it('aller-retour stable : relue puis réécrite, la fiche ne bouge plus', () => {
		const une = ecrireFiche(lireFiche('a.md', avec('Faits')));
		const deux = ecrireFiche(lireFiche('a.md', une));
		expect(deux).toBe(une);
		expect(lireFiche('a.md', deux).faits).toEqual(lireFiche('a.md', avec('Faits')).faits);
	});
});

describe('information corroborée', () => {
	const CORROBOREE = EXEMPLE.replace(
		'recette incluse. »\n',
		'recette incluse. »\n  + src: [[sources/compte-rendu-12-11]] | corroboré 2026-11-24\n  > « Livraison confirmée au 15 décembre. »\n  + src: utilisateur dit | corroboré 2026-11-25\n',
	);

	it('garde ses corroborations dans le fait et se réécrit octet pour octet', () => {
		const fiche = lireFiche('projets/stocks/stocks.md', CORROBOREE);
		expect(fiche.faits).toHaveLength(2);
		const premier = fiche.faits[0]!;
		expect('fait' in premier && premier.fait.corroborations).toEqual([
			{ source: '[[sources/compte-rendu-12-11]]', le: '2026-11-24', citation: 'Livraison confirmée au 15 décembre.' },
			{ source: 'utilisateur dit', le: '2026-11-25' },
		]);
		expect(ecrireFiche(fiche)).toBe(CORROBOREE);
	});

	it('garde telle quelle une ligne de corroboration orpheline', () => {
		const texte = EXEMPLE.replace('\n\n## Relations', '\n- texte | mention inconnue\n  + src: [[sources/x]] | corroboré 2026-11-24\n\n## Relations');
		const fiche = lireFiche('projets/stocks/stocks.md', texte);
		expect(fiche.faits.slice(2)).toEqual([{ brute: ['- texte | mention inconnue'] }, { brute: ['  + src: [[sources/x]] | corroboré 2026-11-24'] }]);
		expect(ecrireFiche(fiche)).toBe(texte);
	});
});
