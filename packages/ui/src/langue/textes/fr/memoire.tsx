import type { ReactNode } from 'react';
import { pluriel } from '../../pluriel.ts';

const NOMBRE = new Intl.NumberFormat('fr-FR');
const HEURE = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' });
const deux = (n: number): string => String(n).padStart(2, '0');
/** « 26/11 », heure locale. */
const jourMois = (ms: number): string => {
	const d = new Date(ms);
	return `${deux(d.getDate())}/${deux(d.getMonth() + 1)}`;
};
/** `1 message`, `3 messages` : au-delà de 1, le pluriel (accord des participes compris). */
const accorder = (n: number, un: string, autre: string): string => `${n} ${pluriel('fr', n, { un, autre })}`;
const MOIS_ANNEE =new Intl.DateTimeFormat('fr-FR', { month: 'short', year: 'numeric', timeZone: 'UTC' });
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
	graphe: {
		etats: { a_confirmer: 'À confirmer', a_reprendre: 'À reprendre', illisible: 'Illisible' },
		typesDeLien: { parente: 'Parenté', personnalise: 'Lien personnalisé' },
		relationDansUnFait: 'cité dans une information',
		legende: {
			titre: 'Légende et filtre',
			types: 'Types de lien',
			toutAfficher: 'Tout afficher',
			lienCasse: 'Lien cassé',
			notion: 'Notion',
			sansNotion: 'Sans notion',
			sansRemarque: 'Sans remarque',
			sansDate: 'Sans date de validité',
			racine: 'Racine du coffre',
			periodes: { avenir: "Valide à partir d'une date à venir", moinsDUnAn: "Moins d'un an", unATroisAns: '1 à 3 ans', plusDeTroisAns: 'Plus de 3 ans' },
		},
		/** Graduations de l'axe du temps. */
		axe: {
			moisAnnee: (ms: number) => MOIS_ANNEE.format(ms),
			sansDate: 'Sans date',
		},
		/** Nom du cran de densité des étiquettes (de 0, aucune, à 4, toutes). */
		densite: (cran: number) => ['Aucune', 'Peu', 'Normale', 'Beaucoup', 'Toutes'][cran] ?? '',
		webgl: 'La vue 3D demande WebGL, indisponible dans ce navigateur.',
		grandeMemoire: (fiches: number, tropGrande: boolean) =>
			`Mémoire de ${nombre(fiches)} fiches : le graphe montre une branche à la fois (2 500 fiches au plus).${tropGrande ? ' Aucune branche ne tient sous ce plafond : celle-ci reste grande.' : ''}`,
		vide: 'La mémoire ne contient encore aucune fiche.',
		illisible: (erreur: string) => `Le graphe n'a pas pu être lu : ${erreur}`,
		lecture: 'Lecture de la mémoire…',
		aide: 'glisser pour tourner | molette pour zoomer | clic pour choisir | glisser un point pour le déplacer',
		/** Bulle d'un lien survolé. */
		bulleLien: (source: string, relation: string, cible: string) => `${source} : ${relation} → ${cible}`,
		pilotage: {
			titre: 'Lecture du graphe',
			compteurs: (fiches: number, liens: number, casses: number, sansRelation: number) =>
				`${nombre(fiches)} fiches | ${nombre(liens)} liens | ${nombre(casses)} cassés | ${nombre(sansRelation)} sans relation`,
			lecture: 'Lecture du graphe',
			disposition: 'Disposition',
			dispositions: {
				forces: 'Graphe de liens',
				constellations: 'Constellations par branche',
				notions: 'Constellations par notion',
				temps: 'Axe du temps',
				tempsTitre: 'Date médiane des débuts de validité des informations actives',
			},
			couleur: 'Couleur',
			couleurs: { branche: 'Branche principale', sousdossier: 'Sous-dossier', etat: 'État mémoire', periode: 'Période de validité', notion: 'Notion principale' },
			taille: 'Taille',
			tailles: { relations: 'Nombre de relations', faits: "Nombre d'informations actives", uniforme: 'Uniforme' },
			arbre: 'Arbre',
			branche: 'Branche',
			toutLeCoffre: 'Tout le coffre',
			optionBranche: (nom: string, fiches: number) => `${nom} (${nombre(fiches)})`,
			relations: 'Relations',
			aucuneRelation: 'Aucune relation dans la mémoire.',
			affichage: 'Affichage',
			liensCasses: 'Liens cassés',
			rotation: 'Rotation lente',
			etiquettes: (cran: ReactNode) => <>Étiquettes : {cran}</>,
			epingles: "Glisser une fiche l'épingle à sa place ; Alt + clic la libère.",
			liberer: (n: number) => `Libérer les nœuds épinglés (${n})`,
			recadrer: 'Recadrer',
		},
		recherche: {
			indication: 'Titre, alias, informations ( / )',
			chercher: 'Chercher dans la mémoire',
			filtres: (actifs: number) => (actifs ? `Filtres (${actifs})` : 'Filtres'),
			etat: 'État',
			tousLesEtats: 'Tous les états',
			categorie: 'Catégorie',
			toutesLesCategories: 'Toutes les catégories',
			optionCategorie: (categorie: string, fiches: number) => `${categorie} (${nombre(fiches)})`,
			liens: 'Liens',
			indifferent: 'Indifférent',
			sansRelation: 'Sans relation',
			nombreux: '5 relations et plus',
			casses: 'Cite une fiche absente',
			etatRecherche: (fiches: number, enCours: boolean) =>
				`${nombre(fiches)} ${pluriel('fr', fiches, { un: 'fiche', autre: 'fiches' })}${enCours ? ', recherche dans les informations…' : ''}`,
			effacer: 'Effacer',
			alias: (alias: string) => `alias : ${alias}`,
			dansLesInformations: 'Dans les informations et le texte des fiches',
			erreur: "La recherche dans les informations n'a pas pu être faite.",
			aucune: 'Aucune fiche ne correspond.',
		},
		carte: {
			titre: 'Fiche choisie',
			fiche: 'Fiche',
			vide: 'Un clic sur un point montre la fiche.',
			absente: 'Fiche citée mais absente de la mémoire.',
			voisinage: 'Voisinage',
			liensDirects: 'Liens directs',
			jusquA: (liens: number) => `Jusqu'à ${liens} liens`,
			centrer: 'Centrer',
			fermerFiche: 'Fermer la fiche',
			reliesA: (n: number) => `Relié à (${n})`,
			ouvrir: 'Ouvrir la fiche',
		},
	},
	/** Mémoire › Entraîner : la note de confiance et son entraînement. Vocabulaire : « note de confiance », « injecter ». */
	entrainer: {
		niveaux: { complets: 'Complets', sens: 'Sens seul' },
		/** L'état d'une note en un mot (puce) ; la note est féminine. */
		etats: { accepte: 'Acceptée', coupe: 'Injection coupée', refuse: 'Refusée', depart: 'De départ', non_appris: 'Pas entraînée' },
		/** « Complets et Sens seul » */
		nomsDesNiveaux: (noms: readonly string[]) => noms.join(' et '),
		/** « 82 % » d'une part de 0 à 1. */
		pourcent: (part: number) => `${Math.round(part * 100)} %`,
		/** « 26/11/2026 à 14:05 », heure locale. */
		dateEtHeure: (ms: number) => `${new Date(ms).toLocaleDateString('fr-FR')} à ${HEURE.format(ms)}`,
		sansValeur: '—',
		livreeAvecMnemo: 'livrée avec Mnemo',
		apprise: (quand: string) => `apprise le ${quand}`,
		taches: { preparer: 'Préparation des messages', prejuger: 'Pré-jugement par Claude', apprendre: 'Apprentissage de la note' },
		jugesDepuisApprentissage: (n: number) =>
			n === 0 ? 'Aucun message jugé depuis le dernier apprentissage' : `${accorder(n, 'message jugé', 'messages jugés')} depuis le dernier apprentissage`,
		serviceMuet: 'Le service n’a pas répondu.',
		page: {
			illisible: (erreur: string) => `État de l’entraînement illisible : ${erreur}`,
			relire: 'Relire',
			derniereTacheEchouee: 'La dernière tâche a échoué.',
		},
		entete: {
			titre: 'Note de confiance',
			autresActions: 'Autres actions sur la note',
			revenir: 'Revenir au modèle d’avant',
			revenirIndisponible: 'Indisponible pendant un apprentissage.',
			revenirDetail: 'Remet le modèle remplacé par le dernier apprentissage. Refaire ce geste revient à celui-ci.',
			revenu: 'Modèle d’avant rétabli.',
		},
		/** Bandeau d'avancement vers les vrais résultats. */
		avancement: {
			titre: 'Vers les vrais résultats',
			explicationSansApprentissage:
				'Les vrais résultats (des % justes, et Mnemo qui injecte seul) viennent quand assez de fiches, de sessions et de messages « Rien d’utile ici » sont jugés. L’avancement est connu au premier apprentissage.',
			/** `parNiveau` : la part de chaque niveau (« Complets 40 % »), vide avec un seul niveau. */
			explication: (seuil: string, parNiveau: readonly string[]) =>
				`Les vrais résultats (des % justes, et Mnemo qui injecte seul) viennent quand les trois volumes sont atteints, puis la précision. L’avancement est celui du volume le plus en retard : c’est lui qui bloque. Mesuré au dernier apprentissage, au seuil de ${seuil}.${parNiveau.length > 0 ? ` ${parNiveau.join(', ')}.` : ''}`,
			partDuNiveau: (niveau: string, part: string) => `${niveau} ${part}`,
			inchange: (depuis: number) => `inchangé depuis le ${jourMois(depuis)}`,
			ecart: (points: number, depuis: number) => `${points > 0 ? '+' : '−'}${Math.abs(points)} pts depuis le ${jourMois(depuis)}`,
			ecartTitre: (quand: string) => `Écart avec l’apprentissage du ${quand}.`,
			volumes: { injections: 'fiches injectables', sessions: 'sessions', silences: '« Rien d’utile ici »' },
			/** Ce qu'un volume compte, pour son infobulle ; `seuil` ne sert qu'aux fiches injectables. */
			sensDesVolumes: {
				injections: (cible: number, seuil: string) => `Fiches que Mnemo injecterait seul, notées au-dessus de ${seuil} (il en faut ${cible}).`,
				sessions: (cible: number, _seuil: string) => `Sessions où Mnemo injecterait au moins une fiche (il en faut ${cible}).`,
				silences: (cible: number, _seuil: string) => `Messages jugés « Rien d'utile ici » (il en faut ${cible}).`,
			},
			venusDeSessions: (fait: number, cible: number) => ` Venus de ${fait} sessions, il en faut ${cible}.`,
			volumeAtteintResteQualite: 'volume atteint ; reste la qualité',
			qualite: (critere: string) => `volume atteint ; reste la qualité : ${critere}`,
			connuAuPremier: 'connu au premier apprentissage',
			/** « sessions 12/40 » ; `fait` arrive mis en forme (gras). */
			volume: (nom: string, fait: ReactNode, cible: number) => (
				<>
					{nom} {fait}/{cible}
				</>
			),
			volumeAtteint: 'Volume atteint',
		},
		tache: {
			titre: 'Tâche en cours',
			enCours: (nom: string) => `${nom}…`,
			compte: (fait: number, total: number) => ` ${fait} sur ${total}`,
			depuis: (heure: string) => `depuis ${heure}`,
			arreter: 'Arrêter',
			/** Ce que garde un arrêt. */
			arret: {
				preparer: 'Arrêter garde les messages déjà préparés.',
				prejuger: 'Arrêter garde les propositions déjà reçues.',
				apprendre: 'Arrêter laisse le modèle actuel en place.',
			},
		},
		etapes: {
			titre: 'Étapes de l’entraînement',
			etape: (numero: number) => `Étape ${numero} : `,
			tacheEnCours: 'Une tâche est en cours',
			preparer: {
				titre: 'Préparer des messages',
				aide: 'Tirés des dernières sessions, avec les fiches que Mnemo aurait proposées.',
				prepares: (n: number) => accorder(n, 'message préparé', 'messages préparés'),
				nombre: 'Nombre de messages à préparer',
				unite: 'messages',
				bouton: 'Préparer',
				bornes: (max: number) => `De 1 à ${max} messages.`,
				/** Jauge : `valides` arrive mis en forme. */
				jauge: (valides: ReactNode, conseilles: number) => (
					<>
						{valides} validés sur ~{conseilles} conseillés
					</>
				),
				jaugeTitre: 'Messages validés',
			},
			juger: {
				titre: 'Juger',
				aucunPrepare: 'Aucun message préparé',
				aJuger: (n: number) => `${n} à juger`,
				dontARelire: (n: number) => `, dont ${n} pré-jugés par Claude, à relire`,
				bouton: 'Juger',
				relire: (n: number) => `Relire (${n})`,
				accepter: 'Accepter les sûres',
				accepterTitre: 'Valide les messages dont Claude est sûr à 90 % ou plus pour chaque fiche',
				preparerDAbord: 'Préparer d’abord des messages.',
				tousJuges: 'Tous les messages préparés sont jugés.',
				aucunSur: 'Aucun message sûr à 90 % ou plus : les relire.',
				acceptes: (n: number) => `${accorder(n, 'message validé', 'messages validés')} avec les propositions sûres.`,
				claudeIntrouvable: 'Claude Code est introuvable sur ce poste.',
				dejaProposees: 'Chaque message à juger a déjà ses propositions.',
				prejuger: 'Pré-juger avec Claude',
				cout: (appels: number) => `${accorder(appels, 'appel', 'appels')} à Claude Code, un par message, sur l’abonnement Claude.`,
			},
			apprendre: {
				titre: 'Apprendre',
				fichesJugees: (n: number) => accorder(n, 'fiche jugée', 'fiches jugées'),
				dansMessages: (n: number) => ` dans ${accorder(n, 'message validé', 'messages validés')}`,
				bouton: 'Apprendre la note',
				aucunJugement: 'Aucun jugement validé : juger des messages d’abord.',
				aide: 'Le nouveau modèle remplace l’actuel, même refusé ; le modèle d’avant reste à portée (menu ⋯).',
			},
		},
		resultat: {
			titre: 'Dernier apprentissage',
			quand: (date: string, messages: number, sessions: number) => `${date} – ${accorder(messages, 'message', 'messages')} de ${accorder(sessions, 'session', 'sessions')}`,
			garde: 'Le modèle d’alors a été gardé.',
			toujoursRefuse: 'Toujours refusé : ce modèle remplace celui d’alors, sans % non plus, et ordonne le classement.',
			remplace: 'Son modèle a remplacé le modèle d’alors.',
			manque: 'Ce qui a manqué :',
			fiabilite: (jugements: number) => `Table de fiabilité (${accorder(jugements, 'jugement', 'jugements')})`,
			note: 'Note',
			jugements: 'Jugements',
			jugementsTitre: 'Une fiche jugée pour un message : la même fiche jugée pour deux messages compte deux fois',
			noteMoyenne: 'Note moyenne',
			utiles: 'Réellement utiles',
			/** Une tranche de notes, de `de` à `a` (0 à 1) : « 80 – 90 % ». */
			tranche: (de: number, a: number) => `${Math.round(de * 100)} – ${Math.round(a * 100)} %`,
		},
		historique: {
			titre: 'Historique',
			date: 'Date',
			origine: 'Origine',
			modele: 'Modèle',
			origines: { manuel: 'Manuel', automatique: 'Automatique' },
			gardeEchec: 'Gardé (échec)',
			remplace: 'Remplacé',
			garde: 'Gardé',
		},
		/** L'écran de jugement d'un message. Vocabulaire : « Utile », « Pas utile », « Je ne sais pas », « Rien d'utile ici ». */
		jugement: {
			noms: { pertinente: 'Utile', non_pertinente: 'Pas utile', indecise: 'Je ne sais pas' },
			/** « Message 3 – 2 autres à juger » ; `restants` : messages encore à juger après celui-ci. */
			progression: (numero: number, restants: number) =>
				`Message ${numero} – ${restants === 0 ? 'le dernier à juger' : `${restants} ${restants > 1 ? 'autres' : 'autre'} à juger`}`,
			/** « Claude propose « Utile » (sûr à 96 %) : raison » ; `raison` vide : sans elle. */
			proposition: (jugement: string, confiance: string, raison: string) => `Claude propose « ${jugement} » (sûr à ${confiance})${raison === '' ? '' : ` : ${raison}`}`,
			synthese: 'Synthèse',
			titre: 'Juger',
			toutEstJuge: 'Tout est jugé',
			rienAJuger: 'Rien à juger',
			annulerDernier: 'Annuler le dernier',
			annulerTitre: 'Rouvre le message de la dernière réponse, sans elle',
			retour: 'Retour',
			retourTitre: 'Revenir à l’entraînement (Échap)',
			illisible: (erreur: string) => `Message illisible : ${erreur}`,
			relire: 'Relire',
			messageDAvant: 'Message d’avant',
			message: 'Message à juger',
			passeAuparavant: 'Passé auparavant : une réponse le remet parmi les messages jugés.',
			dejaValide: 'Déjà validé : une nouvelle réponse remplace la précédente.',
			fichesProposees: 'Fiches proposées pour ce message',
			reste: 'Le reste n’est pas utile',
			sansReponse: (n: number) => (n === 0 ? 'aucune fiche sans réponse' : accorder(n, 'fiche sans réponse', 'fiches sans réponse')),
			repondreAuMoins: 'Répondre pour une fiche au moins, ou cocher « Le reste n’est pas utile ».',
			silenceImpossible: '« Rien d’utile ici » : une fiche est marquée « Utile ».',
			passer: 'Passer',
			passerTitre: 'Mettre ce message de côté sans le juger',
			silence: 'Rien d’utile ici',
			silenceTitre: 'Aucune fiche n’aurait aidé à répondre à ce message',
			valider: 'Valider',
			finReponses: 'Réponses enregistrées. Retour à l’entraînement pour apprendre la note.',
			finRien: 'Aucun message n’attend de jugement : en préparer d’autres.',
			sautes: (n: number) => `${accorder(n, 'message passé reste', 'messages passés restent')} de côté.`,
			revenir: 'Revenir à l’entraînement',
			raccourcis: 'Raccourcis : ',
			touches: { fiche: 'fiche', entree: 'Entrée', echap: 'Échap' },
		},
	},
};
