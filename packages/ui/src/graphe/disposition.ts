/**
 * Disposition du graphe de la mémoire, sans three.js : simulation de forces en 3D, calculée par tranches puis arrêtée.
 * Les positions de départ dépendent du chemin de chaque fiche : la même mémoire donne la même figure à chaque visite.
 */
import { TEXTES, type Textes } from '../langue/textes.ts';
import { cleDuNoeud, dateMediane, type Noeud } from './donnees.ts';

export const DISPOSITIONS = ['forces', 'constellations', 'notions', 'temps'] as const;
export type Disposition = (typeof DISPOSITIONS)[number];

const ALPHA_MINIMUM = 0.001;
const DECROISSANCE_ALPHA = 0.034;
const FREINAGE = 0.6;
const DISTANCE_LIEN = 26;
const REPULSION = -34;
const DISTANCE_MAXIMALE_REPULSION = 700;
const PLAN_SANS_DATE = 1.35;
const JOUR_MS = 86400000;

/** `sansDate` : l'étiquette du plan des fiches sans date. */
export type AxeDuTemps = { longueur: number; planSansDate: number; sansDate: string; graduations: { z: number; texte: string }[] };

/** Textes de l'axe du temps : graduation « mois année » (UTC) et plan sans date. */
export type TextesAxe = Textes['memoire']['graphe']['axe'];

/** Ressort de la simulation : relation, parenté ou lien de notion. */
export type LienSimule = { source: Noeud; cible: Noeud };

export type Simulation = {
	/** Pas de calcul pendant `budgetMs` au plus ; vrai s'il en reste. */
	avancer(budgetMs: number, horloge?: () => number): boolean;
	terminer(): void;
	/** Relance une disposition finie ou en cours, sans repartir de zéro : après le déplacement d'un nœud. */
	rechauffer(niveau: number): void;
	pasFaits(): number;
};

/**
 * Nombre de 0 à 1 tiré d'un texte (FNV-1a puis mélange) : la graine d'un nœud.
 */
export function graine(texte: string, sel = 0): number {
	let empreinte = 2166136261 ^ sel;
	for (let position = 0; position < texte.length; position++) empreinte = Math.imul(empreinte ^ texte.charCodeAt(position), 16777619);
	empreinte = Math.imul(empreinte ^ (empreinte >>> 15), 2246822507);
	empreinte = Math.imul(empreinte ^ (empreinte >>> 13), 3266489909);
	return ((empreinte ^ (empreinte >>> 16)) >>> 0) / 4294967296;
}

/**
 * Place chaque nœud au départ, sur une sphère dont le rayon suit le nombre de nœuds.
 */
export function placerAuDepart(noeuds: Noeud[]): void {
	const rayon = 10 * Math.cbrt(noeuds.length + 1) + 20;
	for (const noeud of noeuds) {
		const cle = cleDuNoeud(noeud);
		const u = graine(cle, 1) * 2 - 1;
		const angle = graine(cle, 2) * Math.PI * 2;
		const distance = rayon * Math.cbrt(graine(cle, 3));
		const horizontal = Math.sqrt(1 - u * u);
		noeud.x = Math.cos(angle) * horizontal * distance;
		noeud.y = u * distance;
		noeud.z = Math.sin(angle) * horizontal * distance;
		noeud.vx = 0;
		noeud.vy = 0;
		noeud.vz = 0;
	}
}

/**
 * Cibles d'attraction de chaque nœud (`tx`, `ty`, `tz`) selon la disposition, et l'axe du temps éventuel. En
 * constellations, une par branche de premier niveau (`racines`), chaque sous-branche rapprochée autour d'elle :
 * `{ longueur, graduations: [{ z, texte }], planSansDate }`. Une fiche sans date de validité est posée sur un plan à
 * part, derrière la fin de l'axe ; un lien cassé suit les fiches qui le citent. En constellations par notion, une par
 * notion (`notions`, identifiants dans leur ordre) : chaque fiche rejoint sa notion principale, une fiche sans notion
 * reste au centre.
 */
