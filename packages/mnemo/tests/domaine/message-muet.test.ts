import { describe, expect, it } from 'vitest';
import { commenceParUneBalise, raisonDeMutisme } from '../../src/domaine/message-muet.ts';

describe('raisonDeMutisme', () => {
	it('est muet quand le message commence par une balise', () => {
		expect(raisonDeMutisme('<task-notification> <task-id>x</task-id>')).toBe('balise');
		expect(raisonDeMutisme('  <agent-message from="a">…')).toBe('balise');
		expect(raisonDeMutisme('<command-name>/clear</command-name>')).toBe('balise');
	});

	it('ne tient pas un contenu collé pour une balise', () => {
		expect(raisonDeMutisme('<pasted_content id="1">Annotations 1 error tests windows</pasted_content>')).toBeNull();
		expect(commenceParUneBalise('<pasted_content id="1">x</pasted_content>')).toBe(false);
	});

	it.each(['oui vas y pousse', 'ok', 'Je suis ok avec tes propositions vas y', 'oui ok pour tes recos a b c et d'])('est muet sans contenu : %s', (message) => {
		expect(raisonDeMutisme(message)).toBe('sans_contenu');
	});

	it.each(['Maquette ERP', "j'ai plein de tests fails", 'Que sais tu de solaire éco énergie ?'])('porte du sens : %s', (message) => {
		expect(raisonDeMutisme(message)).toBeNull();
	});
});
