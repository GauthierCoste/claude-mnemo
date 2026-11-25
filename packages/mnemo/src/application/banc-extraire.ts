/**
 * Banc du contexte : extraction des messages à juger (spec classement vivant § 6.1). De vrais messages porteurs du journal
 * des sessions, variés et dédoublonnés, chacun avec sa session, son rang et la liste figée des fiches à juger : l'union des
 * premières selon le sens, les mots et le reranker, pour chaque variante de requête, plus deux fiches tirées hors de cette
 * pile (mesure du biais).
 */
import { PROFIL_ARCHIVISTE } from '@mnemo/commun';
import { empreinte } from '../domaine/empreinte.ts';
import { choisirMessages, cleDeMessage, entrelacer } from '../domaine/echantillon-banc.ts';
import type { MessageDuJournal } from '../domaine/echantillon-banc.ts';
import { raisonDeMutisme } from '../domaine/message-muet.ts';
import type { IdentiteDesModeles } from '../domaine/modele-de-note.ts';
import type { InjectionManuelle } from '../domaine/signal-injection.ts';
import { designe } from './banc-contexte.ts';
import type { CandidateAJuger, CasContexte, Jugement, VarianteRequete } from './banc-contexte.ts';
import { aprioriDuMessage, candidatesDuBanc, chargerMemoireDuBanc, LISTES_DU_BANC, modelesDisponibles, presentationDe, signauxDuMessage } from './banc-signaux.ts';
import type { GestesDuBanc, ListeDuBanc, MemoireDuBanc, Signaux } from './banc-signaux.ts';
import { ficheDePosition } from './chercher.ts';
import type { Dependances, EntreeServie } from './ports.ts';

/** Entrées lues par session : tout le journal gardé (200 entrées au plus). */
const ENTREES_PAR_SESSION = 200;
/** Fiches tirées hors de la pile, par message. */
export const HORS_PILE = 2;

/**
 * La requête jointe d'un message (spec § 3.2) : le message joint au message porteur d'avant s'il est court ou anaphorique ;
 * null : la variante jointe est la même que le message seul. Règle provisoire (`domaine/requete-jointe-provisoire.ts`), remplacée
 * par celle de T4 (`domaine/requete-du-message.ts`).
 */
export type RequeteJointe = (message: string, precedent: string | null) => string | null;

/** Ce que le banc lit d'une session et de son journal. */
export type SessionDuJournal = { id: string; profil: string; dossier: string; position: string };
export type EntreeDuJournal = Pick<EntreeServie, 'moment' | 'horodatageMs' | 'demande' | 'muet' | 'position' | 'ids'>;
/**
 * Lecture du journal des sessions, **sans jamais l'écrire ni le migrer** : la base est celle du service en marche, peut-être
 * d'une autre version de Mnemo (`infra/journal-en-lecture.ts`).
 */
export type LectureDuJournal = {
	/** Toutes les sessions connues, terminées comprises. */
	sessions(): Promise<SessionDuJournal[]>;
	session(id: string): Promise<SessionDuJournal | null>;
	/** Les `limite` dernières entrées `message` de la session (muettes comprises), les plus récentes d'abord. */
	messages(session: string, limite: number): Promise<EntreeDuJournal[]>;
};

/**
 * Un message à extraire : celui du journal, avec les fiches injectées entières dans la session avant lui (ou à lui), telles que
 * le journal les donne (fiche de position comprise, retirée à l'extraction) et leur âge en messages porteurs ; ou, pour un cas
 * déjà extrait (`--completer`), ses injections à la main déjà établies.
 */
export type MessageAExtraire = MessageDuJournal & {
	injectionsDuJournal?: { chemin: string; messages: number; position: string | null }[];
	injectees?: InjectionManuelle[];
	/** `--completer` : les candidates déjà au fichier, dont les signaux sont recalculés avec les modèles installés. */
	connues?: string[];
};

