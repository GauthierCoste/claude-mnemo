// Forme d'un modèle de note de confiance (spec classement vivant § 4.2) : les variables de chaque niveau, tirées des signaux
// bruts d'une candidate, et le module de données `coefficients-note.ts` qui garde un modèle par niveau. Pur.

import type { MesuresDAcceptation } from './acceptation-note.ts';
import {
	ALPHA_0,
	APRIORI_MAX,
	BETA_0,
	COSINUS_DE_REFERENCE,
	DEMI_VIE_GESTE_JOURS,
	ECHELLE_COSINUS_RELATIF,
	MESSAGES_DE_REFERENCE,
	MESSAGES_POUR_MEDIANE,
	PLAFOND_LUE_APRES_CARTE,
	POIDS_LIEU_AILLEURS,
	POIDS_LUE_APRES_CARTE,
	RESSEMBLANCE_INCONNUE,
	RESSEMBLANCE_MAX,
	RESSEMBLANCE_MIN,
} from './apriori-gestes.ts';

export type NiveauDeNote = 'complets' | 'sens';
export const NIVEAUX_DE_NOTE: readonly NiveauDeNote[] = ['complets', 'sens'];
export type VariableDeNote = 'logit' | 'cosinusRelatif' | 'bm25Relatif' | 'signalSession' | 'apriori';
/** Variables de chaque niveau, dans l'ordre des poids (spec § 3.7) ; 6 au plus. */
export const VARIABLES_DU_NIVEAU: Record<NiveauDeNote, readonly VariableDeNote[]> = {
	complets: ['logit', 'cosinusRelatif', 'bm25Relatif', 'signalSession', 'apriori'],
	sens: ['cosinusRelatif', 'bm25Relatif', 'signalSession', 'apriori'],
};
export const VARIABLES_MAX = 6;
/** Poids maximal de certaines variables, dans leurs unités (l'historique et la session ne doivent pas tout décider). */
export const MAXIMUMS_DES_POIDS: Partial<Record<VariableDeNote, number>> = { apriori: 1, signalSession: 1.5 };
/** Au niveau Complets, le hook ne soumet au reranker que les premières selon la note Sens seul (spec § 3.6), de 8 à 5. */
export const RERANKEES_AU_HOOK = 8;
/** La simulation de l'apprentissage en prend le cas le plus défavorable : 5 rerankées au hook. */
export const RERANKEES_SIMULEES = 5;
/** Cosinus relatif : écart à la médiane des cosinus de la mémoire pour le message, ou z-score. */
export type MethodeCosinus = 'mediane' | 'zscore';
/** Requête du message : seule, ou jointe au message porteur d'avant quand il est court ou anaphorique (spec § 3.2). */
export type RequeteDeNote = 'seule' | 'jointe';

/**
 * Signaux bruts d'une candidate, tels que le hook et le banc les calculent. `cosinusZ` : le z-score du cosinus parmi les fiches
 * de la mémoire, s'il est calculé.
 */
export type SignauxDeNote = {
	logit?: number | null;
	cosinusRelatif: number | null;
	cosinusZ?: number | null;
	bm25Relatif: number | null;
	signalSession?: number;
	apriori?: number;
};

/**
 * Valeurs des variables d'un niveau pour une candidate, dans l'ordre de `VARIABLES_DU_NIVEAU` ; null si une variable
 * nécessaire manque (le logit au niveau Complets, le cosinus relatif). Conventions : un bm25 relatif null (message sans mot
 * cherchable) vaut 0, comme une fiche que les mots ne trouvent pas ; signal de session et a priori absents valent 0 ; sans
 * a priori (`avecApriori` faux), il vaut 0.
 */
export function variablesDeNote(niveau: NiveauDeNote, s: SignauxDeNote, methode: MethodeCosinus, avecApriori = true): number[] | null {
	const cosinus = methode === 'mediane' ? s.cosinusRelatif : (s.cosinusZ ?? null);
	if (cosinus === null || !Number.isFinite(cosinus)) return null;
	const valeurs: Record<VariableDeNote, number | null> = {
		logit: s.logit ?? null,
		cosinusRelatif: cosinus,
		bm25Relatif: s.bm25Relatif ?? 0,
		signalSession: s.signalSession ?? 0,
		apriori: avecApriori ? (s.apriori ?? 0) : 0,
	};
	const x = VARIABLES_DU_NIVEAU[niveau].map((v) => valeurs[v]);
	return x.every((v): v is number => v !== null && Number.isFinite(v)) ? x : null;
}

