/**
 * Ce que la Nouvelle session dit d'un agent (un profil lancé par le dialogue) : sa place dans la scène, son étiquette, son
 * modèle, son équipement, où il se lance, l'état de son moteur (prêt, ou ce qui bloque son lancement) et le résumé du pied.
 */
import { FOURNISSEURS_MOTEURS, MOTEUR_PAR_DEFAUT, PROFIL_TRAVAIL } from '@mnemo/commun';
import type { MoteurVue, ProfilVue } from '@mnemo/contrat';
import { actionDuMoteur, statutDuMoteur } from '../moteurs/circuit.ts';
import { hooksProfil } from '../profils/hooks.ts';
import { TEXTES, type Textes } from '../langue/textes.ts';

type T = Textes['sessions'];

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
export function etiquetteDuProfil(p: Pick<ProfilVue, 'nom' | 'personnalise'>, t: T = TEXTES.fr.sessions): string {
	const e = t.nouvelle.etiquettes;
	if (p.nom === PROFIL_TRAVAIL) return e.parDefaut;
	return p.personnalise ? e.personnalise : e.integre;
}

/** Modèle du profil ; « » : celui par défaut du moteur (que le service ne nomme pas). */
export const modeleDuProfil = (p: Pick<ProfilVue, 'modele'>, t: T = TEXTES.fr.sessions): { texte: string; parDefaut: boolean } =>
	p.modele === '' ? { texte: t.nouvelle.modeleParDefautDuMoteur, parDefaut: true } : { texte: p.modele, parDefaut: false };

/** Hooks du profil, en clair : « tous » (le suivi complet), ou les libellés de ses événements. */
export function texteHooks(hooks: readonly string[], t: T = TEXTES.fr.sessions, textesHooks: Textes['agents']['hooks'] = TEXTES.fr.agents.hooks): string {
	if (hooks.length === 0) return t.nouvelle.hooksAucun;
	const tous = hooksProfil(textesHooks);
	if (tous.every((h) => hooks.includes(h.cle))) return t.nouvelle.hooksTous;
	return tous
		.filter((h) => hooks.includes(h.cle))
		.map((h) => h.libelle)
		.join(', ');
}

/** Les plugins ne valent qu'avec Claude Code : avec un autre moteur, l'équipement ne les montre pas. */
export const montrePlugins = (p: Pick<ProfilVue, 'moteur'>): boolean => p.moteur === MOTEUR_PAR_DEFAUT;

/**
 * État du moteur d'un agent, sur sa fiche :
 * - `verification` : la vue du moteur n'est pas encore là (vérification du poste en cours) ;
 * - `illisible` : la lecture des moteurs, ou la vérification du poste, a échoué ;
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
export function etatDuMoteur(m: MoteurVue | undefined, verification: boolean, erreur: string | null, t: T = TEXTES.fr.sessions, textes: Textes = TEXTES.fr): EtatMoteurAgent {
	const n = t.nouvelle;
	if (m === undefined) return erreur !== null && !verification ? { genre: 'illisible', motif: erreur } : { genre: 'verification' };
	const enDefaut = (m.poste ?? []).filter((x) => x.ok === false).map((x) => n.pointDuPoste(x.libelle, x.etat));
	if (m.indisponible !== null) return m.manuel ? { genre: 'manuel' } : { genre: 'bloque', raison: n.lancementImpossibleIci(m.indisponible), lignes: enDefaut, lier: false };
	// points du poste pas encore vérifiés : rien à dire tant que la vérification court ; elle a échoué : jamais « lié »
	if (m.poste === undefined) return verification ? { genre: 'verification' } : { genre: 'illisible', motif: erreur ?? n.posteNonVerifie };
	const statut = statutDuMoteur(m, textes);
	if (statut.cle === 'pret') return { genre: 'pret' };
	const action = actionDuMoteur(m, textes);
	if (statut.cle === 'a-lier' && action !== null) {
		const lignes = (m.poste ?? []).filter((x) => (x.cle === 'mcp' || x.cle === 'hooks') && x.ok !== true).map((x) => n.pointDuPoste(x.libelle, x.etat));
		return { genre: 'bloque', raison: n.lancementImpossibleCar(action.titre), lignes, lier: true };
	}
	return { genre: 'attention', titre: action?.titre ?? statut.libelle, motif: action?.motif ?? null };
}

/** « travail · Anthropic modèle par défaut · dans api » : qui part, sur quoi, où. */
export function resumeDeLaSession(p: Pick<ProfilVue, 'nom' | 'moteur' | 'modele' | 'lancement'>, dossier: string, nomRacine: string, t: T = TEXTES.fr.sessions): string {
	const modele = p.modele === '' ? t.nouvelle.modeleParDefaut : p.modele;
	const lieu = p.lancement === 'memoire' ? t.nouvelle.lieux.memoire : t.nouvelle.lieuDossier(dossier === '' ? nomRacine : dossier.slice(dossier.lastIndexOf('/') + 1));
	return `${p.nom} · ${FOURNISSEURS_MOTEURS[p.moteur]} ${modele} · ${lieu}`;
}

/** Ce que la fiche annonce aux lecteurs d'écran quand l'agent ou l'état de son moteur change : l'agent, puis l'état en bref. */
export function annonceDeLAgent(nom: string, moteur: string, e: EtatMoteurAgent, t: T = TEXTES.fr.sessions): string {
	const a = t.nouvelle.annonce;
	const etat =
		e.genre === 'verification'
			? a.verification(moteur)
			: e.genre === 'pret'
				? a.pret
				: e.genre === 'manuel'
					? a.manuel(moteur)
					: e.genre === 'bloque'
						? e.raison
						: e.genre === 'attention'
							? e.titre
							: a.illisible(moteur);
	return a.agent(nom, etat);
}
