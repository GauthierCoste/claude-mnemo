/**
 * Affinage du classement en arrière-plan (spec classement vivant § 3.6) : après la réponse du hook de message, le service fait
 * noter par le reranker les 30 premières candidates de l'ordre du hook, plus les fiches désignées par un signal (40 au plus ;
 * celles que le hook a déjà notées gardent sa note) ; si le sens n'avait pas répondu au hook, il calcule aussi les cosinus.
 * Avec une note de confiance apprise, la note est recalculée avec les logits (Complets pour les fiches notées par le reranker,
 * Sens seul pour les autres) et range le classement, `p` seulement d'un modèle accepté ; sans, l'ordre provisoire (`ordreAffine`).
 * L'entrée du journal est complétée (même horodatage, `affinage` `en_cours` puis `fait`, ou null si rien n'a été ajouté) et
 * rediffusée à chaque étape. **Rien d'autre** : ni injection, ni piste, ni file (rien en différé, décision du 24/11).
 * Un message porteur plus récent de la session rend l'affinage caduc (sa demande coupe celle-ci, entre deux morceaux ; l'état
 * le vérifie à l'écriture) : rien n'est écrit, l'état d'affinage de l'entrée revient à null (une entrée d'après un outil, non).
 */
import type { EtapeCalcul } from '@mnemo/commun';
import { baseDuReranker } from '../domaine/note-des-pistes.ts';
import { normaliser } from '../domaine/sens.ts';
import { cosinusDesFiches, cosinusRelatif, cosinusZ } from '../domaine/signaux-de-note.ts';
import { requeteDuReranker, texteDuReranker } from '../domaine/textes-du-reranker.ts';
import { classementDuJournal } from './classement-du-message.ts';
import { modelesActifs, noterLeClassement } from './note-du-classement.ts';
import type { ModelesDeNote } from '../domaine/note-de-confiance.ts';
import type { LigneDeClassement } from './classement-du-message.ts';
import type { Classe, Dependances, EtatSessions, VecteurDuMessage } from './ports.ts';

/** Candidates de l'ordre du hook soumises au reranker (plus les désignées par un signal). */
export const CANDIDATES_AFFINEES = 30;
/** Documents de l'affinage au plus, désignées comprises. */
export const AFFINEES_MAX = 40;
/** Taille d'un morceau : le hook n'attend jamais plus qu'un morceau de l'affinage, et la caducité est vérifiée entre deux. */
export const MORCEAU_AFFINAGE = 10;
/** Budget de l'affinage entier (sens s'il manquait, puis reranker). */
export const BUDGET_AFFINAGE_MS = 3000;
/** Tailles des premiers morceaux quand l'estimation est à faire (puis des morceaux ordinaires) : des tailles différentes, la pente et le fixe. */
export const MORCEAUX_A_MESURER = [5, 8] as const;

export type DemandeAffinage = {
	session: string;
	/** Horodatage de l'entrée de message à compléter. */
	horodatageMs: number;
	/** Rang du message porteur : la mémoire des porteurs ne reçoit le classement affiné que si c'est encore le dernier. */
	rang: number;
	/** Requête du classement (celle du hook : message seul ou joint). */
	requete: string;
	/** Le classement du hook, dans son ordre (le logit des candidates qu'il a notées compris). */
	classement: readonly LigneDeClassement[];
	/** Le sens a-t-il répondu au hook ? Sinon, l'affinage calcule les cosinus. */
	sens: boolean;
	/**
	 * L'estimation de la durée du reranker n'est pas encore fiable : les premiers morceaux ont des tailles différentes
	 * (`MORCEAUX_A_MESURER`), chacun mesuré, pour qu'elle le devienne dès le message suivant (sans appels de mesure à part).
	 */
	mesurer?: boolean;
	budgetMs?: number;
	/** L'a priori des gestes a été lu au hook (sinon, une note qui le pèse n'est pas calibrée). Absent : non. */
	aprioriConnu?: boolean;
	/** Les modèles de la note lus pour ce message au hook ; absents : lus ici. */
	modeles?: ModelesDeNote;
};

export type OptionsAffinage = {
	/** Appelé après chaque écriture de l'entrée (en cours, puis fait ou rien d'ajouté). */
	diffuser?: () => Promise<void>;
	/** Coupé par une demande plus récente de la même session : caduc, vérifié avant chaque étape. */
	signal?: AbortSignal;
	/** Faire noter par le reranker (faux : le sens seul, qui manquait au hook). Défaut : vrai. */
	reranker?: boolean;
	/** Durée estimée du reranker pour `documents` (null : pas encore fiable) ; un morceau qui ne tient pas dans le reste du budget n'est pas lancé. */
	estimer?: (documents: number) => number | null;
	/** L'étape qui commence (sens, affinage par paquets, note), pour le bouton des modèles de la session ; envoi seul. */
	etape?: (e: EtapeCalcul) => void;
};

