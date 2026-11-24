import { describe, expect, it } from 'vitest';
import { empreinte, empreinteOctets, hacheurOctets } from '../../src/domaine/empreinte.ts';

/** Référence : FNV-1a 64 en BigInt, octet par octet. */
function reference(octets: Uint8Array): string {
	let h = 0xcbf29ce484222325n;
	for (const o of octets) h = ((h ^ BigInt(o)) * 0x100000001b3n) & 0xffffffffffffffffn;
	return h.toString(16).padStart(16, '0');
}

describe('empreinte', () => {
	it('est stable et de 16 caractères hexadécimaux, y compris pour le texte vide', () => {
		expect(empreinte('')).toBe('cbf29ce484222325');
		expect(empreinte('')).toBe(empreinte(''));
		expect(empreinte('a')).toMatch(/^[0-9a-f]{16}$/u);
		expect(empreinte('a')).toBe('af63dc4c8601ec8c');
	});
	it('diffère pour deux textes différents', () => {
		expect(empreinte('inventaire')).not.toBe(empreinte('inventaires'));
		expect(empreinte('é')).not.toBe(empreinte('e'));
	});
	it('empreinteOctets : FNV-1a 64 des octets bruts, identique à la référence, et à empreinte du texte UTF-8', () => {
		let graine = 7;
		for (const taille of [0, 1, 2, 17, 255, 4096]) {
			const octets = Uint8Array.from({ length: taille }, () => (graine = (graine * 1103515245 + 12345) % 2 ** 31) & 0xff);
			expect(empreinteOctets(octets)).toBe(reference(octets));
		}
		expect(empreinteOctets(new TextEncoder().encode('Réunion'))).toBe(empreinte('Réunion'));
		expect(empreinteOctets(Uint8Array.of(0xff, 0x00, 0xfe))).toBe(reference(Uint8Array.of(0xff, 0x00, 0xfe)));
	});
});

describe('hacheurOctets', () => {
	it('par morceaux, quel que soit le découpage : même empreinte que d\'un bloc', () => {
		const octets = Uint8Array.from({ length: 10_000 }, (_, i) => (i * 31 + 7) & 0xff);
		for (const taille of [1, 7, 4096, 10_000]) {
			const h = hacheurOctets();
			for (let i = 0; i < octets.length; i += taille) h.ajouter(octets.subarray(i, i + taille));
			expect(h.resultat()).toBe(empreinteOctets(octets));
		}
		expect(hacheurOctets().resultat()).toBe(empreinteOctets(new Uint8Array()));
	});
});