/**
 * Les messages porteurs (non muets, avec un texte) du journal, de toutes les sessions connues (terminées comprises, hors
 * archiviste), ou de la seule `session`. Chacun avec son rang parmi les messages porteurs de sa session, sa position, son
 * groupe (dossier de la session), le message porteur d'avant et les fiches injectées entières avant lui (`servis.ids`, horodatés :
 * la table des injections à la main n'en garde que le dernier état, sans date ; un /clear n'y est pas vu).
 */
export async function messagesDuJournal(journal: LectureDuJournal, session?: string): Promise<MessageAExtraire[]> {
	const sessions =
		session === undefined
			? (await journal.sessions()).filter((s) => s.profil !== PROFIL_ARCHIVISTE)
			: await journal.session(session).then((s) => (s === null ? [] : [s]));
	if (session !== undefined && sessions.length === 0) throw new Error(`Session inconnue : ${session}`);
	const messages: MessageAExtraire[] = [];
	for (const s of sessions) {
		const entrees = (await journal.messages(s.id, ENTREES_PAR_SESSION)).filter((e) => e.moment === 'message').sort((a, b) => a.horodatageMs - b.horodatageMs);
		const porteuse = (e: EntreeDuJournal) => e.muet === null && e.demande !== null && e.demande.trim() !== '' && raisonDeMutisme(e.demande) === null;
		const porteurs = entrees.filter(porteuse);
		porteurs.forEach((e, i) => {
			// âge d'une injection : messages porteurs venus après elle, jusqu'à celui-ci compris (0 : injectée à ce message)
			const injectionsDuJournal = entrees
				.filter((x) => x.horodatageMs <= e.horodatageMs)
				.flatMap((x) => {
					const messagesDepuis = porteurs.filter((p) => p.horodatageMs > x.horodatageMs && p.horodatageMs <= e.horodatageMs).length;
					return x.ids.map((chemin) => ({ chemin, messages: messagesDepuis, position: x.position }));
				});
			messages.push({
				session: s.id,
				groupe: s.dossier,
				rang: i + 1,
				horodatageMs: e.horodatageMs,
				message: e.demande!,
				position: e.position ?? s.position,
				precedent: i === 0 ? null : porteurs[i - 1]!.demande,
				injectionsDuJournal,
			});
		});
	}
	return messages;
}

/** Injections à la main avant le message : les fiches injectées entières, sauf la fiche de position de leur entrée ; l'âge le plus jeune. */
async function injecteesDe(dep: Dependances, m: MessageAExtraire): Promise<InjectionManuelle[]> {
	if (m.injectees !== undefined) return m.injectees;
	const ages = new Map<string, number>();
	const fichesDePosition = new Map<string, string | null>();
	for (const i of m.injectionsDuJournal ?? []) {
		const position = i.position ?? m.position;
		if (!fichesDePosition.has(position)) fichesDePosition.set(position, position.trim() === '' ? null : await ficheDePosition(dep, position));
		if (fichesDePosition.get(position) === i.chemin) continue;
		ages.set(i.chemin, Math.min(i.messages, ages.get(i.chemin) ?? Infinity));
	}
	return [...ages].sort((a, b) => a[1] - b[1] || (a[0] < b[0] ? -1 : 1)).map(([chemin, messages]) => ({ chemin, messages }));
}

export type OptionsExtraction = {
	/** Premières de chaque liste mises en commun (10 par défaut). */
	premieres?: number;
	requeteJointe?: RequeteJointe;
	/** Lancer les modèles s'ils ne tournent pas (vrai par défaut). */
	demarrer?: boolean;
	/** Modèles disponibles (sinon : demandés aux modèles au début). */
	disponibles?: { sens: boolean; reranker: boolean };
	/** Après chaque message : messages traités, total. */
	avancement?: (faits: number, total: number) => void;
	/** Gestes lus dans l'état (a priori, écartées toujours) ; absent : a priori 0, aucune écartée toujours. */
	gestes?: GestesDuBanc;
	/** Identité des modèles installés (GGUF), enregistrée dans chaque cas pour les modèles qui ont répondu. */
	gguf?: IdentiteDesModeles;
};
/**
 * `sansCandidate` : messages sans aucune fiche candidate ; `sansModele` : messages laissés parce qu'un modèle disponible n'a pas
 * répondu (repris à la prochaine extraction) ; `modeles` : les modèles disponibles.
 */
