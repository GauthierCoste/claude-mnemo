/**
 * Apprentissage et calibration de la note de confiance (spec classement vivant § 4.2 et § 4.3), hors du chemin du hook : à
 * partir des jugements du banc (`.mnemo/banc-contexte.json`), un modèle par niveau (Complets avec le logit du reranker, Sens
 * seul sans).
 *
 * Données :
 * - paires d'apprentissage : les fiches de la pile jugées pertinentes ou non ; les indécises, les fiches changées depuis
 *   l'extraction (sauf `empreintes: 'garder'`) et les fiches tirées hors de la pile n'y entrent pas ;
 * - mesure : toutes les candidates, hors pile comprises ; une indécise ou une non jugée injectée compte fausse ;
 * - les cas sans session d'origine (étiquetés à la main) forment la pseudo-session `manuel` ;
 * - un cas calculé par d'autres modèles (GGUF) que ceux installés est écarté ; un cas sans identité des modèles est gardé,
 *   mais aucun modèle n'est alors accepté.
 *
 * Validation emboîtée, groupée par session : 5 plis extérieurs ; dans chacun, 4 plis intérieurs choisissent la configuration
 * (requête seule ou jointe, cosinus médiane ou z-score, avec ou sans a priori) et λ sur la perte logistique ; le modèle ainsi
 * choisi, appris sur les 4 plis extérieurs restants, note le 5e. L'acceptation se mesure sur l'union des notes extérieures,
 * et le découpage des sessions est répété 3 fois (graines fixes) : on accepte si la médiane des mesures passe les critères et
 * qu'aucun découpage n'a une précision pessimiste sous 0,85.
 *
 * Niveau Complets comme au hook : chaque message est d'abord noté par le modèle Sens seul ; seules ses 8 premières reçoivent la
 * note Complets (logit du reranker) et peuvent être injectées ; les autres gardent la note Sens seul (panneau, pistes).
 */
import { accepter, calibration, grilleDesSeuils, mesurerAcceptation, SESSION_MANUELLE } from '../domaine/acceptation-note.ts';
import type { CandidateNotee, CaseDeSeuils, MesuresDAcceptation, MessageNote, StatutDeJugement } from '../domaine/acceptation-note.ts';
import { plisParSessionMelanges } from '../domaine/mesures-banc.ts';
import type { TrancheFiabilite } from '../domaine/mesures-banc.ts';
import { identiteDifferente, MAXIMUMS_DES_POIDS, modeleNonAppris, NIVEAUX_DE_NOTE, RERANKEES_AU_HOOK, VARIABLES_DU_NIVEAU, VARIABLES_MAX, variablesDeNote } from '../domaine/modele-de-note.ts';
import type { CoefficientsNote, IdentiteDesModeles, MesuresDuModele, MethodeCosinus, ModeleDeNote, NiveauDeNote, RequeteDeNote, SignauxDeNote, VariableDeNote } from '../domaine/modele-de-note.ts';
import { apprendreRegression, marge, perteMoyenne, sigmoide } from '../domaine/regression-logistique.ts';
import type { Exemple, Regression } from '../domaine/regression-logistique.ts';
import type { CasContexte } from './banc-contexte.ts';
import { estSilence, rejouable } from './banc-rejeu.ts';

/** λ essayés (pénalité L2 sur les poids réduits, rapportée à la perte moyenne). */
export const LAMBDAS = [0, 0.0003, 0.001, 0.003];
/** Écart de perte (log loss moyenne) en deçà duquel le λ le plus fort, ou la configuration la plus simple, est préféré. */
export const TOLERANCE = 0.0005;
export const PLIS_EXTERIEURS = 5;
export const PLIS_INTERIEURS = 4;
/** Graines des découpages répétés des sessions. */
export const GRAINES = [1, 2, 3];
/** Précision pessimiste minimale de chaque découpage. */
export const PIRE_PRECISION_MIN = 0.85;
/** L'a priori n'est essayé que s'il est non nul sur au moins tant de paires, venues d'au moins tant de sessions. */
export const APRIORI_PAIRES_MIN = 30;
export const APRIORI_SESSIONS_MIN = 5;

