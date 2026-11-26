/**
 * L'entraînement de la note de confiance depuis le service (spec « entraîner la note », § Service, D1, D3, D5, D6, D7, D9) :
 * l'état montré par la page Entraîner, et ses opérations, sur des ports (fichier des jugements et son verrou, journal, extraction
 * avec les modèles du service, synthèses des fiches, juge, fichiers de la note, apprenti, historique).
 *
 * - Une seule tâche longue à la fois (préparer, pré-juger, apprendre) : exclusion en mémoire **et** verrou du banc, tenu toute
 *   la tâche (une commande `mnemo banc contexte` ne peut pas écrire en même temps) ; chaque tâche s'arrête (`AbortController`).
 * - Toutes les écritures du fichier des jugements (réponses, propositions du juge, messages préparés, « Accepter les sûres »,
 *   annulations) passent par une seule file : chacune relit le fichier juste avant d'écrire. Hors tâche, chaque écriture prend
 *   le verrou le temps de l'écrire. Juger reste permis pendant une tâche. Le verrou d'une tâche est pris dans cette file : une
 *   écriture en cours ne fait jamais refuser la tâche qui démarre.
 * - Apprendre : le modèle d'avant est gardé (`revenir` l'échange) ; une ligne d'historique par essai (`enregistrerApprentissage`,
 *   partagé avec `mnemo banc contexte --apprendre`). Les écritures des fichiers de la note (nouveau modèle, retour au modèle
 *   d'avant) passent l'une après l'autre.
 * - `derniereErreur` : l'échec de la dernière tâche ; une tâche qui démarre l'efface, sauf une tâche automatique l'erreur d'une
 *   tâche manuelle.
 */
import type { BilanExtraction, MessageAExtraire } from './banc-extraire.ts';
import { fusionnerCas, messagesAExtraire } from './banc-extraire.ts';
import type { CasContexte, Jugement } from './banc-contexte.ts';
import { accepterSures, aJuger, estJuge, messagesARelire, ordreDePresentation, prochainMessage, progression, repondreMessage } from './banc-juger.ts';
import type { ReponseMessage } from './banc-juger.ts';
import { jeuDApprentissage } from './apprendre-note.ts';
import type { Implicite, JeuDApprentissage, OptionsApprentissage, RapportDApprentissage } from './apprendre-note.ts';
import { aPrejuger, fusionnerPrejugements, prejuger } from './prejuger.ts';
import type { Juge } from './prejuger.ts';
import { NIVEAUX_DE_NOTE } from '../domaine/modele-de-note.ts';
import type { CoefficientsNote, EchelleDesSignaux, IdentiteDesModeles, ModeleDeNote, NiveauDeNote } from '../domaine/modele-de-note.ts';
import { etatDuModele, garderLesNiveauxSansPaire } from '../domaine/note-de-confiance.ts';
import type { EtatDuModele, ModelesDeNote } from '../domaine/note-de-confiance.ts';
import { requeteJointe } from '../domaine/requete-du-message.ts';
import { criteresEnClair, verdictEnClair } from '../domaine/verdict-note.ts';
import type { TrancheFiabilite } from '../domaine/mesures-banc.ts';

// ——— Ports ———

/** Le fichier des jugements : lu et écrit entier ; `verrouiller(operation)` prend son verrou (lève s'il est tenu) et rend de quoi le rendre. */
export type FichierDuBanc = { lire(): Promise<CasContexte[]>; ecrire(cas: readonly CasContexte[]): Promise<void>; verrouiller(operation: string): () => void };
/** L'apprentissage hors du fil du service (`infra/apprenti-note.ts`) ; rejette s'il est arrêté. */
export type Apprenti = { apprendre(jeu: JeuDApprentissage, options: OptionsApprentissage, signal?: AbortSignal): Promise<RapportDApprentissage> };
/** Le juge, ou pourquoi il n'est pas là (Claude Code introuvable). */
export type JugeDisponible = { juge: Juge } | { raison: string };
/** Le dernier rapport et si son modèle a remplacé le modèle d'alors. */
export type DernierRapport = { rapport: RapportDApprentissage; remplace: boolean };
/**
 * Les fichiers de la note : `modeles()` les modèles actifs et leur état (coupures du suivi comprises) ; `ecrire` garde le modèle
 * actuel comme modèle d'avant puis écrit `coefficients` ; `ecrireRapport` : le rapport de l'essai (JSON et texte) ; `revenir`
 * échange le modèle et le modèle d'avant (faux : pas de modèle d'avant) ; `rapport` : le dernier rapport et si son modèle a
 * remplacé l'actuel (null : aucun).
 */
