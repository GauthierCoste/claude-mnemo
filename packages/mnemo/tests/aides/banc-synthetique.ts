// Banc synthétique réaliste (repris de la contre-expertise du 25/11) : messages d'une mémoire de N fiches, signaux bruts comme
// au banc (cosinus relatif et z-score sur toute la mémoire, bm25 relatif, logit du reranker sur 30 soumises, signal de session,
// a priori), mise en commun (la pile), deux fiches tirées hors de la pile, jugements bruités. Rend des cas du banc.
import type { CandidateAJuger, CasContexte, Jugement } from '../../src/application/banc-contexte.ts';
import { hasardFixe } from '../../src/domaine/mesures-banc.ts';
import type { IdentiteDesModeles } from '../../src/domaine/modele-de-note.ts';

export type Scenario = {
	N: number;
	/** Décalage du cosinus des utiles et des « gris » (du sujet mais inutiles), en écarts types. */
	dCos: number;
	dCosGris: number;
	/** Décalage du logit des utiles et des gris. */
	dLogit: number;
	dLogitGris: number;
	sdLogit: number;
	/** Effets aléatoires du message et de la session sur les logits. */
	sdMessage: number;
	sdSession: number;
	pSilence: number;
	/** Utiles : 1 + Poisson(utilesMoy) hors silence ; gris : Poisson(grisMoy). */
	utilesMoy: number;
	grisMoy: number;
	/** Part des gris jugés pertinents (bruit du jugement), et des gris non pertinents jugés indécis. */
	pGrisUtile: number;
	pIndecise: number;
	/** Vrai : signaux et jugements indépendants. */
	auHasard?: boolean;
};

export const SCENARIOS = {
	favorable: { N: 400, dCos: 2.2, dCosGris: 1.2, dLogit: 7.5, dLogitGris: 2.5, sdLogit: 2.2, sdMessage: 0.5, sdSession: 0.3, pSilence: 0.25, utilesMoy: 0.6, grisMoy: 2, pGrisUtile: 0.03, pIndecise: 0.1 },
	central: { N: 400, dCos: 1.9, dCosGris: 1.3, dLogit: 6, dLogitGris: 3, sdLogit: 2.3, sdMessage: 0.8, sdSession: 0.5, pSilence: 0.25, utilesMoy: 0.6, grisMoy: 3, pGrisUtile: 0.06, pIndecise: 0.15 },
	difficile: { N: 400, dCos: 1.6, dCosGris: 1.4, dLogit: 5, dLogitGris: 3.5, sdLogit: 2.4, sdMessage: 1.0, sdSession: 0.6, pSilence: 0.25, utilesMoy: 0.6, grisMoy: 4, pGrisUtile: 0.1, pIndecise: 0.2 },
	auHasard: { N: 400, dCos: 0, dCosGris: 0, dLogit: 0, dLogitGris: 0, sdLogit: 2.3, sdMessage: 0.8, sdSession: 0.5, pSilence: 0.25, utilesMoy: 0.6, grisMoy: 3, pGrisUtile: 0.06, pIndecise: 0.15, auHasard: true },
} satisfies Record<string, Scenario>;

export const GGUF_DE_TEST: IdentiteDesModeles = { sens: 'bge-m3-q8_0.gguf@aa473d51f451', reranker: 'bge-reranker-v2-m3-Q8_0.gguf@a43c7c9b11a4' };

function hasard(graine: number) {
	const u = hasardFixe(graine);
	const n = () => Math.sqrt(-2 * Math.log(1 - u())) * Math.cos(2 * Math.PI * u());
	const poisson = (l: number) => {
		let k = 0;
		let p = Math.exp(-l);
		let s = p;
		const x = u();
		while (x > s) {
			k++;
			p *= l / k;
			s += p;
		}
		return k;
	};
	return { u, n, poisson };
}
type Hasard = ReturnType<typeof hasard>;

type Fiche = { chemin: string; jugement: Jugement; cosinus: number; cosRel: number; cosZ: number; bm25: number | null; logit: number | null; sig: number; apr: number };

const top = (fs: Fiche[], cle: (f: Fiche) => number, k: number, filtre: (f: Fiche) => boolean = () => true) =>
	fs.filter(filtre).sort((a, b) => cle(b) - cle(a)).slice(0, k);

