import type { Forme } from '../../forme.ts';
import { pluriel } from '../../pluriel.ts';
import type { commun as fr } from '../fr/commun.ts';

const NOMBRE = new Intl.NumberFormat('en-US');
const DATE = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const HEURE = new Intl.DateTimeFormat('en-US', { hour: '2-digit', minute: '2-digit' });
const UNITES_TAILLE = ['bytes', 'KB', 'MB', 'GB', 'TB'] as const;

export const commun: Forme<typeof fr> = {
	formats: {
		nombre: (n) => NOMBRE.format(n),
		date: (ms) => DATE.format(ms),
		heure: (ms) => HEURE.format(ms),
		dateHeure: (ms) => `${DATE.format(ms)} ${HEURE.format(ms)}`,
		taille: (octets) => {
			let valeur = octets;
			let rang = 0;
			while (valeur >= 1024 && rang < UNITES_TAILLE.length - 1) {
				valeur /= 1024;
				rang++;
			}
			return `${String(Math.round(valeur * 10) / 10)} ${UNITES_TAILLE[rang]}`;
		},
		fiches: (n) => `${NOMBRE.format(n)} ${pluriel('en', n, { un: 'note', autre: 'notes' })}`,
	},
	actions: {
		annuler: 'Cancel',
		enregistrer: 'Save',
		fermer: 'Close',
		ouvrir: 'Open',
		supprimer: 'Delete',
		reessayer: 'Retry',
	},
};
