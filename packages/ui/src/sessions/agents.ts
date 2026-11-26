/**
 * Ce que la Nouvelle session dit d'un agent (un profil lancé par le dialogue) : sa place dans la scène, son étiquette, son
 * modèle, son équipement, où il se lance, l'état de son moteur (prêt, ou ce qui bloque son lancement) et le résumé du pied.
 */
import { FOURNISSEURS_MOTEURS, MOTEUR_PAR_DEFAUT, PROFIL_TRAVAIL } from '@mnemo/commun';
import type { MoteurVue, ProfilVue } from '@mnemo/contrat';
import { actionDuMoteur, statutDuMoteur } from '../moteurs/circuit.ts';
import { HOOKS_PROFIL } from '../profils/hooks.ts';

/** Écart circulaire de l'agent `j` à l'agent choisi `i`, parmi `n` : négatif à gauche, positif à droite. */
export function ecartCirculaire(j: number, i: number, n: number): number {
	let d = j - i;
	if (d > n / 2) d -= n;
	if (d < -n / 2) d += n;
	return d;
}

/** Place dans la scène : le choisi (`0`), ses voisins (`-1`, `1`), les suivants hors champ (`-2`, `2`), les autres `loin`. */
export const placeDansScene = (ecart: number): string => (Math.abs(ecart) <= 2 ? String(ecart) : 'loin');

/** Étiquette du profil : le profil par défaut, un profil intégré gardé tel quel, ou un profil personnalisé. */
export function etiquetteDuProfil(p: Pick<ProfilVue, 'nom' | 'personnalise'>): string {
	if (p.nom === PROFIL_TRAVAIL) return 'par défaut';
	return p.personnalise ? 'personnalisé' : 'intégré';
}

/** Où se lance un profil. */
export const LIEUX_DE_LANCEMENT: Readonly<Record<ProfilVue['lancement'], string>> = { projet: 'dans le dossier choisi', memoire: 'dans la mémoire' };

/** Modèle du profil ; « » : celui par défaut du moteur (que le service ne nomme pas). */
export const modeleDuProfil = (p: Pick<ProfilVue, 'modele'>): { texte: string; parDefaut: boolean } =>
	p.modele === '' ? { texte: 'par défaut du moteur', parDefaut: true } : { texte: p.modele, parDefaut: false };

/** Hooks du profil, en clair : « tous » (le suivi complet), ou les libellés de ses événements. */
export function texteHooks(hooks: readonly string[]): string {
	if (hooks.length === 0) return 'aucun';
	if (HOOKS_PROFIL.every((h) => hooks.includes(h.cle))) return 'tous';
	return HOOKS_PROFIL.filter((h) => hooks.includes(h.cle))
		.map((h) => h.libelle)
		.join(', ');
}

/** Les plugins ne valent qu'avec Claude Code : avec un autre moteur, l'équipement ne les montre pas. */
export const montrePlugins = (p: Pick<ProfilVue, 'moteur'>): boolean => p.moteur === MOTEUR_PAR_DEFAUT;

const pluriel = (n: number, mot: string): string => `${mot}${n > 1 ? 's' : ''}`;
export const motSkills = (n: number): string => pluriel(n, 'skill');
export const motPlugins = (n: number): string => pluriel(n, 'plugin');

/**
 * État du moteur d'un agent, sur sa fiche :
 * - `verification` : la vue du moteur n'est pas encore là (vérification du poste en cours) ;
 * - `illisible` : la lecture a échoué ;
 * - `pret` ; `manuel` : introuvable, ses sessions se lancent par une ligne à coller ;
 * - `bloque` : le lancement est impossible (`raison`, dite à côté de « Lancer ») ; `lignes` : les points en cause ; `lier` :
 *   « Lier à Mnemo » le débloque ;
 * - `attention` : un point à régler qui n'empêche pas le lancement (hooks à approuver, état inconnu).
 */
export type EtatMoteurAgent =
	| { genre: 'verification' }
	| { genre: 'illisible'; motif: string }
	| { genre: 'pret' }
	| { genre: 'manuel' }
	| { genre: 'bloque'; raison: string; lignes: string[]; lier: boolean }
	| { genre: 'attention'; titre: string; motif: string | null };

/** `verification` : une lecture des moteurs en cours ; `erreur` : celle de la dernière lecture. */
export function etatDuMoteur(m: MoteurVue | undefined, verification: boolean, erreur: string | null): EtatMoteurAgent {
	if (m === undefined) return erreur !== null && !verification ? { genre: 'illisible', motif: erreur } : { genre: 'verification' };
	const enDefaut = (m.poste ?? []).filter((x) => x.ok === false).map((x) => `${x.libelle} : ${x.etat}`);
	if (m.indisponible !== null) return m.manuel ? { genre: 'manuel' } : { genre: 'bloque', raison: `Lancement impossible ici : ${m.indisponible}`, lignes: enDefaut, lier: false };
	// points du poste pas encore vérifiés : rien à dire tant que la vérification court
	if (m.poste === undefined && verification) return { genre: 'verification' };
	const statut = statutDuMoteur(m);
	if (statut.cle === 'pret') return { genre: 'pret' };
	const action = actionDuMoteur(m);
	if (statut.cle === 'a-lier' && action !== null) {
		const lignes = (m.poste ?? []).filter((x) => (x.cle === 'mcp' || x.cle === 'hooks') && x.ok !== true).map((x) => `${x.libelle} : ${x.etat}`);
		return { genre: 'bloque', raison: `Lancement impossible : ${action.titre}`, lignes, lier: true };
	}
	return { genre: 'attention', titre: action?.titre ?? statut.libelle, motif: action?.motif ?? null };
}

/** « travail · Anthropic modèle par défaut · dans api » : qui part, sur quoi, où. */
export function resumeDeLaSession(p: Pick<ProfilVue, 'nom' | 'moteur' | 'modele' | 'lancement'>, dossier: string, nomRacine: string): string {
	const modele = p.modele === '' ? 'modèle par défaut' : p.modele;
	const lieu = p.lancement === 'memoire' ? LIEUX_DE_LANCEMENT.memoire : `dans ${dossier === '' ? nomRacine : dossier.slice(dossier.lastIndexOf('/') + 1)}`;
	return `${p.nom} · ${FOURNISSEURS_MOTEURS[p.moteur]} ${modele} · ${lieu}`;
}