export function cibler(
	noeuds: Noeud[],
	disposition: string,
	{ racines = [], notions = [], textes = TEXTES.fr.memoire.graphe.axe }: { racines?: string[]; notions?: string[]; textes?: TextesAxe } = {},
): AxeDuTemps | null {
	const rayonConstellations = 30 * Math.cbrt(noeuds.length) + 60;
	const longueurAxe = 52 * Math.cbrt(noeuds.length) + 40;
	const dates = new Map<Noeud, number | null>();
	let minimum = Infinity;
	let maximum = -Infinity;
	if (disposition === 'temps') {
		for (const noeud of noeuds) {
			const date = noeud.fantome || noeud.notion ? null : dateMediane(noeud);
			dates.set(noeud, date);
			if (date !== null) {
				minimum = Math.min(minimum, date);
				maximum = Math.max(maximum, date);
			}
		}
	}
	const position = (date: number) => (maximum > minimum ? ((date - minimum) / (maximum - minimum) * 2 - 1) * longueurAxe : 0);
	for (const noeud of noeuds) {
		noeud.tx = 0;
		noeud.ty = 0;
		noeud.tz = 0;
		if (disposition === 'constellations' && !noeud.fantome) {
			const rang = racines.indexOf(noeud.racine);
			if (racines.length > 1 && rang >= 0) {
				const u = 1 - 2 * (rang + 0.5) / racines.length;
				const horizontal = Math.sqrt(1 - u * u);
				const angle = rang * 2.399963;
				noeud.tx = Math.cos(angle) * horizontal * rayonConstellations;
				noeud.ty = u * rayonConstellations * 0.8;
				noeud.tz = Math.sin(angle) * horizontal * rayonConstellations;
			}
			if (noeud.branche !== noeud.racine) {
				const rayonSousBranche = rayonConstellations * 0.3;
				const v = graine(noeud.branche, 4) * 2 - 1;
				const angleSousBranche = graine(noeud.branche, 5) * Math.PI * 2;
				const horizontalSousBranche = Math.sqrt(1 - v * v);
				noeud.tx += Math.cos(angleSousBranche) * horizontalSousBranche * rayonSousBranche;
				noeud.ty += v * rayonSousBranche;
				noeud.tz += Math.sin(angleSousBranche) * horizontalSousBranche * rayonSousBranche;
			}
		} else if (disposition === 'notions' && !noeud.fantome) {
			const notion = noeud.notion ? noeud.notionId : noeud.notionPrincipale?.notionId;
			const rang = notion === undefined ? -1 : notions.indexOf(notion);
			if (rang >= 0) {
				const u = 1 - 2 * (rang + 0.5) / notions.length;
				const horizontal = Math.sqrt(1 - u * u);
				const angle = rang * 2.399963;
				noeud.tx = Math.cos(angle) * horizontal * rayonConstellations;
				noeud.ty = u * rayonConstellations * 0.8;
				noeud.tz = Math.sin(angle) * horizontal * rayonConstellations;
			}
		} else if (disposition === 'temps' && !noeud.fantome && !noeud.notion) {
			const date = dates.get(noeud) ?? null;
			noeud.tz = date === null ? longueurAxe * PLAN_SANS_DATE : position(date);
		}
	}
	if (disposition !== 'temps' || !(maximum >= minimum)) return null;

	return {
		longueur: longueurAxe,
		planSansDate: longueurAxe * PLAN_SANS_DATE,
		sansDate: textes.sansDate,
		graduations: graduations(minimum, maximum, position, textes.moisAnnee),
	};
}

function graduations(minimum: number, maximum: number, position: (date: number) => number, moisAnnee: (ms: number) => string): { z: number; texte: string }[] {
	if (maximum === minimum) return [{ z: 0, texte: moisAnnee(minimum) }];
	const jours = (maximum - minimum) / JOUR_MS;
	const pasMois = jours > 3650 ? 24 : jours > 1500 ? 12 : jours > 700 ? 6 : jours > 300 ? 3 : 1;
	const date = new Date(minimum);
	date.setUTCDate(1);
	date.setUTCHours(0, 0, 0, 0);
	date.setUTCMonth(date.getUTCMonth() + 1);
	const resultat: { z: number; texte: string }[] = [];
	while (date.getTime() <= maximum && resultat.length < 40) {
		if (date.getUTCMonth() % pasMois === 0) resultat.push({ z: position(date.getTime()), texte: moisAnnee(date.getTime()) });
		date.setUTCMonth(date.getUTCMonth() + 1);
	}
	return resultat;
}

/**
 * Simulation de forces : ressorts des liens, répulsion entre nœuds (exacte, en n²), rappel vers les cibles. `avancer`
 * calcule autant de pas que le budget le permet et dit s'il en reste. Un nœud `epingle` ne bouge pas.
 */