export type FichiersDeNote = {
	modeles(): Promise<ModelesDeNote>;
	installes(): IdentiteDesModeles;
	echelle(): EchelleDesSignaux;
	empreintes(): Promise<ReadonlyMap<string, string>>;
	ecrire(coefficients: CoefficientsNote): Promise<void>;
	/** `remplace` : le modèle de l'essai a été écrit (le rapport le dit). */
	ecrireRapport(rapport: RapportDApprentissage, remplace: boolean): Promise<void>;
	avant(): Promise<boolean>;
	revenir(): Promise<boolean>;
	rapport(): Promise<DernierRapport | null>;
};
/** L'historique des apprentissages (`.mnemo/entrainements.json`), plus récents d'abord. */
export type HistoriqueDesApprentissages = { lire(): Promise<LigneHistorique[]>; ecrire(lignes: readonly LigneHistorique[]): Promise<void> };

export type PortsEntrainement = {
	banc: FichierDuBanc;
	/** Les messages porteurs du journal des sessions (`messagesDuJournal`). */
	journal(): Promise<MessageAExtraire[]>;
	/** Les cas à juger de ces messages, avec les modèles du service (`extraireJugements`) ; `avancement(faits, total)`. */
	extraire(messages: readonly MessageAExtraire[], o: { signal: AbortSignal; avancement: (faits: number, total: number) => void }): Promise<BilanExtraction>;
	/** Synthèse de chaque fiche demandée (absente : vide). */
	syntheses(chemins: readonly string[]): Promise<ReadonlyMap<string, string>>;
	/** Le juge (peut être gardé un moment : lu à chaque état) ; `frais` : cherché de nouveau (avant de pré-juger). */
	juge(o?: { frais?: boolean }): JugeDisponible;
	note: FichiersDeNote;
	apprenti: Apprenti;
	historique: HistoriqueDesApprentissages;
	maintenant(): Date;
	/** L'état a changé (le service le relit et le diffuse, au plus quelques fois par seconde). */
	surChangement?(): void;
};

// ——— État ———

export type GenreTache = 'preparer' | 'prejuger' | 'apprendre';
export type TacheEntrainement = { genre: GenreTache; fait: number; total: number; depuis: string };
export type OrigineApprentissage = 'manuel' | 'automatique';
/** `erreur` : l'essai a échoué (réapprentissage automatique) ; `verdicts` sont alors ceux des modèles gardés. */
export type LigneHistorique = { date: string; origine: OrigineApprentissage; verdicts: Record<NiveauDeNote, EtatDuModele>; remplace: boolean; erreur?: string };
/** Les paires implicites des gestes, données ou calculées au début de la tâche (sous son exclusion, arrêtables). */
export type ImplicitesDApprentissage = readonly Implicite[] | ((signal: AbortSignal) => Promise<readonly Implicite[]>);
export type NoteDuNiveau = { niveau: NiveauDeNote; etat: EtatDuModele; origine: 'appris' | 'depart' | 'non_appris'; date: string | null; verdict: string; criteres: string[]; refus: string[] };
/** `nouveauxDepuisApprentissage` : messages jugés depuis le dernier apprentissage (`nouveauxDepuis`), tous sans apprentissage. */
export type BancEntrainement = { messages: number; valides: number; aJuger: number; aRelire: number; aPrejuger: number; silences: number; sautes: number; paires: number; nouveauxDepuisApprentissage: number };
/** `remplace` : le modèle de cet essai a remplacé le modèle d'alors (faux : l'ancien est gardé). */
export type ResultatApprentissage = {
	date: string;
	remplace: boolean;
	messages: number;
	sessions: number;
	niveaux: { niveau: NiveauDeNote; accepte: boolean; verdict: string; criteres: string[]; refus: string[]; paires: number; fiabilite: TrancheFiabilite[] }[];
};
export type EtatEntrainement = {
	note: { niveaux: NoteDuNiveau[]; avant: boolean };
	banc: BancEntrainement;
	tache: TacheEntrainement | null;
	historique: LigneHistorique[];
	juge: { disponible: boolean; raison?: string };
	resultat: ResultatApprentissage | null;
	derniereErreur?: string;
};
export type CandidateAJugerVue = { chemin: string; titre: string; ligne: string; synthese: string; proposition: { jugement: Jugement; confiance: number; raison: string } | null; jugement: Jugement | null };
export type MessageAJuger = { indice: number; message: string; precedent: string | null; candidates: CandidateAJugerVue[]; valide: boolean; silence: boolean; saute: boolean; aRelire: boolean; restants: number };

