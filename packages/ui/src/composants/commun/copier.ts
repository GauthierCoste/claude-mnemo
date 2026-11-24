/** Copie un texte dans le presse-papiers et le dit par un toast ; navigateur sans presse-papiers ou refus → toast d'échec. */
export function copierTexte(texte: string, toast: (message: string) => void, reussite: string): void {
	const presse = typeof navigator !== 'undefined' ? navigator.clipboard : undefined;
	if (!presse) {
		toast('Copie impossible dans ce navigateur');
		return;
	}
	presse.writeText(texte).then(
		() => toast(reussite),
		() => toast('Copie impossible dans ce navigateur'),
	);
}
