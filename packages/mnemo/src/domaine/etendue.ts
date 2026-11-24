// Étendue servie autour d'un passage trouvé (« petit pour chercher, grand pour lire ») : la recherche reste au grain du
// passage ; au moment de servir, il est élargi à sa section ou à ses voisins. Pur, sans module `node:`.
import { tronquerTexte } from './texte.ts';

/** Budget d'une entrée servie (passage et ce qui l'entoure), en caractères. */
export const BUDGET_PAR_ENTREE = 6000;
/** Sous cette place, un voisin n'est pas coupé : il est omis. */
const COUPE_MIN = 80;
const SEPARATEUR = '\n\n';
const COUPURE = '…';

/** Un passage d'une section, dans l'ordre du texte. */
export type Morceau = { id: string; texte: string };
/**
 * `section` : la section entière (plusieurs passages trouvés dans la même section) ; `voisins` : le passage et ses voisins
 * immédiats de la même section ; `passage` : le passage seul (section d'un seul passage, ou budget sans place).
 */
export type ModeEtendue = 'passage' | 'voisins' | 'section';
/** `ids` : passages servis, dans l'ordre ; `tronque` : un passage coupé ou omis faute de place. */
export type Etendue = { mode: ModeEtendue; ids: string[]; tronque: boolean };

/** Début d'un texte en `place` caractères au plus, coupé à un mot, suivi de « … ». */
function debut(texte: string, place: number): string {
	let coupe = tronquerTexte(texte, place - COUPURE.length - 1, 'utf16');
	const espace = coupe.search(/\s\S*$/u);
	if (espace > coupe.length / 2) coupe = coupe.slice(0, espace);
	return `${coupe.trimEnd()} ${COUPURE}`;
}

/** Fin d'un texte en `place` caractères au plus, coupée à un mot, précédée de « … ». */
function fin(texte: string, place: number): string {
	let coupe = texte.slice(texte.length - (place - COUPURE.length - 1));
	// une paire de substitution coupée en deux n'est pas gardée
	if (/^[\udc00-\udfff]/u.test(coupe)) coupe = coupe.slice(1);
	const espace = coupe.search(/\s/u);
	if (espace !== -1 && espace < coupe.length / 2) coupe = coupe.slice(espace);
	return `${COUPURE} ${coupe.trimStart()}`;
}

/**
 * Texte servi pour les passages trouvés (`trouves`, des ids, le meilleur d'abord) d'une même section (`section`, dans
 * l'ordre du texte). `section` : toute la section ; `voisins` : le précédent et le suivant du passage trouvé.
 * - Le meilleur passage trouvé est toujours gardé entier, même au-delà de `budget`.
 * - Les autres passages trouvés le sont ensuite, dans leur ordre, s'ils tiennent entiers dans `budget`.
 * - Puis les autres passages, par distance croissante à un passage gardé : à la première distance qui ne tient pas, ses
 *   passages se partagent la place restante et sont coupés du côté opposé (« … ») ; les plus lointains sont omis.
 * - `exclus` (déjà servis ailleurs) ne sont jamais repris : un « … » marque leur place.
 * `complets` : les passages gardés entiers (les trouvés qui n'y sont pas ont été coupés ou omis).
 */