/** Refus d'une opération : `occupe` (une tâche tourne, ou le fichier est tenu), `refuse` (l'état ne le permet pas), `introuvable`. */
export class ErreurEntrainement extends Error {
	readonly genre: 'occupe' | 'refuse' | 'introuvable';
	constructor(genre: ErreurEntrainement['genre'], message: string) {
		super(message);
		this.name = 'ErreurEntrainement';
		this.genre = genre;
	}
}

/** Messages préparés par défaut, au plus par session, et au plus par demande. */
export const NOMBRE_A_PREPARER = 30;
export const PREPARER_MAX = 200;
export const PAR_SESSION = 6;
/** Messages extraits d'une traite : chacun de ces paquets est enregistré dès qu'il est prêt (un arrêt garde les précédents). */
export const PAQUET_EXTRACTION = 10;
export const HISTORIQUE_MAX = 10;
/** Annulations gardées en mémoire. */
export const ANNULATIONS_MAX = 50;
/** Synthèse montrée d'une candidate. */
export const SYNTHESE_MAX = 300;
/** Erreur gardée d'un essai dans l'historique. */
export const ERREUR_MAX = 300;
/** Seuil de confiance de « Accepter les sûres » (D5). */
export const SEUIL_SUR = 0.9;

const OPERATIONS: Record<GenreTache, string> = { preparer: 'préparer des messages', prejuger: 'pré-juger avec Claude', apprendre: 'apprendre la note' };
const ENREGISTRER = 'enregistrer des jugements';

/** Même message du banc : même texte, position, session et rang (son indice ne change pas : les cas ne font que s'ajouter). */
const memeMessage = (a: CasContexte, b: CasContexte): boolean => a.message === b.message && a.position === b.position && a.session === b.session && a.rang === b.rang;

const estArret = (e: unknown): boolean => e instanceof Error && e.name === 'AbortError';
const motif = (e: unknown): string => (e instanceof Error ? e.message : String(e));
const couper = (texte: string, max: number): string => {
	const lettres = [...texte.trim()];
	return lettres.length <= max ? lettres.join('') : `${lettres.slice(0, max - 1).join('').trimEnd()}…`;
};

/** Une annulation : les messages tels qu'ils étaient avant la réponse (ou « Accepter les sûres »). */
type Annulation = { avant: { indice: number; cas: CasContexte }[] };

/** L'origine d'un modèle de note : appris sur la mémoire, de départ, jamais appris. */
const origineDu = (m: ModeleDeNote, etat: EtatDuModele): NoteDuNiveau['origine'] => (etat === 'non_appris' ? 'non_appris' : m.origine === 'depart' ? 'depart' : 'appris');

/**
 * La date du dernier apprentissage : la ligne la plus récente de l'historique, hors essai en échec (il n'a rien appris) ; sans
 * historique, le plus récent `apprisLe` d'un modèle appris sur cette mémoire (pas un modèle de départ) ; null : aucun.
 */
export function dateDuDernierApprentissage(historique: readonly LigneHistorique[], modeles: ModelesDeNote): string | null {
	const plusRecente = (dates: readonly string[]): string | null => dates.reduce<string | null>((a, d) => (Number.isNaN(Date.parse(d)) ? a : a === null || Date.parse(d) > Date.parse(a) ? d : a), null);
	const lignes = plusRecente(historique.filter((l) => l.erreur === undefined).map((l) => l.date));
	if (lignes !== null) return lignes;
	return plusRecente(NIVEAUX_DE_NOTE.flatMap((n) => {
		const { modele, etat } = modeles[n];
		return origineDu(modele, etat) === 'appris' && modele.apprisLe !== null ? [modele.apprisLe] : [];
	}));
}

