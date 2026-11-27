import type { Forme } from '../../forme.ts';
import { pluriel } from '../../pluriel.ts';
import type { coquille as fr } from '../fr/coquille.tsx';

const HEURE = new Intl.DateTimeFormat('en-US', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const JOUR = new Intl.DateTimeFormat('en-US', { weekday: 'short' });

export const coquille: Forme<typeof fr> = {
	vues: {
		navigation: 'Views',
		sessions: 'Sessions',
		memoire: 'Memory',
		reglages: 'Settings',
		pastilleSessions: (n) => `${n} ${pluriel('en', n, { un: 'session is', autre: 'sessions are' })} waiting for a reply`,
		pastilleMemoire: (n) => `${n} ${pluriel('en', n, { un: 'item', autre: 'items' })} to do (Memory › Archivist)`,
	},
	bandeauConnexion: 'Service stopped, reconnecting…',
	barreStatut: {
		coffre: (racine) => `vault ${racine}`,
		terminauxDisponibles: 'terminals available',
		sansTerminaux: (motif) => `no terminals: ${motif}`,
		connexion: {
			connexion: 'connecting to the service…',
			ouverte: 'service connected',
			reconnexion: 'service stopped',
			jeton_refuse: 'token refused',
		},
	},
	barreTitre: {
		fictif: 'sample data',
		chercher: 'Search sessions, files, notes...',
		archiviste: 'Archivist',
		archivisteAttendNom: 'Archivist, waiting for a reply',
		archivisteAttendBulle: 'The archivist is waiting for a reply',
	},
	ecranJeton: (mnemo, mnemoJeton) => (
		<>
			Token missing or expired. Open the address with the token shown by {mnemo} (or by {mnemoJeton}) in the terminal once: this
			browser will be recognized, and the address without the token will work from then on.
		</>
	),
	palette: {
		nom: 'Command palette',
		champ: 'Palette',
		filtresNom: 'Filters',
		filtres: { tout: 'All', sessions: 'Sessions', fiches: 'Notes', documents: 'Documents' },
		ceProjet: 'This project',
		ceProjetSansObjet: 'Not available with "Documents": documents are not filtered by project.',
		resultats: 'Results',
		recherche: 'Searching…',
		rien: (texte) => `Nothing matches "${texte}".`,
		indisponible: (motif) => `Search unavailable: ${motif}`,
		modeles: {
			demarres: 'Models started: scores will come with the next search.',
			arretes: 'Words only: models stopped.',
			demarrer: 'Start the models',
			echec: ' Could not start them.',
			absents: 'Words only: models not installed.',
			chargement: 'Models loading: scores will come with the next search.',
			coupes: 'Words only: models turned off.',
			sens: 'No scores: semantic only, no reranking.',
		},
		session: (id) => `Session ${id}`,
		noteReranker: 'Reranker score',
		page: (page) => `, p. ${page}`,
		genres: {
			session: 'Session',
			archiviste: 'Archivist',
			fiche: 'Note',
			document: 'Document',
			fait: 'Fact',
			consigne: 'Instruction',
			passage: 'Passage',
			passageDocument: 'Document passage',
		},
	},
	quotas: {
		heure: (ms) => HEURE.format(ms),
		jourHeure: (ms) => `${JOUR.format(ms)} ${HEURE.format(ms)}`,
		cinqHeures: (pourcentage, remise) => `5 hours: ${pourcentage}% (resets ${remise})`,
		semaine: (pourcentage, remise) => `week: ${pourcentage}% (resets ${remise})`,
		detail: (abonnement, fenetres) => `${abonnement}: ${fenetres}`,
		entreAbonnements: '; ',
		titre: (detail) => `Subscription quotas, ${detail}`,
		nom: (detail, deplie) => `Subscription quotas, ${detail}. ${deplie ? 'Collapse' : 'Expand'}`,
		cinqHeuresCourt: '5 h',
		semaineCourt: 'wk',
		pourcentage: (n) => `${n}%`,
	},
	toast: {
		avertissements: 'Warnings',
		fermerAvertissement: 'Close warning',
	},
	terminal: {
		horsLigne: 'Offline',
	},
	partage: {
		dePlus: (n) => `${n} more`,
		toutVoir: 'Show all',
		copieImpossible: 'Copying is not possible in this browser',
		largeurPanneau: (titre) => `${titre} panel width`,
		separateur: (vertical) => `Drag to ${vertical ? 'widen' : 'enlarge'} · double-click: default size`,
		avatar: (forme) => `Avatar ${forme}`,
		liaison: {
			incomplete: 'Link incomplete.',
			liee: (moteur) => `${moteur} linked to Mnemo.`,
			impossible: (moteur) => `Could not link ${moteur}.`,
		},
	},
	arbre: {
		localiser: 'Locate the open note',
		localiserBulle: (raccourci) => `Locate the open note (${raccourci})`,
		toutReplier: 'Collapse all',
		toutReplierBulle: (raccourci) => `Collapse all (${raccourci})`,
		toutDeplier: 'Expand all',
		toutDeplierBulle: (raccourci) => `Expand all (${raccourci})`,
		basculer: (deplie, dossier) => `${deplie ? 'Collapse' : 'Expand'} ${dossier}`,
		projet: 'Project',
		racine: 'root',
		gitAJour: 'up to date',
		gitModifies: (n) => `${n} changed`,
		gitBulle: (branche, modifies) => `branch ${branche ?? '(detached)'}, ${modifies} ${pluriel('en', modifies, { un: 'file', autre: 'files' })} changed`,
	},
	raccourcis: {
		maj: 'Shift',
	},
	client: {
		injoignable: 'Service unreachable.',
		jetonRefuse: 'Token refused.',
		erreurService: (statut) => `Service error (${statut}).`,
	},
};
