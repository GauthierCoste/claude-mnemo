import { describe, expect, it } from 'vitest';
import { estChoixLangue, estLangue, langueDuChoix, langueDuSysteme } from '../src/langue.ts';

describe('langue', () => {
	it('langue du système : fr ou en, anglais pour toute autre', () => {
		expect(langueDuSysteme('fr-FR')).toBe('fr');
		expect(langueDuSysteme('fr-CA')).toBe('fr');
		expect(langueDuSysteme('en-GB')).toBe('en');
		expect(langueDuSysteme('EN_us')).toBe('en');
		expect(langueDuSysteme('de-DE')).toBe('en');
		expect(langueDuSysteme('')).toBe('en');
		expect(langueDuSysteme(undefined)).toBe('en');
	});

	it('choix du réglage : systeme suit le système, une langue l’emporte', () => {
		expect(langueDuChoix('systeme', 'fr-FR')).toBe('fr');
		expect(langueDuChoix('en', 'fr-FR')).toBe('en');
		expect(langueDuChoix('fr', 'en-US')).toBe('fr');
	});

	it('gardes de type', () => {
		expect(estLangue('fr')).toBe(true);
		expect(estLangue('systeme')).toBe(false);
		expect(estChoixLangue('systeme')).toBe(true);
		expect(estChoixLangue('de')).toBe(false);
	});
});