/**
 * Ce qui fixe l'échelle des signaux appris hors du modèle : les réglages du signal de session (`contexte.poidsInjection`,
 * `contexte.demiVieInjection`) et les constantes de l'a priori des gestes (`apriori`, leur signature). Un modèle appris avec
 * une autre échelle lirait des signaux qu'il ne connaît pas : il est refusé.
 */
export type EchelleDesSignaux = { poidsInjection: number; demiVieInjection: number; apriori: string };

/** L'échelle des signaux pour ces réglages et les constantes actuelles de l'a priori. */
export function echelleDesSignaux(contexte: { poidsInjection: number; demiVieInjection: number }): EchelleDesSignaux {
	const apriori = [
		DEMI_VIE_GESTE_JOURS,
		POIDS_LIEU_AILLEURS,
		RESSEMBLANCE_MIN,
		RESSEMBLANCE_MAX,
		RESSEMBLANCE_INCONNUE,
		ECHELLE_COSINUS_RELATIF,
		COSINUS_DE_REFERENCE,
		MESSAGES_DE_REFERENCE,
		MESSAGES_POUR_MEDIANE,
		POIDS_LUE_APRES_CARTE,
		PLAFOND_LUE_APRES_CARTE,
		ALPHA_0,
		BETA_0,
		APRIORI_MAX,
	].join('/');
	return { poidsInjection: contexte.poidsInjection, demiVieInjection: contexte.demiVieInjection, apriori };
}

/** Vrai si deux échelles sont les mêmes ; une échelle inconnue (null) n'est jamais la même. */
export function memeEchelle(a: EchelleDesSignaux | null, b: EchelleDesSignaux | null): boolean {
	return a !== null && b !== null && a.poidsInjection === b.poidsInjection && a.demiVieInjection === b.demiVieInjection && a.apriori === b.apriori;
}

/** Identité des modèles qui ont calculé des signaux : fichier GGUF du sens et du reranker, avec le début de son SHA-256. */
export type IdentiteDesModeles = { sens: string | null; reranker: string | null };

/** Vrai si une identité enregistrée diffère de celle des modèles installés (un modèle absent d'un côté ne compte pas). */
export function identiteDifferente(enregistree: IdentiteDesModeles, installee: IdentiteDesModeles): boolean {
	const differe = (a: string | null, b: string | null) => a !== null && b !== null && a !== b;
	return differe(enregistree.sens, installee.sens) || differe(enregistree.reranker, installee.reranker);
}

/**
 * Résumé des mesures d'acceptation en validation croisée emboîtée, au seuil par défaut : la médiane des découpages répétés ;
 * `pirePrecision` : la plus basse précision pessimiste d'un découpage.
 */
export type MesuresDuModele = Pick<
	MesuresDAcceptation,
	| 'seuil'
	| 'injections'
	| 'nonJugees'
	| 'horsPileFausses'
	| 'precision'
	| 'precisionPessimiste'
	| 'wilsonBassePessimiste'
	| 'bootstrapP025'
	| 'sessions'
	| 'injectionsParMessage'
	| 'silences'
	| 'partSilencesAvecInjection'
	| 'pente'
	| 'ordonnee'
	| 'ece'
	| 'rappel'
	| 'utilesAtteintes'
	| 'rappel10'
> & { pirePrecision: number | null };

/**
 * Un modèle de note pour un niveau : `p = σ(biais + Σ poids·variable)`. `gguf` : fichiers des modèles de sens et du reranker
 * (nom et début du SHA-256) avec lesquels il a été appris ; un modèle appris pour d'autres fichiers n'est pas utilisé.
 * `converge` : l'apprentissage final a atteint son minimum. `origine` `depart` : un modèle de départ livré avec Mnemo (appris
 * ailleurs que sur la mémoire : jamais accepté, `gguf` et `echelle` inconnus), qui ordonne sans % ni injection ; absent : appris
 * sur la mémoire.
 */
