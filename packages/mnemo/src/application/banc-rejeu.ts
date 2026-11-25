/**
 * Banc du contexte : rejeu des messages jugés, par niveau des modèles et pour chaque variante de requête (spec classement
 * vivant § 6.1). Rend les paires jugées avec leurs signaux bruts (données de l'apprentissage, T8) et les mesures.
 *
 * Ordre de chaque niveau, tant qu'aucune note n'est apprise : Complets, le logit du reranker (les fiches qu'il a notées
 * d'abord), puis le cosinus relatif ; Sens seul, le cosinus relatif, puis le bm25 relatif ; Coupés, le bm25 relatif.
 *
 * À brancher :
 * - après T3/T4 : le classement par le vrai chemin (hook puis affinage) au lieu de `classeurDesSignaux`, la durée au hook
 *   (p50, p95) et la part des messages où le reranker a tenu au hook ; la variante jointe (`RequeteJointe`, T4) ;
 * - après T8/T9 : la note `p` (`NoteDuBanc`), d'où la précision au-dessus du seuil, la borne de Wilson, l'ECE, la part des
 *   messages silence avec une injection et les courbes de seuils (calculées ici dès qu'une note est donnée).
 */
import { ece, intervalleWilson, tableDeFiabilite } from '../domaine/mesures-banc.ts';
import type { TrancheFiabilite } from '../domaine/mesures-banc.ts';
import type { CasContexte, VarianteRequete } from './banc-contexte.ts';
import type { RequeteJointe } from './banc-extraire.ts';
import { aprioriDuMessage, candidatesDuBanc, chargerMemoireDuBanc, signauxDuMessage } from './banc-signaux.ts';
import type { GestesDuBanc, Signaux } from './banc-signaux.ts';
import type { Dependances } from './ports.ts';

export type NiveauBanc = 'complets' | 'sens' | 'ordre';
export const NIVEAUX_DU_BANC: readonly NiveauBanc[] = ['complets', 'sens', 'ordre'];
export const VARIANTES: readonly VarianteRequete[] = ['seule', 'jointe'];

/** Une paire jugée (indécises exclues) : le message (cas, session, rang), la fiche, le jugement et ses signaux bruts. */
export type PaireJugee = {
	cas: string;
	session: string;
	rang: number | null;
	variante: VarianteRequete;
	chemin: string;
	pertinente: boolean;
	silence: boolean;
	/** Vrai : fiche tirée hors de la pile (mesure du biais). */
	horsPile: boolean;
	signaux: Signaux;
};

/** Ordre des fiches d'un message pour un niveau ; null : le niveau ne peut pas classer ce message (modèle absent). */
export type Classeur = (niveau: NiveauBanc, signaux: ReadonlyMap<string, Signaux>) => string[] | null;
/** La note `p` d'une fiche pour un niveau (T9) ; null : pas de note (modèle non accepté, variable absente). */
export type NoteDuBanc = (niveau: NiveauBanc, signaux: Signaux) => number | null;

const decroissant = (valeur: (s: Signaux) => number | null) => (a: [string, Signaux], b: [string, Signaux]) =>
	(valeur(b[1]) ?? -Infinity) - (valeur(a[1]) ?? -Infinity) || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);

/** L'ordre provisoire de chaque niveau, tiré des signaux bruts (à remplacer par le vrai chemin après T3/T4). */
export const classeurDesSignaux: Classeur = (niveau, signaux) => {
	const lignes = [...signaux];
	if (niveau === 'ordre') return lignes.sort(decroissant((s) => s.bm25Relatif)).map(([c]) => c);
	if (niveau === 'sens') {
		if (!lignes.some(([, s]) => s.cosinusRelatif !== null)) return null;
		return lignes.sort((a, b) => decroissant((s) => s.cosinusRelatif)(a, b) || decroissant((s) => s.bm25Relatif)(a, b)).map(([c]) => c);
	}
	const notees = lignes.filter(([, s]) => s.logit !== null);
	if (notees.length === 0) return null;
	const autres = lignes.filter(([, s]) => s.logit === null).sort(decroissant((s) => s.cosinusRelatif));
	return [...notees.sort(decroissant((s) => s.logit)), ...autres].map(([c]) => c);
};

