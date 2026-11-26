// Régression logistique régularisée, poids bornés (spec classement vivant § 4.2) : la note de confiance
// `p = σ(b + Σ wⱼ·xⱼ)`. Pur.
//
// Les variables sont centrées réduites avant l'apprentissage : la pénalité L2 porte sur les poids réduits (une variable n'est
// pas punie pour son unité), l'optimisation est bien conditionnée, et le résultat est rendu dans les unités d'origine. Une
// réduction par un écart type positif garde le signe des poids : wⱼ ≥ 0 tient dans les deux unités, et un maximum wⱼ ≤ M
// devient vⱼ ≤ M·σⱼ. Une variable constante (écart type nul) ne dit rien : son poids reste 0.
//
// Optimiseur : Newton projeté. À chaque pas, les poids collés à une borne vers laquelle pousse le gradient restent fixes ; on
// résout le système de Newton sur les autres, puis on recule (Armijo) tant que le pas projeté ne fait pas assez baisser
// l'objectif. L'objectif est convexe ; sans pénalité et sur des données séparables, il n'a pas de minimum fini : l'arrêt au
// nombre maximal d'itérations est alors signalé (`converge` faux).
//
// Pondération : un exemple de poids w compte comme w exemples (perte, gradient, hessien, moyennes et écarts types de la
// réduction, taux de base de départ) ; la perte moyenne est rapportée à la somme des poids. Un poids nul retire l'exemple.

/** Un exemple : les variables, le jugement (vrai : pertinente) et son poids (fini, ≥ 0 ; 1 par défaut). */
export type Exemple = { x: readonly number[]; y: boolean; poids?: number };

const poidsDe = (e: Exemple): number => e.poids ?? 1;

/** Coefficients appris, dans les unités d'origine des variables ; `converge` : l'optimisation a atteint son minimum. */
export type Regression = { biais: number; poids: number[]; converge: boolean };
export type Coefficients = Pick<Regression, 'biais' | 'poids'>;

export type OptionsRegression = {
	/** Force de la pénalité L2 sur les poids réduits, rapportée à la perte moyenne : (λ/2)·Σ vⱼ². */
	lambda: number;
	/** Vrai (défaut) : poids ≥ 0. */
	positifs?: boolean;
	/** Poids maximal de chaque variable, dans ses unités (null ou absent : sans maximum). */
	maximums?: readonly (number | null)[];
	iterationsMax?: number;
	tolerance?: number;
};

/** Pénalité minime sur le biais : il reste fini même quand un seul jugement est présent (que des pertinentes, ou aucune). */
const PENALITE_BIAIS = 1e-6;
const ECART_NUL = 1e-12;
const GRADIENT_NEGLIGEABLE = 1e-7;
/**
 * Au-delà de ce poids réduit, l'écart type d'une variable multiplierait les chances par e^30 : signe de données séparables, où
 * l'objectif sans pénalité n'a pas de minimum fini. Le modèle est rendu, mais pas comme convergé.
 */
const POIDS_REDUIT_MAX = 30;

export const sigmoide = (z: number): number => (z >= 0 ? 1 / (1 + Math.exp(-z)) : Math.exp(z) / (1 + Math.exp(z)));

/** log(1 + e^z), sans débordement. */
const softplus = (z: number): number => (z > 0 ? z + Math.log1p(Math.exp(-z)) : Math.log1p(Math.exp(z)));

/** Perte logistique d'une marge `z` pour le jugement `y`. */
const perte = (z: number, y: boolean): number => (y ? softplus(-z) : softplus(z));

/** `z = b + Σ wⱼ·xⱼ`. */
export function marge(r: Coefficients, x: readonly number[]): number {
	let z = r.biais;
	for (let j = 0; j < r.poids.length; j++) z += r.poids[j]! * x[j]!;
	return z;
}

export const probabilite = (r: Coefficients, x: readonly number[]): number => sigmoide(marge(r, x));

/** Perte logistique moyenne (log loss) des exemples, pondérée ; 0 sans exemple (ou sans poids). */
export function perteMoyenne(r: Coefficients, exemples: readonly Exemple[]): number {
	const total = exemples.reduce((s, e) => s + poidsDe(e), 0);
	if (total === 0) return 0;
	return exemples.reduce((s, e) => s + poidsDe(e) * perte(marge(r, e.x), e.y), 0) / total;
}