/**
 * Les messages jugés après `depuis` (null : aucun apprentissage, tous les messages jugés). Un message validé depuis l'interface
 * a sa date (`valideLe`). Un message jugé fiche à fiche au terminal (`--juger`) n'en a pas : il ne compte que s'il a été extrait
 * après `depuis` (il a forcément été jugé après) ; extrait avant, on ne sait pas quand il a été jugé : compté comme déjà appris.
 */
export function nouveauxDepuis(cas: readonly CasContexte[], depuis: string | null): number {
	const juges = cas.filter(estJuge);
	if (depuis === null) return juges.length;
	const limite = Date.parse(depuis);
	return juges.filter((c) => {
		const date = c.valideLe ?? c.extraitLe;
		return date !== undefined && Date.parse(date) > limite;
	}).length;
}

/** Ce qu'il faut pour enregistrer un apprentissage : les fichiers de la note et l'historique. */
export type PortsEnregistrement = { note: Pick<FichiersDeNote, 'modeles' | 'installes' | 'echelle' | 'ecrire' | 'ecrireRapport'>; historique: HistoriqueDesApprentissages };

/** Ajoute une ligne en tête de l'historique (les `HISTORIQUE_MAX` plus récentes gardées). */
export const ajouterAlHistorique = async (historique: HistoriqueDesApprentissages, ligne: LigneHistorique): Promise<void> =>
	historique.ecrire([ligne, ...(await historique.lire())].slice(0, HISTORIQUE_MAX));

/**
 * Enregistre un apprentissage, pour le service comme pour `mnemo banc contexte --apprendre` : un niveau sans paire jugée garde
 * le modèle actuel (`garderLesNiveauxSansPaire`) ; `remplacer(nouveau, actuel)` dit si le nouveau modèle remplace l'actuel (vrai
 * par défaut : geste de l'utilisateur, même refusé ; « Revenir au modèle d'avant » rend l'ancien) ; écrit le modèle (l'actuel
 * gardé comme modèle d'avant), le rapport et une ligne d'historique. Rend les coefficients retenus et s'ils ont été écrits.
 */
export async function enregistrerApprentissage(
	p: PortsEnregistrement,
	rapport: RapportDApprentissage,
	o: { date: string; origine: OrigineApprentissage; remplacer?: ((nouveau: RapportDApprentissage, actuel: ModelesDeNote) => boolean) | undefined },
): Promise<{ coefficients: CoefficientsNote; remplace: boolean }> {
	const actuel = await p.note.modeles();
	// un niveau sans paire jugée garde le modèle actuel (il ne retombe jamais sur la règle provisoire faute de données)
	const coefficients = garderLesNiveauxSansPaire(rapport.coefficients, actuel);
	const remplace = o.remplacer?.({ ...rapport, coefficients }, actuel) ?? true;
	if (remplace) await p.note.ecrire(coefficients);
	await p.note.ecrireRapport(rapport, remplace);
	const installes = p.note.installes();
	const echelle = p.note.echelle();
	const verdicts = Object.fromEntries(NIVEAUX_DE_NOTE.map((n) => [n, etatDuModele(coefficients[n], n, installes, echelle)])) as Record<NiveauDeNote, EtatDuModele>;
	await ajouterAlHistorique(p.historique, { date: o.date, origine: o.origine, verdicts, remplace });
	return { coefficients, remplace };
}

export type Entrainement = {
	etat(): Promise<EtatEntrainement>;
	/** Lance la tâche ; rend sa fin (jamais rejetée : un échec va dans `derniereErreur`). */
	preparer(o?: { nombre?: number }): Promise<{ fin: Promise<void> }>;
	prejuger(): Promise<{ fin: Promise<void> }>;
	/**
	 * `remplacer(nouveau, actuel)` : le nouveau modèle remplace-t-il l'actuel (vrai par défaut : geste de l'utilisateur) ;
	 * `implicites` : paires des gestes. Un essai automatique en échec (hors arrêt) laisse une ligne d'historique avec son erreur.
	 */
	apprendre(o: { origine: OrigineApprentissage; implicites?: ImplicitesDApprentissage; remplacer?: (nouveau: RapportDApprentissage, actuel: ModelesDeNote) => boolean }): Promise<{ fin: Promise<void> }>;
	/** Arrête la tâche en cours ; faux : aucune. */
	arreter(): boolean;
	revenir(): Promise<void>;
	message(indice?: number): Promise<MessageAJuger | null>;
	repondre(indice: number, reponse: ReponseMessage): Promise<{ suivant: number | null }>;
	annuler(): Promise<{ indice: number }>;
	accepterSures(): Promise<{ acceptes: number }>;
	/** La tâche en cours (null : aucune). */
	tache(): TacheEntrainement | null;
	/** Arrête la tâche en cours et attend sa fin (arrêt du service). */
	fermer(): Promise<void>;
};