export type BilanExtraction = { cas: CasContexte[]; sansCandidate: number; sansModele: number; modeles: { sens: boolean; reranker: boolean } };

/** Fiches hors pile : tirées au hasard, de façon stable (empreinte du message et du chemin), parmi les candidates hors de l'union. */
function horsPile(message: string, pool: readonly string[], pile: ReadonlySet<string>): string[] {
	return pool
		.filter((c) => !pile.has(c))
		.map((c) => ({ c, k: empreinte(`${message}\n${c}`) }))
		.sort((a, b) => (a.k < b.k ? -1 : a.k > b.k ? 1 : 0))
		.slice(0, HORS_PILE)
		.map(({ c }) => c);
}

/** Une candidate à juger : présentation, listes, signaux et empreinte de la fiche. */
function candidate(memoire: MemoireDuBanc, chemin: string, listes: ListeDuBanc[], signaux: Partial<Record<VarianteRequete, Signaux>>, horsDeLaPile: boolean): CandidateAJuger {
	const e = memoire.empreinteDe.get(chemin);
	return { chemin, ...presentationDe(memoire, chemin), listes, signaux, ...(e === undefined ? {} : { empreinte: e }), ...(horsDeLaPile ? { horsPile: true } : {}) };
}

/**
 * Un cas à juger par message : les candidates figées (union des têtes du sens, des mots et du reranker, pour le message seul
 * et, si elle diffère, pour la requête jointe, plus deux fiches hors pile), présentées par leur titre et la première ligne de
 * leur synthèse, avec leurs signaux bruts et leur empreinte. L'index est lu tel qu'il est, jamais synchronisé ni vectorisé :
 * celui du service en marche, qu'une autre version de Mnemo ne doit pas écrire. Un message sans aucune candidate, ou dont un
 * modèle disponible n'a pas répondu, n'est pas gardé (compté).
 */
