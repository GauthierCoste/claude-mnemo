import type { Position } from '../../application/position.ts';
import type { Dependances } from '../../application/ports.ts';
import { consignesPermanentes } from '../../application/servir.ts';
import { tronquerTexte } from '../../domaine/texte.ts';

/** Claude Code coupe les instructions d'un serveur à 4 096 caractères : on garde une marge. */
export const LIMITE_INSTRUCTIONS = 3500;

export const SANS_MEMOIRE = 'Aucune mémoire Mnemo ne couvre ce dossier.';

export { INSTRUCTIONS_SESSION } from '../../application/consignes-par-defaut.ts';

const TITRE_CONSIGNES = 'Consignes à suivre toujours :';
const reste = (n: number) => `… (${n} consigne(s) de plus : appelle \`contexte\`)`;

/**
 * Instructions du serveur, calculées une fois au démarrage (elles restent celles de toute la session) : le profil, la
 * position, puis les consignes permanentes de la position. Au-delà de la borne, ce qui dépasse est coupé à la fin, entre
 * deux consignes (jamais au milieu de l'une), avec le nombre de consignes laissées.
 */
export async function instructions(dep: Dependances, position: Position, profil: string): Promise<string> {
	const tete = `${profil.trim()}\n\nPosition dans la mémoire : ${position.chemin === '' ? 'la racine' : position.chemin}.`;
	if (tete.length > LIMITE_INSTRUCTIONS) return `${tronquerTexte(tete, LIMITE_INSTRUCTIONS - 1, 'utf16')}…`;

	const consignes = (await consignesPermanentes(dep, position)).map((texte) => `- ${texte.replace(/\s+/gu, ' ').trim()}`);
	if (consignes.length === 0) return tete;
	let texte = `${tete}\n\n${TITRE_CONSIGNES}`;
	for (const [i, ligne] of consignes.entries()) {
		const restantes = consignes.length - i - 1;
		// la mention du reste doit encore tenir si une consigne suivante saute
		const place = LIMITE_INSTRUCTIONS - (restantes > 0 ? reste(restantes).length + 1 : 0);
		if (texte.length + 1 + ligne.length > place) {
			const mention = `\n${reste(consignes.length - i)}`;
			if (texte.length + mention.length <= LIMITE_INSTRUCTIONS) return texte + mention;
			// aucune consigne ne tient (pas même le titre et la mention) : on s'arrête à la position ; sinon `texte` tient (place réservée)
			return i === 0 ? tete : texte;
		}
		texte += `\n${ligne}`;
	}
	return texte;
}