export type ResultatAffinage = { classement: Classe[]; vecteur: VecteurDuMessage | null };

const ficheDe = (id: string): string => id.split('#')[0]!;

/**
 * Les appels au reranker, `[début, taille]` : un seul pour peu de candidates (`MORCEAU_AFFINAGE` au plus) ; sinon des morceaux
 * de `MORCEAU_AFFINAGE`, précédés, quand l'estimation est à faire, de morceaux de tailles différentes (`MORCEAUX_A_MESURER`).
 */
export function morceaux(nombre: number, mesurer: boolean): [number, number][] {
	if (nombre <= 0) return [];
	if (nombre <= MORCEAU_AFFINAGE) return [[0, nombre]];
	const voulues: number[] = mesurer ? [...MORCEAUX_A_MESURER] : [];
	const appels: [number, number][] = [];
	let debut = 0;
	while (debut < nombre) {
		const t = Math.min(voulues.shift() ?? MORCEAU_AFFINAGE, nombre - debut);
		appels.push([debut, t]);
		debut += t;
	}
	return appels;
}

/** Les candidates à soumettre au reranker : les `CANDIDATES_AFFINEES` premières de l'ordre, plus celles qu'un signal désigne ; `AFFINEES_MAX` au plus. */
export function candidatesAffinees(ordre: readonly LigneDeClassement[]): string[] {
	return [...new Set([...ordre.slice(0, CANDIDATES_AFFINEES).map((l) => l.chemin), ...ordre.filter((l) => l.signaux.signalSession > 0).map((l) => l.chemin)])].slice(0, AFFINEES_MAX);
}

/**
 * L'ordre affiné de la règle provisoire (aucune note apprise) : d'abord les fiches notées par le reranker, par leur note (sa base, la sigmoïde du logit, plus le signal de
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

/** Les cosinus de toute la mémoire pour la requête (sens absent au hook) : les signaux et la note de chaque ligne, et le vecteur ; null sans le sens. */
async function avecLeSens(dep: Dependances, d: DemandeAffinage, fin: number): Promise<{ lignes: LigneDeClassement[]; vecteur: VecteurDuMessage } | null> {
	const modele = dep.sens.modele();
	if (modele === null || d.requete.trim() === '' || fin - Date.now() <= 0) return null;
	const vecteurs = await dep.sens.vecteurs([d.requete], { budgetMs: fin - Date.now(), demarrer: false, activite: { operation: 'injection' } }).catch(() => null);
	const v = vecteurs?.length === 1 ? vecteurs[0]! : null;
	if (v === null || v.length === 0 || !v.every(Number.isFinite)) return null;
	const valeurs = normaliser(v);
	const nombre = (await dep.index.fiches()).length;
	const proches = await dep.index.plusProches(modele, valeurs, { genres: ['fiche'] }, nombre);
	const cos = cosinusDesFiches(proches.map((p) => ({ chemin: ficheDe(p.id), similarite: p.similarite })));
	if (cos.parFiche.size === 0) return null;
	const lignes = d.classement.map((l): LigneDeClassement => {
		const c = cos.parFiche.get(l.chemin) ?? null;
		const signaux = { ...l.signaux, cosinus: c, cosinusRelatif: cosinusRelatif(c, cos.mediane), cosinusZ: cosinusZ(c, cos) };
		// la note du hook : le sens plus les poids des signaux
		return { ...l, signaux, note: Math.max(0, c ?? 0) + l.signaux.signalSession };
	});
	return { lignes: ordreAffine(lignes, new Map()), vecteur: { modele, valeurs } };
}

/**
 * Affine le classement d'une entrée de message et le complète au journal ; rend le classement écrit et le vecteur calculé,
 * ou null si l'affinage est caduc, si rien n'a été ajouté (ni note du reranker, ni sens) ou si l'écriture échoue.
 */
