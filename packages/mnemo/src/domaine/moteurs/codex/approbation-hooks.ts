import { entreesToml, LitteralToml } from '../toml-lecture.ts';
import type { ValeurToml } from '../toml-lecture.ts';

/**
 * Approbation des hooks par l'utilisateur dans Codex (`/hooks`), lue dans `config.toml` sans l'écrire : Codex 0.171 y note
 * `[hooks.state."<chemin de hooks.json>:<événement>:<groupe>:<commande>"]` avec `trusted_hash = "sha256:…"` (chaîne de base
 * ou littérale ; et `enabled = false` pour un hook désactivé). L'empreinte est calculée par Codex sur l'entrée : Mnemo ne sait pas la recalculer, il ne
 * voit donc pas si une approbation est périmée (entrée changée depuis).
 */
export type ApprobationHooks = { etat: 'approuves' | 'a_approuver' | 'inconnu'; motif: string };

type EtatDeHook = { approuve: boolean; desactive: boolean };

/** Chaque valeur feuille de `valeur` (tables en ligne parcourues), sous son chemin complet. */
function* feuilles(chemin: string[], valeur: ValeurToml): Generator<[string[], ValeurToml]> {
	if (typeof valeur === 'object' && !Array.isArray(valeur) && !(valeur instanceof LitteralToml)) {
		for (const [cle, v] of Object.entries(valeur)) yield* feuilles([...chemin, cle], v);
	} else yield [chemin, valeur];
}

/**
 * `hooks.state` de `config.toml`, par clé de hook (en-têtes, clés pointées et tables en ligne) ; `illisible` : un TOML que
 * la lecture par entrées ne suit pas, l'état est alors inconnu.
 */
export function etatsDansConfig(texte: string): { illisible: boolean; etats: Map<string, EtatDeHook> } {
	const etats = new Map<string, EtatDeHook>();
	const entrees = entreesToml(texte);
	if (entrees === null) return { illisible: true, etats };
	const etat = (cle: string): EtatDeHook => {
		const e = etats.get(cle) ?? { approuve: false, desactive: false };
		etats.set(cle, e);
		return e;
	};
	let table: string[] = [];
	for (const e of entrees) {
		if (e.genre !== 'valeur') {
			table = e.cle;
			continue;
		}
		for (const [chemin, valeur] of feuilles([...table, ...e.cle], e.valeur)) {
			if (chemin.length !== 4 || chemin[0] !== 'hooks' || chemin[1] !== 'state') continue;
			if (chemin[3] === 'trusted_hash' && typeof valeur === 'string' && valeur !== '') etat(chemin[2]!).approuve = true;
			if (chemin[3] === 'enabled' && valeur === false) etat(chemin[2]!).desactive = true;
		}
	}
	return { illisible: false, etats };
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
