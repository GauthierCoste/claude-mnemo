/**
 * Les fichiers de l'entraînement de la note dans `.mnemo/` (spec « entraîner la note », D6, D7) : le fichier des jugements
 * sous le verrou du banc pris au nom du service ; les coefficients appris et le modèle d'avant
 * (`coefficients-note.avant.json` ; `{ "aucun": true }` : il n'y avait pas de fichier, le module livré valait) ; le rapport du
 * dernier essai (`apprentissage-note.json` et `.txt`) ; l'historique des apprentissages (`entrainements.json`, 10 lignes).
 * Écritures entières (fichier voisin puis renommage) : le service, qui relit les coefficients quand ils changent, ne lit jamais
 * un fichier à moitié écrit, ni ne les trouve absents pendant un retour au modèle d'avant.
 */
import { readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { RapportDApprentissage } from '../application/apprendre-note.ts';
import type { CasContexte } from '../application/banc-contexte.ts';
import type { DernierRapport, FichierDuBanc, HistoriqueDesApprentissages, LigneHistorique } from '../application/entrainement.ts';
import { rapportEnTexte } from '../application/rapport-apprentissage.ts';
import { DOSSIER_LOCAL } from '../domaine/dossier-memoire.ts';
import { jsonDeCoefficients, NIVEAUX_DE_NOTE } from '../domaine/modele-de-note.ts';
import type { CoefficientsNote } from '../domaine/modele-de-note.ts';
import { estObjet } from '../domaine/valeurs.ts';
import { enregistrerCas, fichierBancContexte, lireCasDuFichier } from './banc-contexte-fichier.ts';
import { fichierDesCoefficients } from './coefficients-note-fichier.ts';
import { prendreVerrouBanc } from './verrou-banc.ts';

export const fichierAvant = (racine: string): string => join(racine, DOSSIER_LOCAL, 'coefficients-note.avant.json');
export const fichierHistorique = (racine: string): string => join(racine, DOSSIER_LOCAL, 'entrainements.json');
const fichierRapport = (racine: string, extension: 'json' | 'txt'): string => join(racine, DOSSIER_LOCAL, `apprentissage-note.${extension}`);

/** Le modèle d'avant quand il n'y avait aucun fichier de coefficients (le module livré avec Mnemo valait). */
const AUCUN = `${JSON.stringify({ aucun: true })}\n`;

let provisoires = 0;
async function ecrireEntier(fichier: string, texte: string): Promise<void> {
	const provisoire = `${fichier}.${process.pid}.${++provisoires}.tmp`;
	try {
		await writeFile(provisoire, texte);
		await rename(provisoire, fichier);
	} catch (erreur) {
		await rm(provisoire, { force: true }).catch(() => {});
		throw erreur;
	}
}

async function lireOuNull(fichier: string): Promise<string | null> {
	try {
		return await readFile(fichier, 'utf8');
	} catch (e) {
		if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
		throw e;
	}
}

const existe = async (fichier: string): Promise<boolean> => (await lireOuNull(fichier)) !== null;
const estAucun = (texte: string): boolean => {
	try {
		const v: unknown = JSON.parse(texte);
		return estObjet(v) && v['aucun'] === true;
	} catch {
		return false;
	}
};

/** Un niveau du rapport tel que l'entraînement le lit (un rapport d'une autre version, mal formé, est ignoré). */
const niveauLisible = (n: unknown): boolean =>
	estObjet(n) && typeof n['niveau'] === 'string' && Array.isArray(n['fiabilite']) && estObjet(n['modele']) && Array.isArray(n['modele']['refus']) && typeof n['modele']['accepte'] === 'boolean' && estObjet(n['modele']['poids']);

/**
 * Le fichier des jugements de la mémoire, son verrou pris au nom du service. Relu (plusieurs mégaoctets d'analyse sur le fil du
 * service) seulement s'il a changé : même inode, date et taille, les cas déjà lus sont rendus (partagés : jamais modifiés,
 * l'entraînement n'écrit que des copies). Toute écriture, ici ou par le CLI, remplace le fichier par renommage : nouvel inode.
 */
export function bancDuService(racine: string): FichierDuBanc {
	const fichier = fichierBancContexte(racine);
	let lu: { cle: string; cas: Promise<CasContexte[]> } | null = null;
	return {
		async lire() {
			let cle: string;
			try {
				const s = await stat(fichier, { bigint: true });
				cle = `${s.ino}:${s.mtimeNs}:${s.size}`;
			} catch (e) {
				if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
				throw e;
			}
			if (lu?.cle !== cle) {
				const cas = lireCasDuFichier(fichier);
				lu = { cle, cas };
				// une lecture en échec n'est pas gardée
				cas.catch(() => {
					if (lu?.cas === cas) lu = null;
				});
			}
			return lu.cas;
		},
		ecrire: (cas) => enregistrerCas(fichier, cas),
		verrouiller: (operation) => prendreVerrouBanc(fichier, operation, { service: true }),
	};
}

/** Les coefficients appris, le modèle d'avant et le rapport de la mémoire. */
export function fichiersDeLaNote(racine: string) {
	const courant = fichierDesCoefficients(racine);
	const avant = fichierAvant(racine);
	return {
		/** Garde le modèle actuel comme modèle d'avant (écrit entier), puis écrit les nouveaux coefficients. */
		async ecrire(coefficients: CoefficientsNote): Promise<void> {
			await ecrireEntier(avant, (await lireOuNull(courant)) ?? AUCUN);
			await ecrireEntier(courant, jsonDeCoefficients(coefficients));
		},
		/** Le rapport (JSON, avec `remplace`) et son texte, qui dit si le modèle a été écrit ou si l'actuel est gardé. */
		async ecrireRapport(rapport: RapportDApprentissage, remplace: boolean): Promise<void> {
			await ecrireEntier(fichierRapport(racine, 'json'), `${JSON.stringify({ ...rapport, remplace }, null, 2)}\n`);
			await ecrireEntier(fichierRapport(racine, 'txt'), `${rapportEnTexte(rapport, remplace ? [courant] : [])}\n`);
		},
		/** Un modèle d'avant à rendre : le marqueur « aucun » n'en est un que s'il y a un modèle à retirer. */
		async avant(): Promise<boolean> {
			const texteAvant = await lireOuNull(avant);
			return texteAvant !== null && (!estAucun(texteAvant) || (await existe(courant)));
		},
		/**
		 * Échange le modèle et le modèle d'avant ; faux : aucun modèle d'avant. Le modèle d'avant prend la place de l'actuel d'un
		 * seul renommage (le fichier des coefficients n'est jamais absent un instant) ; l'actuel, écrit à côté avant, devient le
		 * modèle d'avant.
		 */
		async revenir(): Promise<boolean> {
			const texteAvant = await lireOuNull(avant);
			if (texteAvant === null) return false;
			const texteCourant = await lireOuNull(courant);
			if (estAucun(texteAvant)) {
				// avant, aucun fichier : l'actuel devient le modèle d'avant, le module livré revaut
				if (texteCourant === null) return false;
				await rename(courant, avant);
				return true;
			}
			const echange = `${avant}.${process.pid}.echange`;
			await ecrireEntier(echange, texteCourant ?? AUCUN);
			try {
				await rename(avant, courant);
			} catch (erreur) {
				await rm(echange, { force: true }).catch(() => {});
				throw erreur;
			}
			await rename(echange, avant);
			return true;
		},
		/** Le dernier rapport et s'il a remplacé le modèle d'alors (null : aucun, ou illisible ; sans `remplace`, d'avant : vrai). */
		async rapport(): Promise<DernierRapport | null> {
			const texte = await lireOuNull(fichierRapport(racine, 'json')).catch(() => null);
			if (texte === null) return null;
			try {
				const r: unknown = JSON.parse(texte);
				if (!(estObjet(r) && typeof r['date'] === 'string' && Array.isArray(r['niveaux']) && r['niveaux'].every(niveauLisible))) return null;
				const { remplace, ...rapport } = r;
				return { rapport: rapport as RapportDApprentissage, remplace: remplace !== false };
			} catch {
				return null;
			}
		},
	};
}

const ETATS = ['accepte', 'coupe', 'refuse', 'depart', 'non_appris'] as const;

/** Une ligne de l'historique lue ; null si elle est mal formée (laissée). */
function lireLigne(v: unknown): LigneHistorique | null {
	if (!estObjet(v) || typeof v['date'] !== 'string' || (v['origine'] !== 'manuel' && v['origine'] !== 'automatique') || !estObjet(v['verdicts'])) return null;
	const verdicts = v['verdicts'];
	if (!NIVEAUX_DE_NOTE.every((n) => (ETATS as readonly unknown[]).includes(verdicts[n]))) return null;
	return { date: v['date'], origine: v['origine'], verdicts: verdicts as LigneHistorique['verdicts'], remplace: v['remplace'] === true };
}

/** L'historique des apprentissages (`.mnemo/entrainements.json`) ; illisible : vide. */
export function historiqueDuDossier(racine: string): HistoriqueDesApprentissages {
	const fichier = fichierHistorique(racine);
	return {
		async lire() {
			try {
				const brut: unknown = JSON.parse((await lireOuNull(fichier)) ?? '[]');
				return Array.isArray(brut) ? brut.map(lireLigne).filter((l) => l !== null) : [];
			} catch {
				return [];
			}
		},
		ecrire: (lignes) => ecrireEntier(fichier, `${JSON.stringify(lignes, null, 2)}\n`),
	};
}
