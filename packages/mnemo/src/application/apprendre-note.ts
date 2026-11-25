/**
 * Apprentissage et calibration de la note de confiance (spec classement vivant § 4.2 et § 4.3), hors du chemin du hook : à
 * partir des jugements du banc (`.mnemo/banc-contexte.json`), un modèle par niveau (Complets avec le logit du reranker, Sens
 * seul sans), validé en validation croisée groupée par session (5 plis), puis appris sur tout le jeu.
 *
 * Données :
 * - paires d'apprentissage : les fiches jugées pertinentes ou non, de la pile ; les indécises, les fiches dont l'empreinte a
 *   changé depuis l'extraction (sauf `empreintes: 'garder'`) et les fiches tirées hors de la pile n'y entrent pas ;
 * - mesures : chaque message est noté par le modèle appris sans sa session (plis) ; les fiches non jugées restent parmi les
 *   injections simulées (précision pessimiste, celle du critère), les fiches hors pile mesurent le rappel.
 *
 * Choix, par niveau, sur la perte logistique en validation croisée : pour chaque requête (seule, jointe), méthode du cosinus
 * relatif (médiane, z-score) et présence de l'a priori, le λ le plus fort dont la perte reste à `TOLERANCE_LAMBDA` de la
 * meilleure (L2 forte) ; puis la meilleure configuration, la plus simple à égalité (requête seule, médiane, avec a priori).
 * Un z-score approché (le banc n'a pas enregistré `cosinusZ`) est mesuré, jamais retenu : le hook ne saurait pas le refaire.
 * L'abstention par message n'est gardée que si elle améliore la précision sans faire tomber les injections sous le minimum.
 */
import { accepter, calibration, CRITERES, REGLAGE_PAR_DEFAUT, simulerInjections } from '../domaine/acceptation-note.ts';
import type { CandidateNotee, MesuresDInjection, MessageNote, ReglageDInjection, StatutDeJugement } from '../domaine/acceptation-note.ts';
import { plisParSession } from '../domaine/mesures-banc.ts';
import type { TrancheFiabilite } from '../domaine/mesures-banc.ts';
import { modeleNonAppris, NIVEAUX_DE_NOTE, VARIABLES_DU_NIVEAU, VARIABLES_MAX, variablesDeNote } from '../domaine/modele-de-note.ts';
import type { CoefficientsNote, MethodeCosinus, ModeleDeNote, NiveauDeNote, RequeteDeNote, SignauxDeNote, VariableDeNote } from '../domaine/modele-de-note.ts';
import { apprendreRegression, marge, perteMoyenne, sigmoide } from '../domaine/regression-logistique.ts';
import type { Exemple, Regression } from '../domaine/regression-logistique.ts';
import type { CasContexte } from './banc-contexte.ts';
import { estSilence, rejouable } from './banc-rejeu.ts';

/** λ essayés (pénalité L2 sur les poids réduits, rapportée à la perte moyenne). */
export const LAMBDAS = [0.003, 0.01, 0.03, 0.1, 0.3];
/** Écart de perte (log loss moyenne) en deçà duquel un λ plus fort est préféré. */
export const TOLERANCE_LAMBDA = 0.002;
/** Écart de perte en deçà duquel la configuration la plus simple est préférée. */
const TOLERANCE_CONFIGURATION = 1e-4;
export const PLIS = 5;
export const ABSTENTIONS = [0.05, 0.1, 0.2];
export const SEUILS_COURBE = [0.8, 0.85, 0.9, 0.95];

type StatutDuJeu = StatutDeJugement | 'exclue';
type CandidateDuJeu = { statut: StatutDuJeu; horsPile: boolean; signaux: Partial<Record<RequeteDeNote, SignauxDeNote>> };
type MessageDuJeu = { session: string; silence: boolean; candidates: CandidateDuJeu[] };

