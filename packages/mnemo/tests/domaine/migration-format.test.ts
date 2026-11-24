import { describe, expect, it } from 'vitest';
import { migrerTexteDeFiche } from '../../src/domaine/migration-format.ts';

const ancienne = `---
id: 01M7QBP20XERWKQS5QBWB6PKWA
type: entite
portee: projet:Interphone
updated: 2026-11-18
type_origine: projet
---
# Interphone

Synthèse : Projet DIY : un interphone.

## Faits
- [objectif] Un fait. | declare | src: utilisateur coffre 2026-11-18 ^f-0001
`;

describe('migrerTexteDeFiche', () => {
	it('retire type_origine et « Synthèse : », le reste octet pour octet', () => {
		expect(migrerTexteDeFiche(ancienne)).toBe(ancienne.replace('type_origine: projet\n', '').replace('Synthèse : ', ''));
	});

	it('idempotent', () => {
		const une = migrerTexteDeFiche(ancienne);
		expect(migrerTexteDeFiche(une)).toBe(une);
	});

	it('texte déjà au format courant : identique', () => {
		const texte = '---\nid: X\ntype: sujet\n---\n# T\n\nUne synthèse.\n\n## Faits\n- a ^f-0001\n';
		expect(migrerTexteDeFiche(texte)).toBe(texte);
	});

	it('garde les fins de ligne CRLF', () => {
		expect(migrerTexteDeFiche('---\r\nid: X\r\ntype_origine: personne\r\n---\r\n# T\r\n\r\nSynthèse : Une personne.\r\n')).toBe('---\r\nid: X\r\n---\r\n# T\r\n\r\nUne personne.\r\n');
	});

	it('retire les lignes de suite indentées de type_origine, pas les champs suivants', () => {
		expect(migrerTexteDeFiche('---\nid: X\ntype_origine:\n  - a\n  - b\nupdated: 2026-01-01\n---\n# T\n')).toBe('---\nid: X\nupdated: 2026-01-01\n---\n# T\n');
	});

	it('ne touche pas un « Synthèse : » qui n\'est pas la première ligne après le titre, ni un préfixe sans texte', () => {
		const milieu = '---\nid: X\n---\n# T\n\nUne synthèse.\n\nSynthèse : plus loin.\n';
		expect(migrerTexteDeFiche(milieu)).toBe(milieu);
		const vide = '---\nid: X\n---\n# T\n\nSynthèse :\n\n## Faits\n';
		expect(migrerTexteDeFiche(vide)).toBe(vide);
		const sansTitre = 'Synthèse : sans titre.\n';
		expect(migrerTexteDeFiche(sansTitre)).toBe(sansTitre);
	});

	it('type_origine hors en-tête gardé', () => {
		const texte = '---\nid: X\n---\n# T\n\n## Faits\ntype_origine: gardé\n';
		expect(migrerTexteDeFiche(texte)).toBe(texte);
	});
});
