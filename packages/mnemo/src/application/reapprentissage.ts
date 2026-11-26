/**
 * Réapprentissage en fond de la note de confiance sur les gestes (spec « entraîner la note », D8) : quand le lancer, avec
 * quelles paires implicites, et si son modèle remplace le modèle actif.
 *
 * Conditions, vérifiées dans cet ordre (les moins chères d'abord ; la première manquée est le motif) :
 * 1. le réglage `entrainement.automatique` est actif ;
 * 2. aucune tâche de l'entraînement en cours (préparer, pré-juger, apprendre : D7) ;
 * 3. aucun calcul de session en cours (hook, affinage d'un classement), ni fini depuis moins de `CALME_APRES_CALCUL_MS` : une
 *    session active en enchaîne d'autres, et l'apprentissage, même dans son fil, prend du processeur ;
 * 4. le dernier apprentissage (manuel ou automatique, réussi ou en échec : historique ; à défaut, la date d'un modèle appris
 *    sur la mémoire, par exemple au terminal) date d'au moins 24 h ;
 * 5. au moins une paire validée au banc (sans elle, rien ne mesure le nouveau modèle : D1) ;
 * 6. au moins `GESTES_NOUVEAUX_MIN` gestes qui jugent une fiche (➤, lue après une carte, ✗ ici ou toujours) depuis ce dernier
 *    apprentissage (tous depuis toujours, s'il n'y en a pas eu).
 *
 * Paires implicites (`pairesDesGestes`) : calculées au début de la tâche, sous son exclusion, sur tous les gestes du journal et
 * les classements des messages porteurs (`servis`, moment `message`, une entrée par message : la plus récente, que l'affinage a
 * pu reclasser) des sessions où au moins un geste juge une fiche (`SESSIONS_MAX` au plus, les plus récemment touchées) : une
 * session sans aucun geste n'a sans doute pas été regardée, ses premières fiches ne disent rien.
 *
 * Remplacement (D8) : on ne perd jamais un niveau accepté. Le nouveau modèle remplace l'actuel, sauf si un niveau accepté par
 * l'actuel (ou coupé par le suivi des injections : il était accepté) ne l'est plus par le nouveau. D'où : nouveau accepté
 * partout où l'actuel l'est → remplace (accepté à un niveau de plus, ou le même modèle réappris) ; nouveau refusé → remplace un
 * actuel refusé, de départ ou jamais appris, jamais un accepté. Le fichier tient les deux niveaux : la décision vaut pour les
 * deux à la fois (un nouveau accepté au Sens seul mais refusé au Complets accepté de l'actuel est gardé de côté, rapport écrit).
 */
import type { RapportDApprentissage } from './apprendre-note.ts';
import type { CasContexte } from './banc-contexte.ts';
import { progression } from './banc-juger.ts';
import { ErreurEntrainement } from './entrainement.ts';
import type { Entrainement, LigneHistorique } from './entrainement.ts';
import type { EntreeServie, GesteNote } from './ports.ts';
import type { Geste } from '../domaine/gestes.ts';
import { NIVEAUX_DE_NOTE } from '../domaine/modele-de-note.ts';
import type { EtatDuModele, ModelesDeNote } from '../domaine/note-de-confiance.ts';
import { pairesDesGestes } from '../domaine/paires-des-gestes.ts';
import type { ClassementServi } from '../domaine/paires-des-gestes.ts';

export const DELAI_ENTRE_APPRENTISSAGES_MS = 24 * 60 * 60_000;
export const GESTES_NOUVEAUX_MIN = 20;
export const CALME_APRES_CALCUL_MS = 60_000;
/** Le service vérifie les conditions toutes les 10 minutes, la première fois 5 minutes après son démarrage. */
export const VERIFICATION_MS = 10 * 60_000;
export const PREMIERE_VERIFICATION_MS = 5 * 60_000;
/** Entrées servies lues par session (le journal en garde autant). */
export const SERVIS_PAR_SESSION = 200;
/** Sessions dont on lit les classements, au plus. */
export const SESSIONS_MAX = 300;
/** Gestes qui jugent une fiche : ceux qui font une paire, et qui comptent comme nouveaux. */
export const GESTES_QUI_JUGENT: readonly Geste[] = ['injectee_main', 'lue_apres_carte', 'ecartee_ici', 'ecartee_toujours'];

