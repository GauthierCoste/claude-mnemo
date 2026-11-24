import { readFile } from 'node:fs/promises';
import JSZip from 'jszip';
import { describe, expect, it, vi } from 'vitest';
import { contenuEnMemoire } from '../../src/application/contenu.ts';
import { ErreurExtraction } from '../../src/application/ports.ts';
import { extracteursReels } from '../../src/infra/extracteurs/index.ts';
import { pdfDePages } from '../aides/pdf.ts';
import { extracteurPdf } from '../../src/infra/extracteurs/pdf.ts';
import { lireProprietesWord } from '../../src/infra/extracteurs/proprietes-word.ts';
import { extracteurWord } from '../../src/infra/extracteurs/word.ts';

const fixture = async (nom: string) => new Uint8Array(await readFile(new URL(`../fixtures/documents/${nom}`, import.meta.url)));
const octets = (t: string) => new TextEncoder().encode(t);
const extracteurs = extracteursReels();

const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));

function pdfVide(): Uint8Array {
	const objs = [
		'<< /Type /Catalog /Pages 2 0 R >>',
		'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
		'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >>',
		'<< /Length 0 >>\nstream\n\nendstream',
	];
	let s = '%PDF-1.4\n';
	const off: number[] = [];
	objs.forEach((o, i) => (off.push(s.length), (s += `${i + 1} 0 obj\n${o}\nendobj\n`)));
	const x = s.length;
	s += `xref\n0 5\n0000000000 65535 f \n${off.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${x}\n%%EOF\n`;
	return new TextEncoder().encode(s);
}

async function docx(avecImage = false, remplissage = 0): Promise<Uint8Array> {
	const zip = new JSZip();
	if (avecImage) {
		zip.file('word/media/image1.png', PNG);
		zip.file('word/_rels/document.xml.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/></Relationships>');
	}
	if (remplissage > 0) zip.file('word/gros.bin', 'a'.repeat(remplissage), { compression: 'DEFLATE' });
	zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
	zip.file('_rels/.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>');
	zip.file('docProps/core.xml', '<?xml version="1.0"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/"><dc:title>Propri&#233;t&#xE9; titre</dc:title><dc:creator>Bob Durand</dc:creator><dcterms:created>2026-02-03T09:00:00Z</dcterms:created></cp:coreProperties>');
	const p = (t: string, style?: string) => `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''}<w:r><w:t>${t}</w:t></w:r></w:p>`;
	const cellule = (t: string) => `<w:tc>${p(t)}</w:tc>`;
	const ligne = (...c: string[]) => `<w:tr>${c.map(cellule).join('')}</w:tr>`;
	zip.file('word/document.xml', `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${avecImage ? '<w:p><w:r><w:drawing><wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:blipFill><a:blip xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:embed="rId9"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>' : ''}${p('Cahier des charges', 'Heading1')}${p('Un paragraphe de texte.')}${p('Périmètre', 'Heading2')}<w:tbl>${ligne('Poste', 'Prix')}${ligne('Site', '1200')}</w:tbl>${p('Fin.')}</w:body></w:document>`);
	return zip.generateAsync({ type: 'uint8array' });
}