/**
 * Mesures d'une note `p` à un seuil d'injection (spec § 4.3). Les injections simulées prennent les fiches les mieux notées,
 * jugées ou non : `injectionsNonJugees` les compte ; `precision` est observée sur les seules jugées, `precisionPessimiste`
 * compte les non jugées comme fausses.
 */
export type MesuresAuSeuil = {
	seuil: number;
	injections: number;
	justes: number;
	injectionsNonJugees: number;
	precision: number | null;
	precisionPessimiste: number | null;
	wilsonBasse: number;
	wilsonBassePessimiste: number;
	sessions: number;
	injectionsParMessage: number;
	silencesAvecInjection: number;
};
export type MesuresDeNote = {
	auSeuil: MesuresAuSeuil;
	ece: number | null;
	fiabilite: TrancheFiabilite[];
	courbeInjection: MesuresAuSeuil[];
	/** Seuil des pistes → pistes par message, part de pertinentes parmi elles (observée et pessimiste), rappel. */
	courbePistes: { seuil: number; pistes: number; pistesNonJugees: number; precision: number | null; precisionPessimiste: number | null; rappel: number | null }[];
};
export type MesuresNiveau = {
	niveau: NiveauBanc;
	variante: VarianteRequete;
	/** Messages rejoués que ce niveau a pu classer (modèle présent), sessions d'où ils viennent, messages silence parmi eux. */
	messages: number;
	sessions: number;
	silences: number;
	pertinentes: number;
	nonPertinentes: number;
	/** Pertinentes dans les 10 premières de l'ordre, sur toutes les pertinentes (rappel du panneau). */
	rappel10: number | null;
	/** Pertinentes dans les `pistesParMessage` premières (3), sur toutes les pertinentes ; précision des mêmes (jugées seules). */
	rappelPistes: number | null;
	precisionPistes: number | null;
	/** Fiches non jugées parmi les 10 premières (fiches ajoutées et pas encore jugées, ou recalcul). */
	nonJugeesEnTete: number;
	/** Null tant qu'aucune note n'est donnée (à brancher après T8/T9). */
	note: MesuresDeNote | null;
};
/** Part de pertinentes parmi les fiches jugées de la pile et parmi celles tirées hors pile (biais de la mise en commun). */
export type BiaisDeLaPile = { pile: { jugees: number; pertinentes: number }; horsPile: { jugees: number; pertinentes: number } };
export type RejeuJugements = {
	paires: PaireJugee[];
	indecises: number;
	messagesJuges: number;
	sessions: number;
	mesures: MesuresNiveau[];
	biais: BiaisDeLaPile;
	/** Fiches jugées dont l'empreinte a changé depuis l'extraction (ou disparues) ; exclues des paires sauf `empreintes: 'garder'`. */
	empreintesChangees: { cas: string; chemin: string }[];
	modeles: { sens: boolean; reranker: boolean } | null;
	aBrancher: string[];
};

export type OptionsRejeu = {
	/** Recalculer les signaux avec les modèles (sinon : ceux de l'extraction). */
	recalculer?: boolean;
	demarrer?: boolean;
	requeteJointe?: RequeteJointe;
	classeur?: Classeur;
	note?: NoteDuBanc;
	/** Jugement d'une fiche changée depuis l'extraction : exclu (défaut) ou gardé. */
	empreintes?: 'exclure' | 'garder';
	/** Réglages du banc : seuils en probabilité, plafonds (défauts de la spec § 5). */
	seuilInjection?: number;
	injectionsParMessage?: number;
	pistesParMessage?: number;
	avancement?: (faits: number, total: number) => void;
	/** Au recalcul : gestes lus dans l'état (a priori, écartées toujours) ; absent : a priori 0, aucune écartée toujours. */
	gestes?: GestesDuBanc;
};

/**
 * Un message rejoué : ses jugements (indécises exclues), ses signaux par variante, s'il est silence (marqué, ou jugé tout
 * entier sans aucune fiche pertinente ni indécise) et ses fiches hors pile.
 */
export type MessageRejoue = {
	cas: CasContexte;
	jugements: Map<string, boolean>;
	signaux: Partial<Record<VarianteRequete, Map<string, Signaux>>>;
	silence: boolean;
	horsPile: ReadonlySet<string>;
};

