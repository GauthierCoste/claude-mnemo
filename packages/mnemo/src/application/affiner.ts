/**
 * Affinage du classement en arrière-plan (spec classement vivant § 3.6) : après la réponse du hook de message, le service fait
 * noter par le reranker les 30 premières candidates de l'ordre du hook, plus les fiches désignées par un signal ; si le sens
 * n'avait pas répondu au hook, il calcule aussi les cosinus. L'entrée du journal est complétée (même horodatage, `affinage`
 * `en_cours` puis `fait`) et rediffusée. **Rien d'autre** : ni injection, ni piste, ni file (rien en différé, décision du 24/11).
 * Un message plus récent de la session rend l'affinage caduc : rien n'est écrit ni diffusé (une entrée d'après un outil, non).
 */
import { baseDuReranker } from '../domaine/note-des-pistes.ts';
import { normaliser } from '../domaine/sens.ts';
import { cosinusDesFiches, cosinusRelatif, cosinusZ } from '../domaine/signaux-de-note.ts';
import { requeteDuReranker, texteDuReranker } from '../domaine/textes-du-reranker.ts';
import { classementDuJournal } from './classement-du-message.ts';
import type { LigneDeClassement } from './classement-du-message.ts';
import type { Classe, Dependances, EtatSessions } from './ports.ts';

/** Candidates de l'ordre du hook soumises au reranker (plus les désignées par un signal). */
export const CANDIDATES_AFFINEES = 30;
/** Budget de l'affinage entier (sens s'il manquait, puis reranker). */
export const BUDGET_AFFINAGE_MS = 3000;

export type DemandeAffinage = {
	session: string;
	/** Horodatage de l'entrée de message à compléter. */
	horodatageMs: number;
	/** Requête du classement (celle du hook : message seul ou joint). */
	requete: string;
	/** Le classement du hook, dans son ordre. */
	classement: readonly LigneDeClassement[];
	/** Le sens a-t-il répondu au hook ? Sinon, l'affinage calcule les cosinus. */
	sens: boolean;
	/**
	 * L'estimation de la durée du reranker n'est pas encore fiable : l'appel est fait en plusieurs morceaux de tailles différentes
	 * (`MORCEAUX_A_MESURER`), chacun mesuré, pour qu'elle le devienne dès le message suivant (au lieu d'appels de mesure à part).
	 */
	mesurer?: boolean;
	budgetMs?: number;
};

/** Tailles voulues des deux premiers morceaux quand l'estimation est à faire (puis le reste) : deux tailles au moins, la pente et le fixe. */
export const MORCEAUX_A_MESURER = [8, 5] as const;

const ficheDe = (id: string): string => id.split('#')[0]!;

/**
 * Les appels au reranker, `[début, taille]` : un seul ; ou, quand l'estimation est à faire, trois morceaux (8, 5 puis le reste,
 * moins quand il y a moins de candidates : il en reste toujours au moins une pour chacun des suivants) : trois mesures
 * complètes, de tailles différentes, suffisent à rendre l'estimation fiable dès le message suivant.
 */
export function morceaux(nombre: number, mesurer: boolean): [number, number][] {
	if (nombre === 0) return [];
	if (!mesurer) return [[0, nombre]];
	const [premier, second] = MORCEAUX_A_MESURER;
	const tailles: number[] = [];
	let reste = nombre;
	for (const [i, voulue] of [premier, second].entries()) {
		if (reste === 0) break;
		// laisser au moins une candidate à chacun des morceaux suivants
		const t = Math.min(voulue, Math.max(1, reste - (2 - i)));
		tailles.push(t);
		reste -= t;
	}
	if (reste > 0) tailles.push(reste);
	let debut = 0;
	return tailles.map((t) => {
		const appel: [number, number] = [debut, t];
		debut += t;
		return appel;
	});
}

/** Les candidates à soumettre au reranker : les `CANDIDATES_AFFINEES` premières de l'ordre, plus celles qu'un signal désigne. */
export function candidatesAffinees(ordre: readonly LigneDeClassement[]): string[] {
	return [...new Set([...ordre.slice(0, CANDIDATES_AFFINEES).map((l) => l.chemin), ...ordre.filter((l) => l.signaux.signalSession > 0).map((l) => l.chemin)])];
}

/**
 * L'ordre affiné : d'abord les fiches notées par le reranker, par leur note (sa base, la sigmoïde du logit, plus le signal de
 * session : comme l'outil `contexte`), puis les autres, par leur note du sens si elle est connue ; à égalité, l'ordre d'avant.
 */