type StatutDuJeu = StatutDeJugement | 'indecise' | 'exclue';
type CandidateDuJeu = { chemin: string; statut: StatutDuJeu; horsPile: boolean; signaux: Partial<Record<RequeteDeNote, SignauxDeNote>> };
export type MessageDuJeu = { session: string; rang: number; silence: boolean; candidates: CandidateDuJeu[] };

/** Les messages jugés, prêts pour l'apprentissage, et ce qui en a été écarté. */
export type JeuDApprentissage = {
	messages: MessageDuJeu[];
	indecises: number;
	empreintesChangees: number;
	/** Vrai : au moins un z-score du cosinus a été approché (écart type des cosinus des candidates du message). */
	zApproche: boolean;
	/** Vrai : au moins un message a une variante jointe de la requête. */
	jointe: boolean;
	/** Cas sans identité des modèles (gardés), cas calculés par d'autres modèles (écartés). */
	identite: { manquante: number; differente: number };
	/** Identité des modèles installés. */
	installes: IdentiteDesModeles;
};

const ecartType = (valeurs: readonly number[]): number => {
	if (valeurs.length < 2) return 0;
	const moyenne = valeurs.reduce((s, v) => s + v, 0) / valeurs.length;
	return Math.sqrt(valeurs.reduce((s, v) => s + (v - moyenne) ** 2, 0) / valeurs.length);
};

/**
 * Le jeu d'apprentissage d'après les cas du banc : messages rejouables (non sautés, jugés au moins en partie, ou silence), statut
 * de chaque candidate. `empreinteDe` : empreinte actuelle de chaque fiche (null : non vérifiée). Le z-score du cosinus est lu
 * (`cosinusZ`) ou, à défaut, approché : le cosinus relatif rapporté à l'écart type des cosinus des candidates du message.
 */
export function jeuDApprentissage(
	cas: readonly CasContexte[],
	empreinteDe: ReadonlyMap<string, string> | null,
	options: { empreintes?: 'exclure' | 'garder'; installes: IdentiteDesModeles },
): JeuDApprentissage {
	let indecises = 0;
	let empreintesChangees = 0;
	let zApproche = false;
	let jointe = false;
	const identite = { manquante: 0, differente: 0 };
	const retenus = cas.filter(rejouable).filter((c) => {
		if (c.gguf === undefined) identite.manquante += 1;
		else if (identiteDifferente(c.gguf, options.installes)) {
			identite.differente += 1;
			return false;
		}
		return true;
	});
	const messages = retenus.map((c): MessageDuJeu => {
		const jugements = c.jugements ?? {};
		const candidates = (c.candidates ?? []).map((x): CandidateDuJeu => {
			const j = jugements[x.chemin];
			const changee = j !== undefined && x.empreinte !== undefined && empreinteDe !== null && empreinteDe.get(x.chemin) !== x.empreinte;
			let statut: StatutDuJeu;
			if (j === undefined) statut = 'non_jugee';
			else if (j === 'indecise') {
				indecises += 1;
				statut = 'indecise';
			} else if (changee) {
				empreintesChangees += 1;
				statut = options.empreintes === 'garder' ? j : 'exclue';
			} else statut = j;
			return { chemin: x.chemin, statut, horsPile: x.horsPile === true, signaux: { ...x.signaux } };
		});
		for (const variante of ['seule', 'jointe'] as const) {
			const avec = candidates.filter((x) => x.signaux[variante] !== undefined);
			if (avec.length === 0) continue;
			if (variante === 'jointe') jointe = true;
			const ecart = ecartType(
				avec.flatMap((x) => {
					const s = x.signaux[variante] as SignauxDeNote & { cosinus?: number | null };
					return typeof s.cosinus === 'number' ? [s.cosinus] : [];
				}),
			);
			for (const x of avec) {
				const s = x.signaux[variante]!;
				if (s.cosinusZ !== undefined && s.cosinusZ !== null) continue;
				zApproche = true;
				x.signaux[variante] = { ...s, cosinusZ: s.cosinusRelatif === null || ecart === 0 ? null : s.cosinusRelatif / ecart };
			}
		}
		return { session: c.session ?? SESSION_MANUELLE, rang: c.rang ?? 0, silence: estSilence(c), candidates };
	});
	return { messages, indecises, empreintesChangees, zApproche, jointe, identite, installes: options.installes };
}