/** Les messages jugés, prêts pour l'apprentissage, et ce qui en a été écarté. */
export type JeuDApprentissage = {
	messages: MessageDuJeu[];
	indecises: number;
	empreintesChangees: number;
	/** Vrai : au moins un z-score du cosinus a été approché (écart type des cosinus des candidates du message). */
	zApproche: boolean;
	/** Vrai : au moins un message a une variante jointe de la requête. */
	jointe: boolean;
};

const ecartType = (valeurs: readonly number[]): number => {
	if (valeurs.length < 2) return 0;
	const moyenne = valeurs.reduce((s, v) => s + v, 0) / valeurs.length;
	return Math.sqrt(valeurs.reduce((s, v) => s + (v - moyenne) ** 2, 0) / valeurs.length);
};

/**
 * Le jeu d'apprentissage d'après les cas du banc : messages rejouables (non sautés, jugés au moins en partie, ou silence), statut
 * de chaque candidate. `empreinteDe` : empreinte actuelle de chaque fiche (null : non vérifiée) ; une fiche jugée dont
 * l'empreinte a changé est exclue (sauf `garder`). Le z-score du cosinus est lu (`cosinusZ`) ou, à défaut, approché : le
 * cosinus relatif rapporté à l'écart type des cosinus des candidates du message.
 */
export function jeuDApprentissage(cas: readonly CasContexte[], empreinteDe: ReadonlyMap<string, string> | null, empreintes: 'exclure' | 'garder' = 'exclure'): JeuDApprentissage {
	let indecises = 0;
	let empreintesChangees = 0;
	let zApproche = false;
	let jointe = false;
	const messages = cas.filter(rejouable).map((c): MessageDuJeu => {
		const jugements = c.jugements ?? {};
		const candidates = (c.candidates ?? []).map((x): CandidateDuJeu => {
			const j = jugements[x.chemin];
			const changee = j !== undefined && x.empreinte !== undefined && empreinteDe !== null && empreinteDe.get(x.chemin) !== x.empreinte;
			let statut: StatutDuJeu;
			if (j === undefined) statut = 'non_jugee';
			else if (j === 'indecise') {
				indecises += 1;
				statut = 'exclue';
			} else if (changee) {
				empreintesChangees += 1;
				statut = empreintes === 'exclure' ? 'exclue' : j;
			} else statut = j;
			return { statut, horsPile: x.horsPile === true, signaux: { ...x.signaux } };
		});
		for (const variante of ['seule', 'jointe'] as const) {
			const avec = candidates.filter((x) => x.signaux[variante] !== undefined);
			if (avec.length === 0) continue;
			if (variante === 'jointe') jointe = true;
			const ecart = ecartType(avec.flatMap((x) => {
				const s = x.signaux[variante] as SignauxDeNote & { cosinus?: number | null };
				return typeof s.cosinus === 'number' ? [s.cosinus] : [];
			}));
			for (const x of avec) {
				const s = x.signaux[variante]!;
				if (s.cosinusZ !== undefined && s.cosinusZ !== null) continue;
				zApproche = true;
				x.signaux[variante] = { ...s, cosinusZ: s.cosinusRelatif === null || ecart === 0 ? null : s.cosinusRelatif / ecart };
			}
		}
		return { session: c.session ?? c.nom, silence: estSilence(c), candidates };
	});
	return { messages, indecises, empreintesChangees, zApproche, jointe };
}

export type Configuration = { niveau: NiveauDeNote; requete: RequeteDeNote; methode: MethodeCosinus; avecApriori: boolean; lambda: number };

const signauxDe = (c: CandidateDuJeu, requete: RequeteDeNote): SignauxDeNote | undefined => (requete === 'jointe' ? (c.signaux.jointe ?? c.signaux.seule) : c.signaux.seule);
const variablesDe = (c: CandidateDuJeu, conf: Configuration): number[] | null => {
	const s = signauxDe(c, conf.requete);
	return s === undefined ? null : variablesDeNote(conf.niveau, s, conf.methode, conf.avecApriori);
};

