import { pluriel } from '../../pluriel.ts';

const deux = (n: number): string => String(n).padStart(2, '0');
const NOMBRE = new Intl.NumberFormat('fr-FR');
const HEURE = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' });
const UNITES_TAILLE = ['octets', 'Ko', 'Mo', 'Go', 'To'] as const;

/** Mots et formats partagés par tous les écrans. */
export const commun = {
	formats: {
		/** « 1 234 » */
		nombre: (n: number): string => NOMBRE.format(n),
		/** « 25.11.2026 », heure locale. */
		date: (ms: number): string => {
			const d = new Date(ms);
			return `${deux(d.getDate())}.${deux(d.getMonth() + 1)}.${d.getFullYear()}`;
		},
		/** « 09:12 », heure locale. */
		heure: (ms: number): string => HEURE.format(ms),
		/** « 25.11.2026 09:12 », heure locale. */
		dateHeure: (ms: number): string => {
			const d = new Date(ms);
			return `${deux(d.getDate())}.${deux(d.getMonth() + 1)}.${d.getFullYear()} ${deux(d.getHours())}:${deux(d.getMinutes())}`;
		},
		/** « 512 octets », « 1,5 Go » : unités binaires, une décimale au plus. */
		taille: (octets: number): string => {
			let valeur = octets;
			let rang = 0;
			while (valeur >= 1024 && rang < UNITES_TAILLE.length - 1) {
				valeur /= 1024;
				rang++;
			}
			return `${String(Math.round(valeur * 10) / 10).replace('.', ',')} ${UNITES_TAILLE[rang]}`;
		},
		/** « 3 fiches », « 1 fiche », « 0 fiche » */
		fiches: (n: number): string => `${NOMBRE.format(n)} ${pluriel('fr', n, { un: 'fiche', autre: 'fiches' })}`,
	},
	/** Un avertissement du service, montré tel qu'il est écrit. */
	avertissement: (texte: string): string => `Avertissement : ${texte}`,
	actions: {
		annuler: 'Annuler',
		enregistrer: 'Enregistrer',
		fermer: 'Fermer',
		ouvrir: 'Ouvrir',
		supprimer: 'Supprimer',
		reessayer: 'Réessayer',
	},
};