export type Configuration = { requete: RequeteDeNote; methode: MethodeCosinus; avecApriori: boolean; lambda: number };
export const nomDeConfiguration = (c: Configuration) =>
	`requête ${c.requete}, cosinus ${c.methode === 'mediane' ? 'médiane' : 'z-score'}, ${c.avecApriori ? 'avec' : 'sans'} a priori, λ ${c.lambda}`;

const signauxDe = (c: CandidateDuJeu, requete: RequeteDeNote): SignauxDeNote | undefined => (requete === 'jointe' ? (c.signaux.jointe ?? c.signaux.seule) : c.signaux.seule);
const variablesDe = (c: CandidateDuJeu, niveau: NiveauDeNote, conf: Configuration): number[] | null => {
	const s = signauxDe(c, conf.requete);
	return s === undefined ? null : variablesDeNote(niveau, s, conf.methode, conf.avecApriori);
};

const jugeeDeLaPile = (c: CandidateDuJeu) => !c.horsPile && (c.statut === 'pertinente' || c.statut === 'non_pertinente');

/** Paires d'apprentissage : jugées pertinentes ou non, de la pile, toutes les variables du niveau présentes. */
function exemplesDe(messages: readonly MessageDuJeu[], niveau: NiveauDeNote, conf: Configuration): Exemple[] {
	return messages.flatMap((m) =>
		m.candidates.flatMap((c) => {
			if (!jugeeDeLaPile(c)) return [];
			const x = variablesDe(c, niveau, conf);
			return x === null ? [] : [{ x, y: c.statut === 'pertinente' }];
		}),
	);
}

const maximumsDu = (niveau: NiveauDeNote) => VARIABLES_DU_NIVEAU[niveau].map((v) => MAXIMUMS_DES_POIDS[v] ?? null);

/** Un modèle appris pour un niveau, avec sa configuration. */
export type ModeleAppris = { niveau: NiveauDeNote; conf: Configuration; r: Regression };

export function apprendreModele(messages: readonly MessageDuJeu[], niveau: NiveauDeNote, conf: Configuration): ModeleAppris {
	return { niveau, conf, r: apprendreRegression(exemplesDe(messages, niveau, conf), { lambda: conf.lambda, maximums: maximumsDu(niveau) }) };
}

/** Assez de paires d'apprentissage où l'a priori est non nul, venues d'assez de sessions, pour l'essayer. */
function aprioriEssayable(messages: readonly MessageDuJeu[]): boolean {
	const sessions = new Set<string>();
	let paires = 0;
	for (const m of messages)
		for (const c of m.candidates) {
			if (!jugeeDeLaPile(c) || (c.signaux.seule?.apriori ?? 0) === 0) continue;
			paires += 1;
			sessions.add(m.session);
		}
	return paires >= APRIORI_PAIRES_MIN && sessions.size >= APRIORI_SESSIONS_MIN;
}

/** Une configuration et sa perte en validation croisée intérieure. */
export type LigneDePerte = Configuration & { perte: number | null; paires: number };