/** Paires d'apprentissage : jugées pertinentes ou non, de la pile, toutes les variables du niveau présentes. */
function exemplesDe(messages: readonly MessageDuJeu[], conf: Configuration): Exemple[] {
	return messages.flatMap((m) =>
		m.candidates.flatMap((c) => {
			if (c.horsPile || (c.statut !== 'pertinente' && c.statut !== 'non_pertinente')) return [];
			const x = variablesDe(c, conf);
			return x === null ? [] : [{ x, y: c.statut === 'pertinente' }];
		}),
	);
}

/** Notes d'un message par un modèle : `p` et `p` sans le terme de l'a priori ; null si aucune candidate n'est notée. */
function noterMessage(m: MessageDuJeu, r: Regression, conf: Configuration): MessageNote | null {
	const iApriori = VARIABLES_DU_NIVEAU[conf.niveau].indexOf('apriori');
	const candidates: CandidateNotee[] = m.candidates.flatMap((c) => {
		if (c.statut === 'exclue') return [];
		const x = variablesDe(c, conf);
		if (x === null) return [];
		const z = marge(r, x);
		const sansApriori = iApriori === -1 ? z : z - r.poids[iApriori]! * x[iApriori]!;
		return [{ p: sigmoide(z), pSansApriori: sigmoide(sansApriori), statut: c.statut, horsPile: c.horsPile }];
	});
	return candidates.length === 0 ? null : { session: m.session, silence: m.silence, candidates };
}

/** Évaluation d'une configuration en validation croisée groupée par session. */
export type Evaluation = { perte: number | null; paires: number; notes: MessageNote[] };

export function validerConfiguration(jeu: JeuDApprentissage, plis: readonly number[], k: number, conf: Configuration): Evaluation {
	let perte = 0;
	let paires = 0;
	const notes: MessageNote[] = [];
	for (let f = 0; f < k; f++) {
		const apprentissage = jeu.messages.filter((_, i) => plis[i] !== f);
		const test = jeu.messages.filter((_, i) => plis[i] === f);
		if (test.length === 0) continue;
		const r = apprendreRegression(exemplesDe(apprentissage, conf), { lambda: conf.lambda });
		const exemples = exemplesDe(test, conf);
		perte += perteMoyenne(r, exemples) * exemples.length;
		paires += exemples.length;
		for (const m of test) {
			const n = noterMessage(m, r, conf);
			if (n !== null) notes.push(n);
		}
	}
	return { perte: paires === 0 ? null : perte / paires, paires, notes };
}

/** Une configuration mesurée (λ retenu pour elle), au seuil par défaut. */
export type LigneDeConfiguration = Omit<Configuration, 'niveau'> & {
	perte: number | null;
	paires: number;
	mesures: MesuresDInjection;
	ece: number | null;
	accepte: boolean;
	/** Faux : z-score approché, ou variante sans données. */
	selectionnable: boolean;
};

export type RapportDeNiveau = {
	niveau: NiveauDeNote;
	configurations: LigneDeConfiguration[];
	/** Indice de la configuration retenue ; null : aucune paire. */
	retenue: number | null;
	abstentions: { valeur: number; mesures: MesuresDInjection }[];
	/** Mesures de la configuration retenue (abstention comprise) aux seuils de la courbe. */
	courbe: MesuresDInjection[];
	fiabilite: TrancheFiabilite[];
	modele: ModeleDeNote;
};

export type RapportDApprentissage = {
	date: string;
	messages: number;
	sessions: number;
	/** Paires jugées de la pile (pertinentes, non pertinentes) ; indécises et empreintes changées ; jugées hors pile. */
	paires: { pertinentes: number; nonPertinentes: number };
	indecises: number;
	empreintesChangees: number;
	horsPile: { jugees: number; pertinentes: number };
	zApproche: boolean;
	niveaux: RapportDeNiveau[];
	coefficients: CoefficientsNote;
};

