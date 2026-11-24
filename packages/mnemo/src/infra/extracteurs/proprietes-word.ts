import JSZip from 'jszip';

export type ProprietesWord = { titre: string | null; auteur: string | null; date: string | null };
export type LimitesZip = { totalMax: number; entreeMax: number };
export const LIMITES_WORD: LimitesZip = { totalMax: 200 * 1024 * 1024, entreeMax: 100 * 1024 * 1024 };

/**
 * Tailles décompressées annoncées par le répertoire central du zip (lu directement dans le tampon, sans rien décompresser).
 * Null si le répertoire est illisible ou si l'archive est Zip64 (marqueurs dans la fin de répertoire, tailles 0xFFFFFFFF,
 * champs supplémentaires Zip64) : un vrai .docx n'est jamais Zip64.
 */
export function taillesDecompressees(zip: Uint8Array): number[] | null {
	const vue = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
	let fin = -1;
	for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 65535); i--) {
		if (vue.getUint32(i, true) === 0x06054b50) {
			fin = i;
			break;
		}
	}
	if (fin < 0) return null;
	if (fin >= 20 && vue.getUint32(fin - 20, true) === 0x07064b50) return null; // localisateur Zip64
	const nombre = vue.getUint16(fin + 10, true);
	const debut = vue.getUint32(fin + 16, true);
	if (nombre === 0xffff || vue.getUint32(fin + 12, true) === 0xffffffff || debut === 0xffffffff) return null;
	let p = debut;
	const tailles: number[] = [];
	for (let n = 0; n < nombre; n++) {
		if (p + 46 > zip.length || vue.getUint32(p, true) !== 0x02014b50) return null;
		const taille = vue.getUint32(p + 24, true);
		if (taille === 0xffffffff || vue.getUint32(p + 20, true) === 0xffffffff) return null;
		const nom = vue.getUint16(p + 28, true);
		const extra = vue.getUint16(p + 30, true);
		const commentaire = vue.getUint16(p + 32, true);
		if (p + 46 + nom + extra + commentaire > zip.length) return null;
		for (let q = p + 46 + nom, finExtra = q + extra; q + 4 <= finExtra; q += 4 + vue.getUint16(q + 2, true)) {
			if (vue.getUint16(q, true) === 0x0001) return null; // champ Zip64
		}
		tailles.push(taille);
		p += 46 + nom + extra + commentaire;
	}
	return tailles;
}

/** `illisible` : répertoire central illisible ou Zip64 ; `volumineux` : au-delà des limites ; null : acceptable. */
export function verifierZip(zip: Uint8Array, limites: LimitesZip): 'illisible' | 'volumineux' | null {
	const tailles = taillesDecompressees(zip);
	if (tailles === null) return 'illisible';
	return tailles.some((t) => t > limites.entreeMax) || tailles.reduce((a, b) => a + b, 0) > limites.totalMax ? 'volumineux' : null;
}

/** Propriétés du document (`docProps/core.xml`) ; vides si absentes ou illisibles. */
export async function lireProprietesWord(contenu: Uint8Array): Promise<ProprietesWord> {
	try {
		const xml = await (await JSZip.loadAsync(contenu)).file('docProps/core.xml')?.async('string');
		if (!xml) return { titre: null, auteur: null, date: null };
		return { titre: balise(xml, 'dc:title'), auteur: balise(xml, 'dc:creator'), date: balise(xml, 'dcterms:created')?.slice(0, 10) ?? null };
	} catch {
		return { titre: null, auteur: null, date: null };
	}
}

function balise(xml: string, nom: string): string | null {
	const m = new RegExp(`<${nom}[^>]*>([^<]*)</${nom}>`).exec(xml);
	if (!m) return null;
	return m[1]!
		.replace(/&#x([0-9a-f]+);/gi, (_, h: string) => caractere(parseInt(h, 16)))
		.replace(/&#(\d+);/g, (_, d: string) => caractere(parseInt(d, 10)))
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'")
		.replace(/&amp;/g, '&');
}

function caractere(code: number): string {
	try {
		return String.fromCodePoint(code);
	} catch {
		return '';
	}
}