export async function affiner(dep: Dependances, etat: Pick<EtatSessions, 'completerClassement'>, d: DemandeAffinage, o: OptionsAffinage = {}): Promise<ResultatAffinage | null> {
	const fin = Date.now() + (d.budgetMs ?? BUDGET_AFFINAGE_MS);
	const diffuser = async () => {
		await o.diffuser?.().catch(() => {});
	};
	const etape = (e: EtapeCalcul) => {
		try {
			o.etape?.(e);
		} catch {
			// l'étape n'est qu'un affichage
		}
	};
	const avant = classementDuJournal(d.classement);
	const ecrire = (classement: Classe[], affinage: 'en_cours' | 'fait' | null, options?: { sens: boolean; calibree: boolean }) =>
		etat.completerClassement(d.session, d.horodatageMs, classement, affinage, options === undefined ? undefined : { ...(options.sens ? { sens: true } : {}), calibree: options.calibree }).catch(() => false);
	// caduc (ou rien d'ajouté) : l'entrée garde le classement du hook, sans état d'affinage ; l'état le remet aussi à null s'il
	// n'est plus l'entrée la plus récente
	const sansAffinage = async (): Promise<null> => {
		await ecrire(avant, null);
		await diffuser();
		return null;
	};
	// coupé par une demande plus récente de la session (relu à chaque étape)
	const coupe = (): boolean => o.signal?.aborted === true;
	if (coupe()) return null;
	if (!(await ecrire(avant, 'en_cours'))) return null;
	await diffuser();
	let lignes: LigneDeClassement[] = [...d.classement];
	let vecteur: VecteurDuMessage | null = null;
	const modeles = d.modeles ?? modelesActifs(dep);
	const aprioriConnu = { aprioriConnu: d.aprioriConnu === true };
	if (!d.sens) {
		etape({ nom: 'sens' });
		const calcul = await avecLeSens(dep, d, fin).catch(() => null);
		if (calcul !== null) {
			({ lignes, vecteur } = calcul);
			// le sens manquait au hook : la note Sens seul ordonne d'abord (si un modèle est appris), puis les 30 sont choisies
			const parSens = noterLeClassement(lignes, modeles, aprioriConnu);
			if (parSens.parNote) lignes = parSens.lignes;
		}
	}
	if (coupe()) return sansAffinage();
	// les notes du hook sont gardées telles quelles : seules les autres candidates sont soumises
	const logits = new Map<string, number>(lignes.flatMap((l) => (l.logit === null ? [] : [[l.chemin, l.logit] as const])));
	const duHook = logits.size;
	if (o.reranker !== false && d.requete.trim() !== '') {
		const soumises = candidatesAffinees(lignes).filter((c) => !logits.has(c));
		const elements = new Map((await dep.index.elements({ chemins: soumises, genres: ['fiche'] })).map((e) => [e.chemin, e]));
		const titre = new Map(lignes.map((l) => [l.chemin, l.titre]));
		const textes = soumises.map((c) => texteDuReranker(titre.get(c) ?? c, elements.get(c)?.texte ?? ''));
		const requete = requeteDuReranker(d.requete);
		for (const [debut, taille] of morceaux(soumises.length, d.mesurer === true)) {
			if (coupe()) return sansAffinage();
			etape({ nom: 'affinage', fait: debut, total: soumises.length });
			const budgetMs = fin - Date.now();
			const estimee = o.estimer?.(taille) ?? null;
			// plus de temps pour ce morceau (ni pour les suivants) : l'affinage s'arrête là, sans appel voué à être coupé
			if (budgetMs <= 0 || (estimee !== null && estimee > budgetMs)) break;
			const notes = await dep.reranker.noter(requete, textes.slice(debut, debut + taille), { budgetMs, demarrer: false, activite: { operation: 'injection' } }).catch(() => null);
			// sans réponse (modèle arrêté, budget dépassé) : les morceaux suivants ne répondraient pas mieux
			if (notes === null || notes.length !== taille) break;
			for (const [i, n] of notes.entries()) logits.set(soumises[debut + i]!, n);
		}
	}
	if (coupe()) return sansAffinage();
	if (logits.size === duHook && vecteur === null) return sansAffinage();
	etape({ nom: 'note' });
	const rangHook = new Map(d.classement.map((l, i) => [l.chemin, i + 1]));
	// la note recalculée avec les logits (et le sens, s'il manquait au hook) ; sans note apprise, l'ordre provisoire
	const note = noterLeClassement(
		lignes.map((l) => ({ ...l, logit: logits.get(l.chemin) ?? null })),
		modeles,
		aprioriConnu,
	);
	const ordre = note.parNote ? note.lignes : ordreAffine(lignes, logits);
	const affine = classementDuJournal(ordre).map((c) => ({ ...c, rangHook: rangHook.get(c.id) ?? c.rang }));
	if (!(await ecrire(affine, 'fait', { sens: vecteur !== null, calibree: note.calibree }))) {
		await diffuser();
		return null;
	}
	await diffuser();
	return { classement: affine, vecteur };
}