export function ordreAffine(lignes: readonly LigneDeClassement[], logits: ReadonlyMap<string, number>): LigneDeClassement[] {
	const rang = new Map(lignes.map((l, i) => [l.chemin, i]));
	const notees = lignes.map((l): LigneDeClassement => {
		const logit = logits.get(l.chemin);
		return logit === undefined ? l : { ...l, logit, note: baseDuReranker(logit) + l.signaux.signalSession };
	});
	const parNote = (a: LigneDeClassement, b: LigneDeClassement) => (b.note ?? -Infinity) - (a.note ?? -Infinity) || rang.get(a.chemin)! - rang.get(b.chemin)!;
	return [...notees.filter((l) => logits.has(l.chemin)).sort(parNote), ...notees.filter((l) => !logits.has(l.chemin)).sort(parNote)];
}

/** Les cosinus de toute la mémoire pour la requête (sens absent au hook) : les signaux et la note de chaque ligne ; null sans le sens. */
async function avecLeSens(dep: Dependances, d: DemandeAffinage, fin: number): Promise<LigneDeClassement[] | null> {
	const modele = dep.sens.modele();
	if (modele === null || d.requete.trim() === '') return null;
	const vecteurs = await dep.sens.vecteurs([d.requete], { budgetMs: fin - Date.now(), demarrer: false, activite: { operation: 'injection' } }).catch(() => null);
	const v = vecteurs?.length === 1 ? vecteurs[0]! : null;
	if (v === null || v.length === 0 || !v.every(Number.isFinite)) return null;
	const nombre = (await dep.index.fiches()).length;
	const proches = await dep.index.plusProches(modele, normaliser(v), { genres: ['fiche'] }, nombre);
	const cos = cosinusDesFiches(proches.map((p) => ({ chemin: ficheDe(p.id), similarite: p.similarite })));
	if (cos.parFiche.size === 0) return null;
	const lignes = d.classement.map((l): LigneDeClassement => {
		const c = cos.parFiche.get(l.chemin) ?? null;
		const signaux = { ...l.signaux, cosinus: c, cosinusRelatif: cosinusRelatif(c, cos.mediane), cosinusZ: cosinusZ(c, cos) };
		// la note du hook : le sens (ici 0, il manquait) plus les poids des signaux
		return { ...l, signaux, note: Math.max(0, c ?? 0) + l.signaux.signalSession };
	});
	return ordreAffine(lignes, new Map());
}

/**
 * Affine le classement d'une entrée de message et le complète au journal ; rend le classement écrit, ou null si l'affinage est
 * caduc (un message plus récent dans la session) ou si l'écriture échoue. `diffuser` : appelé une fois l'entrée complétée.
 */
export async function affiner(dep: Dependances, etat: Pick<EtatSessions, 'completerClassement'>, d: DemandeAffinage, diffuser?: () => Promise<void>): Promise<Classe[] | null> {
	const fin = Date.now() + (d.budgetMs ?? BUDGET_AFFINAGE_MS);
	const avant = classementDuJournal(d.classement);
	// en cours : l'entrée est encore la plus récente ; sinon, caduc dès maintenant
	if (!(await etat.completerClassement(d.session, d.horodatageMs, avant, 'en_cours').catch(() => false))) return null;
	let lignes: LigneDeClassement[] = [...d.classement];
	if (!d.sens) lignes = (await avecLeSens(dep, d, fin).catch(() => null)) ?? lignes;
	const soumises = candidatesAffinees(lignes);
	const elements = new Map((await dep.index.elements({ chemins: soumises, genres: ['fiche'] })).map((e) => [e.chemin, e]));
	const titre = new Map(lignes.map((l) => [l.chemin, l.titre]));
	const textes = soumises.map((c) => texteDuReranker(titre.get(c) ?? c, elements.get(c)?.texte ?? ''));
	const logits = new Map<string, number>();
	if (d.requete.trim() !== '') {
		const requete = requeteDuReranker(d.requete);
		for (const [debut, taille] of morceaux(soumises.length, d.mesurer === true)) {
			const budgetMs = fin - Date.now();
			if (budgetMs <= 0) break;
			const notes = await dep.reranker.noter(requete, textes.slice(debut, debut + taille), { budgetMs, demarrer: false, activite: { operation: 'injection' } }).catch(() => null);
			// sans réponse (modèle arrêté, budget dépassé) : les morceaux suivants ne répondraient pas mieux
			if (notes === null || notes.length !== taille) break;
			for (const [i, n] of notes.entries()) logits.set(soumises[debut + i]!, n);
		}
	}
	const affine = classementDuJournal(logits.size === 0 ? lignes : ordreAffine(lignes, logits));
	if (!(await etat.completerClassement(d.session, d.horodatageMs, affine, 'fait').catch(() => false))) return null;
	await diffuser?.().catch(() => {});
	return affine;
}
