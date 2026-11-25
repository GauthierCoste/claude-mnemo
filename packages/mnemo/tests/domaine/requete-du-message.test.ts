import { describe, expect, it } from 'vitest';
import { estCourtOuAnaphorique, precedentUtile, requeteDuMessage, requeteJointe, VARIANTE_DE_LA_REQUETE } from '../../src/domaine/requete-du-message.ts';

describe('requête du message', () => {
	it('court (moins de 6 mots porteurs) ou début anaphorique : joint au message d’avant', () => {
		expect(estCourtOuAnaphorique('et pour le contact ?')).toBe(true);
		expect(estCourtOuAnaphorique('pareil pour la cuisson des grisailles du vitrail de la chapelle nord')).toBe(true);
		expect(estCourtOuAnaphorique('celle-ci convient-elle au chantier de restauration des vitraux de Corvel ?')).toBe(true);
		expect(estCourtOuAnaphorique('prépare le devis de restauration des vitraux de la chapelle nord avant vendredi')).toBe(false);
		expect(requeteJointe('et le four ?', 'parle-moi du chantier de vitrail')).toBe('parle-moi du chantier de vitrail\net le four ?');
	});

	it('seuls les mots porteurs comptent : mots vides et mots de moins de 3 lettres ne font pas un message long', () => {
		expect(estCourtOuAnaphorique('relis le devis des vitraux de Corvel')).toBe(true);
		expect(estCourtOuAnaphorique('relis le devis des vitraux Atelier Vitrail Corvel demain')).toBe(false);
	});

	it('sans message d’avant, ou message long et autonome : aucune requête jointe', () => {
		expect(requeteJointe('et le four ?', null)).toBeNull();
		expect(requeteJointe('et le four ?', '  ')).toBeNull();
		expect(requeteJointe('prépare le devis de restauration des vitraux de la chapelle nord avant vendredi', 'avant')).toBeNull();
	});

	it('la variante choisit la requête : seule, le message ; jointe, le message d’avant joint s’il le faut', () => {
		expect(requeteDuMessage('et le four ?', 'parle-moi du chantier de vitrail', 'seule')).toBe('et le four ?');
		expect(requeteDuMessage('et le four ?', 'parle-moi du chantier de vitrail', 'jointe')).toBe('parle-moi du chantier de vitrail\net le four ?');
		expect(requeteDuMessage('et le four ?', null, 'jointe')).toBe('et le four ?');
		const long = 'prépare le devis de restauration des vitraux de la chapelle nord avant vendredi';
		expect(requeteDuMessage(long, 'avant', 'jointe')).toBe(long);
	});

	it('le message d’avant n’est utile qu’à la variante jointe, pour un message court ou anaphorique', () => {
		expect(precedentUtile('et le four ?', 'jointe')).toBe(true);
		expect(precedentUtile('et le four ?', 'seule')).toBe(false);
		expect(precedentUtile('', 'jointe')).toBe(false);
		expect(precedentUtile('prépare le devis de restauration des vitraux de la chapelle nord avant vendredi', 'jointe')).toBe(false);
	});

	it('le hook prend le message seul tant que le banc n’a pas montré que la variante jointe gagne', () => {
		expect(VARIANTE_DE_LA_REQUETE).toBe('seule');
		expect(requeteDuMessage('et le four ?', 'parle-moi du chantier de vitrail')).toBe('et le four ?');
	});
});
