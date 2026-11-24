import { estCategorie } from './fait.ts';
import type { Nature } from './fait.ts';
import { estObjet } from './valeurs.ts';

export const TYPES_SOURCE = ['utilisateur', 'contrat', 'spec_validee', 'compte_rendu', 'email', 'note', 'session', 'deduction', 'inconnue'] as const;
export type TypeSource = (typeof TYPES_SOURCE)[number];

/** Types de source portés par une personne ou une session : la mention `src:` commence par le type. */
export const TYPES_PERSONNELS: readonly TypeSource[] = ['utilisateur', 'session', 'deduction'];

/** Type de source personnel annoncé par le préfixe d'une mention `src:`, sinon null. */
export function typeSourcePersonnel(source: string): TypeSource | null {
	for (const type of TYPES_PERSONNELS) {
		if (source === type || source.startsWith(`${type} `)) return type;
	}
	return null;
}

/** Un type de source hors utilisateur, session et déduction est un document : son contenu est encadré, jamais une instruction. */
export function estDocument(type: TypeSource): boolean {
	return !TYPES_PERSONNELS.includes(type);
}

/** Le plus strict de deux types : un document l'emporte sur un type personnel ; à défaut, `b`. */
export function typeLePlusStrict(a: TypeSource | null, b: TypeSource): TypeSource {
	return a !== null && estDocument(a) && !estDocument(b) ? a : b;
}

/** Type déclaré par une valeur (clé `type_source` d'une fiche de source), « inconnue » s'il est absent ou invalide. */
export function typeSourceOuInconnue(valeur: unknown): TypeSource {
	return estTypeSource(valeur) ? valeur : 'inconnue';
}

export function estTypeSource(valeur: unknown): valeur is TypeSource {
	return typeof valeur === 'string' && (TYPES_SOURCE as readonly string[]).includes(valeur);
}

export type Regles = {
	fiabilites: Record<TypeSource, number>;
	poids: Record<Nature, number>;
	seuilRappel: number;
	repetitionsPourMonter: number;
	categoriesAEnjeu: string[];
	anomalies: string[];
};

export const FIABILITES_PAR_DEFAUT: Record<TypeSource, number> = {
	utilisateur: 1,
	contrat: 1,
	spec_validee: 0.9,
	compte_rendu: 0.8,
	email: 0.7,
	note: 0.6,
	session: 0.6,
	deduction: 0.5,
	inconnue: 0.3,
};
export const POIDS_PAR_DEFAUT: Record<Nature, number> = { declare: 1, observe: 0.85, infere: 0.7 };
export const SEUIL_RAPPEL_PAR_DEFAUT = 0.4;
export const REPETITIONS_PAR_DEFAUT = 2;
const CATEGORIES_A_ENJEU_PAR_DEFAUT = ['montant', 'echeance', 'perimetre'];

const NATURES = Object.keys(POIDS_PAR_DEFAUT) as Nature[];

export const REGLES_PAR_DEFAUT: Regles = {
	fiabilites: { ...FIABILITES_PAR_DEFAUT },
	poids: { ...POIDS_PAR_DEFAUT },
	seuilRappel: SEUIL_RAPPEL_PAR_DEFAUT,
	repetitionsPourMonter: REPETITIONS_PAR_DEFAUT,
	categoriesAEnjeu: [...CATEGORIES_A_ENJEU_PAR_DEFAUT],
	anomalies: [],
};

function estProportion(valeur: unknown): valeur is number {
	return typeof valeur === 'number' && Number.isFinite(valeur) && valeur >= 0 && valeur <= 1;
}

function anomalie(cle: string, raison: string, parDefaut: string): string {
	return `SCHEMA.md : « ${cle} » ${raison} ; valeur par défaut appliquée : ${parDefaut}.`;
}

/** Lit les règles dans l'en-tête de SCHEMA.md déjà analysé ; une valeur invalide prend son défaut et laisse une anomalie. */
export function lireRegles(enTete: Record<string, unknown>): Regles {
	const anomalies: string[] = [];

	const proportion = (cle: string, valeur: unknown, parDefaut: number): number => {
		if (valeur === undefined) return parDefaut;
		if (estProportion(valeur)) return valeur;
		anomalies.push(anomalie(cle, 'doit être un nombre entre 0 et 1', String(parDefaut)));
		return parDefaut;
	};

	const poids = {} as Record<Nature, number>;
	for (const nature of NATURES) {
		poids[nature] = proportion(`poids_${nature}`, enTete[`poids_${nature}`], POIDS_PAR_DEFAUT[nature]);
	}

	const fiabilites = { ...FIABILITES_PAR_DEFAUT };
	const bloc = enTete['fiabilites'];
	if (bloc !== undefined) {
		if (estObjet(bloc)) {
			for (const type of TYPES_SOURCE) {
				fiabilites[type] = proportion(`fiabilites.${type}`, bloc[type], FIABILITES_PAR_DEFAUT[type]);
			}
		} else {
			anomalies.push(anomalie('fiabilites', 'doit être une table de fiabilités par type de source', 'fiabilités par défaut'));
		}
	}

	const seuilRappel = proportion('seuil_rappel', enTete['seuil_rappel'], SEUIL_RAPPEL_PAR_DEFAUT);

	let repetitionsPourMonter = REPETITIONS_PAR_DEFAUT;
	const repetitions = enTete['repetitions_pour_monter'];
	if (repetitions !== undefined) {
		if (Number.isInteger(repetitions) && (repetitions as number) >= 1) {
			repetitionsPourMonter = repetitions as number;
		} else {
			anomalies.push(anomalie('repetitions_pour_monter', 'doit être un entier supérieur ou égal à 1', String(REPETITIONS_PAR_DEFAUT)));
		}
	}

	let categoriesAEnjeu = [...CATEGORIES_A_ENJEU_PAR_DEFAUT];
	const categories = enTete['categories_a_enjeu'];
	if (categories !== undefined) {
		if (Array.isArray(categories) && categories.every((c) => estCategorie(c))) {
			categoriesAEnjeu = [...(categories as string[])];
		} else {
			anomalies.push(anomalie('categories_a_enjeu', 'doit être une liste de catégories en minuscules, chiffres, « _ » ou « - » (40 caractères au plus)', CATEGORIES_A_ENJEU_PAR_DEFAUT.join(', ')));
		}
	}

	return { fiabilites, poids, seuilRappel, repetitionsPourMonter, categoriesAEnjeu, anomalies };
}

/** Confiance d'un fait : fiabilité de la source × poids de la nature, en pourcentage entier (0–100). */
export function confiance(regles: Regles, source: TypeSource, nature: Nature): number {
	const valeur = Math.round(100 * regles.fiabilites[source] * regles.poids[nature]);
	return Math.min(100, Math.max(0, valeur));
}