export async function extraireJugements(dep: Dependances, messages: readonly MessageAExtraire[], options: OptionsExtraction = {}): Promise<BilanExtraction> {
	const demarrer = options.demarrer ?? true;
	const memoire = await chargerMemoireDuBanc(dep);
	const disponibles = options.disponibles ?? (messages.length === 0 ? { sens: false, reranker: false } : await modelesDisponibles(dep, demarrer));
	const extraitLe = dep.systeme.maintenant().toISOString();
	const cas: CasContexte[] = [];
	let sansCandidate = 0;
	let sansModele = 0;
	for (const [i, m] of messages.entries()) {
		options.avancement?.(i + 1, messages.length);
		const injectees = await injecteesDe(dep, m);
		const pool = await candidatesDuBanc(dep, memoire, m.position, m.message, injectees, options.gestes?.ecarteesToujours);
		const aprioris = aprioriDuMessage(options.gestes, m, dep.sens.modele());
		const requetes: [VarianteRequete, string][] = [['seule', m.message]];
		const jointe = options.requeteJointe?.(m.message, m.precedent) ?? null;
		if (jointe !== null && jointe !== m.message) requetes.push(['jointe', jointe]);
		const listesDe = new Map<string, Set<ListeDuBanc>>();
		const signauxDe = new Map<string, Partial<Record<VarianteRequete, Signaux>>>();
		const repondu = { sens: true, reranker: true };
		for (const [variante, requete] of requetes) {
			const s = await signauxDuMessage(dep, memoire, requete, pool, {
				...(options.premieres === undefined ? {} : { premieres: options.premieres }),
				demarrer,
				injectees,
				...(aprioris === undefined ? {} : { aprioris }),
			});
			repondu.sens &&= s.modeles.sens;
			repondu.reranker &&= s.modeles.reranker;
			for (const liste of LISTES_DU_BANC) for (const c of s.tetes[liste]) listesDe.set(c, (listesDe.get(c) ?? new Set()).add(liste));
			for (const [c, signaux] of s.signaux) signauxDe.set(c, { ...signauxDe.get(c), [variante]: signaux });
		}
		if ((disponibles.sens && !repondu.sens) || (disponibles.reranker && !repondu.reranker)) {
			sansModele += 1;
			continue;
		}
		// la pile : les têtes des listes, et toute candidate qu'un signal de session ou un a priori désigne (le hook la classe
		// avec ces signaux : elle doit être jugée, pas laissée au hasard du tirage hors pile)
		const designee = (c: string) => Object.values(signauxDe.get(c) ?? {}).some((x) => (x.signalSession ?? 0) > 0 || (x.apriori ?? 0) !== 0);
		const pile = new Set([...listesDe.keys(), ...pool.filter(designee)]);
		const tirees = pile.size === 0 ? [] : horsPile(m.message, pool, pile);
		// --completer : les candidates déjà au fichier reçoivent leurs signaux recalculés (les autres champs restent ceux du fichier)
		const connues = (m.connues ?? []).filter((c) => !pile.has(c) && !tirees.includes(c) && signauxDe.has(c));
		const candidates: CandidateAJuger[] = [
			...[...pile].sort().map((chemin) => candidate(memoire, chemin, LISTES_DU_BANC.filter((l) => listesDe.get(chemin)?.has(l) === true), signauxDe.get(chemin) ?? {}, false)),
			...tirees.map((chemin) => candidate(memoire, chemin, [], signauxDe.get(chemin) ?? {}, true)),
			...connues.map((chemin) => candidate(memoire, chemin, [], signauxDe.get(chemin)!, false)),
		];
		if (candidates.length === 0) {
			sansCandidate += 1;
			continue;
		}
		cas.push({
			nom: `${m.session.slice(0, 8)} #${m.rang}`,
			position: m.position,
			message: m.message,
			premier: m.rang === 1,
			attendues: [],
			interdites: [],
			silence: false,
			session: m.session,
			rang: m.rang,
			horodatageMs: m.horodatageMs,
			extraitLe,
			precedent: m.precedent,
			modeles: { sens: disponibles.sens && repondu.sens, reranker: disponibles.reranker && repondu.reranker },
			...(options.gguf === undefined
				? {}
				: { gguf: { sens: disponibles.sens && repondu.sens ? options.gguf.sens : null, reranker: disponibles.reranker && repondu.reranker ? options.gguf.reranker : null } }),
			...(injectees.length === 0 ? {} : { injectionsManuelles: injectees }),
			candidates,
			jugements: {},
		});
	}
	return { cas, sansCandidate, sansModele, modeles: disponibles };
}

/**
 * Les messages à extraire : variés et nouveaux (un message déjà au fichier, même texte, n'est pas repris), dans un ordre qui
 * alterne premiers messages et suites (un arrêt en route laisse un échantillon équilibré). `nouveaux` : messages du journal
 * encore inconnus du fichier (de quoi dire pourquoi il y en a moins que demandé).
 */
export function messagesAExtraire(
	messages: readonly MessageAExtraire[],
	existants: readonly CasContexte[],
	options: { nombre: number; parSession: number },
): { choisis: MessageAExtraire[]; nouveaux: number } {
	const connus = new Set(existants.map((c) => cleDeMessage(c.message)));
	const nouveaux = new Set(messages.map((m) => cleDeMessage(m.message)).filter((k) => !connus.has(k))).size;
	return { choisis: entrelacer(choisirMessages(messages, { ...options, connus })), nouveaux };
}

/** Les cas déjà extraits, en messages à extraire de nouveau (`--completer`) : mêmes session, rang, position, injections. */
export function messagesDesCas(cas: readonly CasContexte[]): MessageAExtraire[] {
	return cas
		.filter((c) => c.candidates !== undefined && c.saute !== true)
		.map((c) => ({
			session: c.session ?? c.nom,
			groupe: '',
			rang: c.rang ?? (c.premier ? 1 : 2),
			horodatageMs: c.horodatageMs ?? 0,
			message: c.message,
			position: c.position,
			precedent: c.precedent ?? null,
			injectees: c.injectionsManuelles ?? [],
			connues: (c.candidates ?? []).map((x) => x.chemin),
		}));
}

