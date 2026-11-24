/**
 * Branche un écran de terminal (xterm derrière la petite interface `Ecran`) sur la connexion du service : abonnement
 * compté à la session, relecture qui remet l'écran à zéro avant d'écrire (jamais d'écran doublé après une reconnexion),
 * saisie envoyée en `entree`, taille ajustée après stabilisation et envoyée par le seul terminal actif.
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useClient } from '../client/contexte.tsx';
import { decouperEntree } from './entree.ts';
import { ATTENTE_REDIMENSION_MS, TAILLE_MIN, tailleAEnvoyer, type Taille } from './taille.ts';

export type Ecran = {
	/** `fini` : appelé quand xterm a traité les données (son écriture est asynchrone). */
	ecrire(d: string, fini?: () => void): void;
	reinitialiser(): void;
	surSaisie(f: (d: string) => void): () => void;
	dimensions(): Taille;
	/** Taille que le conteneur permet (FitAddon.proposeDimensions) ; null si le conteneur est caché. */
	ajuster(): Taille | null;
	redimensionner(colonnes: number, lignes: number): void;
	focus(): void;
	detruire(): void;
};

/** Classe que porte un ancêtre (grille, `body`) pendant le glissement d'un séparateur : on attend la fin pour ajuster. */
export const CLASSE_GLISSEMENT = 'drag';

export function useTerminal(
	session: string | null,
	ecran: Ecran | null,
	o: {
		/** A le focus : seul à envoyer `taille`. */
		actif: boolean;
		/** Élément observé (`ResizeObserver`) pour réajuster le terminal quand il change de taille. */
		conteneur?: HTMLElement | null;
		/** Toute valeur dont le changement demande un réajustement sans changement du conteneur (taille de la police). */
		reajuster?: unknown;
	},
): {
	connecte: boolean;
	/** Connexion perdue (`reconnexion`, `jeton_refuse`) ou saisie refusée : la carte affiche « Hors ligne ». Pas pendant la première connexion. */
	horsLigne: boolean;
} {
	const { connexion } = useClient();
	const etat = useSyncExternalStore(connexion.surEtat, connexion.etat, connexion.etat);
	const connecte = etat === 'ouverte';
	const [refusee, setRefusee] = useState(false);
	const refuseeCourante = useRef(false);
	const marquerRefus = useCallback((r: boolean) => {
		if (refuseeCourante.current === r) return;
		refuseeCourante.current = r;
		setRefusee(r);
	}, []);
	const conteneur = o.conteneur ?? null;
	const actif = useRef(o.actif);
	actif.current = o.actif;
	const derniere = useRef<Taille | null>(null);
	const planifier = useRef<() => void>(() => {});

	// Une nouvelle connexion ouverte efface un refus de saisie passé.
	useEffect(() => {
		if (connecte) marquerRefus(false);
	}, [connecte, marquerRefus]);

	// Flux du terminal et saisie.
	useEffect(() => {
		if (!session || !ecran) return;
		// Nouvelle session sur cet écran : rien de l'ancienne ne reste ; la relecture redonnera l'écran entier.
		ecran.reinitialiser();
		// Relectures en cours d'écriture : xterm répond aux requêtes qu'elles rejouent (`\x1b[c`…) ; ces réponses-là ne
		// partent pas, `claude` les a déjà reçues la première fois.
		let relecturesEnCours = 0;
		const finAbonnement = connexion.abonner(session, (m) => {
			if (m.type === 'relecture') {
				relecturesEnCours++;
				ecran.reinitialiser();
				ecran.ecrire(m.donnees, () => void relecturesEnCours--);
			} else if (m.type === 'sortie') ecran.ecrire(m.donnees);
			// `retard` : la connexion a déjà redemandé la relecture, qui remettra l'écran à zéro.
		});
		// Un collage géant part en trames bornées, dans l'ordre ; au premier refus (connexion fermée), on s'arrête et la
		// carte affiche « Hors ligne » : rien n'est mis en attente ni perdu en silence.
		const finSaisie = ecran.surSaisie((donnees) => {
			if (relecturesEnCours > 0) return;
			for (const trame of decouperEntree(donnees)) {
				if (!connexion.envoyer({ type: 'entree', session, donnees: trame })) {
					marquerRefus(true);
					return;
				}
			}
			marquerRefus(false);
		});
		return () => {
			finSaisie();
			finAbonnement();
		};
	}, [connexion, session, ecran, marquerRefus]);

	// Taille : ajustée après `ATTENTE_REDIMENSION_MS` de calme, toujours appliquée à xterm, envoyée par le seul terminal actif.
	useEffect(() => {
		if (!session || !ecran) return;
		let minuteur: ReturnType<typeof setTimeout> | null = null;
		const ajuster = () => {
			minuteur = null;
			if (conteneur?.closest(`.${CLASSE_GLISSEMENT}`)) {
				relancer();
				return;
			}
			// Sous 20×5, la cellule est repliée ou cachée (FitAddon propose au moins 2×1) : xterm garde sa taille et son
			// tampon de défilement, rien n'est envoyé.
			const brute = ecran.ajuster();
			const proposee = brute && brute.colonnes >= TAILLE_MIN.colonnes && brute.lignes >= TAILLE_MIN.lignes ? brute : null;
			if (proposee) {
				const d = ecran.dimensions();
				if (d.colonnes !== proposee.colonnes || d.lignes !== proposee.lignes) ecran.redimensionner(proposee.colonnes, proposee.lignes);
			}
			if (!actif.current) return;
			const t = tailleAEnvoyer(proposee, derniere.current);
			if (t && connexion.envoyer({ type: 'taille', session, colonnes: t.colonnes, lignes: t.lignes })) derniere.current = t;
		};
		const relancer = () => {
			if (minuteur !== null) clearTimeout(minuteur);
			minuteur = setTimeout(ajuster, ATTENTE_REDIMENSION_MS);
		};
		planifier.current = relancer;
		const observateur = conteneur && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => relancer()) : null;
		if (conteneur) observateur?.observe(conteneur);
		relancer();
		return () => {
			observateur?.disconnect();
			if (minuteur !== null) clearTimeout(minuteur);
			planifier.current = () => {};
		};
	}, [connexion, session, ecran, conteneur]);

	useEffect(() => planifier.current(), [o.reajuster]);

	// Devenu actif, ou connexion rouverte : la taille est renvoyée (une autre carte a pu imposer la sienne).
	useEffect(() => {
		if (!o.actif || !connecte) return;
		derniere.current = null;
		planifier.current();
	}, [o.actif, connecte, session, ecran]);

	return { connecte, horsLigne: refusee || etat === 'reconnexion' || etat === 'jeton_refuse' };
}