const part = (n: number, d: number): number | null => (d === 0 ? null : n / d);
const SEUILS_INJECTION = [0.7, 0.75, 0.8, 0.85, 0.9, 0.95, 1];
const SEUILS_PISTE = [0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9];

/** Signaux enregistrés à l'extraction, par variante. */
function signauxEnregistres(c: CasContexte): Partial<Record<VarianteRequete, Map<string, Signaux>>> {
	const resultat: Partial<Record<VarianteRequete, Map<string, Signaux>>> = {};
	for (const variante of VARIANTES) {
		const lignes = (c.candidates ?? []).flatMap((x) => (x.signaux[variante] === undefined ? [] : [[x.chemin, x.signaux[variante]] as [string, Signaux]]));
		if (lignes.length > 0) resultat[variante] = new Map(lignes);
	}
	return resultat;
}

type MessageNote = { session: string; silence: boolean; notes: { p: number; pertinente: boolean | undefined }[] };

function mesurerNote(messages: readonly MessageNote[], o: Required<Pick<OptionsRejeu, 'seuilInjection' | 'injectionsParMessage' | 'pistesParMessage'>>): MesuresDeNote {
	const auSeuil = (seuil: number): MesuresAuSeuil => {
		let injections = 0;
		let justes = 0;
		let nonJugees = 0;
		let silencesAvecInjection = 0;
		const sessions = new Set<string>();
		for (const m of messages) {
			// les fiches non jugées restent parmi les injections : les écarter flatterait la précision
			const injectees = m.notes.filter((n) => n.p >= seuil).slice(0, o.injectionsParMessage);
			injections += injectees.length;
			justes += injectees.filter((n) => n.pertinente === true).length;
			nonJugees += injectees.filter((n) => n.pertinente === undefined).length;
			if (injectees.length > 0) sessions.add(m.session);
			if (m.silence && injectees.length > 0) silencesAvecInjection += 1;
		}
		return {
			seuil,
			injections,
			justes,
			injectionsNonJugees: nonJugees,
			precision: part(justes, injections - nonJugees),
			precisionPessimiste: part(justes, injections),
			wilsonBasse: intervalleWilson(justes, injections - nonJugees).basse,
			wilsonBassePessimiste: intervalleWilson(justes, injections).basse,
			sessions: sessions.size,
			injectionsParMessage: messages.length === 0 ? 0 : injections / messages.length,
			silencesAvecInjection,
		};
	};
	const paires = messages.flatMap((m) => m.notes.flatMap((n) => (n.pertinente === undefined ? [] : [{ p: n.p, pertinente: n.pertinente }])));
	const totalPertinentes = paires.filter((x) => x.pertinente).length;
	return {
		auSeuil: auSeuil(o.seuilInjection),
		ece: ece(paires),
		fiabilite: tableDeFiabilite(paires),
		courbeInjection: SEUILS_INJECTION.map(auSeuil),
		courbePistes: SEUILS_PISTE.map((seuil) => {
			const pistes = messages.flatMap((m) => m.notes.filter((n) => n.p >= seuil).slice(0, o.pistesParMessage));
			const justes = pistes.filter((n) => n.pertinente === true).length;
			const nonJugees = pistes.filter((n) => n.pertinente === undefined).length;
			return {
				seuil,
				pistes: messages.length === 0 ? 0 : pistes.length / messages.length,
				pistesNonJugees: nonJugees,
				precision: part(justes, pistes.length - nonJugees),
				precisionPessimiste: part(justes, pistes.length),
				rappel: part(justes, totalPertinentes),
			};
		}),
	};
}