function message(s: Scenario, r: Hasard, session: string, rang: number, effetSession: number): CasContexte {
	const N = s.N;
	const silence = r.u() < s.pSilence;
	const nUtiles = silence ? 0 : 1 + r.poisson(s.utilesMoy);
	const nGris = r.poisson(s.grisMoy);
	const mu = 0.45 + 0.04 * r.n();
	const sigma = 0.045 + 0.03 * r.u();
	const uM = effetSession + s.sdMessage * r.n();
	const mots = r.u() < 0.9;
	const injManuelle = r.u() < 0.2;
	const rho = 0.4;
	// des fiches partagées d'un message à l'autre de la session : la même fiche peut revenir (une fois par session)
	const decalage = Math.floor(r.u() * 5);
	const brut = Array.from({ length: N }, (_, i) => {
		const type = i < nUtiles ? 2 : i < nUtiles + nGris ? 1 : 0;
		const signal = s.auHasard ? 0 : type;
		const ec = r.n();
		const er = r.n();
		const cos = mu + sigma * (ec + (signal === 2 ? s.dCos : signal === 1 ? s.dCosGris : 0));
		const pMatch = signal === 2 ? 0.65 : signal === 1 ? 0.5 : 0.06;
		const bm = mots && r.u() < pMatch ? -(1 + Math.exp(0.5 * r.n())) * (signal === 2 ? 1.5 : signal === 1 ? 1.2 : 1) : 0;
		const logit = -6 + s.sdLogit * (rho * ec + Math.sqrt(1 - rho * rho) * er) + (signal === 2 ? s.dLogit : signal === 1 ? s.dLogitGris : 0) + uM;
		const pSig = signal === 2 ? 0.3 : signal === 1 ? 0.2 : 0.005;
		const sig = injManuelle && r.u() < pSig ? [0.25, 0.18, 0.12][Math.floor(r.u() * 3)]! : 0;
		const pApr = signal === 2 ? 0.25 : signal === 1 ? 0.15 : 0.03;
		const apr = r.u() < pApr ? (signal === 0 ? -1 + 2 * r.u() : 0.2 + 0.8 * r.u()) : 0;
		const utile = type === 2 ? true : type === 1 ? r.u() < s.pGrisUtile : false;
		const jugement: Jugement = utile ? 'pertinente' : type === 1 && r.u() < s.pIndecise ? 'indecise' : 'non_pertinente';
		return { chemin: `notes/Atelier Vitrail ${session} ${(i + decalage) % N}.md`, cos, bm, logit, sig, apr, jugement };
	});
	const cosinus = brut.map((b) => b.cos);
	const tri = [...cosinus].sort((a, b) => a - b);
	const med = (tri[N / 2 - 1]! + tri[N / 2]!) / 2;
	const moy = cosinus.reduce((a, b) => a + b, 0) / N;
	const et = Math.sqrt(cosinus.reduce((a, b) => a + (b - moy) ** 2, 0) / N);
	const meilleur = Math.min(...brut.map((b) => b.bm));
	const fiches: Fiche[] = brut.map((b) => ({
		chemin: b.chemin,
		jugement: b.jugement,
		cosinus: b.cos,
		cosRel: b.cos - med,
		cosZ: (b.cos - moy) / et,
		bm25: !mots ? null : b.bm < 0 ? Math.min(1, b.bm / meilleur) : 0,
		logit: null,
		sig: b.sig,
		apr: b.apr,
	}));
	const logitDe = new Map(brut.map((b) => [b.chemin, b.logit]));
	// 30 soumises au reranker : premières du sens et des mots, plus les désignées
	const soumises = new Set<Fiche>([...top(fiches, (f) => f.cosRel, 18), ...top(fiches, (f) => f.bm25 ?? 0, 12, (f) => (f.bm25 ?? 0) > 0), ...fiches.filter((f) => f.sig > 0)]);
	for (const f of soumises) f.logit = logitDe.get(f.chemin)!;
	const pile = new Set<Fiche>([
		...top(fiches, (f) => f.cosRel, 10),
		...top(fiches, (f) => f.bm25 ?? 0, 10, (f) => (f.bm25 ?? 0) > 0),
		...top([...soumises], (f) => f.logit!, 10),
		...fiches.filter((f) => f.sig > 0 || f.apr !== 0),
	]);
	const dehors = fiches.filter((f) => !pile.has(f));
	const tirees = [dehors[Math.floor(r.u() * dehors.length)]!, dehors[Math.floor(r.u() * dehors.length)]!].filter((f, i, l) => l.indexOf(f) === i);
	const candidate = (f: Fiche, horsPile: boolean): CandidateAJuger => ({
		chemin: f.chemin,
		titre: 'Fiche',
		ligne: '',
		listes: [],
		signaux: { seule: { logit: f.logit, cosinus: f.cosinus, cosinusRelatif: f.cosRel, cosinusZ: f.cosZ, bm25Relatif: f.bm25, signalSession: f.sig, apriori: f.apr } as never },
		...(horsPile ? { horsPile: true } : {}),
	});
	const candidates = [...[...pile].map((f) => candidate(f, false)), ...tirees.map((f) => candidate(f, true))];
	const jugements = Object.fromEntries([...pile, ...tirees].map((f) => [f.chemin, f.jugement]));
	return { nom: `${session} #${rang}`, position: 'projets/Corvel', message: 'message', premier: rang === 1, attendues: [], interdites: [], silence: false, session, rang, candidates, jugements, gguf: GGUF_DE_TEST };
}

/** `messages` messages répartis sur `sessions` sessions de tailles inégales (au moins 1), d'après `graine`. */
export function banc(s: Scenario, graine: number, messages: number, sessions: number): CasContexte[] {
	const r = hasard(graine);
	const tailles = Array.from({ length: sessions }, () => 1);
	for (let i = sessions; i < messages; i++) tailles[Math.floor(r.u() ** 1.5 * sessions)]! += 1;
	return tailles.flatMap((t, i) => {
		const effet = s.sdSession * r.n();
		return Array.from({ length: t }, (_, rang) => message(s, r, `s${String(i).padStart(3, '0')}`, rang + 1, effet));
	});
}