export type ModeleDeNote = {
	origine?: 'depart';
	accepte: boolean;
	biais: number;
	poids: Partial<Record<VariableDeNote, number>>;
	methodeCosinus: MethodeCosinus;
	requete: RequeteDeNote;
	lambda: number | null;
	converge: boolean;
	apprisLe: string | null;
	gguf: IdentiteDesModeles;
	/** Échelle des signaux avec laquelle il a été appris (null : jamais appris, ou inconnue). */
	echelle: EchelleDesSignaux | null;
	paires: number;
	messages: number;
	sessions: number;
	mesures: MesuresDuModele | null;
	/** Critères manqués (vide si accepté). */
	refus: string[];
};
export type CoefficientsNote = Record<NiveauDeNote, ModeleDeNote>;

/** Un modèle jamais appris : refusé, sans poids. */
export const modeleNonAppris = (): ModeleDeNote => ({
	accepte: false,
	biais: 0,
	poids: {},
	methodeCosinus: 'mediane',
	requete: 'seule',
	lambda: null,
	converge: true,
	apprisLe: null,
	gguf: { sens: null, reranker: null },
	echelle: null,
	paires: 0,
	messages: 0,
	sessions: 0,
	mesures: null,
	refus: ['pas encore appris'],
});

/** Le refus d'un modèle de départ : il n'a pas été appris sur la mémoire. */
export const REFUS_DEPART = 'note de départ, à entraîner';

/**
 * Les coefficients en modèles de départ (D2, `--apprendre --module --depart`) : chaque modèle appris marqué `depart`, jamais
 * accepté, sans identité des fichiers GGUF ni échelle des signaux (pour n'être refusé ni pour « autres GGUF » ni pour « autre
 * échelle »), sa date d'apprentissage gardée ; un niveau jamais appris reste tel quel.
 */
export function enModelesDeDepart(c: CoefficientsNote): CoefficientsNote {
	const depart = (m: ModeleDeNote): ModeleDeNote =>
		m.apprisLe === null || Object.keys(m.poids).length === 0
			? m
			: { origine: 'depart', ...m, accepte: false, gguf: { sens: null, reranker: null }, echelle: null, refus: [REFUS_DEPART] };
	return { complets: depart(c.complets), sens: depart(c.sens) };
}

/** Arrondi à 6 chiffres significatifs (un module lisible, des diffs courts). */
function arrondir(valeur: unknown): unknown {
	if (typeof valeur === 'number') return Number.isFinite(valeur) ? Number(valeur.toPrecision(6)) : null;
	if (Array.isArray(valeur)) return valeur.map(arrondir);
	if (valeur !== null && typeof valeur === 'object') return Object.fromEntries(Object.entries(valeur).map(([k, v]) => [k, arrondir(v)]));
	return valeur;
}

/** Les coefficients en JSON (`.mnemo/coefficients-note.json`, lu par le service). */
export function jsonDeCoefficients(c: CoefficientsNote): string {
	return `${JSON.stringify(arrondir(c), null, '\t')}\n`;
}

/** Texte du module `domaine/coefficients-note.ts`, la valeur par défaut (données seules : aucun texte de fiche ni de message). */
export function moduleDeCoefficients(c: CoefficientsNote): string {
	return [
		'// Coefficients de la note de confiance, un modèle par niveau (spec classement vivant § 4.2). Données écrites par',
		'// `mnemo banc contexte --apprendre --module` : aucun texte de fiche ni de message. Valeur par défaut : les coefficients appris',
		"// d'une mémoire sont dans son `.mnemo/coefficients-note.json`. Un modèle non accepté ordonne sans % ni injection (ordre seul) ;",
		"// un modèle de départ (`--depart`, `origine` `depart`) aussi, jusqu'à ce que la mémoire apprenne le sien.",
		'',
		"import type { CoefficientsNote } from './modele-de-note.ts';",
		'',
		`export const COEFFICIENTS_NOTE: CoefficientsNote = ${jsonDeCoefficients(c).trimEnd()};`,
		'',
	].join('\n');
}

