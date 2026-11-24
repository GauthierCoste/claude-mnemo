/** Encodage et nature d'un fichier (texte ou binaire), d'après ses premiers octets : le service et l'interface les lisent. */

export const ENCODAGES = ['utf-8', 'utf-16le', 'utf-16be', 'windows-1252'] as const;
/** Noms reconnus par `TextDecoder`. */
export type Encodage = (typeof ENCODAGES)[number];
const LIBELLE_ENCODAGE: Record<Encodage, string> = { 'utf-8': 'UTF-8', 'utf-16le': 'UTF-16 LE', 'utf-16be': 'UTF-16 BE', 'windows-1252': 'Windows-1252' };

/** Encodage du repli : il décode toute suite d'octets (un texte ancien, d'un poste Windows, en est presque toujours). */
export const ENCODAGE_DE_REPLI: Encodage = 'windows-1252';

/**
 * Octets examinés pour reconnaître un fichier binaire (comme git : les 8 000 premiers). Un fichier reconnu binaire n'est
 * pas écarté en silence : son refus le dit (`motifSiNonCherchable`).
 */
export const ECHANTILLON_NATURE = 8000;
/** Part d'octets de contrôle dans l'échantillon au-delà de laquelle un fichier sans octet nul est binaire. */
export const PART_CONTROLE_BINAIRE = 0.3;
/** Octets de contrôle d'un texte ordinaire : tabulation, LF, FF, CR. */
const CONTROLES_DU_TEXTE: readonly number[] = [0x09, 0x0a, 0x0c, 0x0d];
const estControle = (o: number): boolean => (o < 0x20 || o === 0x7f) && !CONTROLES_DU_TEXTE.includes(o);

const MARQUES: { octets: number[]; encodage: Encodage }[] = [
	{ octets: [0xef, 0xbb, 0xbf], encodage: 'utf-8' },
	{ octets: [0xff, 0xfe], encodage: 'utf-16le' },
	{ octets: [0xfe, 0xff], encodage: 'utf-16be' },
];

/** La marque d'ordre des octets (BOM) en tête, et sa longueur ; null sans marque. */
export function marqueDOrdre(debut: Uint8Array): { encodage: Encodage; longueur: number } | null {
	const trouvee = MARQUES.find((m) => m.octets.every((o, i) => debut[i] === o));
	return trouvee === undefined ? null : { encodage: trouvee.encodage, longueur: trouvee.octets.length };
}

/**
 * Vrai si les premiers octets (`ECHANTILLON_NATURE` au plus) contiennent un octet nul, ou plus de `PART_CONTROLE_BINAIRE`
 * d'octets de contrôle ; un texte UTF-16 marqué n'est jamais binaire (ses octets nuls sont ceux de l'encodage).
 */
export function estBinaire(debut: Uint8Array): boolean {
	const marque = marqueDOrdre(debut);
	if (marque !== null && marque.encodage !== 'utf-8') return false;
	const echantillon = debut.subarray(0, ECHANTILLON_NATURE);
	if (echantillon.includes(0)) return true;
	return echantillon.length > 0 && echantillon.filter(estControle).length / echantillon.length > PART_CONTROLE_BINAIRE;
}

/**
 * Avertissement d'un texte qui n'est pas en UTF-8 : lu par sa marque d'ordre des octets, ou supposé (repli après un UTF-8
 * invalide) ; null pour l'UTF-8.
 */
export function avertissementEncodage(encodage: Encodage, suppose: boolean): string | null {
	if (encodage === 'utf-8') return null;
	return suppose
		? `encodage supposé ${LIBELLE_ENCODAGE[encodage]} (le fichier n'est pas de l'UTF-8 valide)`
		: `encodage ${LIBELLE_ENCODAGE[encodage]} (marque en tête du fichier)`;
}