/** Résout `A·x = b` (petit système) par élimination de Gauss avec pivot partiel. */
function resoudre(a: readonly (readonly number[])[], b: readonly number[]): number[] {
	const n = b.length;
	const m = a.map((ligne, i) => [...ligne, b[i]!]);
	for (let c = 0; c < n; c++) {
		let pivot = c;
		for (let i = c + 1; i < n; i++) if (Math.abs(m[i]![c]!) > Math.abs(m[pivot]![c]!)) pivot = i;
		[m[c], m[pivot]] = [m[pivot]!, m[c]!];
		const d = m[c]![c]!;
		if (Math.abs(d) < 1e-300) continue;
		for (let i = c + 1; i < n; i++) {
			const f = m[i]![c]! / d;
			if (f === 0) continue;
			for (let j = c; j <= n; j++) m[i]![j] = m[i]![j]! - f * m[c]![j]!;
		}
	}
	const x = Array.from({ length: n }, () => 0);
	for (let i = n - 1; i >= 0; i--) {
		let s = m[i]![n]!;
		for (let j = i + 1; j < n; j++) s -= m[i]![j]! * x[j]!;
		x[i] = Math.abs(m[i]![i]!) < 1e-300 ? 0 : s / m[i]![i]!;
	}
	return x;
}

/**
 * Apprend `b` et `w` (poids ≥ 0 par défaut, bornés par `maximums`) en minimisant la perte moyenne pondérée plus (λ/2)·Σ vⱼ².
 */
