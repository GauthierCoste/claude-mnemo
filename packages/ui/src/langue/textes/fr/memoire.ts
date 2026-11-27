import { pluriel } from '../../pluriel.ts';

const NOMBRE = new Intl.NumberFormat('fr-FR');
const nombre = (n: number): string => NOMBRE.format(n);

/** Vue Mémoire : onglets, Fichiers (arbre, fiche, liens), Graph 3D, Entraîner. */
export const memoire = {
	vue: {
		onglets: 'Mémoire',
		archiviste: (n: number) => `Archiviste (${n})`,
		fichiers: 'Fichiers',
		graphe: 'Graph 3D',
		entrainer: 'Entraîner',
		aRelireTitre: (n: number) => `${n} ${pluriel('fr', n, { un: 'message', autre: 'messages' })} à relire`,
		aRelireHorsEcran: (n: number) => ` (${n} à relire)`,
		largeurLiens: 'Largeur du panneau Liens',
		largeurArbre: 'Largeur du panneau Arbre',
		choisirFiche: "Choisir une fiche dans l'arbre.",
		liensFiche: 'Liens de la fiche',
		chargementGraphe: 'Chargement du graphe…',
		/** « n fiches | n informations | n liens » */
		statistiques: (fiches: number, informations: number, liens: number) => `${nombre(fiches)} fiches | ${nombre(informations)} informations | ${nombre(liens)} liens`,
	},
	arbre: {
		filtrer: 'Filtrer les fichiers',
		fiches: 'Fiches',
		chargement: 'Chargement…',
		aucuneCorrespondance: 'Aucune fiche ne correspond.',
		aucune: 'Aucune fiche.',
		nombreFiches: (n: number) => `${n} ${pluriel('fr', n, { un: 'fiche', autre: 'fiches' })}`,
		debut: (n: number) => `Afficher le début (${nombre(n)} lignes avant)`,
		dePlus: (n: number) => `${nombre(n)} lignes de plus : filtrer, ou replier des dossiers.`,
	},
	liens: {
		titre: 'Liens de la fiche',
		entrants: (n: number) => `Liens entrants (${n})`,
		sortants: (n: number) => `Liens sortants (${n})`,
		sessions: (n: number) => `Sessions qui l'ont utilisée (${n})`,
		aucun: 'Aucun.',
		aucune: 'Aucune.',
		session: (debutId: string) => `Session ${debutId}`,
		ficheAbsente: (titre: string) => `Fiche « ${titre} » absente`,
	},
};
