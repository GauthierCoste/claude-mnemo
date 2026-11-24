/**
 * Texte lisible d'un fichier binaire, pour y chercher termes, chemins, adresses et secrets :
 * - chaînes imprimables (ASCII et UTF-8 : au moins 4 octets) et chaînes UTF-16 (petit et gros boutiste) ; couvre l'EXIF et
 *   l'XMP bruts des JPEG, le dictionnaire Info et l'XMP non compressés des PDF, les métadonnées de la plupart des formats ;
 * - PNG : blocs tEXt, zTXt et iTXt, décompressés au besoin ;
 * - PDF : flux FlateDecode décompressés, et chaînes hexadécimales (`<FEFF…>` en UTF-16).
 * Chaque segment porte son lieu (octet de départ, bloc PNG, flux PDF) pour retrouver le constat.
 */
import { inflateSync } from 'node:zlib';

export type Segment = { texte: string; lieu: string };

const LONGUEUR_MIN = 4;

function imprimable(o: number): boolean {
	return o === 0x09 || (o >= 0x20 && o <= 0x7e);
}

/** Suites d'octets imprimables ou ≥ 0x80 (UTF-8), décodées en UTF-8. */
function chainesSimples(octets: Buffer, prefixe: string): Segment[] {
	const r: Segment[] = [];
	let debut = -1;
	const fermer = (fin: number) => {
		if (debut >= 0 && fin - debut >= LONGUEUR_MIN) r.push({ texte: octets.toString('utf8', debut, fin), lieu: `${prefixe}octet ${debut}` });
		debut = -1;
	};
	for (let i = 0; i < octets.length; i++) {
		const o = octets[i]!;
		if (imprimable(o) || o >= 0x80) {
			if (debut < 0) debut = i;
		} else fermer(i);
	}
	fermer(octets.length);
	return r;
}

/** Suites de caractères ASCII imprimables codés sur deux octets (UTF-16, petit ou gros boutiste). */
function chainesUtf16(octets: Buffer, prefixe: string, petitBoutiste: boolean): Segment[] {
	const r: Segment[] = [];
	for (const parite of [0, 1]) {
		let debut = -1;
		let texte = '';
		const fermer = () => {
			if (texte.length >= LONGUEUR_MIN) r.push({ texte, lieu: `${prefixe}octet ${debut} (UTF-16)` });
			debut = -1;
			texte = '';
		};
		for (let i = parite; i + 1 < octets.length; i += 2) {
			const [car, zero] = petitBoutiste ? [octets[i]!, octets[i + 1]!] : [octets[i + 1]!, octets[i]!];
			if (zero === 0 && imprimable(car)) {
				if (debut < 0) debut = i;
				texte += String.fromCharCode(car);
			} else fermer();
		}
		fermer();
	}
	return r;
}

function chaines(octets: Buffer, prefixe = ''): Segment[] {
	return [...chainesSimples(octets, prefixe), ...chainesUtf16(octets, prefixe, true), ...chainesUtf16(octets, prefixe, false)];
}

function inflater(octets: Buffer): Buffer | null {
	try {
		return inflateSync(octets);
	} catch {
		return null;
	}
}

const SIGNATURE_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function blocsTextePng(octets: Buffer): Segment[] {
	const r: Segment[] = [];
	for (let i = 8; i + 8 <= octets.length; ) {
		const longueur = octets.readUInt32BE(i);
		const type = octets.toString('latin1', i + 4, i + 8);
		const donnees = octets.subarray(i + 8, Math.min(octets.length, i + 8 + longueur));
		const nul = donnees.indexOf(0);
		const cle = nul < 0 ? '' : donnees.toString('latin1', 0, nul);
		if (type === 'tEXt' && nul >= 0) r.push({ texte: `${cle} ${donnees.toString('latin1', nul + 1)}`, lieu: 'PNG tEXt' });
		if (type === 'zTXt' && nul >= 0) {
			const texte = inflater(donnees.subarray(nul + 2));
			if (texte) r.push({ texte: `${cle} ${texte.toString('latin1')}`, lieu: 'PNG zTXt' });
		}
		if (type === 'iTXt' && nul >= 0) {
			const compresse = donnees[nul + 1] === 1;
			const langue = donnees.indexOf(0, nul + 3);
			const traduit = langue < 0 ? -1 : donnees.indexOf(0, langue + 1);
			if (traduit >= 0) {
				const brut = donnees.subarray(traduit + 1);
				const texte = compresse ? inflater(brut) : brut;
				const entete = donnees.toString('utf8', nul + 3, traduit).replace(/\0/g, ' ');
				if (texte) r.push({ texte: `${cle} ${entete} ${texte.toString('utf8')}`, lieu: 'PNG iTXt' });
			}
		}
		if (type === 'IEND') break;
		i += 12 + longueur;
	}
	return r;
}

function textePdf(octets: Buffer): Segment[] {
	const r: Segment[] = [];
	const latin = octets.toString('latin1');
	const flux = /stream\r?\n/g;
	let n = 0;
	for (let m = flux.exec(latin); m; m = flux.exec(latin)) {
		const debut = m.index + m[0].length;
		const fin = latin.indexOf('endstream', debut);
		if (fin < 0) break;
		n++;
		const texte = inflater(octets.subarray(debut, fin));
		if (texte) r.push(...chaines(texte, `PDF flux ${n}, `));
		flux.lastIndex = fin;
	}
	for (const h of latin.matchAll(/<([0-9A-Fa-f\s]{8,})>/g)) {
		const hex = h[1]!.replace(/\s/g, '');
		if (hex.length % 2 !== 0) continue;
		const b = Buffer.from(hex, 'hex');
		const texte = b[0] === 0xfe && b[1] === 0xff ? Buffer.from(b.subarray(2)).swap16().toString('utf16le') : b.toString('latin1');
		r.push({ texte, lieu: `PDF chaîne hexadécimale, octet ${h.index}` });
	}
	return r;
}

export function segmentsBinaires(octets: Buffer): Segment[] {
	const r = chaines(octets);
	if (octets.subarray(0, 8).equals(SIGNATURE_PNG)) r.push(...blocsTextePng(octets));
	if (octets.subarray(0, 5).toString('latin1') === '%PDF-') r.push(...textePdf(octets));
	return r;
}
