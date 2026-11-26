// Paires implicites tirées du journal des gestes (spec « entraîner la note », D8) : de quoi réapprendre la note de confiance
// sur l'usage, jamais de quoi la mesurer. Pur.
// Appariement par session, pas par message : le `rangMessage` d'un ➤ est celui du message qui porte la fiche (le suivant de
// celui dont le classement l'a montrée), et ✗ toujours ou une lecture prennent le dernier message de la session.
//
// Choix :
// - utile : ➤ (`injectee_main`), lue après une carte ; pas utile : ✗ ici ou toujours ; `injectee_auto` n'est pas un jugement
//   (Mnemo l'a choisie) ; `retablie` annule le jugement qui précède. Une fiche, une session : le dernier de ces gestes seul
//   (un ✗ après un ➤ l'emporte), avec la ligne du classement gardée dans sa note (rang, signaux bruts).
// - pas utile faible (0,3) : une fiche des 3 premiers rangs d'un classement servi, sans aucun geste (de quelque sorte) sur elle
//   dans la session, ni jamais lue ou injectée dans la session ; une paire par (session, fiche) au plus, celle de sa ligne de
//   meilleur rang dans la session (une fiche montrée à dix messages ne pèse pas dix fois).
// - exposition : une ligne d'un classement (session, message, fiche ; la dernière si le message a plusieurs classements), hors
//   lignes déjà injectées ou lues et injections de Mnemo. `propensionParRang` : part des lignes exposées de ce rang dont la
//   fiche a reçu ➤, ✗ ou une lecture dans la session ; plancher 0,05 ; rang jamais exposé : pas de correction (1).
// - poids : poids de base × min(5, 1 / propension du rang) : un pas utile faible pèse au plus 1,5, jamais plus qu'un geste.
// - un geste sans rang ou sans signaux lisibles (note ancienne) est écarté et compté.
// - modèles : seuls gestes et classements calculés avec le modèle de sens installé. Le seul témoin enregistré est le modèle du
//   vecteur du message d'un geste (`modeleVecteur`, `bge-m3@<empreinte>`) : un geste d'un autre modèle est écarté, et toute sa
//   session avec lui (ses classements ont été calculés par le même modèle) ; un geste sans vecteur, ou une session sans geste
//   qui en porte, est gardé (rien ne dit son modèle). Le reranker (logit) n'est enregistré nulle part : pas de contrôle.

import type { Geste, NoteDuGeste } from './gestes.ts';
import type { SignauxDeNote } from './modele-de-note.ts';

/** Ce que l'on lit d'un geste du journal (`GesteNote` en a la forme) ; `rang` : ordre d'écriture. */
export type GesteDuJournal = { rang: number; geste: Geste; session: string; fiche: string; rangMessage: number; note: NoteDuGeste | null; modeleVecteur?: string | null };
/** Une ligne d'un classement servi (`Classe` en a la forme). */
export type LigneServie = { id: string; rang: number; signaux?: unknown; deja?: string; auto?: boolean };
/** Le classement servi à un message d'une session. */
export type ClassementServi = { session: string; rangMessage: number; lignes: readonly LigneServie[] };

export type OrigineImplicite = 'injectee_main' | 'lue_apres_carte' | 'ecartee_ici' | 'ecartee_toujours' | 'sans_geste';
export type PaireImplicite = {
	session: string;
	fiche: string;
	rangMessage: number;
	rang: number;
	signaux: SignauxDeNote;
	y: boolean;
	poids: number;
	origine: OrigineImplicite;
};
/** `ecartees` : gestes sans rang ou sans signaux lisibles ; `autresModeles` : gestes écartés, avec leur session, pour un autre modèle de sens. */
export type PairesDesGestes = { paires: PaireImplicite[]; ecartees: number; autresModeles: number };

export const POIDS_PAS_UTILE_FAIBLE = 0.3;
export const RANGS_SANS_GESTE = 3;
export const PROPENSION_MIN = 0.05;
export const POIDS_IMPLICITE_MAX = 5;

const UTILES: readonly Geste[] = ['injectee_main', 'lue_apres_carte'];
const PAS_UTILES: readonly Geste[] = ['ecartee_ici', 'ecartee_toujours'];
const estJugement = (g: Geste) => UTILES.includes(g) || PAS_UTILES.includes(g);

const cle = (...parties: readonly (string | number)[]) => parties.join('\u0000');
const nombre = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const sansLigneUtile = (l: LigneServie) => l.auto === true || l.deja === 'injectee' || l.deja === 'lue';

/** Les signaux d'une note ou d'une ligne ; null si le cosinus relatif manque (aucun niveau ne s'en passe). */
function lireSignaux(v: unknown): SignauxDeNote | null {
	if (typeof v !== 'object' || v === null) return null;
	const s = v as Record<string, unknown>;
	if (!nombre(s['cosinusRelatif'])) return null;
	return {
		cosinusRelatif: s['cosinusRelatif'],
		...('cosinusZ' in s ? { cosinusZ: nombre(s['cosinusZ']) ? s['cosinusZ'] : null } : {}),
		bm25Relatif: nombre(s['bm25Relatif']) ? s['bm25Relatif'] : null,
		...(nombre(s['signalSession']) ? { signalSession: s['signalSession'] } : {}),
		...(nombre(s['apriori']) ? { apriori: s['apriori'] } : {}),
		...(nombre(s['logit']) ? { logit: s['logit'] } : {}),
	};
}

/** L'empreinte d'une identité de modèle (`<nom>@<empreinte>`, celle du vecteur comme celle du fichier GGUF installé). */
const empreinte = (identite: string): string => identite.slice(identite.lastIndexOf('@') + 1);

