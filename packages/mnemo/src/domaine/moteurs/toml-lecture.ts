/**
 * Lecture d'un fichier TOML d'un moteur, entrée par entrée, avec la place de chacune dans le texte : de quoi lire une table
 * (`[[mcp_servers]]`, `[[hooks]]`) et la remplacer ou la retirer sans toucher au reste (`toml-edition.ts`). Les valeurs
 * lues : chaînes (des quatre formes), booléens, tableaux et tables en ligne ; nombres et dates restent en texte.
 */

/** Un nombre, une date ou un autre littéral TOML, gardé tel quel. */
export class LitteralToml {
	readonly texte: string;
	constructor(texte: string) {
		this.texte = texte;
	}
}

/** Une valeur TOML lue. */
export type ValeurToml = string | boolean | LitteralToml | ValeurToml[] | { [cle: string]: ValeurToml };

/**
 * Une entrée : un en-tête de table (`[a.b]`) ou de tableau de tables (`[[a]]`), ou une clé et sa valeur. `debut` : début de
 * sa première ligne ; `fin` : après le saut de ligne de sa dernière ligne (ou la fin du texte).
 */
export type EntreeToml = { genre: 'table' | 'tableau'; cle: string[]; debut: number; fin: number } | { genre: 'valeur'; cle: string[]; valeur: ValeurToml; debut: number; fin: number };

const SIMPLES: Readonly<Record<string, string>> = { '"': '"', '\\': '\\', b: '\b', t: '\t', n: '\n', f: '\f', r: '\r', e: '\x1b' };

class Illisible extends Error {}

/** Lecteur à curseur sur le texte entier. */
class Lecteur {
	i = 0;
	readonly texte: string;
	constructor(texte: string) {
		this.texte = texte;
	}

	c(): string | undefined {
		return this.texte[this.i];
	}

	blancs(): void {
		while (this.c() === ' ' || this.c() === '\t') this.i++;
	}

	/** Blancs, sauts de ligne et commentaires (dans un tableau). */
	blancsEtLignes(): void {
		for (;;) {
			this.blancs();
			if (this.c() === '#') this.finDeLigne();
			else if (this.c() === '\n' || this.c() === '\r') this.i++;
			else return;
		}
	}

	/** Jusqu'après le prochain saut de ligne (ou la fin). */
	finDeLigne(): void {
		const n = this.texte.indexOf('\n', this.i);
		this.i = n === -1 ? this.texte.length : n + 1;
	}

	/** Reste de la ligne : blancs et commentaire seulement, puis saut de ligne. */
	finDEntree(): void {
		this.blancs();
		if (this.c() === '#') return this.finDeLigne();
		if (this.c() === '\r') this.i++;
		if (this.c() === undefined) return;
		if (this.c() !== '\n') throw new Illisible();
		this.i++;
	}

	chaineDeBase(multiligne: boolean): string {
		let s = '';
		for (;;) {
			const d = this.c();
			if (d === undefined) throw new Illisible();
			if (multiligne ? this.texte.startsWith('"""', this.i) && this.texte[this.i + 3] !== '"' : d === '"') {
				this.i += multiligne ? 3 : 1;
				return s;
			}
			if (!multiligne && (d === '\n' || d === '\r')) throw new Illisible();
			this.i++;
			if (d !== '\\') {
				s += d;
				continue;
			}
			const e = this.c();
			if (multiligne && (e === '\n' || e === '\r' || e === ' ' || e === '\t')) {
				// barre en fin de ligne : saut de ligne et blancs qui suivent effacés
				while (this.c() === ' ' || this.c() === '\t' || this.c() === '\n' || this.c() === '\r') this.i++;
				continue;
			}
			this.i++;
			if (e !== undefined && Object.hasOwn(SIMPLES, e)) s += SIMPLES[e];
			else if (e === 'u' || e === 'U') {
				const n = e === 'u' ? 4 : 8;
				const hex = this.texte.slice(this.i, this.i + n);
				if (hex.length !== n || !/^[0-9a-fA-F]+$/u.test(hex)) throw new Illisible();
				s += String.fromCodePoint(Number.parseInt(hex, 16));
				this.i += n;
			} else throw new Illisible();
		}
	}