/** Mesures et paires d'après des messages rejoués et leurs signaux (sans modèle ni index). */
export function mesurerJugements(messages: readonly MessageRejoue[], options: OptionsRejeu = {}): Omit<RejeuJugements, 'modeles' | 'aBrancher' | 'indecises' | 'empreintesChangees'> {
	const classeur = options.classeur ?? classeurDesSignaux;
	const o = { seuilInjection: options.seuilInjection ?? 0.9, injectionsParMessage: options.injectionsParMessage ?? 2, pistesParMessage: options.pistesParMessage ?? 3 };
	const paires: PaireJugee[] = [];
	const biais: BiaisDeLaPile = { pile: { jugees: 0, pertinentes: 0 }, horsPile: { jugees: 0, pertinentes: 0 } };
	for (const m of messages) {
		for (const [chemin, pertinente] of m.jugements) {
			const compte = m.horsPile.has(chemin) ? biais.horsPile : biais.pile;
			compte.jugees += 1;
			if (pertinente) compte.pertinentes += 1;
		}
		for (const variante of VARIANTES) {
			for (const [chemin, signaux] of m.signaux[variante] ?? []) {
				const pertinente = m.jugements.get(chemin);
				if (pertinente === undefined) continue;
				paires.push({
					cas: m.cas.nom,
					session: m.cas.session ?? m.cas.nom,
					rang: m.cas.rang ?? null,
					variante,
					chemin,
					pertinente,
					silence: m.silence,
					horsPile: m.horsPile.has(chemin),
					signaux,
				});
			}
		}
	}
	const mesures: MesuresNiveau[] = [];
	for (const variante of VARIANTES) {
		const avecVariante = messages.filter((m) => m.signaux[variante] !== undefined);
		if (avecVariante.length === 0) continue;
		for (const niveau of NIVEAUX_DU_BANC) {
			const classes = avecVariante.flatMap((m) => {
				const ordre = classeur(niveau, m.signaux[variante]!);
				return ordre === null ? [] : [{ m, ordre }];
			});
			let pertinentes = 0;
			let nonPertinentes = 0;
			let dans10 = 0;
			let dansPistes = 0;
			let jugeesPistes = 0;
			let nonJugeesEnTete = 0;
			for (const { m, ordre } of classes) {
				for (const [chemin, p] of m.jugements) {
					if (!m.signaux[variante]!.has(chemin)) continue;
					if (p) pertinentes += 1;
					else nonPertinentes += 1;
				}
				const tete = ordre.slice(0, 10);
				dans10 += tete.filter((c) => m.jugements.get(c) === true).length;
				nonJugeesEnTete += tete.filter((c) => !m.jugements.has(c) && m.cas.jugements?.[c] !== 'indecise').length;
				const pistes = ordre.slice(0, o.pistesParMessage);
				dansPistes += pistes.filter((c) => m.jugements.get(c) === true).length;
				jugeesPistes += pistes.filter((c) => m.jugements.has(c)).length;
			}
			let note: MesuresDeNote | null = null;
			if (options.note !== undefined) {
				const noter = options.note;
				const notes: MessageNote[] = classes.map(({ m }) => ({
					session: m.cas.session ?? m.cas.nom,
					silence: m.silence,
					notes: [...m.signaux[variante]!]
						// une indécise n'est ni juste ni fausse : hors des injections simulées
						.filter(([chemin]) => m.cas.jugements?.[chemin] !== 'indecise')
						.flatMap(([chemin, s]) => {
							const p = noter(niveau, s);
							return p === null ? [] : [{ p, pertinente: m.jugements.get(chemin) }];
						})
						.sort((a, b) => b.p - a.p),
				}));
				if (notes.some((n) => n.notes.length > 0)) note = mesurerNote(notes, o);
			}
			mesures.push({
				niveau,
				variante,
				messages: classes.length,
				sessions: new Set(classes.map(({ m }) => m.cas.session ?? m.cas.nom)).size,
				silences: classes.filter(({ m }) => m.silence).length,
				pertinentes,
				nonPertinentes,
				rappel10: part(dans10, pertinentes),
				rappelPistes: part(dansPistes, pertinentes),
				precisionPistes: part(dansPistes, jugeesPistes),
				nonJugeesEnTete,
				note,
			});
		}
	}
	return { paires, messagesJuges: messages.length, sessions: new Set(messages.map((m) => m.cas.session ?? m.cas.nom)).size, mesures, biais };
}

/** Un message se rejoue s'il a des candidates, n'est pas sauté, et porte au moins un jugement (ou est marqué silence). */
const rejouable = (c: CasContexte): boolean =>
	c.candidates !== undefined && c.candidates.length > 0 && c.saute !== true && (c.silence || Object.keys(c.jugements ?? {}).length > 0);

/** Silence : marqué, ou toutes les fiches jugées sans aucune pertinente ni indécise. */
const estSilence = (c: CasContexte): boolean => {
	if (c.silence) return true;
	const jugements = c.jugements ?? {};
	return (c.candidates ?? []).every((x) => jugements[x.chemin] === 'non_pertinente');
};

