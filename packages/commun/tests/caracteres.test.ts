import { describe, expect, it } from 'vitest';
import { CARACTERES_INVISIBLES, nomAffichable, nomDeFichierNouveauValide } from '../src/index.ts';

describe('nomDeFichierNouveauValide : nom d\'un fichier que le dépôt va créer (service et interface)', () => {
	it('accepté : tout nom visible, caché compris', () => {
		for (const nom of ['cr.pdf', '.notes.md', 'Devis « 2026 ».docx']) expect(nomDeFichierNouveauValide(nom), nom).toEqual({ ok: true, nom });
	});

	it('refusé : vide, « . », « .. », séparateur, caractère invisible ou de contrôle (C0, C1, bidi)', () => {
		for (const nom of ['', '.', '..', 'a/b', 'a\\b', 'a\u0007.txt', 'a\u009b2J.txt', '\u202etxt.exe', '\u2066x\u2069.txt', 'a\u200e.txt', 'a\u200fb.txt', 'a\u061cb.txt']) expect(nomDeFichierNouveauValide(nom).ok, nom).toBe(false);
	});

	it('un caractère est refusé dans un nom si et seulement si CARACTERES_INVISIBLES le reconnaît', () => {
		for (let code = 0; code <= 0x2100; code++) {
			const c = String.fromCharCode(code);
			if (c === '/' || c === '\\') continue;
			expect(nomDeFichierNouveauValide(`a${c}b.txt`).ok, `U+${code.toString(16)}`).toBe(!CARACTERES_INVISIBLES.test(c));
		}
	});
});

describe('nomAffichable : un nom montré dans un message, chaque caractère invisible écrit \\uXXXX', () => {
	it('tous les caractères invisibles sont échappés, le reste est gardé', () => {
		expect(nomAffichable('facture\u200e.pdf')).toBe('facture\\u200e.pdf');
		expect(nomAffichable('docs/\u202etxt\u2066.exe')).toBe('docs/\\u202etxt\\u2066.exe');
		expect(nomAffichable('Devis « 2026 ».docx')).toBe('Devis « 2026 ».docx');
	});
});
