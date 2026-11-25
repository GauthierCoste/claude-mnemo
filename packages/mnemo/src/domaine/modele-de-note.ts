// Forme d'un modèle de note de confiance (spec classement vivant § 4.2) : les variables de chaque niveau, tirées des signaux
// bruts d'une candidate, et le module de données `coefficients-note.ts` qui garde un modèle par niveau. Pur.

import type { MesuresDAcceptation } from './acceptation-note.ts';

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
/** Au niveau Complets, le hook ne soumet au reranker que les premières selon la note Sens seul (spec § 3.6). */
export const RERANKEES_AU_HOOK = 8;
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
 * `converge` : l'apprentissage final a atteint son minimum.
 */
export type ModeleDeNote = {
	accepte: boolean;
	biais: number;
	poids: Partial<Record<VariableDeNote, number>>;
	methodeCosinus: MethodeCosinus;
	requete: RequeteDeNote;
	lambda: number | null;
	converge: boolean;
	apprisLe: string | null;
	gguf: IdentiteDesModeles;
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
	paires: 0,
	messages: 0,
	sessions: 0,
	mesures: null,
	refus: ['pas encore appris'],
});

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
		"// d'une mémoire sont dans son `.mnemo/coefficients-note.json`. Un modèle non accepté ne note rien (ordre seul).",
		'',
		"import type { CoefficientsNote } from './modele-de-note.ts';",
		'',
		`export const COEFFICIENTS_NOTE: CoefficientsNote = ${jsonDeCoefficients(c).trimEnd()};`,
		'',
	].join('\n');
}