/**
 * Choix de la configuration et de λ sur `messages`, en `k` plis groupés par session (graine fixe) : pour chaque configuration,
 * le λ le plus fort à `TOLERANCE` de la plus faible perte ; puis la plus simple (requête seule, médiane, sans a priori) tant
 * qu'une autre ne perd pas plus de `TOLERANCE` en moins. Null : aucune paire pour ce niveau.
 */
export function choisirConfiguration(
	jeu: Pick<JeuDApprentissage, 'zApproche' | 'jointe'>,
	messages: readonly MessageDuJeu[],
	niveau: NiveauDeNote,
	options: { k?: number; graine?: number; lambdas?: readonly number[] } = {},
): { retenue: Configuration | null; lignes: LigneDePerte[] } {
	const k = options.k ?? PLIS_INTERIEURS;
	const plis = plisParSessionMelanges(messages, k, options.graine ?? 0);
	const lambdas = options.lambdas ?? LAMBDAS;
	const lignes: LigneDePerte[] = [];
	const retenues: LigneDePerte[] = [];
	const apriori = aprioriEssayable(messages);
	for (const requete of jeu.jointe ? (['seule', 'jointe'] as const) : (['seule'] as const)) {
		for (const methode of jeu.zApproche ? (['mediane'] as const) : (['mediane', 'zscore'] as const)) {
			for (const avecApriori of apriori ? [false, true] : [false]) {
				const essais = lambdas.map((lambda): LigneDePerte => {
					const conf = { requete, methode, avecApriori, lambda };
					let perte = 0;
					let paires = 0;
					for (let f = 0; f < k; f++) {
						const test = exemplesDe(
							messages.filter((_, i) => plis[i] === f),
							niveau,
							conf,
						);
						if (test.length === 0) continue;
						const { r } = apprendreModele(
							messages.filter((_, i) => plis[i] !== f),
							niveau,
							conf,
						);
						perte += perteMoyenne(r, test) * test.length;
						paires += test.length;
					}
					return { ...conf, perte: paires === 0 ? null : perte / paires, paires };
				});
				lignes.push(...essais);
				const avecPerte = essais.filter((e) => e.perte !== null);
				if (avecPerte.length === 0) continue;
				const meilleure = Math.min(...avecPerte.map((e) => e.perte!));
				retenues.push([...avecPerte].sort((a, b) => b.lambda - a.lambda).find((e) => e.perte! <= meilleure + TOLERANCE)!);
			}
		}
	}
	let retenue: LigneDePerte | null = null;
	for (const l of retenues) if (retenue === null || l.perte! < retenue.perte! - TOLERANCE) retenue = l;
	return { retenue: retenue === null ? null : { requete: retenue.requete, methode: retenue.methode, avecApriori: retenue.avecApriori, lambda: retenue.lambda }, lignes };
}

const statutNote = (s: StatutDuJeu): StatutDeJugement => (s === 'pertinente' || s === 'non_pertinente' ? s : 'non_jugee');

/** Note d'une candidate par un modèle ; null si une variable manque. */
function noterCandidate(c: CandidateDuJeu, m: ModeleAppris, injectable: boolean): CandidateNotee | null {
	const x = variablesDe(c, m.niveau, m.conf);
	if (x === null) return null;
	const iApriori = VARIABLES_DU_NIVEAU[m.niveau].indexOf('apriori');
	const z = marge(m.r, x);
	const sansApriori = iApriori === -1 ? z : z - m.r.poids[iApriori]! * x[iApriori]!;
	return { chemin: c.chemin, z, p: sigmoide(z), pSansApriori: sigmoide(sansApriori), statut: statutNote(c.statut), horsPile: c.horsPile, injectable };
}

/**
 * Notes d'un message comme au hook. Sens seul : toutes ses candidates, injectables. Complets (`complets` donné) : les 8
 * premières selon Sens seul reçoivent la note Complets (si le reranker les a notées) et sont seules injectables ; les autres
 * gardent la note Sens seul. Les fiches changées depuis l'extraction ne sont pas notées.
 */
