import type { GenreLotVue } from '@mnemo/contrat';
import { pluriel } from '../../pluriel.ts';

const nombre = (n: number, un: string, autre: string) => `${n} ${pluriel('fr', n, { un, autre })}`;
const pourcent = (n: number) => `${n} %`;
const le = (date: string | null) => (date ? ` le ${date}` : '');

/** Nom de ce que compte un lot, au singulier et au pluriel, avec l'accord de « proposé ». */
const NOMS_LOT: Record<GenreLotVue, { un: string; autre: string; propose: string; proposes: string }> = {
	fusionner: { un: 'doublon', autre: 'doublons', propose: 'proposé', proposes: 'proposés' },
	supprimer: { un: 'suppression', autre: 'suppressions', propose: 'proposée', proposes: 'proposées' },
	confirmer: { un: 'confirmation', autre: 'confirmations', propose: 'proposée', proposes: 'proposées' },
};

/** Mémoire › Archiviste, le tiroir de l'archiviste, le dépôt de documents, les lots et les propositions à arbitrer. */
export const archiviste = {
	page: {
		aFaire: 'À faire',
		rienAFaire: 'Rien à faire.',
		largeurAFaire: 'Largeur de la colonne À faire',
		terminal: 'Terminal de l’archiviste',
		terminalAilleurs: 'Le terminal de l’archiviste est ouvert dans le tiroir.',
		afficherIci: 'L’afficher ici',
		largeurEnrichir: 'Largeur de la colonne Enrichir',
		enrichir: 'Enrichir',
	},
	centre: {
		suggestions: {
			ranger: 'Range les documents déposés',
			appris: "Qu'as-tu appris aujourd'hui ?",
			contradictions: 'Y a-t-il des contradictions à trancher ?',
		},
		lancementImpossible: "Lancement de l'archiviste impossible.",
		repriseImpossible: 'Reprise impossible.',
		enPause: "L'archiviste est en pause.",
		arrete: "L'archiviste s'est arrêté.",
		reprendre: 'Reprendre',
		sansTerminal: "L'archiviste tourne sans terminal dans Mnemo.",
		aucun: 'Aucun archiviste ne tourne.',
		lancer: "Lancer l'archiviste",
		terminauxIndisponibles: 'Terminaux indisponibles : à lancer à la main.',
		copier: 'Copier',
		commandeCopiee: 'Commande copiée',
		suggestionNonEnvoyee: 'Service injoignable : suggestion non envoyée.',
	},
	tiroir: {
		titre: 'Archiviste',
		etats: {
			arrete: 'arrêté',
			auTravail: 'au travail',
			enPause: 'en pause',
			attendReponse: 'attend une réponse',
			aLEcoute: "à l'écoute",
		},
		aFaire: (n: number) => `${n} à faire`,
		aFaireTitre: 'Mémoire › Archiviste : à faire, dépôt, suggestions',
		rendre: (raccourci: string) => `Rendre au tiroir (${raccourci}, Échap)`,
		enGrand: (raccourci: string) => `Terminal en grand (${raccourci})`,
		reduire: 'Réduire',
		agrandir: 'Agrandir',
		changementsDuJour: 'Changements de la mémoire aujourd’hui',
	},
	activite: {
		horsSession: 'Hors session',
		session: (debut: string) => `Session ${debut}`,
		archiviste: 'Archiviste',
		/** « 2 fiches injectées au démarrage » */
		injectees: (n: number, auDemarrage: boolean) => `${nombre(n, 'fiche injectée', 'fiches injectées')}${auDemarrage ? ' au démarrage' : ''}`,
		/** « 2 fiches injectées, en tête : Titre (87 %) » */
		enTete: (injectees: string, titre: string, note: string | null) => `${injectees}, en tête : ${titre}${note === null ? '' : ` (${note})`}`,
		libelle: (n: number) => `Activité (${n})`,
		rienEncore: "Rien encore aujourd'hui.",
		dePlus: (n: number) => `${n} de plus`,
		restants: (n: number) => nombre(n, 'restant', 'restants'),
		tronque: "Plus de 500 changements aujourd'hui : les plus anciens ne sont pas affichés.",
	},
	appris: {
		apprisLe: 'Appris le',
		jour: 'Jour',
		tronque: 'Plus de 500 changements ce jour-là : seuls les plus récents sont affichés',
		filNonRecharge: (erreur: string) => `Fil non rechargé : ${erreur}`,
		filIllisible: (erreur: string) => `Fil illisible : ${erreur}`,
		aucunChangement: 'Aucun changement de la mémoire ce jour-là.',
		pourLesSessions: "Ce qu'il a fait pour les sessions",
	},
	commits: {
		liste: 'Commits du jour',
		fiches: (n: number) => nombre(n, 'fiche', 'fiches'),
		horsSession: 'hors session',
		session: (debut: string) => `session ${debut}`,
		archiviste: 'Archiviste',
	},
	detail: {
		libelle: 'Commit choisi',
		aucun: 'Aucun commit choisi',
		ecritPar: 'Écrit par',
		ouvrir: '→ ouvrir',
		fichesTouchees: (n: number) => nombre(n, 'fiche touchée', 'fiches touchées'),
		racine: 'racine',
	},
	documents: {
		titre: 'Documents récents',
		chargement: 'Chargement…',
		aucun: 'Aucun document référencé.',
		allerALAction: (chemin: string) => `${chemin} — à traiter : aller à son action`,
		aTraiter: 'à traiter',
		traite: 'traité',
	},
	import: {
		enCours: 'Import en cours…',
		importer: 'Importer la mémoire de Claude Code',
		erreurInconnue: 'erreur inconnue',
		impossible: (message: string) => `Import impossible : ${message}`,
		bilan: 'Bilan de l’import',
		ignores: (n: number) => `Fichiers ignorés (${n})`,
	},
	sources: {
		archiviste: {
			confie: 'Confié à l’archiviste',
			repris: 'Archiviste repris : la consigne suit',
			lance: 'Archiviste lancé avec la consigne',
			manuel: 'Terminaux indisponibles : archiviste à lancer à la main',
		},
		traitementImpossible: (message: string | null) => (message === null ? 'Traitement impossible.' : `Traitement impossible : ${message}`),
		marque: 'Marqué traité',
		marqueNonRetiree: (message: string | null) => (message === null ? 'Marque non retirée.' : `Marque non retirée : ${message}`),
		titre: 'À traiter',
		toutTraiter: 'Tout traiter',
		commande: 'Commande de l’archiviste',
		copier: 'Copier',
		commandeCopiee: 'Commande copiée',
		enCours: 'en cours',
		traiter: 'Traiter',
		marquerTraite: 'Marquer traité',
		ouvrir: 'Ouvrir',
	},
	depot: {
		/** Fichier refusé sans envoi : nom, sa taille, la taille maximale. */
		tropGros: (nom: string, taille: string, max: string) => `Fichier trop gros : ${nom} (${taille}, ${max} au plus)`,
		/** « Envoi de x.mbox : 1,2 Go / 3,4 Go (35 %) » */
		progression: (nom: string, envoyes: string, total: string, part: number) => `Envoi de ${nom} : ${envoyes} / ${total} (${pourcent(part)})`,
		envoiDe: (nom: string) => `Envoi de ${nom}`,
		enAttente: (n: number) => `À traiter : ${n > 1 ? `${n} documents` : '1 document'}, l’archiviste les recevra à son lancement`,
		consigneNonEnvoyee: (message: string | null) => `Consigne non envoyée à l’archiviste${message === null ? '' : ` : ${message}`} (les documents restent à traiter)`,
		nomRefuse: (nom: string) => `Nom de fichier refusé : ${nom}`,
		depose: (chemin: string) => `Déposé : ${chemin}`,
		envoiAnnule: (nom: string) => `Envoi annulé : ${nom}`,
		depotImpossible: (message: string | null) => (message === null ? 'Dépôt impossible.' : `Dépôt impossible : ${message}`),
		deposer: "Déposer n'importe quoi",
		types: 'mails, PDF, Word, tableurs, images',
		depotEnCours: 'Dépôt en cours…',
		choisir: 'Choisir des fichiers',
		groupeDestination: 'Destination',
		destination: (dossier: string) => `Destination : ${dossier}`,
		annulerEnvoi: "Annuler l'envoi",
	},
	propositions: {
		titre: 'À arbitrer',
		etiquettes: { a_confirmer: 'À confirmer', montee: 'Niveau', modification: 'Modification' },
		toasts: {
			a_confirmer: { confirmer: 'Confirmé', rejeter: 'Rejeté', corriger: 'Modifié' },
			montee: { confirmer: 'Niveau appliqué', rejeter: 'Proposition rejetée' },
			modification: { confirmer: 'Modification appliquée', rejeter: 'Modification rejetée' },
		},
		ecrit: 'Écrit',
		doublon: 'Déjà en mémoire sous cette forme',
		proches: 'Des éléments très proches existent déjà : rien n’a été écrit.',
		inattendue: (statut: string) => `Réponse inattendue du service : ${statut}`,
		ecritureImpossible: 'Écriture impossible.',
		correction: 'Correction',
		enregistrer: 'Enregistrer',
		annuler: 'Annuler',
		confirmer: 'Confirmer',
		modifier: 'Modifier',
		rejeter: 'Rejeter',
		niveaux: { rappelee: 'rappelée', toujours: 'toujours', verifiee: 'vérifiée' },
		regles: { commandes_interdites: 'commandes interdites', chemins_interdits: 'chemins interdits' },
		/** « commandes interdites : bin/deployer prod* » */
		regle: (genre: string, motifs: readonly string[]) => `${genre} : ${motifs.join(', ')}`,
		/** Détail d'un fait à confirmer : source, catégorie, date d'apprentissage. */
		detailFait: (source: string | null, categorie: string | null, date: string | null) =>
			[source ?? 'source inconnue', categorie, date ? `appris le ${date}` : null].filter((x): x is string => !!x).join(' · '),
		monteeProposee: (source: string, date: string | null, niveau: string, regle: string | null) => `Proposé par ${source}${le(date)} : niveau « ${niveau} »${regle ? ` (${regle})` : ''}`,
		consigneRepetee: (niveau: string) => `Consigne répétée : passer au niveau « ${niveau} »`,
		modifierCibles: (cibles: readonly string[]) => `Modifier ${cibles.join(', ')}`,
		modificationProposee: (source: string, date: string | null, changements: readonly string[]) =>
			`Proposé par ${source}${le(date)}${changements.length > 0 ? ` : ${changements.join(' ; ')}` : ''}`,
		erreurs: {
			sansAncre: (fiche: string) => `Information sans ancre dans ${fiche}.`,
			correctionVide: 'La correction est vide.',
			modificationNonCorrigible: 'Une modification proposée se confirme ou se rejette, elle ne se corrige pas.',
			monteeSansNiveau: (fiche: string) => `Montée sans niveau visé dans ${fiche}.`,
			aucunePropositionDeSession: (titre: string) => `Aucune proposition de session à rejeter pour ${titre}.`,
			monteeNonCorrigible: 'Une montée de niveau se confirme ou se rejette, elle ne se corrige pas.',
		},
	},
	lots: {
		ficheChangee: 'Une information visée a changé depuis la proposition : lot écarté, demander à l’archiviste de le reproposer.',
		perime: 'Une information visée a changé depuis la proposition : rejeter ce lot, puis demander à l’archiviste de le reproposer.',
		deja: {
			confirmer: 'Déjà confirmée : rien à faire.',
			supprimer: 'Déjà retirée de la fiche : rien à faire.',
			fusionner: 'Déjà fusionnée : rien à faire.',
		},
		ecritureImpossible: 'Écriture impossible.',
		valide: (n: number) => `Lot validé : ${nombre(n, 'ligne appliquée', 'lignes appliquées')}`,
		rejete: 'Lot rejeté',
		toutValider: 'Tout valider',
		replier: 'Replier',
		revoir: 'Revoir',
		rejeter: 'Rejeter',
		/** « Valider 3 doublons » */
		valider: (compte: string) => `Valider ${compte}`,
		roles: { gardee: 'gardée', absorbee: 'absorbée', supprimee: 'supprimée', aConfirmer: 'à confirmer', confirmee: 'confirmée' },
		absenteDeLaFiche: (ancre: string) => `${ancre} : absente de la fiche`,
		lignesAAppliquer: 'Lignes à appliquer',
		ligne: (n: number) => `Ligne ${n}`,
		/** Information absente (aucune ligne écrite) : son ancre, dite absente. */
		absente: (ancre: string) => `${ancre} (absente)`,
		detail: 'Détail',
		avant: 'Avant',
		apres: 'Après',
		informationRetiree: 'Information retirée de la fiche.',
		etiquettes: { fusionner: 'Doublons', supprimer: 'Suppressions', confirmer: 'Confirmations' },
		/** « 11 doublons proposés dans Module stocks », « 1 suppression proposée dans … » */
		intitule: (genre: GenreLotVue, n: number, titre: string) => {
			const nom = NOMS_LOT[genre] ?? { un: genre, autre: genre, propose: 'proposé', proposes: 'proposés' };
			return `${nombre(n, `${nom.un} ${nom.propose}`, `${nom.autre} ${nom.proposes}`)} dans ${titre}`;
		},
		/** « 3 doublons » (fusion), « 2 lignes » (sinon). */
		compte: (genre: GenreLotVue, n: number) => (genre === 'fusionner' ? nombre(n, 'doublon', 'doublons') : nombre(n, 'ligne', 'lignes')),
		changement: {
			supprimee: 'supprimée',
			confirmee: 'confirmée',
			/** « confiance 30 % → 51 % », « confiance 51 % » (pas écrite avant). */
			confiance: (avant: number | null, apres: number) => (avant === null ? `confiance ${pourcent(apres)}` : `confiance ${pourcent(avant)} → ${pourcent(apres)}`),
			sources: (sources: readonly string[]) => `+ ${pluriel('fr', sources.length, { un: 'source', autre: 'sources' })} ${sources.join(', ')}`,
			aucuneSource: 'aucune source nouvelle',
			absorbe: (textes: readonly string[]) => `absorbe : ${textes.map((x) => `« ${x} »`).join(', ')}`,
			separateur: ' · ',
		},
	},
};
