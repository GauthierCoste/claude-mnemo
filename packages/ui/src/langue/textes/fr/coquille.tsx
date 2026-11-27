import type { ReactNode } from 'react';

const HEURE = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' });
const JOUR = new Intl.DateTimeFormat('fr-FR', { weekday: 'short' });

/** La coquille de l'interface : barres de titre et d'état, navigation, palette, quotas, toasts, composants partagés, client. */
export const coquille = {
	vues: {
		navigation: 'Vues',
		sessions: 'Sessions',
		memoire: 'Mémoire',
		reglages: 'Réglages',
		pastilleSessions: (n: number): string => `${n} sessions attendent une réponse`,
		pastilleMemoire: (n: number): string => `${n} éléments à faire (Mémoire › Archiviste)`,
	},
	bandeauConnexion: 'Service arrêté — reconnexion…',
	barreStatut: {
		coffre: (racine: string): string => `coffre ${racine}`,
		terminauxDisponibles: 'terminaux disponibles',
		sansTerminaux: (motif: string): string => `sans terminaux : ${motif}`,
		connexion: {
			connexion: 'connexion au service…',
			ouverte: 'service connecté',
			reconnexion: 'service arrêté',
			jeton_refuse: 'jeton refusé',
		},
	},
	barreTitre: {
		fictif: 'données fictives',
		chercher: 'Chercher une session, un fichier, une fiche...',
		archiviste: 'Archiviste',
		archivisteAttendNom: 'Archiviste, attend une réponse',
		archivisteAttendBulle: 'L’archiviste attend une réponse',
	},
	ecranJeton: (mnemo: ReactNode, mnemoJeton: ReactNode): ReactNode => (
		<>
			Jeton absent ou périmé. Ouvrir une fois l'adresse avec jeton affichée par {mnemo} (ou par {mnemoJeton}) dans le terminal : ce
			navigateur sera reconnu, l'adresse sans jeton suffira ensuite.
		</>
	),
	palette: {
		nom: 'Palette de commandes',
		champ: 'Palette',
		filtresNom: 'Filtres',
		filtres: { tout: 'Tout', sessions: 'Sessions', fiches: 'Fiches', documents: 'Documents' },
		ceProjet: 'Ce projet',
		ceProjetSansObjet: 'Sans objet avec « Documents » : les documents ne se filtrent pas par projet.',
		resultats: 'Résultats',
		recherche: 'Recherche…',
		rien: (texte: string): string => `Rien ne correspond à « ${texte} ».`,
		indisponible: (motif: string): string => `Recherche indisponible : ${motif}`,
		modeles: {
			demarres: 'Modèles démarrés : les notes viendront à la prochaine recherche.',
			arretes: 'Mots seulement : modèles arrêtés.',
			demarrer: 'Démarrer les modèles',
			echec: ' Démarrage impossible.',
			absents: 'Mots seulement : modèles non installés.',
			chargement: 'Modèles en chargement : les notes viendront à la prochaine recherche.',
			coupes: 'Mots seulement : modèles coupés.',
			sens: 'Sans notes : sens seul, pas de reclassement.',
		},
		session: (id: string): string => `Session ${id}`,
		noteReranker: 'Note du reranker',
		page: (page: number): string => `, p. ${page}`,
		genres: {
			session: 'Session',
			archiviste: 'Archiviste',
			fiche: 'Fiche',
			document: 'Document',
			fait: 'Information',
			consigne: 'Consigne',
			passage: 'Passage',
			passageDocument: 'Passage de document',
		},
	},
	quotas: {
		/** « 18:00 » */
		heure: (ms: number): string => HEURE.format(ms),
		/** « lun. 09:00 » */
		jourHeure: (ms: number): string => `${JOUR.format(ms)} ${HEURE.format(ms)}`,
		cinqHeures: (pourcentage: number, remise: string): string => `5 heures : ${pourcentage} % (remise ${remise})`,
		semaine: (pourcentage: number, remise: string): string => `semaine : ${pourcentage} % (remise ${remise})`,
		detail: (abonnement: string, fenetres: string): string => `${abonnement} : ${fenetres}`,
		entreAbonnements: ' ; ',
		titre: (detail: string): string => `Quotas des abonnements, ${detail}`,
		nom: (detail: string, deplie: boolean): string => `Quotas des abonnements, ${detail}. ${deplie ? 'Replier' : 'Déplier'}`,
		cinqHeuresCourt: '5 h',
		semaineCourt: 'sem.',
		pourcentage: (n: number): string => `${n} %`,
	},
	toast: {
		avertissements: 'Avertissements',
		fermerAvertissement: 'Fermer l’avertissement',
	},
	terminal: {
		horsLigne: 'Hors ligne',
	},
	partage: {
		dePlus: (n: number): string => `${n} de plus`,
		toutVoir: 'Tout voir',
		copieImpossible: 'Copie impossible dans ce navigateur',
		largeurPanneau: (titre: string): string => `Largeur du panneau ${titre}`,
		separateur: (vertical: boolean): string => `Glisser pour ${vertical ? 'élargir' : 'agrandir'} · double-clic : taille par défaut`,
		avatar: (forme: string): string => `Avatar ${forme}`,
		liaison: {
			incomplete: 'Liaison incomplète.',
			liee: (moteur: string): string => `${moteur} lié à Mnemo.`,
			impossible: (moteur: string): string => `Liaison de ${moteur} impossible.`,
		},
	},
	arbre: {
		localiser: 'Localiser la fiche ouverte',
		localiserBulle: (raccourci: string): string => `Localiser la fiche ouverte (${raccourci})`,
		toutReplier: 'Tout replier',
		toutReplierBulle: (raccourci: string): string => `Tout replier (${raccourci})`,
		toutDeplier: 'Tout déplier',
		toutDeplierBulle: (raccourci: string): string => `Tout déplier (${raccourci})`,
		basculer: (deplie: boolean, dossier: string): string => `${deplie ? 'Replier' : 'Déplier'} ${dossier}`,
		projet: 'Projet',
		racine: 'racine',
		gitAJour: 'à jour',
		gitModifies: (n: number): string => `${n} modif.`,
		gitBulle: (branche: string | null, modifies: number): string => `branche ${branche ?? '(détachée)'}, ${modifies} fichiers modifiés`,
	},
	raccourcis: {
		maj: 'Maj',
	},
	client: {
		injoignable: 'Service injoignable.',
		jetonRefuse: 'Jeton refusé.',
		erreurService: (statut: number): string => `Erreur du service (${statut}).`,
	},
};
