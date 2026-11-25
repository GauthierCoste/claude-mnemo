/**
 * Banc du contexte : extraction des messages à juger (spec classement vivant § 6.1). De vrais messages porteurs du journal
 * des sessions, variés et dédoublonnés, chacun avec sa session, son rang et la liste figée des fiches à juger : l'union des
 * premières selon le sens, les mots et le reranker, pour chaque variante de requête.
 */
import { PROFIL_ARCHIVISTE } from '@mnemo/commun';
import { choisirMessages, cleDeMessage } from '../domaine/echantillon-banc.ts';
import type { MessageDuJournal } from '../domaine/echantillon-banc.ts';
import { raisonDeMutisme } from '../domaine/message-muet.ts';
import { designe } from './banc-contexte.ts';
import type { CandidateAJuger, CasContexte, Jugement, VarianteRequete } from './banc-contexte.ts';
import { candidatesDuBanc, chargerMemoireDuBanc, LISTES_DU_BANC, presentationDe, signauxDuMessage } from './banc-signaux.ts';
import type { ListeDuBanc, Signaux } from './banc-signaux.ts';
import type { Dependances, EtatSessions } from './ports.ts';
import { SANS_EXTRACTION, synchroniser } from './synchroniser.ts';
import { vectoriser } from './vectoriser.ts';

/** Entrées lues par session : tout le journal gardé (200 entrées au plus). */
const ENTREES_PAR_SESSION = 200;

/**
 * La requête jointe d'un message (spec § 3.2) : le message joint au message porteur d'avant s'il est court ou anaphorique ;
 * null : la variante jointe est la même que le message seul. À brancher après T4 (`domaine/requete-du-message.ts`) : sans
 * elle, le banc ne juge et ne rejoue que la variante `seule`.
 */
export type RequeteJointe = (message: string, precedent: string | null) => string | null;

/**
 * Les messages porteurs (non muets, avec un texte) du journal, de toutes les sessions connues (terminées comprises, hors
 * archiviste), ou de la seule `session`. Chacun avec son rang parmi les messages porteurs de sa session, sa position, son
 * groupe (dossier de la session) et le message porteur d'avant.
 */
export async function messagesDuJournal(etat: EtatSessions, session?: string): Promise<MessageDuJournal[]> {
	const sessions =
		session === undefined
			? (await etat.lister({ archivees: true })).filter((s) => s.profil !== PROFIL_ARCHIVISTE)
			: await etat.lire(session).then((s) => (s === null ? [] : [s]));
	if (session !== undefined && sessions.length === 0) throw new Error(`Session inconnue : ${session}`);
	const messages: MessageDuJournal[] = [];
	for (const s of sessions) {
		const journal = await etat.servis(s.id, ENTREES_PAR_SESSION, 'message');
		const porteurs = journal
			.filter((e) => e.moment === 'message' && e.muet === null && e.demande !== null && e.demande.trim() !== '' && raisonDeMutisme(e.demande) === null)
			.sort((a, b) => a.horodatageMs - b.horodatageMs);
		porteurs.forEach((e, i) => {
			messages.push({
				session: s.id,
				groupe: s.dossier,
				rang: i + 1,
				horodatageMs: e.horodatageMs,
				message: e.demande!,
				position: e.position ?? s.position,
				precedent: i === 0 ? null : porteurs[i - 1]!.demande,
			});
		});
	}
	return messages;
}

export type OptionsExtraction = {
	/** Premières de chaque liste mises en commun (10 par défaut). */
	premieres?: number;
	requeteJointe?: RequeteJointe;
	/** Lancer les modèles s'ils ne tournent pas (vrai par défaut). */
	demarrer?: boolean;
	/** Après chaque message : messages traités, total. */
	avancement?: (faits: number, total: number) => void;
};
export type BilanExtraction = { cas: CasContexte[]; sansCandidate: number; modeles: { sens: boolean; reranker: boolean } };