/**
 * Rejoue les messages jugés, même en partie (non sautés) : signaux de l'extraction, ou recalculés avec les modèles
 * (`recalculer`, sur l'index tel qu'il est, jamais synchronisé), puis paires et mesures par niveau et variante. Les indécises
 * sont exclues des paires, et comptées. Une fiche dont l'empreinte a changé depuis l'extraction est signalée, et son jugement
 * exclu (sauf `empreintes: 'garder'`).
 */
export async function rejouerJugements(dep: Dependances, cas: readonly CasContexte[], options: OptionsRejeu = {}): Promise<RejeuJugements> {
	const retenus = cas.filter(rejouable);
	const indecises = retenus.reduce((n, c) => n + Object.values(c.jugements ?? {}).filter((j) => j === 'indecise').length, 0);
	const empreinteDe = new Map((await dep.index.fiches()).map((f) => [f.chemin, f.empreinte]));
	const empreintesChangees: RejeuJugements['empreintesChangees'] = [];
	const jugementsDe = (c: CasContexte) => {
		const changees = new Set(
			(c.candidates ?? [])
				.filter((x) => x.empreinte !== undefined && c.jugements?.[x.chemin] !== undefined && empreinteDe.get(x.chemin) !== x.empreinte)
				.map((x) => x.chemin),
		);
		for (const chemin of changees) empreintesChangees.push({ cas: c.nom, chemin });
		const garder = options.empreintes === 'garder';
		return new Map(
			Object.entries(c.jugements ?? {}).flatMap(([chemin, j]) => (j === 'indecise' || (changees.has(chemin) && !garder) ? [] : [[chemin, j === 'pertinente'] as [string, boolean]])),
		);
	};
	const rejoue = (c: CasContexte, signaux: MessageRejoue['signaux']): MessageRejoue => ({
		cas: c,
		jugements: jugementsDe(c),
		signaux,
		silence: estSilence(c),
		horsPile: new Set((c.candidates ?? []).filter((x) => x.horsPile === true).map((x) => x.chemin)),
	});
	let modeles: RejeuJugements['modeles'] = null;
	const messages: MessageRejoue[] = [];
	if (options.recalculer === true) {
		const memoire = await chargerMemoireDuBanc(dep);
		modeles = { sens: false, reranker: false };
		for (const [i, c] of retenus.entries()) {
			const injectees = c.injectionsManuelles ?? [];
			const pool = await candidatesDuBanc(dep, memoire, c.position, c.message, injectees, options.gestes?.ecarteesToujours);
			const aprioris = aprioriDuMessage(options.gestes, c, dep.sens.modele());
			const signaux: MessageRejoue['signaux'] = {};
			const jointe = options.requeteJointe?.(c.message, c.precedent ?? null) ?? null;
			const requetes: [VarianteRequete, string][] = [['seule', c.message], ...(jointe === null || jointe === c.message ? [] : [['jointe', jointe] as [VarianteRequete, string]])];
			for (const [variante, requete] of requetes) {
				const s = await signauxDuMessage(dep, memoire, requete, pool, { demarrer: options.demarrer ?? true, injectees, ...(aprioris === undefined ? {} : { aprioris }) });
				modeles.sens ||= s.modeles.sens;
				modeles.reranker ||= s.modeles.reranker;
				signaux[variante] = s.signaux;
			}
			messages.push(rejoue(c, signaux));
			options.avancement?.(i + 1, retenus.length);
		}
	} else {
		for (const c of retenus) messages.push(rejoue(c, signauxEnregistres(c)));
	}
	const aBrancher = [
		'après T3/T4 : classement par le vrai chemin (hook puis affinage), durée au hook (p50, p95), part des messages où le reranker a tenu au hook',
		options.requeteJointe === undefined ? 'après T4 : variante jointe de la requête (requete-du-message.ts)' : 'après T4 : règle de la requête jointe de T4 au lieu de la règle provisoire',
		...(options.note === undefined ? ['après T8/T9 : note p (précision au-dessus du seuil, Wilson, ECE, silences avec injection, courbes des seuils)'] : []),
	];
	return { ...mesurerJugements(messages, options), indecises, empreintesChangees, modeles, aBrancher };
}
