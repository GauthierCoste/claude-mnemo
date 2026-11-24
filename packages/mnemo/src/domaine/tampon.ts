/** Capacité du tampon de chaque session (caractères) : de quoi redessiner l'écran d'un client qui se (re)connecte. */
export const CAPACITE_TAMPON = 256 * 1024;

const estBasDePaire = (code: number): boolean => code >= 0xdc00 && code <= 0xdfff;

/** `texte` sans ses `n` premières unités, ni la moitié basse d'une paire de substitution coupée. */
function sansDebut(texte: string, n: number): string {
	let debut = n;
	while (debut < texte.length && estBasDePaire(texte.charCodeAt(debut))) debut++;
	return texte.slice(debut);
}

/**
 * Tampon circulaire de la sortie d'un terminal : garde les `capacite` dernières unités (UTF-16), en coupant le plus ancien
 * morceau ; jamais au milieu d'un caractère (paire de substitution). Ajouter ne copie que le morceau reçu.
 */
export function tamponCirculaire(capacite: number): { ajouter(d: string): void; lire(): string } {
	let morceaux: string[] = [];
	let taille = 0;
	return {
		ajouter(d) {
			if (d === '') return;
			if (d.length >= capacite) {
				morceaux = [sansDebut(d, d.length - capacite)];
				taille = morceaux[0]!.length;
				return;
			}
			morceaux.push(d);
			taille += d.length;
			while (taille > capacite) {
				const premier = morceaux[0]!;
				const exces = taille - capacite;
				if (premier.length <= exces) {
					morceaux.shift();
					taille -= premier.length;
				} else {
					const reste = sansDebut(premier, exces);
					morceaux[0] = reste;
					taille -= premier.length - reste.length;
				}
			}
		},
		lire() {
			const tout = morceaux.join('');
			morceaux = tout === '' ? [] : [tout];
			return tout;
		},
	};
}
