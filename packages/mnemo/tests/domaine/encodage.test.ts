import { describe, expect, it } from 'vitest';
import { ECHANTILLON_NATURE, estBinaire, marqueDOrdre, PART_CONTROLE_BINAIRE } from '@mnemo/commun';

const o = (...octets: number[]) => new Uint8Array(octets);

describe('encodage d\'un fichier texte', () => {
	it('marque d\'ordre des octets : UTF-8, UTF-16 LE et BE ; sans marque : null', () => {
		expect(marqueDOrdre(o(0xef, 0xbb, 0xbf, 0x61))).toEqual({ encodage: 'utf-8', longueur: 3 });
		expect(marqueDOrdre(o(0xff, 0xfe, 0x61, 0x00))).toEqual({ encodage: 'utf-16le', longueur: 2 });
		expect(marqueDOrdre(o(0xfe, 0xff, 0x00, 0x61))).toEqual({ encodage: 'utf-16be', longueur: 2 });
		expect(marqueDOrdre(o(0x61, 0x62))).toBeNull();
		expect(marqueDOrdre(o())).toBeNull();
	});

	it('binaire : un octet nul au début sans marque UTF-16 ; un texte UTF-16 marqué n\'est pas binaire', () => {
		expect(estBinaire(o(0x50, 0x4b, 0x03, 0x04, 0x00, 0x00))).toBe(true);
		expect(estBinaire(o(0xff, 0xfe, 0x61, 0x00))).toBe(false);
		expect(estBinaire(new TextEncoder().encode('tarifs;prix\nsite;1200\n'))).toBe(false);
		expect(estBinaire(o(0x63, 0x61, 0x66, 0xe9))).toBe(false);
	});
});

describe('binaire : octet nul ou trop d\'octets de contrôle dans l\'échantillon', () => {
	const controles = (part: number, n = 1000) => {
		const o = new Uint8Array(n).fill(0x61);
		for (let i = 0; i < Math.round(n * part); i++) o[i] = 0x01;
		return o;
	};
	it(`au-delà de ${PART_CONTROLE_BINAIRE * 100} % d'octets de contrôle (hors tabulation, CR, LF, FF) : binaire`, () => {
		expect(estBinaire(controles(PART_CONTROLE_BINAIRE + 0.05))).toBe(true);
		expect(estBinaire(controles(PART_CONTROLE_BINAIRE - 0.05))).toBe(false);
		expect(estBinaire(new Uint8Array(1000).fill(0x0a))).toBe(false);
		expect(estBinaire(new Uint8Array([0x09, 0x0d, 0x0a, 0x0c, 0x61]))).toBe(false);
	});
	it('un octet nul après l\'échantillon n\'est pas vu ; un UTF-8 marqué qui contient un octet nul est binaire', () => {
		const long = new Uint8Array(ECHANTILLON_NATURE + 10).fill(0x61);
		long[ECHANTILLON_NATURE + 5] = 0;
		expect(estBinaire(long)).toBe(false);
		expect(estBinaire(new Uint8Array([0xef, 0xbb, 0xbf, 0x61, 0x00, 0x62]))).toBe(true);
	});
});