export function apprendreRegression(tous: readonly Exemple[], options: OptionsRegression): Regression {
	const d = tous[0]?.x.length ?? 0;
	if (tous.some((e) => e.x.length !== d)) throw new Error('Exemples de dimensions différentes.');
	if (!(options.lambda >= 0)) throw new Error(`λ invalide : ${options.lambda}`);
	if (tous.some((e) => !(Number.isFinite(poidsDe(e)) && poidsDe(e) >= 0))) throw new Error('Poids d’exemple invalide (fini et ≥ 0).');
	const exemples = tous.filter((e) => poidsDe(e) > 0);
	const n = exemples.length;
	const w = exemples.map(poidsDe);
	const total = w.reduce((s, x) => s + x, 0);
	if (n === 0) return { biais: 0, poids: Array.from({ length: d }, () => 0), converge: true };
	const positifs = options.positifs ?? true;
	const iterationsMax = options.iterationsMax ?? 100;
	const tolerance = options.tolerance ?? 1e-8;
	const lambda = options.lambda;

	// variables centrées réduites ; une variable constante reste hors du jeu
	const moyenne = Array.from({ length: d }, (_, j) => exemples.reduce((s, e, i) => s + w[i]! * e.x[j]!, 0) / total);
	const ecart = Array.from({ length: d }, (_, j) => Math.sqrt(exemples.reduce((s, e, i) => s + w[i]! * (e.x[j]! - moyenne[j]!) ** 2, 0) / total));
	const actives = Array.from({ length: d }, (_, j) => j).filter((j) => ecart[j]! > ECART_NUL);
	const k = actives.length;
	const q = k + 1; // coordonnées : 0 à k − 1 les poids réduits, k le biais
	const z = new Float64Array(n * q);
	exemples.forEach((e, i) => {
		actives.forEach((j, c) => (z[i * q + c] = (e.x[j]! - moyenne[j]!) / ecart[j]!));
		z[i * q + k] = 1;
	});
	const y = exemples.map((e) => e.y);
	const bas = Array.from({ length: q }, (_, c) => (c < k && positifs ? 0 : -Infinity));
	const haut = Array.from({ length: q }, (_, c) => {
		const m = c < k ? options.maximums?.[actives[c]!] : null;
		return m === null || m === undefined ? Infinity : Math.max(0, m) * ecart[actives[c]!]!;
	});
	const penalite = Array.from({ length: q }, (_, c) => (c === k ? PENALITE_BIAIS : lambda));
	const projeter = (v: readonly number[]) => v.map((x, c) => Math.min(haut[c]!, Math.max(bas[c]!, x)));
	const marges = (v: readonly number[]): Float64Array => {
		const m = new Float64Array(n);
		for (let i = 0; i < n; i++) {
			let s = 0;
			for (let c = 0; c < q; c++) s += v[c]! * z[i * q + c]!;
			m[i] = s;
		}
		return m;
	};
	const objectif = (v: readonly number[]): number => {
		const m = marges(v);
		let s = 0;
		for (let i = 0; i < n; i++) s += w[i]! * perte(m[i]!, y[i]!);
		return s / total + v.reduce((r, x, c) => r + (penalite[c]! / 2) * x * x, 0);
	};

	const base = y.reduce((s, yi, i) => s + (yi ? w[i]! : 0), 0) / total;
	let v = Array.from({ length: q }, (_, c) => (c === k ? Math.log((base * total + 0.5) / ((1 - base) * total + 0.5)) : 0));
	let valeur = objectif(v);
	let converge = false;
	for (let iteration = 0; iteration < iterationsMax; iteration++) {
		const m = marges(v);
		const g = Array.from({ length: q }, () => 0);
		const h = Array.from({ length: q }, () => Array.from({ length: q }, () => 0));
		for (let i = 0; i < n; i++) {
			const p = sigmoide(m[i]!);
			const r = w[i]! * (p - (y[i]! ? 1 : 0));
			const courbure = w[i]! * p * (1 - p);
			for (let a = 0; a < q; a++) {
				const za = z[i * q + a]!;
				g[a] = g[a]! + r * za;
				const ha = h[a]!;
				for (let b = a; b < q; b++) ha[b] = ha[b]! + courbure * za * z[i * q + b]!;
			}
		}
		for (let a = 0; a < q; a++) {
			g[a] = g[a]! / total + penalite[a]! * v[a]!;
			for (let b = a; b < q; b++) {
				h[a]![b] = h[a]![b]! / total + (a === b ? penalite[a]! + 1e-12 : 0);
				h[b]![a] = h[a]![b]!;
			}
		}
		// libres : les coordonnées qui ne sont pas collées à une borne vers laquelle pousse le gradient
		const libres = Array.from({ length: q }, (_, c) => c).filter((c) => !((v[c]! <= bas[c]! && g[c]! > 0) || (v[c]! >= haut[c]! && g[c]! < 0)));
		if (Math.max(0, ...libres.map((c) => Math.abs(g[c]!))) < tolerance) {
			converge = true;
			break;
		}
		const pas = resoudre(
			libres.map((a) => libres.map((b) => h[a]![b]!)),
			libres.map((a) => -g[a]!),
		);
		const direction = Array.from({ length: q }, () => 0);
		libres.forEach((c, i) => (direction[c] = pas[i]!));
		let t = 1;
		let essai: number[] = v;
		let nouvelle = valeur;
		let descend = false;
		for (let recul = 0; recul < 40; recul++) {
			essai = projeter(v.map((x, c) => x + t * direction[c]!));
			nouvelle = objectif(essai);
			const attendue = essai.reduce((s, x, c) => s + g[c]! * (x - v[c]!), 0);
			if (nouvelle <= valeur + 1e-4 * attendue) {
				descend = true;
				break;
			}
			t /= 2;
		}
		if (!descend) {
			// plus aucun pas ne fait baisser l'objectif : le minimum est atteint à la précision des calculs, si le gradient est
			// devenu négligeable
			converge = Math.max(0, ...libres.map((c) => Math.abs(g[c]!))) < GRADIENT_NEGLIGEABLE;
			break;
		}
		const deplacement = Math.max(...essai.map((x, c) => Math.abs(x - v[c]!)));
		v = essai;
		valeur = nouvelle;
		if (deplacement < tolerance) {
			converge = true;
			break;
		}
	}

	if (v.some((x, c) => c < k && Math.abs(x) > POIDS_REDUIT_MAX)) converge = false;
	// sans pénalité, des données que le modèle sépare toutes n'ont pas de minimum fini : l'arrêt n'est qu'un arrêt
	if (lambda === 0) {
		const m = marges(v);
		if (y.every((yi, i) => (m[i]! > 0) === yi)) converge = false;
	}
	// retour aux unités d'origine
	const poids = Array.from({ length: d }, () => 0);
	let biais = v[k]!;
	actives.forEach((j, c) => {
		poids[j] = v[c]! / ecart[j]!;
		biais -= poids[j]! * moyenne[j]!;
	});
	return { biais, poids, converge };
}
