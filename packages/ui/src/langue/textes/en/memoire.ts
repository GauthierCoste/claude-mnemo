import type { Forme } from '../../forme.ts';
import { pluriel } from '../../pluriel.ts';
import type { memoire as fr } from '../fr/memoire.ts';

const NOMBRE = new Intl.NumberFormat('en-US');
const nombre = (n: number): string => NOMBRE.format(n);
const compte = (n: number, un: string, autre: string): string => `${nombre(n)} ${pluriel('en', n, { un, autre })}`;

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
};