/**
 * Ajoute les cas extraits aux cas existants. Un cas déjà connu (même position, même message) garde ses jugements et reçoit
 * les candidates qui lui manquent (pas de nouvelles fiches hors pile s'il en a déjà), et sa session, son rang, son horodatage
 * s'il ne les avait pas ; s'il était étiqueté à la main, ses `attendues` deviennent pertinentes, ses `interdites` non
 * pertinentes, et tout est non pertinent dans un cas `silence`. Un extrait qui porte une identité des modèles (GGUF) autre
 * que celle du cas connu lui donne ses signaux recalculés (par chemin) et son identité : ses jugements restent.
 */
export function fusionnerCas(existants: readonly CasContexte[], extraits: readonly CasContexte[]): { cas: CasContexte[]; ajoutes: number; completes: number; fichesAjoutees: number } {
	const cle = (c: CasContexte) => JSON.stringify([c.position, c.message]);
	const parCle = new Map<string, CasContexte>();
	const cas = existants.map((c) => {
		const copie = { ...c };
		if (!parCle.has(cle(c))) parCle.set(cle(c), copie);
		return copie;
	});
	let ajoutes = 0;
	let completes = 0;
	let fichesAjoutees = 0;
	for (const e of extraits) {
		const connu = parCle.get(cle(e));
		if (connu === undefined) {
			const nouveau = { ...e };
			parCle.set(cle(e), nouveau);
			cas.push(nouveau);
			ajoutes += 1;
			continue;
		}
		const presentes = new Set((connu.candidates ?? []).map((c) => c.chemin));
		const aDejaHorsPile = (connu.candidates ?? []).some((c) => c.horsPile === true);
		const manquantes = (e.candidates ?? []).filter((c) => !presentes.has(c.chemin) && !(c.horsPile === true && aDejaHorsPile));
		const recalcule = e.gguf !== undefined && connu.candidates !== undefined && JSON.stringify(connu.gguf) !== JSON.stringify(e.gguf);
		if (recalcule) {
			const signauxDe = new Map((e.candidates ?? []).map((c) => [c.chemin, c.signaux]));
			Object.assign(connu, { gguf: e.gguf, candidates: connu.candidates!.map((c) => (signauxDe.has(c.chemin) ? { ...c, signaux: signauxDe.get(c.chemin)! } : c)) });
		}
		if (manquantes.length === 0 && connu.candidates !== undefined) {
			if (recalcule) completes += 1;
			continue;
		}
		const jugements: Record<string, Jugement> = { ...connu.jugements };
		for (const { chemin } of manquantes) {
			if (jugements[chemin] !== undefined) continue;
			if (connu.silence || connu.interdites.some((n) => designe(n, chemin))) jugements[chemin] = 'non_pertinente';
			else if (connu.attendues.some((n) => designe(n, chemin))) jugements[chemin] = 'pertinente';
		}
		Object.assign(connu, {
			candidates: [...(connu.candidates ?? []), ...manquantes],
			jugements,
			...(connu.session === undefined && e.session !== undefined ? { session: e.session, rang: e.rang, precedent: e.precedent ?? null } : {}),
			...(connu.horodatageMs === undefined && e.horodatageMs !== undefined ? { horodatageMs: e.horodatageMs } : {}),
			...(connu.extraitLe === undefined && e.extraitLe !== undefined ? { extraitLe: e.extraitLe } : {}),
			...(connu.modeles === undefined && e.modeles !== undefined ? { modeles: e.modeles } : {}),
			...(connu.injectionsManuelles === undefined && e.injectionsManuelles !== undefined ? { injectionsManuelles: e.injectionsManuelles } : {}),
		});
		completes += 1;
		fichesAjoutees += manquantes.length;
	}
	return { cas, ajoutes, completes, fichesAjoutees };
}