export function noterMessage(m: MessageDuJeu, sens: ModeleAppris, complets?: ModeleAppris): MessageNote | null {
	const parSens = m.candidates
		.filter((c) => c.statut !== 'exclue')
		.flatMap((c) => {
			const n = noterCandidate(c, sens, complets === undefined);
			return n === null ? [] : [{ c, n }];
		})
		.sort((a, b) => b.n.z - a.n.z);
	if (parSens.length === 0) return null;
	const candidates = parSens.map(({ c, n }, i) => (complets !== undefined && i < RERANKEES_AU_HOOK ? (noterCandidate(c, complets, true) ?? n) : n));
	return { session: m.session, rang: m.rang, silence: m.silence, candidates };
}

/** Mesures d'un découpage des sessions (une graine). */
export type Tirage = { graine: number; mesures: MesuresDAcceptation; grille: CaseDeSeuils[]; configurations: string[]; nonConverges: number; apprentissages: number };

export type RapportDeNiveau = {
	niveau: NiveauDeNote;
	/** Configuration retenue sur tout le jeu, et la perte de chaque configuration essayée (comparaisons). */
	retenue: Configuration | null;
	pertes: LigneDePerte[];
	tirages: Tirage[];
	/** Médiane des tirages, mesure par mesure ; null sans tirage. */
	mediane: MesuresDAcceptation | null;
	pirePrecision: number | null;
	/** Grille des seuils (médiane des tirages, case par case). */
	grille: CaseDeSeuils[];
	/** Configurations choisies aux plis extérieurs, sur tous les tirages, et combien de fois. */
	stabilite: { configuration: string; fois: number }[];
	fiabilite: TrancheFiabilite[];
	modele: ModeleDeNote;
};

export type RapportDApprentissage = {
	date: string;
	messages: number;
	/** Sessions réelles (sans la pseudo-session `manuel`) ; messages de la pseudo-session `manuel`. */
	sessions: number;
	messagesManuels: number;
	paires: { pertinentes: number; nonPertinentes: number };
	indecises: number;
	empreintesChangees: number;
	horsPile: { jugees: number; pertinentes: number };
	zApproche: boolean;
	identite: JeuDApprentissage['identite'];
	niveaux: RapportDeNiveau[];
	coefficients: CoefficientsNote;
};

export type OptionsApprentissage = { date: string; graines?: readonly number[]; lambdas?: readonly number[] };

const mediane = (valeurs: readonly (number | null)[]): number | null => {
	const v = valeurs.filter((x): x is number => x !== null).sort((a, b) => a - b);
	if (v.length === 0) return null;
	const m = Math.floor(v.length / 2);
	return v.length % 2 === 1 ? v[m]! : (v[m - 1]! + v[m]!) / 2;
};

/** Médiane, champ par champ, d'objets aux mêmes champs numériques (ou null). */
function medianeDes<T extends object>(objets: readonly T[]): T | null {
	if (objets.length === 0) return null;
	return Object.fromEntries(Object.keys(objets[0]!).map((cle) => [cle, mediane(objets.map((o) => (o as Record<string, number | null>)[cle] ?? null))])) as T;
}

function resumer(m: MesuresDAcceptation, pirePrecision: number | null): MesuresDuModele {
	return {
		seuil: m.seuil,
		injections: m.injections,
		nonJugees: m.nonJugees,
		horsPileFausses: m.horsPileFausses,
		precision: m.precision,
		precisionPessimiste: m.precisionPessimiste,
		wilsonBassePessimiste: m.wilsonBassePessimiste,
		bootstrapP025: m.bootstrapP025,
		sessions: m.sessions,
		injectionsParMessage: m.injectionsParMessage,
		silences: m.silences,
		partSilencesAvecInjection: m.partSilencesAvecInjection,
		pente: m.pente,
		ordonnee: m.ordonnee,
		ece: m.ece,
		rappel: m.rappel,
		utilesAtteintes: m.utilesAtteintes,
		rappel10: m.rappel10,
		pirePrecision,
	};
}