	chaineLitterale(multiligne: boolean): string {
		const fermeture = multiligne ? "'''" : "'";
		let fin = this.texte.indexOf(fermeture, this.i);
		if (fin === -1) throw new Illisible();
		if (multiligne) while (this.texte[fin + 3] === "'") fin++;
		const s = this.texte.slice(this.i, fin);
		if (!multiligne && /[\r\n]/u.test(s)) throw new Illisible();
		this.i = fin + fermeture.length;
		return s;
	}

	chaine(): string {
		for (const [ouvrante, base] of [['"""', true], ["'''", false]] as const) {
			if (!this.texte.startsWith(ouvrante, this.i)) continue;
			this.i += 3;
			// un saut de ligne juste après l'ouverture n'en fait pas partie
			if (this.c() === '\r') this.i++;
			if (this.c() === '\n') this.i++;
			return base ? this.chaineDeBase(true) : this.chaineLitterale(true);
		}
		const c = this.c();
		this.i++;
		return c === '"' ? this.chaineDeBase(false) : this.chaineLitterale(false);
	}

	cle(): string[] {
		const segments: string[] = [];
		for (;;) {
			this.blancs();
			const c = this.c();
			if (c === '"' || c === "'") {
				this.i++;
				segments.push(c === '"' ? this.chaineDeBase(false) : this.chaineLitterale(false));
			} else {
				const nu = /^[A-Za-z0-9_-]+/u.exec(this.texte.slice(this.i, this.i + 256));
				if (nu === null) throw new Illisible();
				segments.push(nu[0]);
				this.i += nu[0].length;
			}
			this.blancs();
			if (this.c() !== '.') return segments;
			this.i++;
		}
	}

	valeur(): ValeurToml {
		const c = this.c();
		if (c === '"' || c === "'") return this.chaine();
		if (c === '[') {
			this.i++;
			const valeurs: ValeurToml[] = [];
			for (;;) {
				this.blancsEtLignes();
				if (this.c() === ']') {
					this.i++;
					return valeurs;
				}
				valeurs.push(this.valeur());
				this.blancsEtLignes();
				if (this.c() === ',') this.i++;
				else if (this.c() !== ']') throw new Illisible();
			}
		}
		if (c === '{') {
			this.i++;
			const table: { [cle: string]: ValeurToml } = {};
			this.blancs();
			if (this.c() === '}') {
				this.i++;
				return table;
			}
			for (;;) {
				const cle = this.cle();
				if (this.c() !== '=') throw new Illisible();
				this.i++;
				this.blancs();
				poser(table, cle, this.valeur());
				this.blancs();
				if (this.c() === '}') {
					this.i++;
					return table;
				}
				if (this.c() !== ',') throw new Illisible();
				this.i++;
			}
		}
		const brut = /^[^\s,\]}#]+/u.exec(this.texte.slice(this.i, this.i + 256))?.[0];
		if (brut === undefined) throw new Illisible();
		this.i += brut.length;
		// une date-heure peut porter une espace entre la date et l'heure
		const heure = /^ \d{2}:\d{2}[^\s,\]}#]*/u.exec(this.texte.slice(this.i, this.i + 64));
		if (/^\d{4}-\d{2}-\d{2}$/u.test(brut) && heure !== null) {
			this.i += heure[0].length;
			return new LitteralToml(brut + heure[0]);
		}
		if (brut === 'true' || brut === 'false') return brut === 'true';
		return new LitteralToml(brut);
	}
}

function poser(table: { [cle: string]: ValeurToml }, cle: string[], valeur: ValeurToml): void {
	let t = table;
	for (const segment of cle.slice(0, -1)) {
		const suivant = Object.hasOwn(t, segment) ? t[segment] : undefined;
		if (suivant === undefined) t = t[segment] = {};
		else if (estTableToml(suivant)) t = suivant;
		else throw new Illisible();
	}
	t[cle.at(-1)!] = valeur;
}

/** Une table (en ligne ou non), pas une chaîne, un booléen, un tableau ni un littéral brut. */
export const estTableToml = (v: ValeurToml | undefined): v is { [cle: string]: ValeurToml } => typeof v === 'object' && !Array.isArray(v) && !(v instanceof LitteralToml);

/** Marque d'ordre des octets qu'un éditeur sous Windows peut mettre en tête d'un fichier UTF-8 : sautée, jamais retirée. */
const BOM = '\uFEFF';

