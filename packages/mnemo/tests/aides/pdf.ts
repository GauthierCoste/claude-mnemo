// PDF minimal généré pour les tests (police Helvetica standard, une ligne de texte par page).

/** PDF dont chaque page porte le texte donné ; une chaîne vide : page sans texte (comme une page scannée). */
export function pdfDePages(textes: string[]): Uint8Array {
	const n = textes.length;
	const objs = ['<< /Type /Catalog /Pages 2 0 R >>', `<< /Type /Pages /Kids [${textes.map((_, i) => `${4 + 2 * i} 0 R`).join(' ')}] /Count ${n} >>`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
	textes.forEach((t, i) => {
		const flux = t === '' ? '' : `BT /F1 12 Tf 72 720 Td (${t}) Tj ET`;
		objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + 2 * i} 0 R >>`);
		objs.push(`<< /Length ${flux.length} >>\nstream\n${flux}\nendstream`);
	});
	let s = '%PDF-1.4\n';
	const off: number[] = [];
	objs.forEach((o, i) => (off.push(s.length), (s += `${i + 1} 0 obj\n${o}\nendobj\n`)));
	const x = s.length;
	s += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${off.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF\n`;
	return new TextEncoder().encode(s);
}
