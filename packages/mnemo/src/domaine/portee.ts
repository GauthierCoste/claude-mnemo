import { cleDeCasse, dossiersAscendants, ficheDeDossier, positionDeFiche } from './chemin.ts';

/** Genres d'une portée nommée (`genre:nom`) ; `globale` vaut partout. */
export const GENRES_DE_PORTEE = ['stack', 'projet', 'client'] as const;
export type GenrePortee = (typeof GENRES_DE_PORTEE)[number];
export const PORTEE_GLOBALE = 'globale';
/** Genres dont les sessions ont leurs épisodes (`episodes/<nom>/`) : le projet d'une session. */
export const GENRES_A_EPISODES: readonly GenrePortee[] = ['projet', 'client'];
/** Clé du frontmatter : portée d'une consigne, ou portée que déclare le lieu d'une autre fiche. */
export const CLE_PORTEE = 'portee';

export type Portee = { genre: typeof PORTEE_GLOBALE } | { genre: GenrePortee; nom: string };
/**
 * Portée lue dans une fiche. `invalide` : valeur mal écrite, gardée telle quelle (`brute`) pour être montrée et réécrite ;
 * une telle consigne n'est jamais servie (on ne devine pas à qui elle s'adresse).
 */
export type PorteeLue = Portee | { genre: 'invalide'; brute: string };

const GLOBALE: Portee = { genre: PORTEE_GLOBALE };
const estGenre = (texte: string): texte is GenrePortee => (GENRES_DE_PORTEE as readonly string[]).includes(texte);

/** Absente : globale. Sinon `globale` ou `genre:nom` ; toute autre valeur est invalide. */
export function lirePortee(valeur: unknown): PorteeLue {
	if (valeur === undefined || valeur === PORTEE_GLOBALE) return GLOBALE;
	const brute = typeof valeur === 'string' ? valeur : valeur === null ? '' : String(valeur);
	const invalide = { genre: 'invalide' as const, brute };
	if (typeof valeur !== 'string') return invalide;
	const separateur = valeur.indexOf(':');
	if (separateur === -1) return invalide;
	const genre = valeur.slice(0, separateur);
	const nom = valeur.slice(separateur + 1).trim();
	if (!estGenre(genre) || nom === '') return invalide;
	return { genre, nom };
}

export function ecrirePortee(portee: PorteeLue): string {
	if (portee.genre === 'invalide') return portee.brute;
	return portee.genre === PORTEE_GLOBALE ? PORTEE_GLOBALE : `${portee.genre}:${portee.nom}`;
}

/** Un endroit de la mémoire qui peut porter une portée : un dossier (ou une fiche simple) et la fiche qui la déclare. */
export type Lieu = { position: string; fiche: string };

/** Lieux d'un chemin (fiche ou dossier), du plus profond au premier niveau ; la racine (« ») n'en a aucun. */
export function lieuxDe(chemin: string): Lieu[] {
	if (chemin === '') return [];
	const fiche = chemin.endsWith('.md') ? chemin : ficheDeDossier(chemin);
	const propre = positionDeFiche(fiche);
	const lieux: Lieu[] = [{ position: propre, fiche: propre === fiche ? fiche : ficheDeDossier(propre) }];
	for (const dossier of dossiersAscendants(fiche).reverse()) if (dossier !== propre) lieux.push({ position: dossier, fiche: ficheDeDossier(dossier) });
	return lieux;
}

/** Portée nommée qui s'applique à un chemin, avec la position du lieu qui la porte. */
export type PorteeDeLieu = { portee: string; genre: GenrePortee; nom: string; position: string };

/**
 * Portées nommées de ces lieux, du plus profond au premier niveau : pour chaque lieu, celle que sa fiche déclare (clé
 * `portee`, lue par `declaree`) ; le nom d'un dossier ne donne jamais de portée. Une portée vue à plusieurs niveaux garde son
 * rang le plus profond et la position la plus haute (le lieu le plus large qu'elle couvre).
 */
export function porteesDesLieux(lieux: readonly Lieu[], declaree: (fiche: string) => string | null): PorteeDeLieu[] {
	const sortie: PorteeDeLieu[] = [];
	for (const lieu of lieux) {
		const brute = declaree(lieu.fiche);
		const lue = brute === null ? null : lirePortee(brute);
		if (lue === null || lue.genre === 'invalide' || lue.genre === PORTEE_GLOBALE) continue;
		const texte = ecrirePortee(lue);
		const deja = sortie.find((p) => p.portee === texte);
		if (deja === undefined) sortie.push({ portee: texte, genre: lue.genre, nom: lue.nom, position: lieu.position });
		else deja.position = lieu.position;
	}
	return sortie;
}