/** Validation emboîtée d'un niveau sur un découpage des sessions (`graine`) : les notes hors pli et leurs mesures. */
export function validationEmboitee(jeu: JeuDApprentissage, niveau: NiveauDeNote, graine: number, lambdas: readonly number[]): Tirage & { notes: MessageNote[] } {
	const plis = plisParSessionMelanges(jeu.messages, PLIS_EXTERIEURS, graine);
	const notes: MessageNote[] = [];
	const configurations: string[] = [];
	let nonConverges = 0;
	let apprentissages = 0;
	for (let f = 0; f < PLIS_EXTERIEURS; f++) {
		const apprentissage = jeu.messages.filter((_, i) => plis[i] !== f);
		const test = jeu.messages.filter((_, i) => plis[i] === f);
		if (test.length === 0) continue;
		const choixSens = choisirConfiguration(jeu, apprentissage, 'sens', { graine: graine * 100 + f, lambdas }).retenue;
		if (choixSens === null) continue;
		const sens = apprendreModele(apprentissage, 'sens', choixSens);
		apprentissages += 1;
		if (!sens.r.converge) nonConverges += 1;
		let complets: ModeleAppris | undefined;
		if (niveau === 'complets') {
			const choix = choisirConfiguration(jeu, apprentissage, 'complets', { graine: graine * 100 + f, lambdas }).retenue;
			if (choix === null) continue;
			complets = apprendreModele(apprentissage, 'complets', choix);
			apprentissages += 1;
			if (!complets.r.converge) nonConverges += 1;
			configurations.push(nomDeConfiguration(choix));
		} else configurations.push(nomDeConfiguration(choixSens));
		for (const m of test) {
			const n = noterMessage(m, sens, complets);
			if (n !== null) notes.push(n);
		}
	}
	return { graine, mesures: mesurerAcceptation(notes), grille: grilleDesSeuils(notes), configurations, nonConverges, apprentissages, notes };
}

