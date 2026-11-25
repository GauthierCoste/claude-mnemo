/**
 * Approbation des hooks par l'utilisateur dans Codex (`/hooks`), lue dans `config.toml` sans l'écrire : Codex 0.171 y note
 * `[hooks.state."<chemin de hooks.json>:<événement>:<groupe>:<commande>"]` avec `trusted_hash = "sha256:…"` (chaîne de base
 * ou littérale ; et `enabled = false` pour un hook désactivé). L'empreinte est calculée par Codex sur l'entrée : Mnemo ne sait pas la recalculer, il ne
 * voit donc pas si une approbation est périmée (entrée changée depuis).
 */
export type ApprobationHooks = { etat: 'approuves' | 'a_approuver' | 'inconnu'; motif: string };

/** Clé TOML pointée (`a."b.c".'d'`) en segments ; null si elle est mal formée. */
export function segmentsDeCle(texte: string): string[] | null {
	const segments: string[] = [];
	let i = 0;
	const blancs = () => {
		while (i < texte.length && (texte[i] === ' ' || texte[i] === '\t')) i++;
	};
	for (;;) {
		blancs();
		const c = texte[i];
		if (c === '"') {
			let s = '';
			i++;
			for (;;) {
				const d = texte[i];
				if (d === undefined) return null;
				i++;
				if (d === '"') break;
				if (d !== '\\') {
					s += d;
					continue;
				}
				const e = texte[i++];
				const simples: Record<string, string> = { '"': '"', '\\': '\\', b: '\b', t: '\t', n: '\n', f: '\f', r: '\r' };
				if (e !== undefined && Object.hasOwn(simples, e)) s += simples[e];
				else if (e === 'u' || e === 'U') {
					const n = e === 'u' ? 4 : 8;
					const hex = texte.slice(i, i + n);
					if (!/^[0-9a-fA-F]+$/u.test(hex) || hex.length !== n) return null;
					s += String.fromCodePoint(Number.parseInt(hex, 16));
					i += n;
				} else return null;
			}
			segments.push(s);
		} else if (c === "'") {
			const fin = texte.indexOf("'", i + 1);
			if (fin === -1) return null;
			segments.push(texte.slice(i + 1, fin));
			i = fin + 1;
		} else {
			const nu = /^[A-Za-z0-9_-]+/u.exec(texte.slice(i));
			if (nu === null) return null;
			segments.push(nu[0]);
			i += nu[0].length;
		}
		blancs();
		if (i === texte.length) return segments;
		if (texte[i] !== '.') return null;
		i++;
	}
}

/** Position du premier `stop` hors des chaînes de `ligne`, ou -1. */
function horsChaines(ligne: string, stop: string): number {
	let guillemet: string | null = null;
	for (let i = 0; i < ligne.length; i++) {
		const c = ligne[i]!;
		if (guillemet !== null) {
			if (c === '\\' && guillemet === '"') i++;
			else if (c === guillemet) guillemet = null;
		} else if (c === '"' || c === "'") guillemet = c;
		else if (c === stop) return i;
	}
	return -1;
}

type EtatDeHook = { approuve: boolean; desactive: boolean };

/**
 * `hooks.state` de `config.toml`, par clé de hook ; `illisible` : une forme que cette lecture par lignes ne suit pas (table
 * en ligne `state = { … }`, en-tête mal formé), l'état est alors inconnu.
 */
export function etatsDansConfig(texte: string): { illisible: boolean; etats: Map<string, EtatDeHook> } {
	const etats = new Map<string, EtatDeHook>();
	let illisible = false;
	let table: string[] = [];
	const etat = (cle: string): EtatDeHook => {
		const e = etats.get(cle) ?? { approuve: false, desactive: false };
		etats.set(cle, e);
		return e;
	};
	// chaîne sur plusieurs lignes en cours (`"""` ou `'''`) : ses lignes ne sont ni des en-têtes ni des clés
	let multiligne: string | null = null;
	for (const brute of texte.split(/\r?\n/u)) {
		if (multiligne !== null) {
			if (brute.includes(multiligne)) multiligne = null;
			continue;
		}
		const ligne = brute.trim();
		if (ligne === '' || ligne.startsWith('#')) continue;
		if (ligne.startsWith('[')) {
			const double = ligne.startsWith('[[');
			const interieur = ligne.slice(double ? 2 : 1);
			const fin = horsChaines(interieur, ']');
			const segments = fin === -1 ? null : segmentsDeCle(interieur.slice(0, fin));
			if (segments === null) {
				illisible = true;
				table = [];
			} else table = segments;
			continue;
		}
		const egal = horsChaines(ligne, '=');
		if (egal === -1) continue;
		const cle = segmentsDeCle(ligne.slice(0, egal));
		if (cle === null) continue;
		const chemin = [...table, ...cle];
		const valeur = ligne.slice(egal + 1).trim();
		const ouvrante = valeur.startsWith('"""') ? '"""' : valeur.startsWith("'''") ? "'''" : null;
		if (ouvrante !== null && !valeur.slice(3).includes(ouvrante)) multiligne = ouvrante;
		if (chemin[0] !== 'hooks') continue;
		if (chemin.length <= 3 && valeur.startsWith('{') && (chemin.length === 1 || chemin[1] === 'state')) illisible = true;
		if (chemin.length !== 4 || chemin[1] !== 'state') continue;
		if (chemin[3] === 'trusted_hash' && /^(?:"[^"]+"|'[^']+')/u.test(valeur)) etat(chemin[2]!).approuve = true;
		if (chemin[3] === 'enabled' && /^false\b/u.test(valeur)) etat(chemin[2]!).desactive = true;
	}
	return { illisible, etats };
}

const AVERTISSEMENT = 'Mnemo ne peut pas recalculer l’empreinte de Codex : si l’entrée a changé depuis l’approbation, Codex la redemande (/hooks)';

/**
 * Approbation des hooks de Mnemo (`cles` : `<événement>:<groupe>:<commande>`, voir `etatDesHooks`), cherchés sous chacun des
 * `chemins` possibles de `hooks.json` (tel quel et réel). `texte` null : `config.toml` illisible.
 */
export function approbationDesHooks(texte: string | null, chemins: readonly string[], cles: readonly string[]): ApprobationHooks {
	if (texte === null) return { etat: 'inconnu', motif: 'config.toml de Codex illisible : approbation à vérifier dans Codex (/hooks).' };
	const { illisible, etats } = etatsDansConfig(texte);
	const lus = cles.map((cle) => chemins.map((chemin) => etats.get(`${chemin}:${cle}`)).find((e) => e !== undefined));
	if (lus.some((e) => e?.desactive === true)) return { etat: 'a_approuver', motif: 'hooks de Mnemo désactivés dans Codex : à réactiver dans Codex (/hooks).' };
	const approuves = lus.filter((e) => e?.approuve === true).length;
	if (approuves === cles.length) return { etat: 'approuves', motif: `approbation enregistrée dans config.toml (hooks.state) ; ${AVERTISSEMENT}.` };
	if (illisible) return { etat: 'inconnu', motif: 'hooks.state de config.toml sous une forme que Mnemo ne lit pas : approbation à vérifier dans Codex (/hooks).' };
	return { etat: 'a_approuver', motif: `${cles.length - approuves} hook(s) de Mnemo sur ${cles.length} sans approbation : à approuver dans Codex (/hooks).` };
}