/**
 * Un cas à juger par message : les candidates figées (union des têtes du sens, des mots et du reranker, pour le message seul
 * et, si elle diffère, pour la requête jointe), présentées par leur titre et la première ligne de leur synthèse, avec leurs
 * signaux bruts. L'index est synchronisé et vectorisé d'abord. Un message sans aucune candidate n'est pas gardé (compté).
 */
export async function extraireJugements(dep: Dependances, messages: readonly MessageDuJournal[], options: OptionsExtraction = {}): Promise<BilanExtraction> {
	const demarrer = options.demarrer ?? true;
	await synchroniser(dep, SANS_EXTRACTION);
	await vectoriser(dep, { budgetMs: Infinity, demarrer, compter: false });
	const memoire = await chargerMemoireDuBanc(dep);
	const cas: CasContexte[] = [];
	let sansCandidate = 0;
	const modeles = { sens: false, reranker: false };
	for (const [i, m] of messages.entries()) {
		const pool = await candidatesDuBanc(dep, memoire, m.position, m.message);
		const requetes: [VarianteRequete, string][] = [['seule', m.message]];
		const jointe = options.requeteJointe?.(m.message, m.precedent) ?? null;
		if (jointe !== null && jointe !== m.message) requetes.push(['jointe', jointe]);
		const listesDe = new Map<string, Set<ListeDuBanc>>();
		const signauxDe = new Map<string, Partial<Record<VarianteRequete, Signaux>>>();
		for (const [variante, requete] of requetes) {
			const s = await signauxDuMessage(dep, memoire, requete, pool, { ...(options.premieres === undefined ? {} : { premieres: options.premieres }), demarrer });
			modeles.sens ||= s.modeles.sens;
			modeles.reranker ||= s.modeles.reranker;
			for (const liste of LISTES_DU_BANC) for (const c of s.tetes[liste]) listesDe.set(c, (listesDe.get(c) ?? new Set()).add(liste));
			for (const [c, signaux] of s.signaux) signauxDe.set(c, { ...signauxDe.get(c), [variante]: signaux });
		}
		const candidates: CandidateAJuger[] = [...listesDe.keys()].sort().map((chemin) => ({
			chemin,
			...presentationDe(memoire, chemin),
			listes: LISTES_DU_BANC.filter((l) => listesDe.get(chemin)!.has(l)),
			signaux: signauxDe.get(chemin) ?? {},
		}));
		options.avancement?.(i + 1, messages.length);
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
			precedent: m.precedent,
			candidates,
			jugements: {},
		});
	}
	return { cas, sansCandidate, modeles };
}

/** Les messages à extraire : variés et nouveaux (un message déjà au fichier, même texte, n'est pas repris). */
export function messagesAExtraire(
	messages: readonly MessageDuJournal[],
	existants: readonly CasContexte[],
	options: { nombre: number; parSession: number },
): MessageDuJournal[] {
	return choisirMessages(messages, { ...options, connus: new Set(existants.map((c) => cleDeMessage(c.message))) });
}

/**
 * Ajoute les cas extraits aux cas existants. Un cas déjà connu (même position, même message) garde ses jugements et reçoit
 * les candidates qui lui manquent (et sa session, son rang) ; s'il était étiqueté à la main, ses `attendues` deviennent
 * pertinentes, ses `interdites` non pertinentes, et tout est non pertinent dans un cas `silence`.
 */
export function fusionnerCas(existants: readonly CasContexte[], extraits: readonly CasContexte[]): { cas: CasContexte[]; ajoutes: number; completes: number } {
	const cle = (c: CasContexte) => JSON.stringify([c.position, c.message]);
	const parCle = new Map<string, CasContexte>();
	const cas = existants.map((c) => {
		const copie = { ...c };
		if (!parCle.has(cle(c))) parCle.set(cle(c), copie);
		return copie;
	});
	let ajoutes = 0;
	let completes = 0;
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
		const manquantes = (e.candidates ?? []).filter((c) => !presentes.has(c.chemin));
		if (manquantes.length === 0 && connu.candidates !== undefined) continue;
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
		});
		completes += 1;
	}
	return { cas, ajoutes, completes };
}
