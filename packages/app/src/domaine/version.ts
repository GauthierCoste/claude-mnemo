/**
 * Nouvelles versions de Mnemo : une fois par jour au plus, l'app lit la dernière version publiée sur GitHub Releases
 * (`GauthierCoste/claude-mnemo`, requête anonyme, rien d'autre n'est envoyé) et, si elle est plus récente que la sienne,
 * le dit dans le menu avec le lien de sa page. Ici : comparaison des versions, lecture de la réponse, rythme.
 */

/** Dépôt public des versions publiées. */
export const DEPOT_VERSIONS = 'GauthierCoste/claude-mnemo';
/** Adresse de la dernière version publiée (ni brouillon ni préversion : l'API les écarte). */
export const ADRESSE_DERNIERE_VERSION = `https://api.github.com/repos/${DEPOT_VERSIONS}/releases/latest`;
/** Les pages de version acceptées comme lien : celles du dépôt, rien d'autre. */
const PREFIXE_PAGES = `https://github.com/${DEPOT_VERSIONS}/releases/`;
/** Une vérification par jour au plus. */
export const INTERVALLE_VERIFICATION_MS = 24 * 60 * 60 * 1000;

export type VersionPubliee = { version: string; url: string };

/** Lien d'une page de version du dépôt (le seul que le menu ouvre). */
export function estPageDeVersion(url: string): boolean {
	if (!url.startsWith(PREFIXE_PAGES) || /\s/u.test(url)) return false;
	// relu une fois analysé : un `..` ne mène pas hors des pages du dépôt
	try {
		const u = new URL(url);
		return u.origin === 'https://github.com' && u.username === '' && u.password === '' && u.pathname.startsWith(`/${DEPOT_VERSIONS}/releases/`);
	} catch {
		return false;
	}
}

type Semver = { noyau: [number, number, number]; pre: string[] };

/** `1.5.0`, `v1.5.0`, `1.6.0-beta.2` (métadonnées `+…` ignorées) ; autre forme : null. */
export function lireVersion(texte: string): Semver | null {
	const m = /^v?(\d{1,9})\.(\d{1,9})\.(\d{1,9})(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/u.exec(texte.trim());
	if (m === null) return null;
	return { noyau: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] === undefined ? [] : m[4].split('.') };
}

/** Ordre de SemVer : négatif si `a` < `b`, 0 si égales, positif sinon ; une version illisible est la plus petite. */
export function comparerVersions(a: string, b: string): number {
	const va = lireVersion(a);
	const vb = lireVersion(b);
	if (va === null || vb === null) return (va === null ? 0 : 1) - (vb === null ? 0 : 1);
	for (let i = 0; i < 3; i++) if (va.noyau[i] !== vb.noyau[i]) return va.noyau[i]! - vb.noyau[i]!;
	// une préversion précède la version publiée
	if (va.pre.length === 0 || vb.pre.length === 0) return (va.pre.length === 0 ? 1 : 0) - (vb.pre.length === 0 ? 1 : 0);
	for (let i = 0; i < Math.min(va.pre.length, vb.pre.length); i++) {
		const x = va.pre[i]!;
		const y = vb.pre[i]!;
		if (x === y) continue;
		const nx = /^\d+$/u.test(x);
		const ny = /^\d+$/u.test(y);
		if (nx && ny) return Number(x) - Number(y);
		if (nx !== ny) return nx ? -1 : 1;
		return x < y ? -1 : 1;
	}
	return va.pre.length - vb.pre.length;
}

/**
 * La version publiée lue dans la réponse de l'API (`tag_name`, `html_url`) : null si elle est illisible, si le lien n'est
 * pas une page de version du dépôt, ou si c'est un brouillon ou une préversion.
 */
export function lireDerniereVersion(brut: unknown): VersionPubliee | null {
	if (typeof brut !== 'object' || brut === null || Array.isArray(brut)) return null;
	const { tag_name: tag, html_url: url, draft, prerelease } = brut as Record<string, unknown>;
	if (draft === true || prerelease === true) return null;
	if (typeof tag !== 'string' || typeof url !== 'string' || !estPageDeVersion(url)) return null;
	const v = lireVersion(tag);
	if (v === null || v.pre.length > 0) return null;
	return { version: v.noyau.join('.'), url };
}

/** La version à annoncer : la publiée si elle est plus récente que `courante`, sinon null. */
export function versionAAnnoncer(courante: string, publiee: VersionPubliee | null): VersionPubliee | null {
	return publiee !== null && comparerVersions(publiee.version, courante) > 0 ? publiee : null;
}

/** Faut-il vérifier maintenant ? Réglage actif, et jamais vérifié ou plus d'un jour depuis (horloge reculée : oui). */
export function verificationDue(actif: boolean, derniereMs: number | null, maintenantMs: number): boolean {
	if (!actif) return false;
	if (derniereMs === null) return true;
	const ecart = maintenantMs - derniereMs;
	return ecart < 0 || ecart >= INTERVALLE_VERIFICATION_MS;
}
