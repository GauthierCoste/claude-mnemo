/**
 * Pré-jugement du banc du contexte par un juge (spec « entraîner la note », D4) : chaque message à juger qui n'a encore aucune
 * proposition est soumis au juge, deux à la fois, et ses propositions (`prejugements`) sont enregistrées après chaque message.
 * Elles ne comptent qu'une fois validées par l'utilisateur (D1).
 */
import type { MessageAJuger } from '../domaine/consigne-juge.ts';
import type { CasContexte, Prejugement } from './banc-contexte.ts';
import { aJuger, ordreDePresentation } from './banc-juger.ts';

/** Le juge : ses propositions pour les candidates d'un message, par chemin ; rejette s'il n'aboutit pas ou est abandonné. */
export type Juge = { juger(message: MessageAJuger, signal?: AbortSignal): Promise<Record<string, Prejugement>> };

/** Un message à pré-juger : à juger (ni validé, ni sauté, ni silence, une candidate sans jugement) et sans aucune proposition. */
export const aPrejuger = (c: CasContexte): boolean => aJuger(c) && Object.keys(c.prejugements ?? {}).length === 0;

/** Ce que voit le juge d'un message : message, message d'avant, candidates dans l'ordre de présentation mêlé, synthèse courte. */
export function messagePourLeJuge(c: CasContexte, synthese: (chemin: string) => string): MessageAJuger {
	return {
		message: c.message,
		precedent: c.precedent ?? null,
		candidates: ordreDePresentation(c).map((x) => ({ chemin: x.chemin, titre: x.titre, ligne: x.ligne, synthese: synthese(x.chemin) })),
	};
}

/** Même message du banc : même message, position, session et rang (l'indice peut avoir changé entre-temps). */
const memeMessage = (a: CasContexte, b: CasContexte): boolean => a.message === b.message && a.position === b.position && a.session === b.session && a.rang === b.rang;

/**
 * Les cas `cas` (relus du fichier) où le message `cible` reçoit les propositions `prejugements`, et rien d'autre : ses
 * jugements, sa validation et les autres messages restent tels qu'ils sont (un jugement fait entre-temps n'est jamais écrasé).
 * Seules les propositions pour ses candidates sont gardées ; un message disparu entre-temps ne change rien. Copie.
 */
export function fusionnerPrejugements(cas: readonly CasContexte[], cible: CasContexte, prejugements: Readonly<Record<string, Prejugement>>): CasContexte[] {
	return cas.map((c) => {
		if (!memeMessage(c, cible)) return c;
		const chemins = new Set((c.candidates ?? []).map((x) => x.chemin));
		const gardes = Object.fromEntries(Object.entries(prejugements).filter(([chemin]) => chemins.has(chemin)));
		return Object.keys(gardes).length === 0 ? c : { ...c, prejugements: { ...c.prejugements, ...gardes } };
	});
}

/**
 * `juge` ; `synthese` : synthèse courte d'une fiche (vide par défaut) ; `enregistrer` : écrit les propositions d'un message
 * (relit le fichier et fusionne, `fusionnerPrejugements`), appelée un message à la fois ; `concurrence` : appels au juge en même
 * temps (2) ; `nombre` : au plus tant de messages ; `signal` : arrêt (plus aucun message lancé, ceux en cours abandonnés) ;
 * `avancement(faits, total)` au départ (0, s'il y a des messages) puis après chaque message.
 */
export type OptionsPrejuger = {
	juge: Juge;
	enregistrer: (cible: CasContexte, prejugements: Record<string, Prejugement>) => Promise<void>;
	synthese?: (chemin: string) => string;
	concurrence?: number;
	nombre?: number;
	signal?: AbortSignal;
	avancement?: (faits: number, total: number) => void;
};

/** Messages pré-jugés et enregistrés, en échec (le juge ou l'écriture), restants (arrêt) ; motifs des échecs, sans doublon. */
export type BilanPrejuger = { juges: number; echecs: number; restants: number; motifs: string[] };

export const CONCURRENCE_DU_JUGE = 2;

/**
 * Soumet au juge les messages à pré-juger (`aPrejuger`), dans l'ordre du fichier, `concurrence` à la fois, et enregistre les
 * propositions de chacun dès qu'il est jugé. Un échec est compté et n'arrête pas les autres ; un juge qui ne propose rien est
 * un échec. Arrêté (`signal`), ce qui n'est pas fini reste à faire : ni jugé ni en échec.
 */
export async function prejuger(cas: readonly CasContexte[], o: OptionsPrejuger): Promise<BilanPrejuger> {
	const choisis = cas.filter(aPrejuger).slice(0, o.nombre ?? Infinity);
	const total = choisis.length;
	const synthese = o.synthese ?? (() => '');
	const arrete = () => o.signal?.aborted === true;
	let suivant = 0;
	let juges = 0;
	let echecs = 0;
	const motifs = new Set<string>();
	// une écriture à la fois : chacune relit le fichier que la précédente a écrit
	let ecritures: Promise<void> = Promise.resolve();
	const enregistrer = (c: CasContexte, p: Record<string, Prejugement>): Promise<void> => {
		const ecriture = ecritures.then(() => o.enregistrer(c, p));
		ecritures = ecriture.catch(() => {});
		return ecriture;
	};
	const travailleur = async (): Promise<void> => {
		while (!arrete() && suivant < total) {
			const c = choisis[suivant++]!;
			try {
				const propositions = await o.juge.juger(messagePourLeJuge(c, synthese), o.signal);
				if (Object.keys(propositions).length === 0) throw new Error('le juge n\'a rien proposé.');
				await enregistrer(c, propositions);
				juges++;
			} catch (e) {
				// arrêté pendant l'appel : le message reste à faire
				if (arrete()) return;
				echecs++;
				motifs.add(e instanceof Error ? e.message : String(e));
			}
			o.avancement?.(juges + echecs, total);
		}
	};
	if (total > 0) o.avancement?.(0, total);
	const concurrence = Math.max(1, Math.floor(o.concurrence ?? CONCURRENCE_DU_JUGE));
	await Promise.all(Array.from({ length: Math.min(concurrence, total) }, travailleur));
	return { juges, echecs, restants: total - juges - echecs, motifs: [...motifs] };
}