function apprendreNiveau(
	jeu: JeuDApprentissage,
	niveau: NiveauDeNote,
	o: Required<OptionsApprentissage>,
	sensFinal: ModeleAppris | null,
): { rapport: RapportDeNiveau; final: ModeleAppris | null } {
	if (VARIABLES_DU_NIVEAU[niveau].length > VARIABLES_MAX) throw new Error(`Trop de variables pour le niveau ${niveau}.`);
	const { retenue, lignes } = choisirConfiguration(jeu, jeu.messages, niveau, { graine: 0, lambdas: o.lambdas });
	if (retenue === null || (niveau === 'complets' && sensFinal === null)) {
		const modele = { ...modeleNonAppris(), apprisLe: o.date, gguf: jeu.installes, refus: ['aucune paire jugée pour ce niveau'] };
		return { rapport: { niveau, retenue: null, pertes: lignes, tirages: [], mediane: null, pirePrecision: null, grille: [], stabilite: [], fiabilite: [], modele }, final: null };
	}
	const tirages = o.graines.map((graine) => validationEmboitee(jeu, niveau, graine, o.lambdas));
	const medianes = medianeDes(tirages.map((t) => t.mesures))!;
	const pirePrecision = Math.min(...tirages.map((t) => t.mesures.precisionPessimiste ?? 0));
	const grille = tirages[0]!.grille.map((c, i) => ({ ...medianeDes(tirages.map((t) => t.grille[i]!))!, seuil: c.seuil, seuilPiste: c.seuilPiste }));
	const compte = new Map<string, number>();
	for (const t of tirages) for (const c of t.configurations) compte.set(c, (compte.get(c) ?? 0) + 1);
	const refus = accepter(medianes).refus;
	if (pirePrecision < PIRE_PRECISION_MIN) {
		refus.push(`un découpage des sessions donne une précision de ${Math.round(pirePrecision * 1000) / 10} % (au moins ${PIRE_PRECISION_MIN * 100} % à chaque découpage)`);
	}
	if (jeu.installes.sens === null || (niveau === 'complets' && jeu.installes.reranker === null)) refus.push('modèles installés inconnus');
	if (jeu.identite.manquante > 0) refus.push(`identité des modèles absente sur ${jeu.identite.manquante} cas (--completer la recalcule)`);
	const final = apprendreModele(jeu.messages, niveau, retenue);
	const notesFinales = jeu.messages.flatMap((m) => {
		const n = niveau === 'complets' ? noterMessage(m, sensFinal!, final) : noterMessage(m, final);
		return n === null ? [] : [n];
	});
	const modele: ModeleDeNote = {
		accepte: refus.length === 0,
		biais: final.r.biais,
		poids: Object.fromEntries(VARIABLES_DU_NIVEAU[niveau].map((v, j) => [v, final.r.poids[j]!])) as Record<VariableDeNote, number>,
		methodeCosinus: retenue.methode,
		requete: retenue.requete,
		lambda: retenue.lambda,
		converge: final.r.converge,
		apprisLe: o.date,
		gguf: jeu.installes,
		paires: exemplesDe(jeu.messages, niveau, retenue).length,
		messages: notesFinales.length,
		sessions: new Set(notesFinales.map((m) => m.session).filter((s) => s !== SESSION_MANUELLE)).size,
		mesures: resumer(medianes, pirePrecision),
		refus,
	};
	return {
		rapport: {
			niveau,
			retenue,
			pertes: lignes,
			tirages: tirages.map(({ notes: _notes, ...t }) => t),
			mediane: medianes,
			pirePrecision,
			grille,
			stabilite: [...compte].sort((a, b) => b[1] - a[1]).map(([configuration, fois]) => ({ configuration, fois })),
			fiabilite: calibration(tirages[0]!.notes).fiabilite,
			modele,
		},
		final,
	};
}

/** Apprend et valide un modèle par niveau ; rend le rapport et les coefficients à écrire. */
export function apprendreNote(jeu: JeuDApprentissage, options: OptionsApprentissage): RapportDApprentissage {
	const o = { date: options.date, graines: options.graines ?? GRAINES, lambdas: options.lambdas ?? LAMBDAS };
	const sens = apprendreNiveau(jeu, 'sens', o, null);
	const complets = apprendreNiveau(jeu, 'complets', o, sens.final);
	const niveaux = NIVEAUX_DE_NOTE.map((n) => (n === 'sens' ? sens.rapport : complets.rapport));
	const pile = jeu.messages.flatMap((m) => m.candidates.filter((c) => !c.horsPile));
	const horsPile = jeu.messages.flatMap((m) => m.candidates.filter((c) => c.horsPile && (c.statut === 'pertinente' || c.statut === 'non_pertinente')));
	return {
		date: o.date,
		messages: jeu.messages.length,
		sessions: new Set(jeu.messages.map((m) => m.session).filter((s) => s !== SESSION_MANUELLE)).size,
		messagesManuels: jeu.messages.filter((m) => m.session === SESSION_MANUELLE).length,
		paires: { pertinentes: pile.filter((c) => c.statut === 'pertinente').length, nonPertinentes: pile.filter((c) => c.statut === 'non_pertinente').length },
		indecises: jeu.indecises,
		empreintesChangees: jeu.empreintesChangees,
		horsPile: { jugees: horsPile.length, pertinentes: horsPile.filter((c) => c.statut === 'pertinente').length },
		zApproche: jeu.zApproche,
		identite: jeu.identite,
		niveaux,
		coefficients: { complets: complets.rapport.modele, sens: sens.rapport.modele },
	};
}
