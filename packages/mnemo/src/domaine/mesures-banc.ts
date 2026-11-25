// Mesures du banc du contexte (spec classement vivant § 4.3 et § 6.1) : borne de Wilson, table de fiabilité et ECE,
// plis de validation croisée groupés par session. Pur.

/** Quantile de la loi normale pour un intervalle à 95 %. */
const Z_95 = 1.959963984540054;

/**
 * Intervalle de Wilson d'une proportion `succes / total` (95 % par défaut). Sans essai : [0, 1] (rien n'est prouvé).
 */
export function intervalleWilson(succes: number, total: number, z = Z_95): { basse: number; haute: number } {
	if (total <= 0) return { basse: 0, haute: 1 };
	const p = succes / total;
	const z2 = z * z;
	const centre = p + z2 / (2 * total);
	const ecart = z * Math.sqrt((p * (1 - p)) / total + z2 / (4 * total * total));
	const denominateur = 1 + z2 / total;
	return { basse: Math.max(0, (centre - ecart) / denominateur), haute: Math.min(1, (centre + ecart) / denominateur) };
}

/** Une paire notée : `p` la probabilité annoncée, `pertinente` le jugement. */
export type PaireNotee = { p: number; pertinente: boolean };
/** Une tranche de la table de fiabilité : [de, a[ (la dernière inclut 1), nombre de paires, p moyen, part de pertinentes. */
export type TrancheFiabilite = { de: number; a: number; paires: number; pMoyen: number; frequence: number };

/** Table de fiabilité : `tranches` tranches égales de [0, 1] ; une tranche vide est rendue avec 0 paire (p moyen et fréquence 0). */
export function tableDeFiabilite(paires: readonly PaireNotee[], tranches = 10): TrancheFiabilite[] {
	const table = Array.from({ length: tranches }, (_, i) => ({ de: i / tranches, a: (i + 1) / tranches, paires: 0, somme: 0, pertinentes: 0 }));
	for (const { p, pertinente } of paires) {
		if (!Number.isFinite(p)) continue;
		const i = Math.min(tranches - 1, Math.max(0, Math.floor(p * tranches)));
		const t = table[i]!;
		t.paires += 1;
		t.somme += p;
		if (pertinente) t.pertinentes += 1;
	}
	return table.map((t) => ({ de: t.de, a: t.a, paires: t.paires, pMoyen: t.paires === 0 ? 0 : t.somme / t.paires, frequence: t.paires === 0 ? 0 : t.pertinentes / t.paires }));
}

/**
 * Erreur de calibration attendue (ECE) sur les paires où `p ≥ pMin` (0,5 par défaut) : moyenne, pondérée par le nombre de
 * paires, de l'écart entre p moyen et part de pertinentes, sur les tranches de la table de fiabilité. Null sans paire.
 */
export function ece(paires: readonly PaireNotee[], options: { pMin?: number; tranches?: number } = {}): number | null {
	const pMin = options.pMin ?? 0.5;
	const retenues = paires.filter((x) => Number.isFinite(x.p) && x.p >= pMin);
	if (retenues.length === 0) return null;
	const table = tableDeFiabilite(retenues, options.tranches ?? 10);
	return table.reduce((somme, t) => somme + (t.paires / retenues.length) * Math.abs(t.pMoyen - t.frequence), 0);
}

/**
 * Plis de validation croisée groupés par session : chaque session tombe tout entière dans un pli (jamais deux messages d'une
 * même session de part et d'autre). Les sessions, des plus fournies aux moins fournies (puis par id), vont chacune au pli le
 * moins rempli (le premier à égalité) : les plis restent équilibrés en nombre d'éléments. Rend le pli (0 à k − 1) de chaque
 * élément, dans l'ordre. Déterministe.
 */
export function plisParSession(elements: readonly { session: string }[], k = 5): number[] {
	if (!Number.isInteger(k) || k < 1) throw new Error(`Nombre de plis invalide : ${k}`);
	const tailles = new Map<string, number>();
	for (const { session } of elements) tailles.set(session, (tailles.get(session) ?? 0) + 1);
	const sessions = [...tailles].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
	const remplissage = Array.from({ length: k }, () => 0);
	const pliDe = new Map<string, number>();
	for (const [session, taille] of sessions) {
		let pli = 0;
		for (let i = 1; i < k; i++) if (remplissage[i]! < remplissage[pli]!) pli = i;
		pliDe.set(session, pli);
		remplissage[pli] = remplissage[pli]! + taille;
	}
	return elements.map(({ session }) => pliDe.get(session)!);
}

/** Générateur pseudo-aléatoire déterministe (mulberry32) : nombres dans [0, 1[, la même suite pour la même graine. */
export function hasardFixe(graine: number): () => number {
	let a = graine >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/**
 * Plis groupés par session, dans un ordre des sessions tiré de `graine` (chaque session, prise dans cet ordre, va au pli le
 * moins rempli) : d'une graine à l'autre, un autre découpage, toujours sans couper une session. Déterministe pour une graine.
 */
export function plisParSessionMelanges(elements: readonly { session: string }[], k: number, graine: number): number[] {
	if (!Number.isInteger(k) || k < 1) throw new Error(`Nombre de plis invalide : ${k}`);
	const tailles = new Map<string, number>();
	for (const { session } of elements) tailles.set(session, (tailles.get(session) ?? 0) + 1);
	const sessions = [...tailles].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
	const u = hasardFixe(graine);
	for (let i = sessions.length - 1; i > 0; i--) {
		const j = Math.floor(u() * (i + 1));
		[sessions[i], sessions[j]] = [sessions[j]!, sessions[i]!];
	}
	const remplissage = Array.from({ length: k }, () => 0);
	const pliDe = new Map<string, number>();
	for (const [session, taille] of sessions) {
		let pli = 0;
		for (let i = 1; i < k; i++) if (remplissage[i]! < remplissage[pli]!) pli = i;
		pliDe.set(session, pli);
		remplissage[pli] = remplissage[pli]! + taille;
	}
	return elements.map(({ session }) => pliDe.get(session)!);
}