const estObjet = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const nombreFini = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const texteOuNull = (v: unknown): v is string | null => v === null || typeof v === 'string';

/** L'échelle lue du JSON ; null si elle est absente ou invalide. */
function lireEchelle(v: unknown): EchelleDesSignaux | null {
	if (!estObjet(v) || !nombreFini(v['poidsInjection']) || !nombreFini(v['demiVieInjection']) || typeof v['apriori'] !== 'string') return null;
	return { poidsInjection: v['poidsInjection'], demiVieInjection: v['demiVieInjection'], apriori: v['apriori'] };
}

/** Marge d'arrondi des poids écrits (6 chiffres significatifs) au regard de leurs bornes. */
const ARRONDI_DES_BORNES = 1e-5;

/**
 * Un modèle lu du JSON ; null s'il est invalide : forme, poids négatifs, au-delà de leur maximum (`MAXIMUMS_DES_POIDS`) ou de
 * variables hors du niveau, `accepte` incohérent avec `refus` (accepté : aucun refus ; refusé : au moins un ; jamais appris :
 * jamais accepté), `origine` autre que `depart` (absente : appris sur la mémoire) ou modèle de départ accepté.
 */
function lireModele(niveau: NiveauDeNote, v: unknown): ModeleDeNote | null {
	if (!estObjet(v) || typeof v['accepte'] !== 'boolean' || !nombreFini(v['biais']) || !estObjet(v['poids']) || !estObjet(v['gguf'])) return null;
	const poids: Partial<Record<VariableDeNote, number>> = {};
	for (const [variable, w] of Object.entries(v['poids'])) {
		if (!(VARIABLES_DU_NIVEAU[niveau] as readonly string[]).includes(variable) || !nombreFini(w) || w < 0) return null;
		const max = MAXIMUMS_DES_POIDS[variable as VariableDeNote];
		if (max !== undefined && w > max * (1 + ARRONDI_DES_BORNES)) return null;
		poids[variable as VariableDeNote] = w;
	}
	if (!Array.isArray(v['refus']) || !v['refus'].every((r) => typeof r === 'string')) return null;
	const refus = v['refus'] as string[];
	if (v['accepte'] !== (refus.length === 0)) return null;
	if (v['accepte'] && (v['apprisLe'] ?? null) === null) return null;
	// un modèle de départ n'est jamais accepté
	const origine = v['origine'];
	if (origine !== undefined && (origine !== 'depart' || v['accepte'])) return null;
	const methode = v['methodeCosinus'];
	const requete = v['requete'] ?? 'seule';
	const { sens, reranker } = v['gguf'];
	if ((methode !== 'mediane' && methode !== 'zscore') || (requete !== 'seule' && requete !== 'jointe') || !texteOuNull(sens) || !texteOuNull(reranker) || !texteOuNull(v['apprisLe'] ?? null)) return null;
	const entier = (x: unknown) => (nombreFini(x) ? x : 0);
	return {
		...(origine === 'depart' ? { origine } : {}),
		accepte: v['accepte'],
		biais: v['biais'],
		poids,
		methodeCosinus: methode,
		requete,
		lambda: nombreFini(v['lambda']) ? v['lambda'] : null,
		converge: v['converge'] !== false,
		apprisLe: (v['apprisLe'] as string | null | undefined) ?? null,
		gguf: { sens, reranker },
		echelle: lireEchelle(v['echelle']),
		paires: entier(v['paires']),
		messages: entier(v['messages']),
		sessions: entier(v['sessions']),
		mesures: estObjet(v['mesures']) ? (v['mesures'] as MesuresDuModele) : null,
		refus,
	};
}

/**
 * Les coefficients lus de `.mnemo/coefficients-note.json` (`jsonDeCoefficients`) ; null si le contenu est invalide (un modèle
 * de chaque niveau attendu) : la valeur par défaut s'applique alors.
 */
export function lireCoefficients(brut: unknown): CoefficientsNote | null {
	if (!estObjet(brut)) return null;
	const complets = lireModele('complets', brut['complets']);
	const sens = lireModele('sens', brut['sens']);
	return complets === null || sens === null ? null : { complets, sens };
}
