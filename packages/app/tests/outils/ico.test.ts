import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { icoDepuisPng } from '../../outils/ico.ts';

/** Un PNG minimal (en-tête et IHDR seulement : l'icône n'en lit que les dimensions). */
function png(cote: number): Buffer {
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(cote, 0);
	ihdr.writeUInt32BE(cote, 4);
	const bloc = Buffer.concat([Buffer.from([0, 0, 0, 13]), Buffer.from('IHDR'), ihdr, Buffer.alloc(4)]);
	return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), bloc, deflateSync(Buffer.alloc(1))]);
}

describe('icône Windows (.ico)', () => {
	it('en-tête, une entrée par image (256 écrit 0), puis les PNG à leur décalage', () => {
		const grand = png(256);
		const petit = png(48);
		const ico = icoDepuisPng([{ taille: 256, png: grand }, { taille: 48, png: petit }]);
		expect([ico.readUInt16LE(0), ico.readUInt16LE(2), ico.readUInt16LE(4)]).toEqual([0, 1, 2]);
		expect([ico.readUInt8(6), ico.readUInt8(7), ico.readUInt16LE(12)]).toEqual([0, 0, 32]);
		expect(ico.readUInt32LE(14)).toBe(grand.length);
		expect(ico.readUInt32LE(18)).toBe(6 + 32);
		expect(ico.readUInt8(22)).toBe(48);
		expect(ico.readUInt32LE(34)).toBe(6 + 32 + grand.length);
		expect(ico.subarray(6 + 32, 6 + 32 + grand.length).equals(grand)).toBe(true);
		expect(ico.subarray(6 + 32 + grand.length).equals(petit)).toBe(true);
	});

	it('taille fausse, plus de 256 ou pas un PNG : refusé', () => {
		expect(() => icoDepuisPng([{ taille: 256, png: png(128) }])).toThrow();
		expect(() => icoDepuisPng([{ taille: 512, png: png(512) }])).toThrow();
		expect(() => icoDepuisPng([{ taille: 16, png: Buffer.from('pas un png, vraiment pas') }])).toThrow();
		expect(() => icoDepuisPng([])).toThrow();
	});

	const pngInterface = join(import.meta.dirname, '../../../ui/dist/icones/icone-256.png');
	it.skipIf(!existsSync(pngInterface))('le PNG 256 de l’interface construite est accepté (sauté si l’interface n’est pas construite)', () => {
		const icone = readFileSync(pngInterface);
		expect(icoDepuisPng([{ taille: 256, png: icone }]).length).toBe(6 + 16 + icone.length);
	});
});
