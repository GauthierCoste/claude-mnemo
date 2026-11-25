// Choix des messages à juger au banc du contexte (spec classement vivant § 6.1) : variés (premiers messages et suites,
// sessions et projets différents), dédoublonnés, déterministes. Pur.

import { empreinte } from './empreinte.ts';

/**
 * Un message porteur du journal : `rang` (1 = premier message porteur de la session), `groupe` (projet ou dossier de la
 * session : les messages sont pris tour à tour d'un groupe à l'autre), `precedent` : le message porteur d'avant dans la session.
 */
export type MessageDuJournal = {
	session: string;
	groupe: string;
	rang: number;
	horodatageMs: number;
	message: string;
	position: string;
	precedent: string | null;
};

/** Clé de dédoublonnage d'un message : sans casse ni espaces en trop. */
export function cleDeMessage(message: string): string {
	return message.toLowerCase().replace(/\s+/gu, ' ').trim();
}

/** Ordre de prise des messages d'une session : le premier d'abord, puis les suites dans un ordre mêlé, fixe (empreinte). */
function ordreDansLaSession(messages: readonly MessageDuJournal[]): MessageDuJournal[] {
	const [premier, ...suites] = [...messages].sort((a, b) => a.rang - b.rang);
	if (premier === undefined) return [];
	const melange = suites.map((m) => ({ m, cle: empreinte(`${m.session}#${m.rang}`) })).sort((a, b) => (a.cle < b.cle ? -1 : a.cle > b.cle ? 1 : 0));
	return [premier, ...melange.map((x) => x.m)];
}

/**
 * Au plus `nombre` messages, `parSession` au plus par session, pris tour à tour d'un groupe à l'autre, et dans un groupe d'une
 * session à l'autre (les plus récentes d'abord) ; dans une session, le premier message, puis des suites mêlées. Un message
 * déjà connu (`connus` : clés de `cleDeMessage`) ou déjà pris (même texte dans une autre session) est laissé.
 */
export function choisirMessages(
	messages: readonly MessageDuJournal[],
	options: { nombre: number; parSession: number; connus?: ReadonlySet<string> },
): MessageDuJournal[] {
	const pris = new Set(options.connus ?? []);
	// la première occurrence d'un texte (la plus ancienne) le représente
	const uniques: MessageDuJournal[] = [];
	const vus = new Set<string>();
	for (const m of [...messages].sort((a, b) => a.horodatageMs - b.horodatageMs || a.rang - b.rang)) {
		const cle = cleDeMessage(m.message);
		if (cle === '' || vus.has(cle)) continue;
		vus.add(cle);
		uniques.push(m);
	}
	const parSession = new Map<string, MessageDuJournal[]>();
	for (const m of uniques) parSession.set(m.session, [...(parSession.get(m.session) ?? []), m]);
	const recence = (liste: readonly MessageDuJournal[]) => Math.max(...liste.map((m) => m.horodatageMs));
	const groupes = new Map<string, { session: string; file: MessageDuJournal[]; pris: number }[]>();
	for (const [session, liste] of [...parSession].sort((a, b) => recence(b[1]) - recence(a[1]) || (a[0] < b[0] ? -1 : 1))) {
		const groupe = liste[0]!.groupe;
		groupes.set(groupe, [...(groupes.get(groupe) ?? []), { session, file: ordreDansLaSession(liste), pris: 0 }]);
	}
	const tours = [...groupes].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).map(([, sessions]) => ({ sessions, prochaine: 0 }));
	const choisis: MessageDuJournal[] = [];
	let avance = true;
	while (choisis.length < options.nombre && avance) {
		avance = false;
		for (const tour of tours) {
			if (choisis.length >= options.nombre) break;
			// la prochaine session du groupe qui a encore un message à donner
			for (let essai = 0; essai < tour.sessions.length; essai++) {
				const s = tour.sessions[tour.prochaine % tour.sessions.length]!;
				tour.prochaine += 1;
				let m: MessageDuJournal | undefined;
				if (s.pris < options.parSession) {
					do m = s.file.shift();
					while (m !== undefined && pris.has(cleDeMessage(m.message)));
				}
				if (m === undefined) continue;
				pris.add(cleDeMessage(m.message));
				s.pris += 1;
				choisis.push(m);
				avance = true;
				break;
			}
		}
	}
	return choisis;
}
