/**
 * Icône macOS (`.icns`) assemblée à partir de PNG, sans outil externe : en-tête `icns` + longueur totale, puis une entrée par
 * taille (type sur 4 octets, longueur entrée comprise, PNG). Types PNG reconnus par macOS : `ic08` 256, `ic09` 512, `ic10`
 * 1024 (512 en double densité).
 */
export type TypeIcns = 'ic08' | 'ic09' | 'ic10';

export function icnsDepuisPng(entrees: readonly { type: TypeIcns; png: Buffer }[]): Buffer {
	const blocs = entrees.map(({ type, png }) => {
		const tete = Buffer.alloc(8);
		tete.write(type, 0, 'latin1');
		tete.writeUInt32BE(8 + png.length, 4);
		return Buffer.concat([tete, png]);
	});
	const tete = Buffer.alloc(8);
	tete.write('icns', 0, 'latin1');
	tete.writeUInt32BE(8 + blocs.reduce((n, b) => n + b.length, 0), 4);
	return Buffer.concat([tete, ...blocs]);
}
