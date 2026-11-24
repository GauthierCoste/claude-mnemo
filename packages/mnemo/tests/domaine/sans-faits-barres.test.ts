import { describe, expect, it } from 'vitest';
import { sansFaitsBarres } from '../../src/domaine/sans-faits-barres.ts';

const entete = '---\nid: X\ntype: sujet\nupdated: 2026-11-01\n---\n# Vela\n\nSynthèse.\n';

describe('sansFaitsBarres', () => {
	it('retire le fait barré et sa citation, garde les autres faits et leurs citations', () => {
		const texte = `${entete}\n## Informations\n- [montant] Budget de 10 k€ | src: utilisateur dit ^f-0001\n  > « dix »\n- [montant] ~~Budget de 8 k€~~ | invalidé 2026-11-02 par ^f-0001 | src: utilisateur dit ^f-0002\n  > « huit »\n- [echeance] Livraison en mars | src: utilisateur dit ^f-0003\n\n## Relations\n- concerne [[Avoirs]]\n`;
		expect(sansFaitsBarres(texte)).toBe(
			`${entete}\n## Informations\n- [montant] Budget de 10 k€ | src: utilisateur dit ^f-0001\n  > « dix »\n- [echeance] Livraison en mars | src: utilisateur dit ^f-0003\n\n## Relations\n- concerne [[Avoirs]]\n`,
		);
	});

	it('sans fait barré, rend le texte à l’octet près', () => {
		const texte = `${entete}\n## Informations\n- Un fait ^f-0001\n  > « cité »\n`;
		expect(sansFaitsBarres(texte)).toBe(texte);
	});

	it('ne touche pas un texte barré hors de la section Informations, ni une citation qui suit un fait non barré', () => {
		const texte = `${entete}\n## Notes\n- ~~ancien plan~~ gardé\n\n## Informations\n- Fait vivant ^f-0001\n  > « ~~cité~~ »\n`;
		expect(sansFaitsBarres(texte)).toBe(texte);
	});

	it('reconnaît un fait barré en fin de ligne CRLF', () => {
		const texte = '## Informations\r\n- ~~Vieux~~ | invalidé 2026-11-02 ^f-0001\r\n  > « v »\r\n- Neuf ^f-0002\r\n';
		expect(sansFaitsBarres(texte)).toBe('## Informations\r\n- Neuf ^f-0002\r\n');
	});

	it('lit aussi l’ancien titre « Faits »', () => {
		expect(sansFaitsBarres('## Faits\n- ~~Vieux~~ | invalidé 2026-11-02 ^f-0001\n  > « v »\n- Neuf ^f-0002\n')).toBe('## Faits\n- Neuf ^f-0002\n');
	});

	it('retire les corroborations du fait barré, garde celles des autres', () => {
		const texte = `${entete}\n## Informations\n- ~~Vieux~~ | invalidé 2026-11-02 ^f-0001\n  > « v »\n  + src: [[sources/b]] | corroboré 2026-11-03\n  > « vb »\n  + src: [[sources/c]] | corroboré 2026-11-04\n- Neuf ^f-0002\n  + src: [[sources/d]] | corroboré 2026-11-05\n`;
		expect(sansFaitsBarres(texte)).toBe(`${entete}\n## Informations\n- Neuf ^f-0002\n  + src: [[sources/d]] | corroboré 2026-11-05\n`);
	});
});
