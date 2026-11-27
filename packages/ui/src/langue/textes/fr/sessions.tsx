import type { RaisonCarte } from '@mnemo/commun';
import type { EtatSessionVue } from '@mnemo/contrat';
import type { ReactNode } from 'react';
import { pluriel } from '../../pluriel.ts';

const HEURE = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' });
const heure = (ms: number): string => HEURE.format(ms);
const deux = (n: number): string => String(n).padStart(2, '0');

/** Vue Sessions : grille, barre, panneaux Dossier et Contexte, nouvelle session, sessions terminées. */
export const sessions = {
	formats: {
		/** « 87 % » (espace fine insécable). */
		pourcentage: (n: number): string => `${n}\u202f%`,
		/** « 124 k » ; « 1 M » au million. */
		tokens: (n: number): string => (n >= 1_000_000 ? `${Math.round(n / 100_000) / 10} M` : `${Math.round(n / 1000)} k`),
		/** Durées des cartes : « 18 min », « 1 h 10 », « 1 j 4 h » ; en pause, « 3 j sans activité ». */
		duree: {
			minutes: (m: number): string => `${m} min`,
			heures: (h: number): string => `${h} h`,
			heuresMinutes: (h: number, m: number): string => `${h} h ${deux(m)}`,
			jours: (j: number): string => `${j} j`,
			joursHeures: (j: number, h: number): string => `${j} j ${h} h`,
			sansActivite: (duree: string): string => `${duree} sans activité`,
		},
	},
	etats: {
		attend: 'Attend une réponse',
		travaille: 'Travaille',
		a_relire: 'Terminée, à relire',
		en_pause: 'En pause',
		terminee: 'Terminée',
	} satisfies Record<EtatSessionVue, string>,
	sansObjectif: 'Sans objectif',
	profil: (nom: string): string => `Profil ${nom}`,
	actionImpossible: 'Action impossible.',
	vue: {
		aucune: 'Aucune session en cours.',
		aucuneAide: '« + Nouvelle session » en lance une dans un dossier.',
		largeurDossier: 'Largeur du panneau Dossier',
		largeurContexte: 'Largeur du panneau Contexte',
		tourneAilleurs: 'La session tourne ailleurs, ou les terminaux sont indisponibles.',
		repriseImpossible: 'Reprise impossible.',
		sessionIllisible: 'Session illisible.',
	},
	barre: {
		/** « 8 sessions | 2 attendent une réponse | 2 travaillent » */
		decompte: (total: number, attendent: number, travaillent: number): string =>
			[
				`${total} ${pluriel('fr', total, { un: 'session', autre: 'sessions' })}`,
				`${attendent} ${pluriel('fr', attendent, { un: 'attend', autre: 'attendent' })} une réponse`,
				`${travaillent} ${pluriel('fr', travaillent, { un: 'travaille', autre: 'travaillent' })}`,
			].join(' | '),
		/** « 1 terminée », « 3 terminées » (lien vers l'historique). */
		terminees: (n: number): string => `${n} ${pluriel('fr', n, { un: 'terminée', autre: 'terminées' })}`,
		dossier: 'Dossier',
		contexte: 'Contexte',
		nouvelle: '+ Nouvelle session',
	},
	agentsEnCours: {
		liste: 'Agents en cours',
		/** « travail : 2 sessions, 1 travaille, 1 attend une réponse » */
		agent: (profil: string, sessions: number, travaillent: number, attendent: number, repos: number): string => {
			const parties = [
				`${sessions} ${pluriel('fr', sessions, { un: 'session', autre: 'sessions' })}`,
				...(travaillent > 0 ? [`${travaillent} ${pluriel('fr', travaillent, { un: 'travaille', autre: 'travaillent' })}`] : []),
				...(attendent > 0 ? [`${attendent} ${pluriel('fr', attendent, { un: 'attend', autre: 'attendent' })} une réponse`] : []),
				...(repos > 0 ? [`${repos} au repos`] : []),
			];
			return `${profil} : ${parties.join(', ')}`;
		},
		allerA: {
			attend: 'Aller à la session qui attend',
			travaille: 'Aller à la session qui travaille',
			repos: 'Aller à la session la plus récente',
		},
		autres: (n: number, liste: string): string => `Et ${n} autres : ${liste}`,
	},
	grille: {
		region: 'Grille des sessions',
		deplier: (titre: string): string => `Déplier ${titre}`,
		replier: (titre: string): string => `Replier ${titre}`,
		sessions: (n: number): string => `${n} ${pluriel('fr', n, { un: 'session', autre: 'sessions' })}`,
		nouvelle: '+ session',
		aideUne: (touche: string): string => `${touche} ouvre la session en grand`,
		aidePlusieurs: (premiere: string, derniere: string): string => `${premiere} à ${derniere} ouvre une session en grand`,
		aideEchap: 'Échap revient à la grille',
		aideDoubleClic: 'double-clic sur un titre pour agrandir',
		aideArchiviste: (touche: string): string => `${touche} parle à l'archiviste`,
		separateurs: { cellules: 'Largeur des sessions voisines', lignes: 'Hauteur des dossiers voisins' },
	},
	carte: {
		moteur: (moteur: string): string => `Moteur : ${moteur}`,
		agrandir: 'Agrandir ou réduire',
		sansTerminal: 'Session suivie sans terminal dans Mnemo',
		reprendreIci: 'Reprendre ici',
		repriseImpossible: (raison: string): string => `Reprise impossible : ${raison}.`,
	},
	fermer: {
		fermer: 'Fermer la session',
		impossible: 'impossible pour l’instant (raison dans le panneau Contexte)',
		bilanImpossible: (raison: string): string => `Bilan impossible pour l’instant : ${raison}.`,
		bilanDemande: 'Bilan demandé',
		terminerAvecBilan: 'Terminer avec bilan',
		faireLeBilan: 'Faire le bilan',
		abandonner: 'Abandonner',
		confirmerAbandon: 'Confirmer l’abandon',
	},
	panneau: {
		region: 'Contexte',
		dossier: 'Dossier',
		moteur: 'Moteur',
		demarree: 'Démarrée',
		duree: 'Durée',
		branche: 'Branche',
		quotas: 'Quotas',
		quotasAbsents: (moteur: string): string => `non communiqués par ${moteur}`,
		contexte: 'Contexte',
		/** « 124 k / 200 k (62 %) » */
		fenetre: (utilises: string, max: string, pourcent: number): string => `${utilises} / ${max} (${pourcent} %)`,
		pause: 'Pause',
		pauseTitre: 'Mettre la session en pause',
		reprendre: 'Reprendre',
		bilan: 'Bilan',
		bilanTitre: 'Terminer la session avec un bilan',
		abandonnerTitre: 'Abandonner la session, sans bilan',
		sansReprise: (raison: string): string => `Pause, reprise et bilan impossibles pour l’instant : ${raison}. Abandonner reste possible.`,
	},
	jauge: {
		/** « Fenêtre de contexte : 124 k sur 200 k tokens (62 %) » */
		fenetre: (utilises: string, max: string, pourcent: number, avantResume: boolean): string =>
			`Fenêtre de contexte : ${utilises} sur ${max} tokens${avantResume ? ' avant résumé automatique' : ''} (${pourcent} %)`,
	},
	panneauDossier: {
		region: 'Dossier',
		nouvelle: '+ session',
		cheminCopie: 'Chemin copié',
		copierChemin: (chemin: string): string => `Copier le chemin de ${chemin}`,
	},
	recherche: {
		loupe: 'Chercher une fiche',
		loupeAllumee: (texte: string): string => `Recherche : « ${texte} » (Échap pour l'effacer)`,
		loupeFermer: 'Fermer la recherche',
		loupeOuvrir: 'Chercher une fiche à injecter ( / )',
		champ: 'Chercher une fiche à injecter',
		placeholder: 'Chercher une fiche…',
		effacer: 'Effacer la recherche',
		effacerTitre: 'Effacer la recherche (Échap)',
		impossible: (erreur: string): string => `Recherche impossible : ${erreur}`,
		enCours: 'Recherche…',
		aucune: (texte: string): string => `Aucune fiche pour « ${texte} »`,
		fiches: (n: number): string => `${n} ${pluriel('fr', n, { un: 'fiche', autre: 'fiches' })}`,
	},
	apercu: {
		region: (titre: string): string => `Aperçu de ${titre}`,
		racine: 'racine de la mémoire',
		indisponible: (erreur: string): string => `Aperçu indisponible : ${erreur}`,
		lecture: 'Lecture de la fiche…',
		vide: 'Ni synthèse ni information.',
		informations: 'Premières informations',
		reste: (n: number): string => `+ ${n} ${pluriel('fr', n, { un: 'information', autre: 'informations' })}`,
		ouvrir: 'Ouvrir la fiche',
		ouvrirTitre: 'Ouvrir la fiche entière, page Mémoire',
	},
	/** Pourquoi une piste est proposée, par code `RaisonCarte`. */
	raisons: {
		perimetre: 'du périmètre',
		nommee: 'nommée',
		question: 'question',
		liee: 'liée',
		proche: 'proche du message',
		historique: 'souvent injectée',
	} satisfies Record<RaisonCarte, string>,
	/** « liée à Avoirs » : la raison et la fiche d'où elle vient. */
	raisonDepuis: (raison: string, titre: string): string => `${raison} à ${titre}`,
	classement: {
		titre: 'Injecté dans la session',
		aucune: 'Aucune fiche pour l’instant.',
		delta: (d: number): string => {
			const n = Math.abs(d);
			return `${d > 0 ? 'monte' : 'descend'} de ${n} ${pluriel('fr', n, { un: 'rang', autre: 'rangs' })}`;
		},
		ordreSeul: {
			coupes: "Ordre seul : modèles coupés pour cette session, ni sens ni reranker. L'ordre suit les mots, puis l'historique des gestes ; sans %, ni injection par Mnemo.",
			sansNote:
				"Ordre seul : aucune note apprise et validée sur les jugements pour les modèles installés (note de départ à entraîner, pas encore apprise, refusée, ou modèles changés depuis). L'ordre suit le sens et les mots ; sans %, ni injection par Mnemo.",
		},
		repos: { coupee: 'injection coupée', calibre: 'calibré', ordreSeul: 'ordre seul' },
		mode: {
			auto: 'auto',
			autoNote: (note: string): string => `auto ${note}`,
			bulleAuto: (note: string | null, seuil: string, ms: number): string =>
				`Injectée par Mnemo${note === null ? '' : ` : ${note} pour ce message`} (seuil ${seuil}), entière, au message de ${heure(ms)}`,
			main: 'à la main',
			bulleMain: (ms: number): string => `Injectée à la main (➤), entière, au message de ${heure(ms)}`,
			dossier: 'du dossier',
			bulleDossier: 'Fiche du dossier de la session, injectée entière',
			bulleInjectee: 'Injectée entière dans la session',
		},
		nonCalibree: {
			refusee: "Note non calibrée : le modèle appris n'a pas passé les critères d'acceptation",
			depart: 'Note non calibrée : note de départ, à entraîner (livrée avec Mnemo, pas encore apprise sur les jugements)',
			provisoire: 'Note non calibrée : la règle provisoire (sens et mots), aucun modèle de note appris',
			ancienne: "Note non calibrée : celle d'une entrée d'avant le classement vivant",
		},
		injecter: 'Injecter',
		injecterLabel: (titre: string): string => `Injecter ${titre} dans la session`,
		injecterBulle: 'Injecter dans la session : la fiche entière, au prochain message',
		attendBulle: 'Sera injectée au prochain message de la session ; cliquer pour annuler',
		ecarter: 'Écarter',
		ecarterLabel: (titre: string): string => `Écarter ${titre}`,
		ecarterTitre: 'Écarter : de cette session, ou pour toujours',
		pasIci: 'Pas pour cette session',
		pasIciDetail: 'Ni proposée ni injectée par Mnemo dans cette session. Se rétablit depuis « Écartées ».',
		jamais: 'Ne plus jamais suggérer',
		jamaisDetail: 'Dans aucune session, ni par Mnemo ni en piste. Se rétablit depuis la fiche, page Mémoire.',
		injectee: 'Injectée dans la session',
		resumeInjectee: (mode: string | null): string => `${mode} – injectée par Mnemo`,
		lueAussi: (ms: number): string => `, lue aussi à ${heure(ms)}`,
		auDessusCoupee: "\nAu-dessus du seuil, mais l'injection automatique est coupée : ➤ pour l'injecter.",
		auDessusNonInjectee: "\nAu-dessus du seuil sans être injectée (affinée après le message, plafond par message, ou déjà vue) : ➤ pour l'injecter.",
		classee: 'Classée pour ce message',
		enPiste: ' – envoyée en piste dans la session (titre et résumé)',
		noteBulle: (note: string): string => `${note} : chance que la fiche soit utile à ce message (note apprise sur les jugements)`,
		rangBulle: (rang: number): string => `Rang ${rang} : ordre seul, sans note calibrée`,
		rang: (rang: number): string => `rang ${rang}`,
		/** Sépare les parties d'un résumé ou d'une info-bulle : « 87 % – liée – piste ». */
		separe: ' – ',
		piste: 'piste',
		auProchain: 'injectée au prochain message',
		lueA: (ms: number): string => `lue par la session à ${heure(ms)}`,
		pisteDe: (ms: number): string => `piste du message de ${heure(ms)}`,
		motifLue: "Indisponible : la session l'a lue d'elle-même, Mnemo ne l'a pas proposée.",
		motifTropTot: 'Indisponible : proposée trop tôt dans la session pour être écartée ici.',
		lue: 'Lue par la session',
		pisteAncienne: "Piste d'un message précédent, absente du classement de ce message",
		trouvee: {
			dejaInjectee: 'déjà injectée dans la session',
			jamais: 'plus jamais suggérée',
			ecarteeIci: 'écartée de cette session',
			trouvee: 'trouvée par la recherche',
			motif: "Indisponible : trouvée par la recherche, Mnemo ne l'a pas proposée à ce message.",
			bulleInjectee: 'Déjà injectée dans la session',
			bulleTrouvee: 'Trouvée par la recherche',
		},
		separateur: {
			bulleSeuil: (seuil: string): string => `Au-dessus : vu par la session. Mnemo injecte au message même, entière, une fiche notée au-dessus de ${seuil}. Réglages › Mémoire › Rappel.`,
			bulleCoupe: (seuil: string): string => `Seuil d'injection automatique : ${seuil}. Injection coupée : rien n'est injecté au-dessus.`,
			bulleFilet: 'Au-dessus : vu par la session ; dessous : pas encore vu.',
			seuil: (seuil: string): string => `seuil d’injection ${seuil}`,
			coupe: (seuil: string): string => `seuil ${seuil} – coupé`,
		},
		niveaux: { complets: 'modèles complets', sens: 'sens seul' },
		/** « **Injection automatique coupée** (sens seul) : justesse récente insuffisante. » */
		coupure: (niveau: string | null): ReactNode => (
			<>
				<b>Injection automatique coupée</b>
				{niveau === null ? '' : ` (${niveau})`} : justesse récente insuffisante.
			</>
		),
		detailCoupure: (niveau: string | null, motif: string): string => `${niveau === null ? '' : `${niveau} : `}${motif}.`,
		coupureMainPourcent: 'Les % restent affichés ; ➤ pour injecter à la main.',
		coupureMain: '➤ pour injecter à la main.',
		reactiver: 'Réactiver',
		reactiverTitre: "Réactiver l'injection automatique : elle se coupera de nouveau si les écarts continuent",
		plusTot: 'Plus tôt dans la session',
		suggestion: 'Suggestion',
		suggestionTexte: (titre: ReactNode, sessions: number): ReactNode => (
			<>
				{titre} écartée dans {sessions} sessions : ne plus la suggérer ?
			</>
		),
		neSuggererPlus: 'Ne plus suggérer',
		neSuggererPlusTitre: 'Ne plus jamais la suggérer, dans aucune session ; se rétablit depuis la fiche (page Mémoire)',
		garder: 'Garder',
		garderTitre: 'La garder : elle reste écartée de cette session seulement',
		jamaisIci: (titres: string, n: number): string => `${titres} : plus jamais ${pluriel('fr', n, { un: 'suggérée', autre: 'suggérées' })}. Se rétablit depuis la fiche, page Mémoire.`,
		muet: { sans_contenu: 'Message sans contenu : rien proposé', balise: 'Message système : rien proposé' },
		avantLeClassement: 'Dernier message classé avant cette version de Mnemo : le classement viendra au prochain message.',
		modelesDemarres: 'Modèles démarrés : les notes viendront au prochain message.',
		notesArretes: 'Notes indisponibles : modèles arrêtés',
		demarrer: 'Démarrer',
		notesAbsents: 'Notes indisponibles : modèles non installés',
		modelesEnChargement: 'Modèles en chargement : les notes viendront au prochain message.',
		notesSans: (coupes: boolean, pourLaSession: boolean): string => `Notes indisponibles : ${coupes ? 'modèles coupés' : 'sens seul'}${pourLaSession ? ' pour cette session' : ''}`,
		sousLeSeuil: (n: number): string => `Sous le seuil (${n})`,
		ecartees: (n: number): string => `Écartées (${n})`,
		retablir: 'Rétablir',
		retablirLabel: (titre: string): string => `Rétablir ${titre}`,
		retablirTitre: 'La remettre parmi les fiches proposées à cette session',
	},
	nouvelle: {
		titre: 'Nouvelle session',
		aide: { changer: 'changer d’agent', lancer: 'lancer', echap: 'Échap', fermer: 'fermer' },
		lectureProfils: 'Lecture des profils…',
		aucunAgent: 'Aucun agent à proposer : aucun profil ne se lance par ce dialogue.',
		lancer: (nom: string): string => `Lancer ${nom}`,
		lancee: 'Session lancée',
		lancementImpossible: 'Lancement impossible.',
		manuel: 'Les terminaux ne sont pas disponibles dans Mnemo : la session est suivie, à lancer à la main dans un terminal.',
		copier: 'Copier',
		commandeCopiee: 'Commande copiée',
		/** Étiquette du profil. */
		etiquettes: { parDefaut: 'par défaut', integre: 'intégré', personnalise: 'personnalisé' },
		/** Où se lance un profil. */
		lieux: { projet: 'dans le dossier choisi', memoire: 'dans la mémoire' },
		lieuDossier: (dossier: string): string => `dans ${dossier}`,
		modeleParDefautDuMoteur: 'par défaut du moteur',
		modeleParDefaut: 'modèle par défaut',
		hooksAucun: 'aucun',
		hooksTous: 'tous',
		hookEtDetail: (libelle: string, detail: string) => `${libelle} : ${detail}`,
		hooks: (texte: string): string => `hooks : ${texte}`,
		skills: (n: number): string => pluriel('fr', n, { un: 'skill', autre: 'skills' }),
		plugins: (n: number): string => pluriel('fr', n, { un: 'plugin', autre: 'plugins' }),
		/** Un point du poste : « Serveur MCP mnemo : non déclaré ». */
		pointDuPoste: (libelle: string, etat: string): string => `${libelle} : ${etat}`,
		posteNonVerifie: 'poste non vérifié',
		lancementImpossibleIci: (raison: string): string => `Lancement impossible ici : ${raison}`,
		lancementImpossibleCar: (raison: string): string => `Lancement impossible : ${raison}`,
		annonce: {
			verification: (moteur: string): string => `vérification de ${moteur}`,
			pret: 'prêt',
			manuel: (moteur: string): string => `${moteur} introuvable, lancement par une ligne à coller`,
			illisible: (moteur: string): string => `état de ${moteur} illisible`,
			agent: (nom: string, etat: string): string => `${nom} : ${etat}`,
		},
		fiche: {
			fournisseur: 'Fournisseur',
			moteur: 'Moteur',
			modele: 'Modèle',
			seLance: 'Se lance',
			equipement: 'Équipement',
		},
		etat: {
			voirReglages: 'Voir dans Réglages',
			verificationEnCours: 'vérification…',
			verification: (moteur: string): string => `Vérification de ${moteur} sur ce poste…`,
			pret: (moteur: string): string => `✓ Prêt : ${moteur} trouvé et lié à Mnemo.`,
			manuel: (moteur: string): string => `${moteur} introuvable ici : la session sera suivie, et à lancer à la main dans un terminal.`,
			illisible: (moteur: string, motif: string): string => `État de ${moteur} illisible : ${motif}`,
			liaison: 'Liaison…',
			lier: 'Lier à Mnemo',
		},
		autres: {
			illisibles: (erreur: string): string => `Profils illisibles : ${erreur}`,
			propre: (nom: string, lieu: string): string => `${nom} : lancé par son propre chemin, ${lieu}.`,
			avertissement: (nom: string, motif: string): string => `Profil ${nom} : ${motif}`,
			ignore: (nom: string, motif: string): string => `Profil ignoré, ${nom} : ${motif}`,
		},
		mission: {
			dossier: 'Dossier',
			dansLaMemoire: 'Se lance dans la mémoire, quel que soit le dossier.',
			replier: 'Replier',
			changer: 'Changer',
			choisirDossier: 'Choisir le dossier',
			objectif: 'Objectif (facultatif)',
			objectifPlaceholder: 'Ce que la session doit faire',
		},
		agents: 'Agents',
		lancementImpossibleCourt: 'lancement impossible',
		eteint: (nom: string): string => `${nom}, lancement impossible`,
		precedent: 'Agent précédent',
		suivant: 'Agent suivant',
	},
	historique: {
		titre: 'Sessions terminées',
		introuvable: 'La session demandée n’est pas dans l’historique.',
		chargement: 'Chargement…',
		aucune: 'Aucune session terminée.',
		profil: (nom: string): string => `, profil ${nom}`,
		episodeMinimal: (titre: string): string => `Épisode minimal : ${titre}`,
		bilan: (titre: string): string => `Bilan : ${titre}`,
		sansBilan: 'Sans bilan',
		confirmerRetrait: 'Confirmer le retrait',
		retirer: 'Retirer de l’historique',
		retirerTitre: (moteur: string): string => `Oublie la session dans Mnemo ; la transcription de ${moteur} et la mémoire restent.`,
		retiree: 'Session retirée de l’historique.',
		retraitImpossible: 'Retrait impossible.',
	},
};
