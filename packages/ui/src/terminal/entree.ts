/**
 * Saisie envoyée au service : un collage géant est découpé en trames d'au plus `TAILLE_MAX_ENTREE` octets UTF-8, sans
 * jamais couper un caractère (paire de substitution comprise).
 */
import { ENTREE_MAX_OCTETS } from '@mnemo/contrat';

/**
 * Plafond d'une trame `entree` (octets UTF-8) : celui du contrat, que le service vérifie ; échappée en JSON, une trame pleine
 * tient dans un message client (`MESSAGE_CLIENT_MAX_OCTETS`).
 */
export const TAILLE_MAX_ENTREE = ENTREE_MAX_OCTETS;

function octets(pointDeCode: number): number {
	if (pointDeCode < 0x80) return 1;
	if (pointDeCode < 0x800) return 2;
	if (pointDeCode < 0x10000) return 3;
	return 4;
}

export function decouperEntree(donnees: string, max = TAILLE_MAX_ENTREE): string[] {
	if (donnees.length * 3 <= max) return [donnees];
	const trames: string[] = [];
	let debut = 0;
	let taille = 0;
	let i = 0;
	while (i < donnees.length) {
		const point = donnees.codePointAt(i)!;
		const n = octets(point);
		if (taille + n > max) {
			trames.push(donnees.slice(debut, i));
			debut = i;
			taille = 0;
		}
		taille += n;
		i += point > 0xffff ? 2 : 1;
	}
	if (debut < donnees.length) trames.push(donnees.slice(debut));
	return trames;
}