/** Ce qui décide du lancement. */
export type EtatPourReapprendre = {
	actif: boolean;
	tacheEnCours: boolean;
	calculs: { enCours: number; dernierMs: number };
	/** Instant du dernier apprentissage ; null : aucun. */
	dernierApprentissageMs: number | null;
	maintenantMs: number;
	pairesValidees: number;
	gestesNouveaux: number;
};

/** Le motif de l'attente des conditions 1 à 4 (sans lire le banc ni les gestes) ; null : rien n'y fait obstacle. */
export function attenteImmediate(e: Omit<EtatPourReapprendre, 'pairesValidees' | 'gestesNouveaux'>): string | null {
	if (!e.actif) return 'réglage coupé';
	if (e.tacheEnCours) return 'une tâche de l’entraînement est en cours';
	if (e.calculs.enCours > 0) return 'une session calcule';
	if (e.maintenantMs - e.calculs.dernierMs < CALME_APRES_CALCUL_MS) return 'une session vient de calculer';
	if (e.dernierApprentissageMs !== null && e.maintenantMs - e.dernierApprentissageMs < DELAI_ENTRE_APPRENTISSAGES_MS) return 'dernier apprentissage il y a moins de 24 h';
	return null;
}

/** Le motif de l'attente des conditions 5 et 6 ; null : rien n'y fait obstacle. */
export function attenteDesDonnees(e: Pick<EtatPourReapprendre, 'pairesValidees' | 'gestesNouveaux'>): string | null {
	if (e.pairesValidees === 0) return 'aucun jugement validé au banc';
	if (e.gestesNouveaux < GESTES_NOUVEAUX_MIN) return `${e.gestesNouveaux} geste(s) nouveau(x), il en faut ${GESTES_NOUVEAUX_MIN}`;
	return null;
}

/** Lancer, ou pourquoi attendre. */
export function decider(e: EtatPourReapprendre): { lancer: true } | { lancer: false; motif: string } {
	const motif = attenteImmediate(e) ?? attenteDesDonnees(e);
	return motif === null ? { lancer: true } : { lancer: false, motif };
}

const instant = (date: string | null): number | null => {
	if (date === null) return null;
	const ms = Date.parse(date);
	return Number.isFinite(ms) ? ms : null;
};

/** Le dernier apprentissage : la ligne d'historique la plus récente, ou la date d'un modèle appris sur la mémoire (ni de départ, ni jamais appris). */
export function dernierApprentissage(historique: readonly LigneHistorique[], modeles: ModelesDeNote): number | null {
	const dates = [
		...historique.map((l) => instant(l.date)),
		...NIVEAUX_DE_NOTE.map((n) => {
			const { modele, etat } = modeles[n];
			return etat === 'non_appris' || etat === 'depart' || modele.origine === 'depart' ? null : instant(modele.apprisLe);
		}),
	].filter((d): d is number => d !== null);
	return dates.length === 0 ? null : Math.max(...dates);
}

/** Les classements servis aux messages porteurs : une entrée par (session, message), la plus récente ; sans classement : laissée. */
export function classementsServis(entrees: readonly EntreeServie[]): ClassementServi[] {
	const parMessage = new Map<string, EntreeServie>();
	for (const e of entrees) {
		if (e.moment !== 'message' || typeof e.rangMessage !== 'number' || e.classement.length === 0) continue;
		const cle = `${e.session}\u0000${e.rangMessage}`;
		const deja = parMessage.get(cle);
		if (deja === undefined || e.horodatageMs > deja.horodatageMs) parMessage.set(cle, e);
	}
	return [...parMessage.values()].map((e) => ({ session: e.session, rangMessage: e.rangMessage!, lignes: e.classement }));
}

const accepteOuCoupe = (etat: EtatDuModele): boolean => etat === 'accepte' || etat === 'coupe';

/** Règle de remplacement d'un réapprentissage automatique (D8) : faux si un niveau accepté par l'actuel ne l'est plus. */
export function remplacerAutomatiquement(nouveau: Pick<RapportDApprentissage, 'coefficients'>, actuel: ModelesDeNote): boolean {
	return NIVEAUX_DE_NOTE.every((n) => {
		const m = nouveau.coefficients[n];
		const accepte = m.accepte && m.apprisLe !== null && Object.keys(m.poids).length > 0 && m.origine !== 'depart';
		return accepte || !accepteOuCoupe(actuel[n].etat);
	});
}

