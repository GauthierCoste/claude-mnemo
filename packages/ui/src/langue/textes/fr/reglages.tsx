import type { ReactNode } from 'react';
import { pluriel } from '../../pluriel.ts';

/**
 * Vue Réglages : onglets, onglet Réglages (Branchements, Mémoire, Système), cartes et champs, moteurs, app Claude. `champs` :
 * libellé, explication, unité et libellés des choix de chaque réglage du service, par sa clé (repli sur le texte du service
 * pour une clé inconnue) ; `disposition` : le libellé court de chaque réglage dans sa carte.
 */
export const reglages = {
	gestes: { abandonner: 'Abandonner', toutAbandonner: 'Tout abandonner', rester: 'Rester' },
	vue: {
		titre: 'Réglages',
		onglets: { agents: 'Agents', reglages: 'Réglages', documentation: 'Documentation' },
		sections: 'Sections des réglages',
		geste: 'Un moteur attend un geste (Branchements)',
		retenu: 'Modifications non enregistrées dans cet onglet : les abandonner ?',
	},
	onglet: {
		sections: {
			branchements: { titre: 'Branchements', sous: 'moteurs et app Claude' },
			memoire: { titre: 'Mémoire', sous: 'rappel, recherche, confiance' },
			systeme: { titre: 'Système', sous: 'service, modèles, interface' },
		},
		geste: 'Un moteur attend un geste',
		gesteHorsEcran: '(un moteur attend un geste)',
		modifie: 'modifié',
		chargement: 'Chargement des réglages…',
		/** `reglages`, `schema` : les noms de fichier en `<code>` ; `raccourci` : en `<kbd>`. */
		fichiers: (reglages: ReactNode, schema: ReactNode, raccourci: ReactNode): ReactNode => (
			<>
				Dans {reglages} ; les règles de la mémoire (confiance, seuil de rappel) dans {schema}, versionné (un commit). Raccourci : {raccourci}
			</>
		),
		avertissements: 'Avertissements',
		redemarrage: (libelles: string): string => `Redémarrage du service requis pour : ${libelles} — « mnemo arreter » puis « mnemo ouvrir ».`,
		branchements: 'Les moteurs des agents, et ce que l’app Claude peut utiliser.',
		sortieDouble:
			'Deux saisies non enregistrées : des réglages (Mémoire, Système) et un serveur MCP (ci-dessus, dans Branchements). Enregistrer les réglages laisse le serveur à enregistrer ensuite ; Tout abandonner perd les deux.',
		sortie: 'Modifications non enregistrées : les enregistrer avant de quitter les Réglages ?',
		enregistrerReglages: 'Enregistrer les réglages',
		erreur: 'Enregistrement impossible.',
		nonEnregistre: 'Modifié, non enregistré',
		enregistre: 'Enregistré.',
	},
	service: {
		enMarche: 'En marche',
		version: (version: string): string => `version ${version}`,
		port: (port: string, enAttente: boolean): string => `port ${port}${enAttente ? ' au prochain démarrage' : ''}`,
	},
	cartes: {
		rappel: {
			titre: 'Rappel',
			sous: 'Ce que Mnemo injecte dans les sessions, et ce qu’il propose en pistes.',
			note: 'Note de confiance',
			projet: 'Un projet, c’est un dossier avec…',
			fins: 'Réglages fins',
		},
		recherche: {
			titre: 'Recherche',
			sous: 'Ce que remontent l’outil chercher et la recherche de l’interface, et dans quel ordre.',
			devant: 'Ce qui passe devant',
			fins: 'Réglages fins',
		},
		confiance: {
			titre: 'Confiance',
			sous: 'À qui Mnemo fait confiance, et ce que l’archiviste écrit sans confirmation.',
			fiabilite: 'Fiabilité des sources',
			fait: 'Un fait vaut…',
			archiviste: 'L’archiviste écrit seul…',
		},
		systeme: { titre: 'Système', sous: 'Mnemo qui tourne ici, et sa tête.', service: 'Service', modeles: 'Modèles locaux', interface: 'Interface' },
	},
	disposition: {
		'contexte.seuilInjection': 'Seuil d’injection',
		'contexte.injectionsParMessage': 'Fiches injectées',
		'contexte.seuilPiste': 'Seuil des pistes',
		'contexte.pistesParMessage': 'Pistes proposées',
		'entrainement.automatique': 'Réapprentissage automatique',
		'entrainement.automatique.aide': 'en fond, au plus une fois par jour',
		'projets.marqueurs': 'Marqueurs de projet',
		'contexte.similariteRecherche': 'Similarité min.',
		'contexte.poidsInjection': 'Poids d’une injection à la main',
		'contexte.demiVieInjection': 'Demi-vie',
		'contexte.cartesNommees': 'Fiches nommées',
		'recherche.poidsPosition': 'Projet en cours',
		'recherche.poidsConfiance': 'Confiance',
		'recherche.poidsMemoire': 'Fiches de la mémoire',
		'recherche.poidsFraicheur': 'Fraîcheur',
		'recherche.resultats': 'Résultats / recherche',
		'memoire.seuilRappel': 'Seuil de rappel',
		'recherche.chronologie': 'Chronologie',
		'recherche.graphe': 'Graphe',
		'recherche.reranker': 'Reranker',
		'memoire.fiabilite_utilisateur': 'Toi',
		'memoire.fiabilite_contrat': 'Contrat',
		'memoire.fiabilite_spec_validee': 'Spéc. validée',
		'memoire.fiabilite_compte_rendu': 'Compte rendu',
		'memoire.fiabilite_email': 'E-mail',
		'memoire.fiabilite_note': 'Note',
		'memoire.fiabilite_session': 'Session',
		'memoire.fiabilite_deduction': 'Déduction',
		'memoire.fiabilite_inconnue': 'Inconnue',
		'memoire.poids_declare': 'Déclaré',
		'memoire.poids_observe': 'Observé',
		'memoire.poids_infere': 'Inféré',
		'memoire.repetitions': 'Redites avant de proposer une consigne',
		'archiviste.typesAConfirmer': 'Types de fiche',
		'service.navigateur': 'S’ouvre dans',
		'service.navigateur.aide': 'au lancement de Mnemo',
		'service.port': 'Port',
		'service.port.aide': 'l’adresse de l’interface',
		'modeles.inactiviteMinutes': 'S’endorment après',
		'interface.accent': 'Couleur de l’interface',
		'interface.langue': 'Langue',
	},
	champs: {
		'contexte.seuilInjection': {
			libelle: 'Seuil d’injection automatique',
			explication: 'Note minimale d’une fiche pour être injectée dans la session sans geste ; 100 % : jamais. Agit seulement avec une note calibrée (modèle de note accepté).',
		},
		'contexte.injectionsParMessage': {
			libelle: 'Fiches injectées automatiquement par message',
			explication: 'Fiches injectées au plus dans la session à chaque message, les mieux notées d’abord, au-dessus du seuil d’injection ; 0 : jamais.',
			unite: 'fiches',
		},
		'contexte.seuilPiste': {
			libelle: 'Seuil des pistes',
			explication:
				'Note minimale d’une piste (carte proposée sans injecter la fiche dans la session), jamais au-dessus du seuil d’injection. Agit dès qu’une note est apprise ou livrée avec Mnemo, même refusée ; sans note apprise, les premières de l’ordre.',
		},
		'contexte.pistesParMessage': {
			libelle: 'Pistes par message',
			explication: 'Cartes (titre, chemin, première phrase) proposées au plus à chaque message pour des fiches nouvelles, à injecter dans la session d’un geste ; 0 : aucune.',
			unite: 'cartes',
		},
		'contexte.cartesNommees': {
			libelle: 'Cartes des fiches nommées par message',
			explication: 'Cartes proposées au plus, à chaque message, pour les fiches dont le titre ou un alias est cité dans le message.',
			unite: 'cartes',
		},
		'contexte.poidsInjection': {
			libelle: 'Poids d’une fiche injectée à la main sur ses voisines',
			explication: 'Ajouté à la note des fiches reliées à une fiche injectée à la main, de 0 à 1 (0,25 : 25 points ; le sens du message vaut de 0 à 1).',
		},
		'contexte.demiVieInjection': {
			libelle: 'Demi-vie de ce poids, en messages',
			explication: 'Messages (hors messages muets) après lesquels le poids d’une fiche injectée à la main sur ses voisines a diminué de moitié.',
			unite: 'messages',
		},
		'contexte.similariteRecherche': {
			libelle: 'Similarité minimale (recherche)',
			explication: 'Proximité de sens minimale d’un résultat de recherche (outils, interface, CLI), de 0 à 1.',
		},
		'entrainement.automatique': {
			libelle: 'Réapprentissage automatique de la note',
			explication: 'Réapprendre la note en fond à partir des gestes (➤, ✗, fiches lues), au plus une fois par jour ; un modèle accepté n’est jamais remplacé par un refusé.',
		},
		'archiviste.typesAConfirmer': {
			libelle: 'Types de fiche à confirmer',
			explication: 'Une information proposée dans une fiche de ces types attend une confirmation avant d’être injectée.',
		},
		'recherche.resultats': {
			libelle: 'Résultats par recherche',
			explication: 'Résultats rendus par `chercher` quand la demande n’en fixe pas le nombre (outils, interface).',
		},
		'recherche.chronologie': { libelle: 'Résultats de la chronologie', explication: 'Faits rendus par `chronologie` quand la demande n’en fixe pas le nombre.' },
		'recherche.graphe': { libelle: 'Fiches suivies par le graphe', explication: 'Premières fiches de la recherche dont les liens sont suivis (un saut).' },
		'recherche.reranker': {
			libelle: 'Candidats au reranker',
			explication: 'Premiers candidats reclassés par le reranker (s’il tourne) ; plus, c’est plus juste et plus lent.',
		},
		'recherche.poidsPosition': {
			libelle: 'Poids du projet courant',
			explication: 'Ajouté à la note d’un résultat situé dans le voisinage du projet courant, de 0 à 0,5 (0,1 : 10 points ; la pertinence vaut de 0 à 1).',
		},
		'recherche.poidsConfiance': {
			libelle: 'Poids de la confiance',
			explication: 'Retiré à la note d’un résultat peu fiable, au prorata de ce qui manque à sa confiance, de 0 à 0,5 (0,05 : 5 points au plus).',
		},
		'recherche.poidsMemoire': {
			libelle: 'Poids de la mémoire',
			explication: 'Ajouté à la note d’un résultat qui vient de la mémoire (fiches et faits), de 0 à 0,5 (0,05 : 5 points).',
		},
		'recherche.poidsFraicheur': {
			libelle: 'Poids de la fraîcheur',
			explication: 'Ajouté à la note d’un résultat récent, de 0 à 0,5, réduit de moitié après un an (0,05 : 5 points au plus).',
		},
		'projets.marqueurs': {
			libelle: 'Marqueurs de projet',
			explication: 'Un dossier qui contient l’un de ces fichiers ou dossiers porte ◆ dans l’arbre des dossiers (casse ignorée).',
		},
		'modeles.inactiviteMinutes': {
			libelle: 'Arrêt pour inactivité',
			explication:
				'Les modèles locaux s’arrêtent après ce temps sans requête, que le service tourne ou non ; le prochain usage les relance. Partagés par toute la machine, ils gardent le délai du dossier qui les a démarrés.',
			unite: 'minutes',
		},
		'service.port': {
			libelle: 'Port du service',
			explication: 'Port local de l’interface ; le changer change son adresse (favori, application installée, lanceur).',
		},
		'service.navigateur': {
			libelle: 'Navigateur du lanceur',
			explication: 'Navigateur qui ouvre la fenêtre de Mnemo (« mnemo ouvrir » et le lanceur macOS).',
			choix: {
				auto: 'Automatique (Chrome, sinon Edge, sinon par défaut)',
				chrome: 'Google Chrome',
				edge: 'Microsoft Edge',
				brave: 'Brave',
				arc: 'Arc',
				defaut: 'Navigateur par défaut',
			},
		},
		'interface.accent': {
			libelle: 'Couleur principale de l’interface',
			explication: 'Couleur des éléments actifs, des liens, des titres, du focus et du logo.',
		},
		'interface.langue': {
			libelle: 'Langue de l’interface',
			explication: 'Langue de l’interface et de l’app de bureau ; « Langue du système » suit la langue du système. Le contenu de la mémoire n’est jamais traduit.',
			// chaque langue écrite dans sa propre langue, quelle que soit la langue de l'interface
			choix: { systeme: 'Langue du système', fr: 'Français', en: 'English' },
		},
		'memoire.seuilRappel': {
			libelle: 'Seuil de rappel',
			explication: 'Pertinence minimale d’un résultat de recherche pour qu’il soit rappelé aux sessions ; la confiance d’un fait ne pèse que sur son rang.',
		},
		'memoire.repetitions': {
			libelle: 'Répétitions pour monter une consigne',
			explication: 'Fois où une consigne est redite avant que Mnemo propose de la rendre toujours présente.',
		},
		'memoire.poids_declare': { libelle: 'Poids d’un fait déclaré', explication: 'Multiplie la fiabilité de la source pour donner la confiance du fait.' },
		'memoire.poids_observe': { libelle: 'Poids d’un fait observé', explication: 'Multiplie la fiabilité de la source pour donner la confiance du fait.' },
		'memoire.poids_infere': { libelle: 'Poids d’un fait inféré', explication: 'Multiplie la fiabilité de la source pour donner la confiance du fait.' },
		'memoire.fiabilite_utilisateur': { libelle: 'Fiabilité : Utilisateur', explication: 'Fiabilité d’une information de source « utilisateur ».' },
		'memoire.fiabilite_contrat': { libelle: 'Fiabilité : Contrat', explication: 'Fiabilité d’une information de source « contrat ».' },
		'memoire.fiabilite_spec_validee': { libelle: 'Fiabilité : Spécification validée', explication: 'Fiabilité d’une information de source « spec_validee ».' },
		'memoire.fiabilite_compte_rendu': { libelle: 'Fiabilité : Compte rendu', explication: 'Fiabilité d’une information de source « compte_rendu ».' },
		'memoire.fiabilite_email': { libelle: 'Fiabilité : Email', explication: 'Fiabilité d’une information de source « email ».' },
		'memoire.fiabilite_note': { libelle: 'Fiabilité : Note', explication: 'Fiabilité d’une information de source « note ».' },
		'memoire.fiabilite_session': { libelle: 'Fiabilité : Session', explication: 'Fiabilité d’une information de source « session ».' },
		'memoire.fiabilite_deduction': { libelle: 'Fiabilité : Déduction', explication: 'Fiabilité d’une information de source « deduction ».' },
		'memoire.fiabilite_inconnue': { libelle: 'Fiabilité : Source inconnue', explication: 'Fiabilité d’une information de source « inconnue ».' },
	},
	effets: {
		seuilInjection: {
			jamais: 'Jamais d’injection automatique.',
			presqueCertaines: 'Seulement les fiches presque certaines.',
			tresSures: 'Les fiches très sûres entrent seules.',
			genereux: 'Mnemo injecte généreusement.',
		},
		injectionsParMessage: {
			aucune: 'Rien n’entre sans un geste.',
			jusqua: (n: number): string => `Jusqu’à ${n} ${pluriel('fr', n, { un: 'fiche', autre: 'fiches' })} par message.`,
		},
		seuilPiste: {
			auDessus: (injection: number): string => `Au-dessus du seuil d’injection (${injection} %) : refusé à l’enregistrement.`,
			presqueTout: 'Presque tout peut devenir une piste.',
			solides: 'Seules les pistes solides sont proposées.',
			plausibles: 'Les pistes plausibles sont proposées.',
		},
		pistesParMessage: {
			aucune: 'Aucune piste.',
			cartes: (n: number): string => `${n} ${pluriel('fr', n, { un: 'carte', autre: 'cartes' })} à injecter d’un geste.`,
		},
		inactiviteMinutes: {
			econes: 'Économes : ils redémarrent souvent, et la recherche attend alors leur réveil.',
			toujoursPrets: 'Toujours prêts, mais environ 1,6 Go de mémoire vive occupés longtemps.',
			equilibre: 'Un bon équilibre.',
		},
		remarqueSeuil: {
			sansEffet: 'Sans effet pour l’instant : la note de confiance n’est pas encore acceptée (Mémoire › Entraîner).',
			mesuree: (mesure: number, n: number): string => `Note mesurée à ${mesure} % : la réapprendre pour la mesurer à ${n} %.`,
		},
	},
	champ: {
		effets: { service: 'Redémarrage du service requis', modeles: 'Au prochain démarrage des modèles' },
		fixePar: (variable: string): string => `Fixé par ${variable}`,
		fixeParDetail: (variable: string): string => `La variable d’environnement ${variable} du service l’emporte sur ce réglage tant qu’elle est posée.`,
		/** `retablir` : le bouton « Rétablir ». */
		defaut: (valeur: string, retablir: ReactNode): ReactNode => (
			<>
				Défaut : {valeur} · {retablir}
			</>
		),
		retablir: 'Rétablir',
		retablirDefaut: (libelle: string): string => `Rétablir le défaut : ${libelle}`,
		infobulleBarre: (libelle: string, explication: string): string => `${libelle} : ${explication}`,
		tous: 'tous',
		aucun: 'aucun',
		oui: 'oui',
		non: 'non',
		/** « 0,45 » */
		decimal: (n: number): string => String(n).replace('.', ','),
		/** « 0,40 » : deux décimales, sur les barres. */
		decimalBarre: (n: number): string => n.toFixed(2).replace('.', ','),
	},
	nuancier: {
		vertOrigine: 'Vert d’origine',
		violet: 'Violet',
		bleu: 'Bleu',
		ambre: 'Ambre',
		rouge: 'Rouge',
		selecteur: 'Ouvrir le sélecteur de couleur du système',
		personnalisee: 'Personnalisée',
		couleurPersonnalisee: 'Couleur personnalisée',
		codeHex: 'Code hexadécimal de la couleur',
		codeInvalide: 'Code attendu : # puis 6 caractères (0 à 9, a à f)',
		contraste: (rapport: number, minimum: number): string =>
			`Cette couleur se lit mal sur le fond sombre (contraste ${rapport.toFixed(1).replace('.', ',')}:1, au moins ${minimum}:1 conseillé) : les liens, filets et titres seront peu visibles.`,
	},
	puces: {
		retirer: (nom: string): string => `Retirer ${nom}`,
		ajouter: '+ ajouter',
		ajouterA: (libelle: string): string => `Ajouter : ${libelle}`,
		exemple: 'ex. Makefile',
	},
	moteurs: {
		titre: 'Moteurs',
		premiereVerification: 'Vérification des moteurs… (quelques secondes)',
		verification: 'Vérification…',
		verifie: (heure: string): string => `Vérifié à ${heure}`,
		relire: 'Relire',
		illisible: (erreur: string): string => `État des moteurs illisible : ${erreur}`,
		pret: '● prêt',
		statuts: {
			pret: 'Prêt',
			'a-lier': 'À lier',
			'a-approuver': 'À approuver',
			'a-verifier': 'À vérifier',
			'a-mettre-a-jour': 'À mettre à jour',
			'a-regler': 'À régler',
			introuvable: 'Introuvable',
			'pas-installe': 'Pas installé',
		},
		/** Les points vérifiés du poste, par leur clé. */
		points: { commande: 'Commande', version: 'Version', mcp: 'Serveur MCP mnemo', hooks: 'Hooks de Mnemo', approbation: 'Approbation des hooks' },
		titres: {
			point: (libelle: string, etat: string): string => `${libelle} : ${etat}.`,
			perimee: (moteur: string): string => `La liaison de ${moteur} à Mnemo est périmée.`,
			nonLie: (moteur: string): string => `${moteur} n’est pas lié à Mnemo.`,
			pasInstalle: 'Pas installé sur ce poste.',
			introuvable: (moteur: string): string => `${moteur} introuvable maintenant.`,
			approbationInconnue: (moteur: string): string => `Approbation des hooks inconnue dans ${moteur}.`,
			hooksAApprouver: (moteur: string): string => `Hooks à approuver dans ${moteur}.`,
		},
		motifs: {
			niMemoireNiSuivi: 'Ses sessions lancées hors de Mnemo ne lisent pas la mémoire, et Mnemo ne suit pas ses sessions.',
			sansMemoire: 'Ses sessions lancées hors de Mnemo ne lisent pas la mémoire.',
			sansSuivi: 'Mnemo ne suit pas ses sessions.',
			approbation: 'Tant qu’ils ne le sont pas, Mnemo ne suit pas ses sessions.',
		},
		action: {
			copiee: 'Commande copiée.',
			dansMoteur: (moteur: string): string => `À taper dans ${moteur} :`,
			ouTerminal: 'Ou dans un terminal :',
			terminal: 'Dans un terminal :',
			liaison: 'Liaison…',
			lier: 'Lier à Mnemo',
			copierCommande: (commande: string): string => `Copier « ${commande} »`,
			copier: 'Copier',
			puisRelire: 'puis « Relire ».',
		},
		/** « Claude Code (modèle par défaut) » */
		modeleParDefaut: 'modèle par défaut',
	},
	appClaude: {
		titre: 'App Claude',
		etats: {
			absent: 'Pas branchée : l’app Claude ne voit pas la mémoire.',
			branche: 'Claude lit et écrit la mémoire.',
			perime: 'Son entrée ne correspond plus à cette installation (autre Node, autre emplacement de Mnemo ou autre dossier).',
		},
		erreur: 'Écriture impossible.',
		lecture: 'Lecture de la configuration de l’app Claude…',
		absente: 'L’app Claude n’est pas installée sur ce poste.',
		fichier: 'Fichier :',
		illisible: 'Mnemo ne réécrit jamais un fichier qu’il ne sait pas lire : à corriger, puis rouvrir les Réglages.',
		redemarrer: 'Redémarrer l’app Claude pour prendre ce changement en compte.',
		memoire: {
			liste: 'Mémoire Mnemo dans l’app Claude',
			nom: 'Mémoire Mnemo',
			mettreAJour: 'Mettre à jour',
			debrancher: 'Débrancher',
			branchee: 'Mémoire Mnemo branchée',
		},
		serveurs: {
			liste: 'Serveurs MCP',
			/** `complet` : l'infobulle, qui dit aussi pourquoi. */
			lectureSeule: (complet: boolean): string => (complet ? 'lecture seule : décrit autrement que par une commande, Mnemo ne le modifie pas, il peut seulement le retirer' : 'lecture seule'),
			variables: (noms: string): string => ` · variables : ${noms}`,
			modifier: 'Modifier',
			retirerDemande: 'Retirer…',
			confirmer: (nom: string): string => `Retirer le serveur « ${nom} » de l’app Claude ? Sa configuration (variables comprises) est effacée du fichier.`,
			retirer: 'Retirer',
			garder: 'Garder',
			ajouter: '+ Ajouter un serveur',
		},
		formulaire: {
			modifier: (nom: string): string => `Modifier le serveur « ${nom} »`,
			ajouter: 'Ajouter un serveur MCP',
			nom: 'Nom',
			commande: 'Commande',
			exempleCommande: 'npx, uvx, chemin d’un exécutable…',
			arguments: 'Arguments',
			unParLigne: 'Un par ligne.',
			variables: 'Variables',
			aideVariablesModification:
				'NOM=valeur, une par ligne. Les valeurs enregistrées ne sont jamais montrées : NOM seul garde la valeur actuelle, une ligne effacée retire la variable.',
			aideVariables: 'NOM=valeur, une par ligne.',
			sortie: 'Serveur MCP non enregistré : l’enregistrer avant de quitter les Réglages ?',
			ajouterBouton: 'Ajouter',
		},
		motifs: {
			sansNom: 'Variable sans nom : une ligne commence par « = ».',
			nomInvalide: (ligne: number): string => `Variables, ligne ${ligne} : nom invalide (lettres, chiffres et « _ », sans chiffre au début), à écrire NOM=valeur.`,
			double: (nom: string): string => `Variable « ${nom} » écrite deux fois.`,
			sansValeur: (nom: string): string => `Variable « ${nom} » sans valeur : écrire ${nom}=valeur.`,
		},
	},
};