/**
 * Les entrées du texte, dans l'ordre ; null s'il n'est pas lisible ainsi (TOML invalide, ou une forme que cette lecture ne
 * suit pas). Un BOM en tête est sauté : les places restent celles du texte, BOM compris, et aucune entrée ne le couvre.
 */
export function entreesToml(texte: string): EntreeToml[] | null {
	const l = new Lecteur(texte);
	const avantTout = texte.startsWith(BOM) ? BOM.length : 0;
	l.i = avantTout;
	const entrees: EntreeToml[] = [];
	try {
		for (;;) {
			l.blancsEtLignes();
			if (l.c() === undefined) return entrees;
			const debut = Math.max(texte.lastIndexOf('\n', l.i - 1) + 1, avantTout);
			if (l.c() === '[') {
				const tableau = texte.startsWith('[[', l.i);
				l.i += tableau ? 2 : 1;
				const cle = l.cle();
				if (!texte.startsWith(tableau ? ']]' : ']', l.i)) return null;
				l.i += tableau ? 2 : 1;
				l.finDEntree();
				entrees.push({ genre: tableau ? 'tableau' : 'table', cle, debut, fin: l.i });
				continue;
			}
			const cle = l.cle();
			if (l.c() !== '=') return null;
			l.i++;
			l.blancs();
			const valeur = l.valeur();
			l.finDEntree();
			entrees.push({ genre: 'valeur', cle, valeur, debut, fin: l.i });
		}
	} catch (erreur) {
		if (erreur instanceof Illisible) return null;
		throw erreur;
	}
}

/** Une place dans le texte : de `debut` à `fin` (exclu). */
export type Plage = { debut: number; fin: number };

/**
 * Un élément d'un tableau de tables (`[[nom]]`) : ses clés (sous-tables `[nom.x]` qui le suivent comprises, sous leur chemin)
 * et ses places dans le texte, disjointes et dans l'ordre : son en-tête et ses entrées, puis chaque sous-table écrite après une
 * autre table (`[[nom]]`, `[autre]`, `[nom.x]`). Une plage finit après sa dernière entrée : les commentaires et lignes vides
 * qui suivent restent au texte.
 */
export type ElementDeTableau = { valeurs: { [cle: string]: ValeurToml }; plages: Plage[] };

/**
 * Éléments du tableau de tables `nom` (racine du fichier), dans l'ordre ; `enLigne` : le tableau est écrit en valeur
 * (`nom = [ … ]`), forme que Mnemo ne réécrit pas. Null : une sous-table de forme non suivie (`[[nom.x]]`) ou un doublon.
 */
export function elementsDuTableau(entrees: readonly EntreeToml[], nom: string): { elements: ElementDeTableau[]; enLigne: boolean } | null {
	const elements: ElementDeTableau[] = [];
	let enLigne = false;
	let courant: ElementDeTableau | null = null;
	// l'élément de l'entrée précédente : une sous-table qui la suit prolonge sa plage, sinon elle en ouvre une autre
	let precedent: ElementDeTableau | null = null;
	let table: string[] = [];
	try {
		for (const e of entrees) {
			if (e.genre !== 'valeur') {
				courant = null;
				table = e.cle;
				if (e.cle[0] !== nom) {
					precedent = null;
					continue;
				}
				if (e.genre === 'tableau' && e.cle.length === 1) {
					courant = { valeurs: {}, plages: [{ debut: e.debut, fin: e.fin }] };
					elements.push(courant);
					precedent = courant;
					continue;
				}
				// sous-table d'un élément : celle du dernier élément ouvert
				const dernier = elements.at(-1);
				if (e.genre === 'tableau' || dernier === undefined) return null;
				courant = dernier;
				if (precedent === dernier) dernier.plages.at(-1)!.fin = e.fin;
				else dernier.plages.push({ debut: e.debut, fin: e.fin });
				precedent = dernier;
				poser(courant.valeurs, e.cle.slice(1), {});
				continue;
			}
			if (table.length === 0 && e.cle[0] === nom) enLigne = true;
			precedent = courant;
			if (courant === null) continue;
			poser(courant.valeurs, [...table.slice(1), ...e.cle], e.valeur);
			courant.plages.at(-1)!.fin = e.fin;
		}
	} catch (erreur) {
		if (erreur instanceof Illisible) return null;
		throw erreur;
	}
	return { elements, enLigne };
}