export type PortsReapprentissage = {
	/** Le réglage `entrainement.automatique` (relu à chaque vérification). */
	actif(): boolean;
	entrainement: Pick<Entrainement, 'tache' | 'apprendre'>;
	calculs(): { enCours: number; dernierMs: number };
	historique(): Promise<LigneHistorique[]>;
	modeles(): Promise<ModelesDeNote>;
	banc(): Promise<CasContexte[]>;
	/** Gestes du journal, sans leurs vecteurs (modèle du vecteur compris), les plus récents d'abord. */
	gestes(filtre: { depuisMs?: number; sortes?: readonly Geste[] }): Promise<GesteNote[]>;
	/** Nombre de gestes du journal (sans lire une ligne : la vérification ne lit jamais le journal). */
	nombreGestes(filtre: { depuisMs?: number; sortes?: readonly Geste[] }): Promise<number>;
	/** Les entrées servies aux messages porteurs de la session, classements entiers. */
	servis(session: string): Promise<EntreeServie[]>;
	/** Identité du modèle de sens installé (fichier GGUF) ; null : inconnue. */
	sensInstalle(): string | null;
	maintenantMs(): number;
};

export type ResultatVerification = { lance: true; fin: Promise<void> } | { lance: false; motif: string; erreur?: true };

const arret = (): Error => Object.assign(new Error('réapprentissage arrêté'), { name: 'AbortError' });
/**
 * Rend la main à la boucle d'événements : l'état des sessions se lit de façon synchrone (SQLite), une suite de lectures sans
 * pause retiendrait un hook arrivé entre-temps.
 */
const rendreLaMain = (): Promise<void> => new Promise((resoudre) => setTimeout(resoudre, 0));

/** Les paires implicites de tout le journal des gestes (voir l'en-tête). */
export async function implicitesDuJournal(p: Pick<PortsReapprentissage, 'gestes' | 'servis' | 'sensInstalle'>, signal: AbortSignal) {
	const gestes = await p.gestes({});
	const sessions = [...new Set(gestes.filter((g) => g.session !== '' && GESTES_QUI_JUGENT.includes(g.geste)).map((g) => g.session))].slice(0, SESSIONS_MAX);
	const entrees: EntreeServie[] = [];
	for (const session of sessions) {
		await rendreLaMain();
		if (signal.aborted) throw arret();
		entrees.push(...(await p.servis(session)));
	}
	await rendreLaMain();
	if (signal.aborted) throw arret();
	return pairesDesGestes(gestes, classementsServis(entrees), { sens: p.sensInstalle() }).paires;
}

/**
 * Vérifie les conditions et lance le réapprentissage s'il est prêt (origine `automatique`, règle de remplacement D8). Ne
 * rejette jamais : une panne est rendue en motif (`erreur`), un verrou du banc tenu ailleurs (le terminal) est une attente.
 */
export async function reapprendreSiPret(p: PortsReapprentissage): Promise<ResultatVerification> {
	try {
		const base = { actif: p.actif(), tacheEnCours: p.entrainement.tache() !== null, calculs: p.calculs(), maintenantMs: p.maintenantMs() };
		// sans rien lire d'abord, puis avec la date du dernier apprentissage
		const avant = attenteImmediate({ ...base, dernierApprentissageMs: null });
		if (avant !== null) return { lance: false, motif: avant };
		const [historique, modeles] = await Promise.all([p.historique(), p.modeles()]);
		const dernier = dernierApprentissage(historique, modeles);
		const immediate = attenteImmediate({ ...base, dernierApprentissageMs: dernier });
		if (immediate !== null) return { lance: false, motif: immediate };
		const pairesValidees = progression(await p.banc()).pairesValidees;
		const gestesNouveaux = pairesValidees === 0 ? 0 : await p.nombreGestes({ sortes: GESTES_QUI_JUGENT, ...(dernier === null ? {} : { depuisMs: dernier + 1 }) });
		const donnees = attenteDesDonnees({ pairesValidees, gestesNouveaux });
		if (donnees !== null) return { lance: false, motif: donnees };
		const { fin } = await p.entrainement.apprendre({ origine: 'automatique', implicites: (signal) => implicitesDuJournal(p, signal), remplacer: remplacerAutomatiquement });
		return { lance: true, fin };
	} catch (e) {
		if (e instanceof ErreurEntrainement && e.genre !== 'introuvable') return { lance: false, motif: e.message };
		return { lance: false, motif: e instanceof Error ? e.message : String(e), erreur: true };
	}
}