/**
 * Les gestes et classements calculés avec le modèle de sens installé (`sens` : son identité, null ou absent : rien n'est
 * écarté) : les sessions où un geste porte le vecteur d'un autre modèle sont retirées entières.
 */
export function avecLesModelesInstalles(
	gestes: readonly GesteDuJournal[],
	classements: readonly ClassementServi[],
	sens: string | null | undefined,
): { gestes: GesteDuJournal[]; classements: ClassementServi[]; autresModeles: number } {
	if (sens === null || sens === undefined) return { gestes: [...gestes], classements: [...classements], autresModeles: 0 };
	const attendue = empreinte(sens);
	const autres = new Set(gestes.filter((g) => typeof g.modeleVecteur === 'string' && empreinte(g.modeleVecteur) !== attendue).map((g) => g.session));
	const gardes = gestes.filter((g) => !autres.has(g.session));
	return { gestes: gardes, classements: classements.filter((c) => !autres.has(c.session)), autresModeles: gestes.length - gardes.length };
}

/** Gestes utilisables : dans une session, sur une fiche, dans l'ordre d'écriture. */
const gestesUtiles = (gestes: readonly GesteDuJournal[]) => gestes.filter((g) => g.session !== '' && g.fiche !== '').sort((a, b) => a.rang - b.rang);

/** Lignes exposées, une par (session, message, fiche) : la dernière vue. */
function exposees(classements: readonly ClassementServi[]): { session: string; rangMessage: number; ligne: LigneServie }[] {
	const parCle = new Map<string, { session: string; rangMessage: number; ligne: LigneServie }>();
	for (const c of classements) for (const ligne of c.lignes) parCle.set(cle(c.session, c.rangMessage, ligne.id), { session: c.session, rangMessage: c.rangMessage, ligne });
	return [...parCle.values()].filter((e) => !sansLigneUtile(e.ligne));
}

/** Part des lignes exposées de chaque rang dont la fiche a reçu ➤, ✗ ou une lecture dans la session (plancher 0,05). */
export function propensionParRang(gestes: readonly GesteDuJournal[], classements: readonly ClassementServi[]): Map<number, number> {
	const jugees = new Set(gestesUtiles(gestes).filter((g) => estJugement(g.geste)).map((g) => cle(g.session, g.fiche)));
	const parRang = new Map<number, { lignes: number; gestes: number }>();
	for (const { session, ligne } of exposees(classements)) {
		const r = parRang.get(ligne.rang) ?? { lignes: 0, gestes: 0 };
		r.lignes += 1;
		if (jugees.has(cle(session, ligne.id))) r.gestes += 1;
		parRang.set(ligne.rang, r);
	}
	return new Map([...parRang].map(([rang, r]) => [rang, Math.max(PROPENSION_MIN, r.gestes / r.lignes)]));
}

/**
 * Les paires implicites des gestes et des classements servis, et le nombre de gestes écartés faute de rang ou de signaux, ou
 * pour un autre modèle de sens que `options.sens` (identité du modèle installé).
 */
export function pairesDesGestes(tousLesGestes: readonly GesteDuJournal[], tousLesClassements: readonly ClassementServi[], options: { sens?: string | null } = {}): PairesDesGestes {
	const { gestes, classements, autresModeles } = avecLesModelesInstalles(tousLesGestes, tousLesClassements, options.sens);
	const propension = propensionParRang(gestes, classements);
	const poids = (base: number, rang: number) => base * Math.min(POIDS_IMPLICITE_MAX, 1 / (propension.get(rang) ?? 1));
	const utiles = gestesUtiles(gestes);

	// le dernier jugement (ou rétablissement) de chaque fiche dans chaque session
	const derniers = new Map<string, GesteDuJournal>();
	for (const g of utiles) if (estJugement(g.geste) || g.geste === 'retablie') derniers.set(cle(g.session, g.fiche), g);
	const paires: PaireImplicite[] = [];
	let ecartees = 0;
	for (const g of derniers.values()) {
		if (g.geste === 'retablie') continue;
		const rang = g.note?.['rang'];
		const signaux = lireSignaux(g.note?.['signaux']);
		if (!nombre(rang) || signaux === null) {
			ecartees += 1;
			continue;
		}
		const y = UTILES.includes(g.geste);
		paires.push({ session: g.session, fiche: g.fiche, rangMessage: g.rangMessage, rang, signaux, y, poids: poids(1, rang), origine: g.geste as OrigineImplicite });
	}

	// pas utile faible : top 3 sans geste ni lecture dans la session ; une paire par (session, fiche), sa ligne de meilleur rang
	// (à rang égal, la première vue)
	const touchees = new Set(utiles.map((g) => cle(g.session, g.fiche)));
	for (const c of classements) for (const l of c.lignes) if (sansLigneUtile(l)) touchees.add(cle(c.session, l.id));
	const meilleures = new Map<string, { session: string; rangMessage: number; ligne: LigneServie }>();
	for (const e of exposees(classements)) {
		const k = cle(e.session, e.ligne.id);
		const deja = meilleures.get(k);
		if (deja === undefined || e.ligne.rang < deja.ligne.rang) meilleures.set(k, e);
	}
	for (const { session, rangMessage, ligne } of meilleures.values()) {
		if (ligne.rang > RANGS_SANS_GESTE || touchees.has(cle(session, ligne.id))) continue;
		const signaux = lireSignaux(ligne.signaux);
		if (signaux === null) {
			ecartees += 1;
			continue;
		}
		paires.push({ session, fiche: ligne.id, rangMessage, rang: ligne.rang, signaux, y: false, poids: poids(POIDS_PAS_UTILE_FAIBLE, ligne.rang), origine: 'sans_geste' });
	}
	return { paires, ecartees, autresModeles };
}