export function creerEntrainement(p: PortsEntrainement): Entrainement {
	let tache: TacheEntrainement | null = null;
	let controle: AbortController | null = null;
	let enCours: Promise<void> = Promise.resolve();
	/** Rend le verrou tenu par la tâche en cours (null : aucune tâche ne le tient). */
	let rendreVerrou: (() => void) | null = null;
	let derniereErreur: string | undefined;
	/** `derniereErreur` vient d'une tâche automatique (réapprentissage en fond) : la tâche suivante, même automatique, l'efface. */
	let erreurAutomatique = false;
	const noterErreur = (message: string, automatique: boolean): void => {
		derniereErreur = message;
		erreurAutomatique = automatique;
	};
	let ecritures: Promise<unknown> = Promise.resolve();
	/** File des écritures des fichiers de la note (nouveau modèle, retour au modèle d'avant). */
	let ecrituresNote: Promise<unknown> = Promise.resolve();
	/** Fermé (arrêt du service) : plus aucune tâche ne démarre. */
	let ferme = false;
	const annulations: Annulation[] = [];
	const changer = (): void => p.surChangement?.();

	/** `travail` dans la file du fichier des jugements, après tout ce qui y est déjà. */
	const enFile = <T>(travail: () => Promise<T> | T): Promise<T> => {
		const suite = ecritures.then(travail);
		ecritures = suite.catch(() => {});
		return suite;
	};
	const enFileNote = <T>(travail: () => Promise<T>): Promise<T> => {
		const suite = ecrituresNote.then(travail);
		ecrituresNote = suite.catch(() => {});
		return suite;
	};

	/**
	 * Une écriture du fichier des jugements, dans la file : relu, transformé (`faire` rend les cas à écrire, ou null : rien), écrit.
	 * Hors tâche, le verrou est pris le temps de l'écriture (refus : `occupe`).
	 */
	const ecrire = <T>(faire: (cas: CasContexte[]) => { cas: CasContexte[] | null; resultat: T }): Promise<T> =>
		enFile(async () => {
			const rendre = rendreVerrou === null ? verrouiller(ENREGISTRER) : null;
			try {
				const { cas, resultat } = faire(await p.banc.lire());
				if (cas !== null) await p.banc.ecrire(cas);
				return resultat;
			} finally {
				rendre?.();
			}
		}).finally(changer);

	const verrouiller = (operation: string): (() => void) => {
		try {
			return p.banc.verrouiller(operation);
		} catch (e) {
			throw new ErreurEntrainement('occupe', motif(e));
		}
	};

	/** Réserve la place de la tâche (synchrone : deux demandes ne la prennent jamais toutes deux) ; le verrou est pris ensuite, dans la file. */
	const reserver = (genre: GenreTache): (() => void) => {
		if (ferme) throw new ErreurEntrainement('refuse', 'Le service Mnemo s’arrête : aucune tâche ne démarre.');
		if (tache !== null) throw new ErreurEntrainement('occupe', `Une tâche est déjà en cours (${OPERATIONS[tache.genre]}) : attends sa fin ou arrête-la.`);
		tache = { genre, fait: 0, total: 0, depuis: p.maintenant().toISOString() };
		controle = new AbortController();
		return () => {
			tache = null;
			controle = null;
			const rendre = rendreVerrou;
			rendreVerrou = null;
			rendre?.();
		};
	};

	/**
	 * Lance la tâche réservée ; sa fin libère la place, garde son erreur (sauf arrêt) et prévient. Elle efface l'erreur de la
	 * tâche d'avant, sauf une tâche automatique celle d'une tâche manuelle (l'utilisateur ne l'a peut-être pas encore lue).
	 */
	const lancer = (liberer: () => void, automatique: boolean, travail: (signal: AbortSignal) => Promise<void>): { fin: Promise<void> } => {
		const signal = controle!.signal;
		if (!automatique || erreurAutomatique) derniereErreur = undefined;
		changer();
		const fin = (async () => {
			try {
				await travail(signal);
			} catch (e) {
				if (!signal.aborted && !estArret(e)) noterErreur(motif(e), automatique);
			} finally {
				// les écritures lancées par la tâche finissent sous son verrou
				await ecritures;
				liberer();
				changer();
			}
		})();
		enCours = fin;
		return { fin };
	};

	const avancer = (fait: number, total: number): void => {
		if (tache === null) return;
		tache = { ...tache, fait, total };
		changer();
	};

	/**
	 * Réserve, prend le verrou du banc dans la file (après les écritures en cours, qui le tiennent un instant), vérifie (en échec,
	 * place et verrou sont rendus), puis lance.
	 */
	const tacheVerifiee = async <C>(genre: GenreTache, verifier: () => Promise<C>, travail: (contexte: C, signal: AbortSignal) => Promise<void>, o: { automatique?: boolean } = {}): Promise<{ fin: Promise<void> }> => {
		const liberer = reserver(genre);
		let contexte: C;
		try {
			await enFile(() => {
				rendreVerrou = verrouiller(OPERATIONS[genre]);
			});
			contexte = await verifier();
		} catch (e) {
			liberer();
			throw e;
		}
		return lancer(liberer, o.automatique === true, (signal) => travail(contexte, signal));
	};

	const noteDuNiveau = (niveau: NiveauDeNote, m: ModelesDeNote): NoteDuNiveau => {
		const { modele, etat } = m[niveau];
		return { niveau, etat, origine: origineDu(modele, etat), date: modele.apprisLe, verdict: verdictEnClair(etat), criteres: criteresEnClair(modele, etat), refus: [...modele.refus] };
	};

	const resultatDu = ({ rapport: r, remplace }: DernierRapport): ResultatApprentissage => ({
		date: r.date,
		remplace,
		messages: r.messages,
		sessions: r.sessions,
		niveaux: r.niveaux.map((n) => {
			const etat: EtatDuModele = n.modele.apprisLe === null || Object.keys(n.modele.poids).length === 0 ? 'non_appris' : n.modele.accepte ? 'accepte' : 'refuse';
			return { niveau: n.niveau, accepte: n.modele.accepte, verdict: verdictEnClair(etat), criteres: criteresEnClair(n.modele, etat), refus: [...n.modele.refus], paires: n.modele.paires, fiabilite: n.fiabilite };
		}),
	});

	return {
		tache: () => tache,

		async etat() {
			const [cas, modeles, avant, historique, rapport] = await Promise.all([p.banc.lire(), p.note.modeles(), p.note.avant(), p.historique.lire(), p.note.rapport()]);
			const pr = progression(cas);
			const juge = p.juge();
			const depuis = dateDuDernierApprentissage(historique, modeles);
			return {
				note: { niveaux: NIVEAUX_DE_NOTE.map((n) => noteDuNiveau(n, modeles)), avant },
				banc: {
					messages: pr.messages,
					valides: pr.messagesJuges,
					aJuger: pr.messages - pr.messagesJuges,
					aRelire: pr.aRelire,
					aPrejuger: cas.filter(aPrejuger).length,
					silences: pr.silences,
					sautes: pr.sautes,
					paires: pr.pairesValidees,
					nouveauxDepuisApprentissage: nouveauxDepuis(cas, depuis),
				},
				tache,
				historique: historique.slice(0, HISTORIQUE_MAX),
				juge: 'juge' in juge ? { disponible: true } : { disponible: false, raison: juge.raison },
				resultat: rapport === null ? null : resultatDu(rapport),
				...(derniereErreur === undefined ? {} : { derniereErreur }),
			};
		},

		preparer(o = {}) {
			const nombre = o.nombre ?? NOMBRE_A_PREPARER;
			if (!Number.isInteger(nombre) || nombre < 1 || nombre > PREPARER_MAX) return Promise.reject(new ErreurEntrainement('refuse', `Nombre de messages : de 1 à ${PREPARER_MAX}.`));
			return tacheVerifiee(
				'preparer',
				async () => undefined,
				async (_, signal) => {
					const existants = await p.banc.lire();
					const { choisis } = messagesAExtraire(await p.journal(), existants, { nombre, parSession: PAR_SESSION });
					avancer(0, choisis.length);
					let faits = 0;
					let sansModele = 0;
					for (let i = 0; i < choisis.length && !signal.aborted; i += PAQUET_EXTRACTION) {
						const paquet = choisis.slice(i, i + PAQUET_EXTRACTION);
						const bilan = await p.extraire(paquet, { signal, avancement: (f) => avancer(faits + f - 1, choisis.length) });
						sansModele += bilan.sansModele;
						// relu dans la file : une réponse donnée pendant l'extraction est gardée
						await ecrire((cas) => ({ cas: fusionnerCas(cas, bilan.cas).cas, resultat: undefined }));
						faits += paquet.length;
						avancer(faits, choisis.length);
					}
					if (choisis.length === 0) throw new Error("Aucun message nouveau dans le journal des sessions : utilise Mnemo, puis prépares-en d'autres.");
					if (sansModele > 0 && !signal.aborted) noterErreur(`${sansModele} message(s) laissé(s) : un modèle local n'a pas répondu (repris à la prochaine préparation).`, false);
				},
			);
		},

		prejuger() {
			return tacheVerifiee(
				'prejuger',
				async () => {
					const j = p.juge({ frais: true });
					if (!('juge' in j)) throw new ErreurEntrainement('refuse', j.raison);
					return j.juge;
				},
				async (juge, signal) => {
					const cas = await p.banc.lire();
					const chemins = [...new Set(cas.filter(aPrejuger).flatMap((c) => (c.candidates ?? []).map((x) => x.chemin)))];
					const syntheses = await p.syntheses(chemins);
					const bilan = await prejuger(cas, {
						juge,
						synthese: (chemin) => syntheses.get(chemin) ?? '',
						enregistrer: (cible, propositions) => ecrire((relus) => ({ cas: fusionnerPrejugements(relus, cible, propositions), resultat: undefined })),
						signal,
						avancement: avancer,
					});
					if (bilan.echecs > 0 && !signal.aborted) throw new Error(`${bilan.echecs} message(s) en échec : ${bilan.motifs.slice(0, 3).join(' ; ')}`);
				},
			);
		},

		apprendre(o) {
			const apprendreEtEcrire = async (cas: CasContexte[], date: string, signal: AbortSignal): Promise<void> => {
				const implicites = typeof o.implicites === 'function' ? await o.implicites(signal) : o.implicites;
				if (signal.aborted) return;
				const jeu = jeuDApprentissage(cas, await p.note.empreintes(), { empreintes: 'exclure', installes: p.note.installes() });
				const rapport = await p.apprenti.apprendre(jeu, { date, echelle: p.note.echelle(), ...(implicites === undefined ? {} : { implicites }) }, signal);
				if (signal.aborted) return;
				await enFileNote(() => enregistrerApprentissage(p, rapport, { date, origine: o.origine, remplacer: o.remplacer }));
			};
			/** L'échec d'un essai automatique dans l'historique (les modèles gardés) ; une panne ici ne masque pas l'erreur. */
			const noterEchec = async (date: string, erreur: string): Promise<void> => {
				try {
					await enFileNote(async () => {
						const actuel = await p.note.modeles();
						const verdicts = Object.fromEntries(NIVEAUX_DE_NOTE.map((n) => [n, actuel[n].etat])) as Record<NiveauDeNote, EtatDuModele>;
						await ajouterAlHistorique(p.historique, { date, origine: o.origine, verdicts, remplace: false, erreur: couper(erreur, ERREUR_MAX) });
					});
				} catch {
					// historique illisible ou non écrit : l'erreur reste dans `derniereErreur`
				}
			};
			return tacheVerifiee(
				'apprendre',
				async () => {
					const cas = (await p.banc.lire()).filter((c) => c.candidates !== undefined);
					if (progression(cas).pairesValidees === 0) throw new ErreurEntrainement('refuse', 'Aucun jugement validé : juge des messages avant d’apprendre.');
					return cas;
				},
				async (cas, signal) => {
					const date = p.maintenant().toISOString();
					try {
						await apprendreEtEcrire(cas, date, signal);
					} catch (e) {
						if (o.origine === 'automatique' && !signal.aborted && !estArret(e)) await noterEchec(date, motif(e));
						throw e;
					}
				},
				{ automatique: o.origine === 'automatique' },
			);
		},

		arreter() {
			if (controle === null) return false;
			controle.abort();
			return true;
		},

		revenir() {
			// dans la file de la note : deux retours demandés ensemble ne s'entremêlent jamais, ni avec l'écriture d'un nouveau modèle
			return enFileNote(async () => {
				if (tache?.genre === 'apprendre') throw new ErreurEntrainement('occupe', 'Un apprentissage est en cours : attends sa fin ou arrête-le.');
				if (!(await p.note.revenir())) throw new ErreurEntrainement('refuse', "Aucun modèle d'avant.");
				changer();
			});
		},

		async message(indice) {
			const cas = await p.banc.lire();
			const i = indice ?? prochainMessage(cas);
			if (i === null) return null;
			const c = cas[i];
			if (c?.candidates === undefined || c.candidates.length === 0) throw new ErreurEntrainement('introuvable', `Message ${i} inconnu.`);
			const ordre = ordreDePresentation(c);
			const syntheses = await p.syntheses(ordre.map((x) => x.chemin));
			const precedent = c.precedent ?? null;
			return {
				indice: i,
				message: c.message,
				precedent: precedent !== null && requeteJointe(c.message, precedent) !== null ? precedent : null,
				candidates: ordre.map((x) => ({
					chemin: x.chemin,
					titre: x.titre,
					ligne: x.ligne,
					synthese: couper(syntheses.get(x.chemin) ?? '', SYNTHESE_MAX),
					proposition: c.prejugements?.[x.chemin] ?? null,
					jugement: c.jugements?.[x.chemin] ?? null,
				})),
				valide: c.valideLe !== undefined,
				silence: c.silence,
				saute: c.saute === true,
				aRelire: messagesARelire(cas).includes(i),
				restants: cas.filter(aJuger).length,
			};
		},

		repondre(indice, reponse) {
			return ecrire((cas) => {
				const avant = cas[indice];
				if (avant?.candidates === undefined || avant.candidates.length === 0) throw new ErreurEntrainement('introuvable', `Message ${indice} inconnu.`);
				const r = repondreMessage(cas, indice, reponse, { maintenant: p.maintenant().toISOString() });
				if (r === null) throw new ErreurEntrainement('refuse', "« Rien d'utile ici » est refusé : une fiche de ce message est jugée utile.");
				annulations.push({ avant: [{ indice, cas: avant }] });
				if (annulations.length > ANNULATIONS_MAX) annulations.shift();
				return { cas: r.cas, resultat: { suivant: prochainMessage(r.cas) } };
			});
		},

		annuler() {
			return ecrire((cas) => {
				const a = annulations.at(-1);
				if (a === undefined) throw new ErreurEntrainement('refuse', 'Rien à annuler.');
				annulations.pop();
				const suivants = [...cas];
				// un message disparu ou remplacé entre-temps (fichier réécrit ailleurs) n'est pas touché
				const rendus = a.avant.filter(({ indice, cas: c }) => suivants[indice] !== undefined && memeMessage(suivants[indice]!, c));
				if (rendus.length === 0) throw new ErreurEntrainement('refuse', 'Rien à annuler : le fichier des jugements a changé depuis.');
				for (const { indice, cas: c } of rendus) suivants[indice] = c;
				return { cas: suivants, resultat: { indice: rendus[0]!.indice } };
			});
		},

		accepterSures() {
			return ecrire((cas) => {
				const r = accepterSures(cas, SEUIL_SUR, { maintenant: p.maintenant().toISOString() });
				if (r.acceptes === 0) return { cas: null, resultat: { acceptes: 0 } };
				const avant = cas.flatMap((c, indice) => (r.cas[indice] !== c ? [{ indice, cas: c }] : []));
				annulations.push({ avant });
				if (annulations.length > ANNULATIONS_MAX) annulations.shift();
				return { cas: r.cas, resultat: { acceptes: r.acceptes } };
			});
		},

		async fermer() {
			ferme = true;
			controle?.abort();
			await enCours;
			await ecritures;
			await ecrituresNote;
		},
	};
}