export function creerSimulation(noeuds: Noeud[], liens: LienSimule[], disposition: string): Simulation {
	const regroupe = disposition === 'constellations' || disposition === 'notions';
	const forceLien = regroupe ? 0.12 : disposition === 'temps' ? 0.5 : 1;
	const rappel = regroupe ? 0.22 : 0.03;
	const rappelZ = disposition === 'temps' ? 0.7 : rappel;
	const degres = new Map(noeuds.map((noeud) => [noeud, 0]));
	for (const lien of liens) {
		degres.set(lien.source, (degres.get(lien.source) ?? 0) + 1);
		degres.set(lien.cible, (degres.get(lien.cible) ?? 0) + 1);
	}
	const ressorts = liens
		.filter((lien) => lien.source !== lien.cible)
		.map((lien) => {
			const degreSource = degres.get(lien.source)!;
			const degreCible = degres.get(lien.cible)!;
			return {
				source: lien.source,
				cible: lien.cible,
				force: forceLien / Math.min(degreSource || 1, degreCible || 1),
				partSource: degreCible / (degreSource + degreCible),
			};
		});
	const distanceMaximale2 = DISTANCE_MAXIMALE_REPULSION ** 2;
	let alpha = 1;
	let pasFaits = 0;

	function pas(): void {
		alpha += -alpha * DECROISSANCE_ALPHA;
		for (const ressort of ressorts) {
			const { source, cible } = ressort;
			let dx = cible.x + cible.vx - source.x - source.vx;
			let dy = cible.y + cible.vy - source.y - source.vy;
			let dz = cible.z + cible.vz - source.z - source.vz;
			let longueur = Math.hypot(dx, dy, dz) || 1e-6;
			longueur = ((longueur - DISTANCE_LIEN) / longueur) * alpha * ressort.force;
			dx *= longueur;
			dy *= longueur;
			dz *= longueur;
			cible.vx -= dx * ressort.partSource;
			cible.vy -= dy * ressort.partSource;
			cible.vz -= dz * ressort.partSource;
			source.vx += dx * (1 - ressort.partSource);
			source.vy += dy * (1 - ressort.partSource);
			source.vz += dz * (1 - ressort.partSource);
		}
		for (let premier = 0; premier < noeuds.length; premier++) {
			const a = noeuds[premier]!;
			for (let second = premier + 1; second < noeuds.length; second++) {
				const b = noeuds[second]!;
				let dx = b.x - a.x;
				let dy = b.y - a.y;
				let dz = b.z - a.z;
				let distance2 = dx * dx + dy * dy + dz * dz;
				if (distance2 >= distanceMaximale2) continue;
				if (distance2 < 1e-6) {
					dx = (graine(String(a.id), second) - 0.5) * 1e-3;
					dy = (graine(String(b.id), premier) - 0.5) * 1e-3;
					dz = 1e-3;
					distance2 = dx * dx + dy * dy + dz * dz;
				}
				distance2 = Math.max(distance2, 1);
				const poussee = (REPULSION * alpha) / distance2;
				a.vx += dx * poussee;
				a.vy += dy * poussee;
				a.vz += dz * poussee;
				b.vx -= dx * poussee;
				b.vy -= dy * poussee;
				b.vz -= dz * poussee;
			}
		}
		for (const noeud of noeuds) {
			if (noeud.epingle) {
				noeud.vx = 0;
				noeud.vy = 0;
				noeud.vz = 0;
				continue;
			}
			noeud.vx += (noeud.tx - noeud.x) * rappel * alpha;
			noeud.vy += (noeud.ty - noeud.y) * rappel * alpha;
			noeud.vz += (noeud.tz - noeud.z) * rappelZ * alpha;
			noeud.vx *= FREINAGE;
			noeud.vy *= FREINAGE;
			noeud.vz *= FREINAGE;
			noeud.x += noeud.vx;
			noeud.y += noeud.vy;
			noeud.z += noeud.vz;
		}
		pasFaits++;
	}

	return {
		avancer(budgetMs, horloge = () => performance.now()) {
			const debut = horloge();
			do {
				if (alpha <= ALPHA_MINIMUM) return false;
				pas();
			} while (horloge() - debut < budgetMs);
			return alpha > ALPHA_MINIMUM;
		},
		terminer() {
			while (alpha > ALPHA_MINIMUM) pas();
		},
		rechauffer(niveau) {
			alpha = Math.max(alpha, niveau);
		},
		pasFaits: () => pasFaits,
	};
}
