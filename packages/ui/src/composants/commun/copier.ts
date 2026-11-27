import { TEXTES } from '../../langue/textes.ts';

/**
 * Copie un texte dans le presse-papiers et le dit par un toast ; navigateur sans presse-papiers ou refus → toast d'échec
 * (`impossible`, `coquille.partage.copieImpossible` de la langue de l'appelant).
 */
export function copierTexte(texte: string, toast: (message: string) => void, reussite: string, impossible: string = TEXTES.fr.coquille.partage.copieImpossible): void {
	const presse = typeof navigator !== 'undefined' ? navigator.clipboard : undefined;
	if (!presse) {
		toast(impossible);
		return;
	}
	presse.writeText(texte).then(
		() => toast(reussite),
		() => toast(impossible),
	);
}