export type OptionsApprentissage = {
	/** Date de l'apprentissage (AAAA-MM-JJ). */
	date: string;
	/** Fichiers GGUF installés (nom@début du SHA-256). */
	gguf: { sens: string | null; reranker: string | null };
	plis?: number;
	lambdas?: readonly number[];
	reglage?: ReglageDInjection;
	abstentions?: readonly number[];
	seuilsCourbe?: readonly number[];
};

/** Le λ le plus fort dont la perte reste à `TOLERANCE_LAMBDA` de la meilleure. */
function choisirLambda(essais: readonly { lambda: number; evaluation: Evaluation }[]): { lambda: number; evaluation: Evaluation } {
	const avecPerte = essais.filter((e) => e.evaluation.perte !== null);
	if (avecPerte.length === 0) return essais[essais.length - 1]!;
	const meilleure = Math.min(...avecPerte.map((e) => e.evaluation.perte!));
	return [...avecPerte].sort((a, b) => b.lambda - a.lambda).find((e) => e.evaluation.perte! <= meilleure + TOLERANCE_LAMBDA)!;
}

function apprendreNiveau(jeu: JeuDApprentissage, plis: readonly number[], k: number, niveau: NiveauDeNote, o: Required<Omit<OptionsApprentissage, 'gguf' | 'date'>> & Pick<OptionsApprentissage, 'gguf' | 'date'>): RapportDeNiveau {
	if (VARIABLES_DU_NIVEAU[niveau].length > VARIABLES_MAX) throw new Error(`Trop de variables pour le niveau ${niveau}.`);
	const configurations: LigneDeConfiguration[] = [];
	const evaluations: Evaluation[] = [];
	for (const requete of ['seule', 'jointe'] as const) {
		if (requete === 'jointe' && !jeu.jointe) continue;
		for (const methode of ['mediane', 'zscore'] as const) {
			for (const avecApriori of [true, false]) {
				const essais = o.lambdas.map((lambda) => ({ lambda, evaluation: validerConfiguration(jeu, plis, k, { niveau, requete, methode, avecApriori, lambda }) }));
				const { lambda, evaluation } = choisirLambda(essais);
				const mesures = simulerInjections(evaluation.notes, o.reglage);
				const { ece } = calibration(evaluation.notes);
				configurations.push({
					requete,
					methode,
					avecApriori,
					lambda,
					perte: evaluation.perte,
					paires: evaluation.paires,
					mesures,
					ece,
					accepte: accepter(mesures, ece).accepte,
					selectionnable: evaluation.paires > 0 && (methode === 'mediane' || !jeu.zApproche),
				});
				evaluations.push(evaluation);
			}
		}
	}
	// la plus simple d'abord (ordre d'énumération) ; une autre ne la remplace que si elle perd nettement moins
	let retenue: number | null = null;
	configurations.forEach((c, i) => {
		if (!c.selectionnable || c.perte === null) return;
		if (retenue === null || c.perte < configurations[retenue]!.perte! - TOLERANCE_CONFIGURATION) retenue = i;
	});
	if (retenue === null) {
		const modele = { ...modeleNonAppris(), apprisLe: o.date, gguf: o.gguf, refus: ['aucune paire jugée pour ce niveau'] };
		return { niveau, configurations, retenue: null, abstentions: [], courbe: [], fiabilite: [], modele };
	}
	const choisie = configurations[retenue]!;
	const notes = evaluations[retenue]!.notes;
	const sansAbstention = choisie.mesures;
	const abstentions = o.abstentions.map((valeur) => ({ valeur, mesures: simulerInjections(notes, { ...o.reglage, abstention: valeur }) }));
	// gardée seulement si elle améliore la précision sans faire tomber les injections ni les sessions sous le minimum
	const utiles = abstentions.filter(
		({ mesures: m }) =>
			m.precisionPessimiste !== null &&
			m.precisionPessimiste > (sansAbstention.precisionPessimiste ?? 0) &&
			m.injections >= CRITERES.injectionsMin &&
			m.sessions >= CRITERES.sessionsMin,
	);
	const abstention = utiles.length === 0 ? null : utiles.reduce((a, b) => (b.mesures.precisionPessimiste! > a.mesures.precisionPessimiste! ? b : a)).valeur;
	const reglage = { ...o.reglage, abstention };
	const mesures = abstention === null ? sansAbstention : simulerInjections(notes, reglage);
	const { ece, fiabilite } = calibration(notes);
	const { accepte, refus } = accepter(mesures, ece);
	const conf: Configuration = { niveau, requete: choisie.requete, methode: choisie.methode, avecApriori: choisie.avecApriori, lambda: choisie.lambda };
	const exemples = exemplesDe(jeu.messages, conf);
	const r = apprendreRegression(exemples, { lambda: conf.lambda });
	const poids = Object.fromEntries(VARIABLES_DU_NIVEAU[niveau].map((v, j) => [v, r.poids[j]!])) as Record<VariableDeNote, number>;
	const messagesNotes = jeu.messages.filter((m) => noterMessage(m, r, conf) !== null);
	const modele: ModeleDeNote = {
		accepte,
		biais: r.biais,
		poids,
		methodeCosinus: conf.methode,
		requete: conf.requete,
		lambda: conf.lambda,
		abstention,
		apprisLe: o.date,
		gguf: o.gguf,
		paires: exemples.length,
		messages: messagesNotes.length,
		sessions: new Set(messagesNotes.map((m) => m.session)).size,
		mesures: {
			seuil: mesures.seuil,
			injections: mesures.injections,
			nonJugees: mesures.nonJugees,
			precision: mesures.precision,
			precisionPessimiste: mesures.precisionPessimiste,
			wilsonBassePessimiste: mesures.wilsonBassePessimiste,
			sessions: mesures.sessions,
			injectionsParMessage: mesures.injectionsParMessage,
			partSilencesAvecInjection: mesures.partSilencesAvecInjection,
			rappel: mesures.rappel,
			ece,
		},
		refus,
	};
	const courbe = o.seuilsCourbe.map((seuil) => simulerInjections(notes, { ...reglage, seuil }));
	return { niveau, configurations, retenue, abstentions, courbe, fiabilite, modele };
}

