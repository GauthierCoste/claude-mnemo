/**
 * Ce que la page Mémoire › Entraîner dit de l'état de l'entraînement, en fonctions pures : l'état d'une note en un mot (et
 * le ton de sa puce), le verdict du service sans son premier mot, les niveaux regroupés quand ils disent la même chose,
 * l'étape utile, les dates et les libellés des tâches. Vocabulaire (spec, D9) : « note de confiance », « injecter ».
 */
import type { EtatNoteVue, NiveauNoteVue, NoteDuNiveauVue, TacheEntrainementVue, VueEntrainement } from '@mnemo/contrat';

/** Messages validés conseillés pour un premier apprentissage (la jauge de « Préparer »). */
export const MESSAGES_CONSEILLES = 100;
/** Messages préparés par défaut (comme le service). */
export const NOMBRE_A_PREPARER = 30;
export const PREPARER_MAX = 200;

export const NOMS_NIVEAUX_NOTE: Record<NiveauNoteVue, string> = { complets: 'Complets', sens: 'Sens seul' };

/** L'état d'une note en un mot (puce). La note est féminine ; le verdict du service parle du modèle. */
export const NOMS_ETATS_NOTE: Record<EtatNoteVue, string> = {
	accepte: 'Acceptée',
	coupe: 'Injection coupée',
	refuse: 'Refusée',
	depart: 'De départ',
	non_appris: 'Pas entraînée',
};

export type TonEtat = 'succes' | 'avertissement' | 'neutre';
export const TONS_ETATS_NOTE: Record<EtatNoteVue, TonEtat> = { accepte: 'succes', coupe: 'avertissement', refuse: 'avertissement', depart: 'neutre', non_appris: 'neutre' };

/**
 * Le verdict du service (« Refusé : la note ordonne le classement, sans % ») sans ce qui précède le premier « : », que la
 * puce dit déjà ; avec une majuscule. Sans « : », tel quel.
 */
export function suiteDuVerdict(verdict: string): string {
	const i = verdict.indexOf(' : ');
	if (i < 0) return verdict;
	const suite = verdict.slice(i + 3).trim();
	return suite.charAt(0).toLocaleUpperCase('fr-FR') + suite.slice(1);
}

/** Une ligne de l'en-tête : un ou plusieurs niveaux qui ont le même état, la même origine, la même date et le même verdict. */
export type LigneDeNote = { niveaux: NiveauNoteVue[]; note: NoteDuNiveauVue };

/** Les niveaux regroupés : « Complets et Sens seul » quand ils disent la même chose, sinon une ligne chacun. */
export function lignesDeNote(niveaux: readonly NoteDuNiveauVue[]): LigneDeNote[] {
	const lignes: LigneDeNote[] = [];
	for (const n of niveaux) {
		const meme = lignes.find((l) => l.note.etat === n.etat && l.note.origine === n.origine && l.note.date === n.date && l.note.verdict === n.verdict);
		if (meme) meme.niveaux.push(n.niveau);
		else lignes.push({ niveaux: [n.niveau], note: n });
	}
	return lignes;
}

export const nomsDesNiveaux = (niveaux: readonly NiveauNoteVue[]): string => niveaux.map((n) => NOMS_NIVEAUX_NOTE[n]).join(' et ');

/** Date et heure courtes, à la française : « 26/11/2026 à 14:05 ». */
export function dateEtHeure(iso: string): string {
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return '—';
	return `${d.toLocaleDateString('fr-FR')} à ${d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
}

/** D'où vient la note, à côté de son état : apprise (et quand), livrée avec Mnemo, ou rien. */
export function origineDeNote(n: NoteDuNiveauVue): string | null {
	if (n.origine === 'depart') return 'livrée avec Mnemo';
	if (n.origine === 'appris' && n.date !== null) return `apprise le ${dateEtHeure(n.date)}`;
	return null;
}

/** La tâche en cours, nommée par l'opération réelle. */
export const NOMS_TACHES: Record<TacheEntrainementVue['genre'], string> = {
	preparer: 'Préparation des messages',
	prejuger: 'Pré-jugement par Claude',
	apprendre: 'Apprentissage de la note',
};

export type Etape = 1 | 2 | 3;

/**
 * L'étape à mettre en avant : rien de préparé → Préparer ; des messages attendent un jugement → Juger ; tout est jugé et des
 * messages ont été jugés depuis le dernier apprentissage (ou il n'y en a pas eu) → Apprendre ; sinon, préparer d'autres messages.
 */
export function etapeUtile(v: Pick<VueEntrainement, 'banc'>): Etape {
	const b = v.banc;
	if (b.messages === 0) return 1;
	if (b.aJuger > 0) return 2;
	if (b.paires > 0 && b.nouveauxDepuisApprentissage > 0) return 3;
	return 1;
}

/** Vrai si la note a déjà été apprise sur cette mémoire : un essai réussi dans l'historique, un rapport, ou un modèle appris. */
export const dejaAppris = (v: Pick<VueEntrainement, 'historique' | 'resultat' | 'note'>): boolean =>
	v.resultat !== null || v.historique.some((l) => l.erreur === undefined) || v.note.niveaux.some((n) => n.origine === 'appris');

/** Les messages jugés depuis le dernier apprentissage, dits sur la carte Apprendre (null : jamais appris, rien de plus à dire). */
export function jugesDepuisApprentissage(v: Pick<VueEntrainement, 'banc' | 'historique' | 'resultat' | 'note'>): string | null {
	if (!dejaAppris(v)) return null;
	const n = v.banc.nouveauxDepuisApprentissage;
	return n === 0 ? 'Aucun message jugé depuis le dernier apprentissage' : `${accorder(n, 'message jugé', 'messages jugés')} depuis le dernier apprentissage`;
}

/** Un pourcentage entier (« 82 % ») d'une part de 0 à 1. */
export const pourcent = (x: number): string => `${Math.round(x * 100)} %`;

/** Accord en nombre : `1 message`, `3 messages` (le pluriel régulier par défaut). */
export const accorder = (n: number, singulier: string, pluriel = `${singulier}s`): string => `${n} ${n > 1 ? pluriel : singulier}`;
