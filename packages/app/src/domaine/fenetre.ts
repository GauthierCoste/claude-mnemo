/**
 * Fenêtre de l'app : l'interface du service, chargée sur `http://127.0.0.1:<port>/`. Le jeton passe par le fragment
 * (`#jeton=`, jamais envoyé sur le réseau ; l'interface le range puis l'efface de l'adresse), une session à ouvrir aussi
 * (`#session=`). Toute navigation hors de l'origine du service est refusée ; un lien `http`/`https` ailleurs s'ouvre
 * dans le navigateur. Taille et position retenues d'une ouverture à l'autre, si elles tiennent encore sur un écran.
 */

/** Adresse locale où le service écoute (jamais `localhost`, qui peut se résoudre ailleurs). */
export const HOTE_SERVICE = '127.0.0.1';

export function origineService(port: number): string {
	return `http://${HOTE_SERVICE}:${port}`;
}

/**
 * Adresse de la fenêtre : l'interface du service, le jeton (chargement) et la session à ouvrir dans le fragment
 * (`#jeton=…&session=…`, que l'interface lit ensemble), ou la session seule (page déjà chargée avec son jeton).
 */
export function adresseFenetre(port: number, fragment: { jeton: string; session?: string } | { session: string }): string {
	const parties: string[] = [];
	if ('jeton' in fragment) parties.push(`jeton=${encodeURIComponent(fragment.jeton)}`);
	if (fragment.session !== undefined) parties.push(`session=${encodeURIComponent(fragment.session)}`);
	return `${origineService(port)}/#${parties.join('&')}`;
}

/** `autoriser` : même origine que le service ; `externe` : lien `http`/`https` ailleurs (le navigateur) ; sinon `refuser`. */
export type DecisionNavigation = 'autoriser' | 'externe' | 'refuser';

export function decisionNavigation(adresse: string, origine: string): DecisionNavigation {
	let url: URL;
	try {
		url = new URL(adresse);
	} catch {
		return 'refuser';
	}
	if (url.origin === origine) return 'autoriser';
	return url.protocol === 'http:' || url.protocol === 'https:' ? 'externe' : 'refuser';
}

/**
 * La fenêtre est l'app : barre de titre de macOS masquée, l'interface dessine la sienne (44 px de haut, retrait à gauche
 * pour les trois boutons de la fenêtre, qu'on y centre verticalement). L'interface le sait par la marque `MnemoApp/` de
 * son agent utilisateur.
 */
export const HAUTEUR_BARRE_TITRE = 44;
/** Boutons de la fenêtre (16 points de haut) centrés dans la barre de titre de l'interface. */
export const POSITION_BOUTONS_FENETRE = { x: 14, y: (HAUTEUR_BARRE_TITRE - 16) / 2 } as const;
/** Fond de la fenêtre avant que l'interface ne s'affiche (pas d'éclair blanc) : `--bg` de `packages/ui/src/styles/jetons.css`. */
export const FOND_FENETRE = '#09090b';
export const MARQUE_APP = 'MnemoApp';

/** Agent utilisateur de la fenêtre : celui d'Electron suivi de ` MnemoApp/<version>`. */
export function agentUtilisateur(defaut: string, version: string): string {
	return `${defaut} ${MARQUE_APP}/${version}`;
}

/** Position et taille d'une fenêtre (ou zone utile d'un écran), en points. */
export type Bornes = { x: number; y: number; largeur: number; hauteur: number };

export const TAILLE_DEFAUT = { largeur: 1280, hauteur: 820 } as const;
export const TAILLE_MIN = { largeur: 900, hauteur: 600 } as const;
/** Part d'une fenêtre retenue qui doit tomber sur un écran (en points, sur chaque axe) pour qu'on la rouvre là. */
const VISIBLE_MIN = 80;

const entier = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && Math.abs(v) <= 100_000;

/** Bornes lues des préférences : quatre entiers, taille au moins minimale ; sinon null. */
export function validerBornes(brut: unknown): Bornes | null {
	if (typeof brut !== 'object' || brut === null) return null;
	const { x, y, largeur, hauteur } = brut as Record<string, unknown>;
	if (!entier(x) || !entier(y) || !entier(largeur) || !entier(hauteur)) return null;
	if (largeur < TAILLE_MIN.largeur || hauteur < TAILLE_MIN.hauteur) return null;
	return { x, y, largeur, hauteur };
}

/**
 * Bornes à l'ouverture : celles retenues si au moins `VISIBLE_MIN` points de chaque côté tombent sur la zone utile d'un des
 * écrans (un écran débranché depuis ne la cache pas) ; sinon null (taille par défaut, centrée).
 */
export function bornesAOuvrir(retenues: Bornes | null, ecrans: readonly Bornes[]): Bornes | null {
	if (retenues === null) return null;
	const visible = ecrans.some((e) => {
		const l = Math.min(retenues.x + retenues.largeur, e.x + e.largeur) - Math.max(retenues.x, e.x);
		const h = Math.min(retenues.y + retenues.hauteur, e.y + e.hauteur) - Math.max(retenues.y, e.y);
		return l >= VISIBLE_MIN && h >= VISIBLE_MIN;
	});
	return visible ? retenues : null;
}
