// Régression logistique régularisée, poids ≥ 0 (spec classement vivant § 4.2) : la note de confiance `p = σ(b + Σ wⱼ·xⱼ)`.
// Pur.
//
// Les variables sont centrées réduites avant l'apprentissage : la pénalité L2 porte sur les poids réduits (une variable n'est
// pas punie pour son unité), l'optimisation est bien conditionnée, et le résultat est rendu dans les unités d'origine. Une
// réduction par un écart type positif garde le signe des poids : la contrainte wⱼ ≥ 0 tient dans les deux unités. Une variable
// constante (écart type nul) ne dit rien : son poids reste 0.
//
// Optimiseur : descente par coordonnées, un pas de Newton par coordonnée (projeté sur wⱼ ≥ 0), raccourci de moitié tant qu'il
// ne fait pas baisser l'objectif. L'objectif est convexe : la descente converge vers son minimum.

/** Un exemple : les variables et le jugement (vrai : pertinente). */
export type Exemple = { x: readonly number[]; y: boolean };

/** Coefficients appris, dans les unités d'origine des variables. */
export type Regression = { biais: number; poids: number[] };

export type OptionsRegression = {
	/** Force de la pénalité L2 sur les poids réduits, rapportée à la perte moyenne : (λ/2)·Σ vⱼ². */
	lambda: number;
	/** Vrai (défaut) : poids ≥ 0. */
	positifs?: boolean;
	iterationsMax?: number;
	tolerance?: number;
};

/** Pénalité minime sur le biais : il reste fini même quand un seul jugement est présent (que des pertinentes, ou aucune). */
const PENALITE_BIAIS = 1e-6;
const ECART_NUL = 1e-12;

export const sigmoide = (z: number): number => (z >= 0 ? 1 / (1 + Math.exp(-z)) : Math.exp(z) / (1 + Math.exp(z)));

/** log(1 + e^z), sans débordement. */
const softplus = (z: number): number => (z > 0 ? z + Math.log1p(Math.exp(-z)) : Math.log1p(Math.exp(z)));

/** Perte logistique d'une marge `z` pour le jugement `y`. */
const perte = (z: number, y: boolean): number => (y ? softplus(-z) : softplus(z));

/** `z = b + Σ wⱼ·xⱼ`. */
export function marge(r: Regression, x: readonly number[]): number {
	let z = r.biais;
	for (let j = 0; j < r.poids.length; j++) z += r.poids[j]! * x[j]!;
	return z;
}

export const probabilite = (r: Regression, x: readonly number[]): number => sigmoide(marge(r, x));

/** Perte logistique moyenne (log loss) des exemples ; 0 sans exemple. */
export function perteMoyenne(r: Regression, exemples: readonly Exemple[]): number {
	if (exemples.length === 0) return 0;
	return exemples.reduce((s, e) => s + perte(marge(r, e.x), e.y), 0) / exemples.length;
}

/** Apprend `b` et `w` (poids ≥ 0 par défaut) en minimisant la perte moyenne plus (λ/2)·Σ vⱼ² sur les variables réduites. */
export function apprendreRegression(exemples: readonly Exemple[], options: OptionsRegression): Regression {
	const n = exemples.length;
	const d = exemples[0]?.x.length ?? 0;
	if (exemples.some((e) => e.x.length !== d)) throw new Error('Exemples de dimensions différentes.');
	if (!(options.lambda >= 0)) throw new Error(`λ invalide : ${options.lambda}`);
	if (n === 0) return { biais: 0, poids: Array.from({ length: d }, () => 0) };
	const positifs = options.positifs ?? true;
	const iterationsMax = options.iterationsMax ?? 1000;
	const tolerance = options.tolerance ?? 1e-9;
	const lambda = options.lambda;

	// variables centrées réduites ; une variable constante reste hors du jeu
	const moyenne = Array.from({ length: d }, (_, j) => exemples.reduce((s, e) => s + e.x[j]!, 0) / n);
	const ecart = Array.from({ length: d }, (_, j) => Math.sqrt(exemples.reduce((s, e) => s + (e.x[j]! - moyenne[j]!) ** 2, 0) / n));
	const actives = Array.from({ length: d }, (_, j) => j).filter((j) => ecart[j]! > ECART_NUL);
	const z = exemples.map((e) => actives.map((j) => (e.x[j]! - moyenne[j]!) / ecart[j]!));
	const y = exemples.map((e) => e.y);
	const k = actives.length;

	// coordonnées : 0 à k − 1 les poids réduits, k le biais
	const v = Array.from({ length: k + 1 }, () => 0);
	const base = y.filter(Boolean).length / n;
	v[k] = Math.log((base * n + 0.5) / ((1 - base) * n + 0.5));
	const marges = Array.from({ length: n }, () => v[k]!);
	const xc = (i: number, c: number) => (c === k ? 1 : z[i]![c]!);
	const penalite = (c: number) => (c === k ? PENALITE_BIAIS : lambda);
	const objectifSelon = (c: number, delta: number): number => {
		let s = 0;
		for (let i = 0; i < n; i++) s += perte(marges[i]! + delta * xc(i, c), y[i]!);
		let reg = 0;
		for (let q = 0; q <= k; q++) {
			const vq = q === c ? v[q]! + delta : v[q]!;
			reg += (penalite(q) / 2) * vq * vq;
		}
		return s / n + reg;
	};

	for (let iteration = 0; iteration < iterationsMax; iteration++) {
		let plusGrandPas = 0;
		for (let c = 0; c <= k; c++) {
			let g = 0;
			let h = 0;
			for (let i = 0; i < n; i++) {
				const p = sigmoide(marges[i]!);
				const x = xc(i, c);
				g += (p - (y[i]! ? 1 : 0)) * x;
				h += p * (1 - p) * x * x;
			}
			g = g / n + penalite(c) * v[c]!;
			h = h / n + penalite(c);
			let delta = -g / Math.max(h, 1e-12);
			if (positifs && c < k && v[c]! + delta < 0) delta = -v[c]!;
			if (delta === 0) continue;
			const avant = objectifSelon(c, 0);
			let essais = 0;
			while (objectifSelon(c, delta) > avant && essais < 40) {
				delta /= 2;
				essais += 1;
			}
			if (essais === 40) continue;
			v[c] = v[c]! + delta;
			for (let i = 0; i < n; i++) marges[i] = marges[i]! + delta * xc(i, c);
			plusGrandPas = Math.max(plusGrandPas, Math.abs(delta));
		}
		if (plusGrandPas < tolerance) break;
	}

	// retour aux unités d'origine
	const poids = Array.from({ length: d }, () => 0);
	let biais = v[k]!;
	actives.forEach((j, c) => {
		poids[j] = v[c]! / ecart[j]!;
		biais -= poids[j]! * moyenne[j]!;
	});
	return { biais, poids };
}
