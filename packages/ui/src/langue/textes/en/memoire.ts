import type { Forme } from '../../forme.ts';
import { pluriel } from '../../pluriel.ts';
import type { memoire as fr } from '../fr/memoire.ts';

const NOMBRE = new Intl.NumberFormat('en-US');
const nombre = (n: number): string => NOMBRE.format(n);
const MENTIONS: Readonly<Record<string, string>> = {
	'a confirmer': 'to confirm',
	'à confirmer': 'to confirm',
	declare: 'stated',
	déclaré: 'stated',
	observe: 'observed',
	observé: 'observed',
	infere: 'inferred',
	inféré: 'inferred',
};
const compte =(n: number, un: string, autre: string): string => `${nombre(n)} ${pluriel('en', n, { un, autre })}`;

export const memoire: Forme<typeof fr> = {
	vue: {
		onglets: 'Memory',
		archiviste: (n) => `Archivist (${n})`,
		fichiers: 'Files',
		graphe: '3D graph',
		entrainer: 'Train',
		aRelireTitre: (n) => `${compte(n, 'message', 'messages')} to review`,
		aRelireHorsEcran: (n) => ` (${n} to review)`,
		largeurLiens: 'Links panel width',
		largeurArbre: 'Tree panel width',
		choisirFiche: 'Choose a note in the tree.',
		liensFiche: 'Note links',
		chargementGraphe: 'Loading graph…',
		statistiques: (fiches, informations, liens) => `${compte(fiches, 'note', 'notes')} | ${compte(informations, 'fact', 'facts')} | ${compte(liens, 'link', 'links')}`,
	},
	arbre: {
		filtrer: 'Filter files',
		fiches: 'Notes',
		chargement: 'Loading…',
		aucuneCorrespondance: 'No matching note.',
		aucune: 'No notes.',
		nombreFiches: (n) => compte(n, 'note', 'notes'),
		debut: (n) => `Show the beginning (${compte(n, 'line', 'lines')} before)`,
		dePlus: (n) => `${compte(n, 'more line', 'more lines')}: filter, or collapse folders.`,
	},
	liens: {
		titre: 'Note links',
		entrants: (n) => `Incoming links (${n})`,
		sortants: (n) => `Outgoing links (${n})`,
		sessions: (n) => `Sessions that used it (${n})`,
		aucun: 'None.',
		aucune: 'None.',
		session: (debutId) => `Session ${debutId}`,
		ficheAbsente: (titre) => `Note "${titre}" is missing`,
	},
	fiche: {
		edition: 'Edit',
		voirDansLeGraphe: 'Show in graph',
		deplacer: 'Move',
		chargement: 'Loading note…',
		proprietes: 'Properties',
		modifie: 'updated',
		aVerifier: 'To check in this note',
		markdown: 'Note Markdown',
		aideMarkdown: 'Markdown file, also readable in Obsidian',
		enregistree: 'Note saved',
		deplaceeDans: (dossier) => `Note moved to ${dossier}`,
		deplaceeALaRacine: 'Note moved to the root',
		disparue: (erreur, enEdition) => `This note no longer exists here (${erreur}).${enEdition ? ' The text stays in the editor; copy it before leaving.' : ''}`,
		relectureImpossible: (erreur) => `Could not reload the note (${erreur}). The version shown may be out of date.`,
		conflit: 'The note has changed since it was opened. The text stays in the editor: Reload starts again from the version on disk.',
		changeeSurLeDisque: 'The note changed on disk while you were editing.',
		recharger: 'Reload',
		refus: (motif) => `Save refused: ${motif}`,
		plusSuggeree: (date) => `Mnemo no longer suggests this note in any session ("Never suggest again", on ${date}).`,
		retablir: 'Restore',
		retablirTitre: 'Mnemo can suggest it as a lead or inject it again',
		retablie: 'Mnemo can suggest this note again',
		quitter: {
			titre: 'Unsaved changes',
			texte: 'Unsaved changes.',
			abandonner: 'Discard changes',
			rester: 'Stay',
		},
		deplacement: {
			dossier: 'Destination folder',
			indication: 'Destination folder (empty = root)',
			ici: 'Move here',
		},
	},
	rendu: {
		sansCategorie: 'no category',
		barrees: 'removed or outdated',
		mention: (brute) => MENTIONS[brute] ?? brute,
		corroboree: (le) => `corroborated ${le}`,
		ficheAbsente: (cible) => `Note "${cible}" is missing`,
	},
};
