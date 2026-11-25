import { describe, expect, it } from 'vitest';
import { estCourtOuAnaphorique, requeteJointeProvisoire } from '../../src/domaine/requete-jointe-provisoire.ts';

describe('requête jointe provisoire (remplacée par T4)', () => {
	it('court (moins de 6 mots porteurs) ou début anaphorique : joint au message d’avant', () => {
		expect(estCourtOuAnaphorique('et pour le contact ?')).toBe(true);
		expect(estCourtOuAnaphorique('pareil pour la cuisson des grisailles du vitrail de la chapelle nord')).toBe(true);
		expect(estCourtOuAnaphorique('prépare le devis de restauration des vitraux de la chapelle nord avant vendredi')).toBe(false);
		expect(requeteJointeProvisoire('et le four ?', 'parle-moi du chantier de vitrail')).toBe('parle-moi du chantier de vitrail\net le four ?');
	});

	it('sans message d’avant, ou message long et autonome : aucune requête jointe', () => {
		expect(requeteJointeProvisoire('et le four ?', null)).toBeNull();
		expect(requeteJointeProvisoire('et le four ?', '  ')).toBeNull();
		expect(requeteJointeProvisoire('prépare le devis de restauration des vitraux de la chapelle nord avant vendredi', 'avant')).toBeNull();
	});
});
