import { pluriel } from '../../pluriel.ts';

const NOMBRE = new Intl.NumberFormat('fr-FR');
const nombre = (n: number): string => NOMBRE.format(n);
const MENTIONS: Readonly<Record<string, string>> = { 'a confirmer': 'à confirmer', declare: 'déclaré', observe: 'observé', infere: 'inféré' };

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
	fiche: {
		edition: 'Édition',
		voirDansLeGraphe: 'Voir dans le graphe',
		deplacer: 'Déplacer',
		chargement: 'Chargement de la fiche…',
		proprietes: 'Propriétés',
		/** Nom de la propriété `updated`. */
		modifie: 'modifié',
		aVerifier: 'À vérifier dans cette fiche',
		markdown: 'Markdown de la fiche',
		aideMarkdown: 'Fichier Markdown, lisible aussi dans Obsidian',
		enregistree: 'Fiche enregistrée',
		deplaceeDans: (dossier: string) => `Fiche déplacée dans ${dossier}`,
		deplaceeALaRacine: 'Fiche déplacée à la racine',
		disparue: (erreur: string, enEdition: boolean) =>
			`Cette fiche n'existe plus à cet endroit (${erreur}).${enEdition ? ' Le texte reste dans la zone ; le copier avant de quitter.' : ''}`,
		relectureImpossible: (erreur: string) => `Relecture de la fiche impossible (${erreur}). La version affichée est peut-être dépassée.`,
		conflit: "La fiche a changé depuis l'ouverture. Le texte reste dans la zone : Recharger repart de la version du disque.",
		changeeSurLeDisque: 'La fiche a changé sur le disque pendant l’édition.',
		recharger: 'Recharger',
		refus: (motif: string) => `Enregistrement refusé : ${motif}`,
		plusSuggeree: (date: string) => `Mnemo ne suggère plus cette fiche, dans aucune session (« Ne plus jamais suggérer », le ${date}).`,
		retablir: 'Rétablir',
		retablirTitre: "Mnemo peut de nouveau la proposer en piste ou l'injecter",
		retablie: 'Mnemo peut de nouveau suggérer cette fiche',
		quitter: {
			titre: 'Modifications non enregistrées',
			texte: 'Modifications non enregistrées.',
			abandonner: 'Abandonner les modifications',
			rester: 'Rester',
		},
		deplacement: {
			dossier: 'Dossier d’arrivée',
			indication: 'Dossier d’arrivée (vide = racine)',
			ici: 'Déplacer ici',
		},
	},
	/** Corps d'une fiche rendu : groupes d'informations, mentions du format, liens. */
	rendu: {
		sansCategorie: 'sans catégorie',
		barrees: 'retirées ou périmées',
		/** Mention du format affichée avec ses accents (`a confirmer` → « à confirmer ») ; une mention inconnue telle quelle. */
		mention: (brute: string): string => MENTIONS[brute] ?? brute,
		corroboree: (le: string) => `corroboré ${le}`,
		ficheAbsente: (cible: string) => `Fiche « ${cible} » absente`,
	},
};