export function etendre(
	section: readonly Morceau[],
	trouves: readonly string[],
	mode: 'section' | 'voisins',
	budget = BUDGET_PAR_ENTREE,
	exclus: ReadonlySet<string> = new Set(),
): Etendue & { texte: string; complets: string[] } {
	const indice = new Map(section.map((m, i) => [m.id, i]));
	const rangs = trouves.flatMap((id) => (indice.has(id) ? [indice.get(id)!] : []));
	if (rangs.length === 0) return { mode: 'passage', ids: [], tronque: false, texte: '', complets: [] };
	const longueur = (i: number): number => section[i]!.texte.length;
	// en mode section, un « … » peut marquer chaque bord de section omis
	const reserve = mode === 'section' ? 2 * (SEPARATEUR.length + COUPURE.length) : 0;
	/** Texte gardé par indice (entier ou coupé). */
	const gardes = new Map<number, string>([[rangs[0]!, section[rangs[0]!]!.texte]]);
	let taille = longueur(rangs[0]!);
	let tronque = false;
	for (const i of rangs.slice(1)) {
		if (taille + SEPARATEUR.length + longueur(i) + reserve > budget) {
			tronque = true;
			continue;
		}
		gardes.set(i, section[i]!.texte);
		taille += SEPARATEUR.length + longueur(i);
	}
	const centraux = [...gardes.keys()];
	const distance = (i: number): number => Math.min(...centraux.map((c) => Math.abs(i - c)));
	const candidats = section
		.map((_, i) => i)
		.filter((i) => !gardes.has(i) && !exclus.has(section[i]!.id) && (mode === 'section' || distance(i) === 1));
	// par distance croissante : un rang entier, ou le premier qui ne tient pas se partage la place restante
	const distances = [...new Set(candidats.map(distance))].sort((a, b) => a - b);
	for (const d of distances) {
		const rang = candidats.filter((i) => distance(i) === d);
		const place = rang.reduce((n, i) => n + SEPARATEUR.length + longueur(i), 0);
		if (taille + place + reserve <= budget) {
			for (const i of rang) gardes.set(i, section[i]!.texte);
			taille += place;
			continue;
		}
		tronque = true;
		// partage : les plus courts d'abord (gardés entiers s'ils tiennent dans leur part), les autres coupés à leur part
		let reste = budget - taille - reserve - rang.length * (SEPARATEUR.length + COUPURE.length);
		const parLongueur = [...rang].sort((a, b) => longueur(a) - longueur(b));
		parLongueur.forEach((i, n) => {
			const part = Math.floor(reste / (parLongueur.length - n));
			const texte = section[i]!.texte;
			if (texte.length <= part) gardes.set(i, texte);
			else if (part >= COUPE_MIN) {
				const proche = Math.min(...centraux.filter((c) => Math.abs(i - c) === d));
				gardes.set(i, i < proche ? fin(texte, part) : debut(texte, part));
			}
			reste -= Math.min(texte.length, Math.max(part, 0));
		});
		break;
	}
	const indices = [...gardes.keys()].sort((a, b) => a - b);
	const morceaux: string[] = [];
	// en mode section, ce qui manque en bord de section se voit aussi
	if (mode === 'section' && indices[0]! > 0) morceaux.push(COUPURE);
	indices.forEach((i, rang) => {
		if (rang > 0 && i > indices[rang - 1]! + 1) morceaux.push(COUPURE);
		morceaux.push(gardes.get(i)!);
	});
	if (mode === 'section' && indices.at(-1)! < section.length - 1) morceaux.push(COUPURE);
	const ids = indices.map((i) => section[i]!.id);
	const complets = indices.filter((i) => gardes.get(i) === section[i]!.texte).map((i) => section[i]!.id);
	const effectif: ModeEtendue = mode === 'section' ? 'section' : ids.length > 1 ? 'voisins' : 'passage';
	return { mode: effectif, ids, tronque, texte: morceaux.join(SEPARATEUR), complets };
}

/** Libellé de l'étendue servie, à côté de la référence du passage : « section entière, 3 passages », « passage seul »… */
export function libelleEtendue(etendue: Etendue): string {
	if (etendue.mode === 'passage') return 'passage seul';
	const nombre = `${etendue.ids.length} passage${etendue.ids.length > 1 ? 's' : ''}`;
	const nom = etendue.mode === 'section' ? (etendue.tronque ? 'section' : 'section entière') : 'passage et ses voisins';
	return `${nom}, ${nombre}${etendue.tronque ? ', coupée' : ''}`;
}