/** Apprend et valide un modèle par niveau ; rend le rapport et les coefficients à écrire. */
export function apprendreNote(jeu: JeuDApprentissage, options: OptionsApprentissage): RapportDApprentissage {
	const o = {
		date: options.date,
		gguf: options.gguf,
		plis: options.plis ?? PLIS,
		lambdas: options.lambdas ?? LAMBDAS,
		reglage: options.reglage ?? REGLAGE_PAR_DEFAUT,
		abstentions: options.abstentions ?? ABSTENTIONS,
		seuilsCourbe: options.seuilsCourbe ?? SEUILS_COURBE,
	};
	const plis = plisParSession(jeu.messages, o.plis);
	const niveaux = NIVEAUX_DE_NOTE.map((niveau) => apprendreNiveau(jeu, plis, o.plis, niveau, o));
	const pile = jeu.messages.flatMap((m) => m.candidates.filter((c) => !c.horsPile));
	const horsPile = jeu.messages.flatMap((m) => m.candidates.filter((c) => c.horsPile && (c.statut === 'pertinente' || c.statut === 'non_pertinente')));
	return {
		date: o.date,
		messages: jeu.messages.length,
		sessions: new Set(jeu.messages.map((m) => m.session)).size,
		paires: { pertinentes: pile.filter((c) => c.statut === 'pertinente').length, nonPertinentes: pile.filter((c) => c.statut === 'non_pertinente').length },
		indecises: jeu.indecises,
		empreintesChangees: jeu.empreintesChangees,
		horsPile: { jugees: horsPile.length, pertinentes: horsPile.filter((c) => c.statut === 'pertinente').length },
		zApproche: jeu.zApproche,
		niveaux,
		coefficients: Object.fromEntries(niveaux.map((n) => [n.niveau, n.modele])) as CoefficientsNote,
	};
}