describe('extracteurs', () => {
	it('tout fichier a un extracteur : celui de son format, sinon le texte (le contenu décide)', async () => {
		for (const c of ['a.md', 'a.MARKDOWN', 'a.txt', 'dossier/A.PDF', 'a.docx', 'a.csv', 'sans-extension', 'a.doc']) expect(extracteurs.pour(c)).toBeTruthy();
		const csv = await extracteurs.pour('docs/tarifs.csv').extraire('docs/tarifs.csv', contenuEnMemoire(octets('poste;prix\nsite;1200\n')));
		expect(csv).toMatchObject({ format: 'texte', titre: 'tarifs', markdown: 'poste;prix\nsite;1200\n' });
		const yaml = await extracteurs.pour('config/contrat.yaml').extraire('config/contrat.yaml', contenuEnMemoire(octets('# Contrat\nmontant: 1200\n')));
		expect(yaml.markdown).toContain('montant: 1200');
	});

	it("fichier binaire sans extracteur : refus qui dit qu'il ne sera pas cherchable", async () => {
		const xlsx = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00, 0x08, 0x00]);
		await expect(extracteurs.pour('compta.xlsx').extraire('compta.xlsx', contenuEnMemoire(xlsx))).rejects.toThrow(/ne sera pas cherchable/u);
	});

	it('encodage : UTF-16 marqué (Bloc-notes « Unicode ») et Windows-1252 lus, signalés ; UTF-8 sans avertissement', async () => {
		const lire = (nom: string, b: Uint8Array) => extracteurs.pour(nom).extraire(nom, contenuEnMemoire(b));
		const utf16 = new Uint8Array([0xff, 0xfe, ...[...'Procès-verbal été'].flatMap((c) => [c.charCodeAt(0) & 0xff, c.charCodeAt(0) >> 8])]);
		const r16 = await lire('pv.txt', utf16);
		expect(r16.markdown).toBe('Procès-verbal été');
		expect(r16.avertissements).toEqual(['encodage UTF-16 LE (marque en tête du fichier)']);
		const be = await lire('pv.txt', new Uint8Array([0xfe, 0xff, 0x00, 0xe9, 0x00, 0x74, 0x00, 0xe9]));
		expect(be.markdown).toBe('été');
		const r1252 = await lire('pv.txt', new Uint8Array([0x50, 0x72, 0x6f, 0x63, 0xe8, 0x73, 0x20, 0xe9, 0x74, 0xe9, 0x20, 0x80]));
		expect(r1252.markdown).toBe('Procès été €');
		expect(r1252.avertissements).toEqual(["encodage supposé Windows-1252 (le fichier n'est pas de l'UTF-8 valide)"]);
		const r8 = await lire('pv.txt', octets('Procès été'));
		expect(r8.markdown).toBe('Procès été');
		expect(r8.avertissements).toBeUndefined();
	});

	it('UTF-8 invalide au-delà du premier morceau lu : tout le fichier relu en Windows-1252', async () => {
		const debut = octets('a'.repeat(5 * 1024 * 1024));
		const tout = new Uint8Array([...debut, 0xe9]);
		const r = await extracteurs.pour('long.txt').extraire('long.txt', contenuEnMemoire(tout));
		expect(r.markdown.endsWith('aé')).toBe(true);
		expect(r.avertissements).toEqual(["encodage supposé Windows-1252 (le fichier n'est pas de l'UTF-8 valide)"]);
	});

	it('Markdown : titre = premier « # », BOM retiré', async () => {
		const r = await extracteurs.pour('n.md')!.extraire('n.md', contenuEnMemoire(octets('﻿intro\n\n# Mon titre\n\ntexte')));
		expect(r).toMatchObject({ format: 'markdown', titre: 'Mon titre', pages: null, pieces: [] });
		expect(r.markdown.startsWith('intro')).toBe(true);
	});

	it('texte : titre = nom du fichier ; Latin-1 lu comme Windows-1252, sans exception', async () => {
		const r = await extracteurs.pour('dossier/notes de réunion.txt')!.extraire('dossier/notes de réunion.txt', contenuEnMemoire(new Uint8Array([0x63, 0x61, 0x66, 0xe9, 0x0a])));
		expect(r.titre).toBe('notes de réunion');
		expect(r.markdown).toBe('café\n');
		expect(r.format).toBe('texte');
	});

	it('PDF : texte par page, positions des pages, métadonnées', async () => {
		const r = await extracteurs.pour('c.pdf')!.extraire('c.pdf', contenuEnMemoire(await fixture('contrat.pdf')));
		expect(r.format).toBe('pdf');
		expect(r.titre).toBe('Contrat de test');
		expect(r.auteur).toBe('Alice Martin');
		expect(r.date).toBe('2026-01-15');
		expect(r.markdown).toBe('Premiere page du contrat\n\nSeconde page: montant 1200 euros');
		expect(r.pages).toEqual([0, r.markdown.indexOf('Seconde')]);
	});

	it('PDF : n’écrit rien sur la sortie standard (le serveur MCP la partage)', async () => {
		const ecritures: unknown[] = [];
		const espion = vi.spyOn(process.stdout, 'write').mockImplementation(((c: unknown) => (ecritures.push(c), true)) as never);
		try {
			await extracteurs.pour('c.pdf')!.extraire('c.pdf', contenuEnMemoire(await fixture('contrat.pdf')));
			await extracteurs.pour('c.pdf')!.extraire('c.pdf', contenuEnMemoire(await fixture('corrompu.pdf'))).catch(() => undefined);
		} finally {
			espion.mockRestore();
		}
		expect(ecritures).toEqual([]);
	});

	it('PDF corrompu → ErreurExtraction qui nomme le format', async () => {
		const e = await extracteurs.pour('x.pdf')!.extraire('x.pdf', contenuEnMemoire(await fixture('corrompu.pdf'))).catch((x) => x);
		expect(e).toBeInstanceOf(ErreurExtraction);
		expect(e.message).toContain('PDF');
	});

	it('PDF trop long (pages ou délai) → ErreurExtraction « trop long »', async () => {
		const pdf = await fixture('contrat.pdf');
		await expect(extracteurPdf({ pagesMax: 1 }).extraire('c.pdf', contenuEnMemoire(pdf))).rejects.toThrow(/trop long/);
		await expect(extracteurPdf({ delaiMs: 0 }).extraire('c.pdf', contenuEnMemoire(pdf))).rejects.toThrow(/trop long/);
	});

	it('Word : titres, tableau en Markdown, propriétés', async () => {
		const r = await extracteurs.pour('d.docx')!.extraire('d.docx', contenuEnMemoire(await docx()));
		expect(r.format).toBe('docx');
		expect(r.titre).toBe('Cahier des charges');
		expect(r.auteur).toBe('Bob Durand');
		expect(r.date).toBe('2026-02-03');
		expect(r.pages).toBeNull();
		expect(r.markdown).toContain('# Cahier des charges');
		expect(r.markdown).toContain('## Périmètre');
		expect(r.markdown).toContain('| Poste | Prix |');
		expect(r.markdown).toContain('| Site | 1200 |');
		expect(r.markdown).not.toContain('data:');
	});

	it('Word invalide → ErreurExtraction', async () => {
		const e = await extracteurs.pour('d.docx')!.extraire('d.docx', contenuEnMemoire(octets('pas un zip'))).catch((x) => x);
		expect(e).toBeInstanceOf(ErreurExtraction);
		expect(e.message).toContain('Word');
	});

	it('PDF sans couche texte : markdown vide, format pdf-sans-texte, pages sans texte comptées', async () => {
		const r = await extracteurs.pour('s.pdf')!.extraire('s.pdf', contenuEnMemoire(pdfVide()));
		expect(r).toMatchObject({ format: 'pdf-sans-texte', markdown: '', pages: null });
		expect(r.avertissements).toEqual(["1 page sur 1 sans texte (scannée ?) : non indexée, la reconnaissance de caractères n'est pas faite"]);
	});

	it('PDF en partie scanné : les pages sans texte sont comptées et signalées', async () => {
		const r = await extracteurs.pour('c.pdf').extraire('c.pdf', contenuEnMemoire(pdfDePages(['Contrat de maintenance', '', '', 'Signatures'])));
		expect(r.format).toBe('pdf');
		expect(r.markdown).toContain('Contrat de maintenance');
		expect(r.avertissements).toEqual(["2 pages sur 4 sans texte (scannées ?) : non indexées, la reconnaissance de caractères n'est pas faite"]);
		const complet = await extracteurs.pour('t.pdf').extraire('t.pdf', contenuEnMemoire(pdfDePages(['Une', 'Deux'])));
		expect(complet.avertissements).toBeUndefined();
	});

	it('Word avec image : aucune URI data: dans le Markdown', async () => {
		const r = await extracteurs.pour('d.docx')!.extraire('d.docx', contenuEnMemoire(await docx(true)));
		expect(r.markdown).not.toContain('data:');
		expect(r.markdown).not.toContain('![');
		expect(r.markdown).toContain('# Cahier des charges');
	});

	it('Word : bombe de décompression refusée avant toute conversion', async () => {
		const bombe = await docx(false, 3_000_000);
		expect(bombe.length).toBeLessThan(100_000);
		const e = await extracteurWord({ totalMax: 1_000_000, entreeMax: 1_000_000 }).extraire('b.docx', contenuEnMemoire(bombe)).catch((x) => x);
		expect(e).toBeInstanceOf(ErreurExtraction);
		expect(e.message).toContain('trop volumineux une fois décompressé');
		await expect(extracteurWord().extraire('b.docx', contenuEnMemoire(bombe))).resolves.toMatchObject({ format: 'docx' });
	});

	it('Markdown : « # » final retiré seulement après une espace, titres de blocs de code ignorés', async () => {
		const t = async (m: string) => (await extracteurs.pour('n.md')!.extraire('n.md', contenuEnMemoire(octets(m)))).titre;
		expect(await t('# C# et F#')).toBe('C# et F#');
		expect(await t('# Titre ##')).toBe('Titre');
		expect(await t('```\n# commentaire\n```\n\n# Vrai titre')).toBe('Vrai titre');
	});

	it('Word : entités XML numériques décodées dans les propriétés', async () => {
		const r = await lireProprietesWord(await docx());
		expect(r.titre).toBe('Propriété titre');
	});

	it('Word : archive Zip64 ou tronquée refusée (échec fermé) ; un .docx normal passe', async () => {
		const normal = await docx();
		const fin = normal.length - 22;
		const zip64 = new Uint8Array(fin + 56 + 20 + 22);
		const vue = new DataView(zip64.buffer);
		zip64.set(normal.subarray(0, fin));
		vue.setUint32(fin, 0x06064b50, true);
		vue.setUint32(fin + 56, 0x07064b50, true);
		zip64.set(normal.subarray(fin), fin + 76);
		vue.setUint16(fin + 76 + 10, 0xffff, true);
		vue.setUint32(fin + 76 + 16, 0xffffffff, true);
		for (const archive of [zip64, normal.subarray(0, normal.length - 40), octets('PK')]) {
			const e = await extracteurWord().extraire('z.docx', contenuEnMemoire(archive)).catch((x) => x);
			expect(e).toBeInstanceOf(ErreurExtraction);
			expect(e.message).toContain('Zip64 ou illisible');
		}
		await expect(extracteurWord().extraire('n.docx', contenuEnMemoire(normal))).resolves.toMatchObject({ format: 'docx' });
	});
});
