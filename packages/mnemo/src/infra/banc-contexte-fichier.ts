/**
 * Le fichier des jugements du banc du contexte (`.mnemo/banc-contexte.json`, état local, jamais commité) : lecture validée,
 * écriture entière (fichier voisin puis renommage). Partagé par le CLI (`mnemo banc contexte`) et le service (page Entraîner).
 */
import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { JUGEMENTS } from '../application/banc-contexte.ts';
import type { CandidateAJuger, CasContexte, Jugement, Prejugement, VarianteRequete } from '../application/banc-contexte.ts';
import { LISTES_DU_BANC } from '../application/banc-signaux.ts';
import type { Signaux } from '../application/banc-signaux.ts';
import { DOSSIER_LOCAL } from '../domaine/dossier-memoire.ts';
import type { InjectionManuelle } from '../domaine/signal-injection.ts';
import { estObjet } from '../domaine/valeurs.ts';

/** Un fichier des jugements mal formé : le motif, lisible. */
export class ErreurBancContexte extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'ErreurBancContexte';
	}
}

/** Cas du banc `contexte` : `.mnemo/banc-contexte.json` (état local, ignoré par git, jamais commité). */
export function fichierBancContexte(racine: string): string {
	return join(racine, DOSSIER_LOCAL, 'banc-contexte.json');
}

const textes = (v: unknown, nom: string, i: number): string[] => {
	if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) throw new ErreurBancContexte(`banc-contexte.json, cas ${i + 1} : « ${nom} » doit être une liste de textes.`);
	return v as string[];
};
const texteOuNull = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const nombreOuNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Signaux d'une candidate ; `signalSession`, `apriori` et `cosinusZ`, venus après les premières extractions, sont facultatifs. */
function lireSignaux(v: unknown): Signaux | undefined {
	if (!estObjet(v)) return undefined;
	const signalSession = nombreOuNull(v['signalSession']);
	const apriori = nombreOuNull(v['apriori']);
	// absent des cas extraits avant lui
	const cosinusZ = v['cosinusZ'] === null ? null : nombreOuNull(v['cosinusZ']);
	return {
		logit: nombreOuNull(v['logit']),
		cosinus: nombreOuNull(v['cosinus']),
		cosinusRelatif: nombreOuNull(v['cosinusRelatif']),
		// null : le message n'a pas de mots cherchables ; absent (ou illisible) : 0, comme aux premières extractions
		bm25Relatif: v['bm25Relatif'] === null ? null : (nombreOuNull(v['bm25Relatif']) ?? 0),
		...(signalSession === null ? {} : { signalSession }),
		...(apriori === null ? {} : { apriori }),
		...(v['cosinusZ'] === undefined ? {} : { cosinusZ }),
	};
}

function lireCandidates(v: unknown, i: number): CandidateAJuger[] {
	if (!Array.isArray(v)) throw new ErreurBancContexte(`banc-contexte.json, cas ${i + 1} : « candidates » doit être une liste.`);
	return v.map((x: unknown): CandidateAJuger => {
		if (!estObjet(x) || typeof x['chemin'] !== 'string') throw new ErreurBancContexte(`banc-contexte.json, cas ${i + 1} : chaque candidate doit avoir un « chemin ».`);
		const signaux: Partial<Record<VarianteRequete, Signaux>> = {};
		const brut = estObjet(x['signaux']) ? x['signaux'] : {};
		for (const variante of ['seule', 'jointe'] as const) {
			const s = lireSignaux(brut[variante]);
			if (s !== undefined) signaux[variante] = s;
		}
		const listes: unknown[] = Array.isArray(x['listes']) ? x['listes'] : [];
		return {
			chemin: x['chemin'],
			titre: typeof x['titre'] === 'string' ? x['titre'] : x['chemin'],
			ligne: typeof x['ligne'] === 'string' ? x['ligne'] : '',
			listes: LISTES_DU_BANC.filter((l) => listes.includes(l)),
			signaux,
			...(typeof x['empreinte'] === 'string' ? { empreinte: x['empreinte'] } : {}),
			...(x['horsPile'] === true ? { horsPile: true } : {}),
		};
	});
}

function lireInjections(v: unknown[]): InjectionManuelle[] {
	return v.flatMap((x) => (estObjet(x) && typeof x['chemin'] === 'string' && typeof x['messages'] === 'number' ? [{ chemin: x['chemin'], messages: x['messages'] }] : []));
}

function lireJugements(v: unknown, i: number): Record<string, Jugement> {
	if (!estObjet(v)) throw new ErreurBancContexte(`banc-contexte.json, cas ${i + 1} : « jugements » doit être un objet (chemin → jugement).`);
	const jugements: Record<string, Jugement> = {};
	for (const [chemin, j] of Object.entries(v)) {
		if (!JUGEMENTS.includes(j as Jugement)) throw new ErreurBancContexte(`banc-contexte.json, cas ${i + 1} : jugement inconnu pour ${chemin} (${JUGEMENTS.join(', ')}).`);
		jugements[chemin] = j as Jugement;
	}
	return jugements;
}

function lirePrejugements(v: unknown, i: number): Record<string, Prejugement> {
	if (!estObjet(v)) throw new ErreurBancContexte(`banc-contexte.json, cas ${i + 1} : « prejugements » doit être un objet (chemin → proposition du juge).`);
	const prejugements: Record<string, Prejugement> = {};
	for (const [chemin, p] of Object.entries(v)) {
		const confiance = estObjet(p) ? p['confiance'] : undefined;
		if (!estObjet(p) || !JUGEMENTS.includes(p['jugement'] as Jugement) || typeof confiance !== 'number' || !(confiance >= 0 && confiance <= 1) || typeof p['raison'] !== 'string') {
			throw new ErreurBancContexte(`banc-contexte.json, cas ${i + 1} : proposition du juge mal formée pour ${chemin} (jugement, confiance de 0 à 1, raison).`);
		}
		prejugements[chemin] = { jugement: p['jugement'] as Jugement, confiance, raison: p['raison'] };
	}
	return prejugements;
}

/** Cas d'un fichier `banc-contexte.json` (liste de cas) ; erreur lisible sur un cas mal formé. */
export function lireCasContexte(texte: string): CasContexte[] {
	let brut: unknown;
	try {
		brut = JSON.parse(texte);
	} catch {
		throw new ErreurBancContexte('banc-contexte.json : JSON invalide.');
	}
	if (!Array.isArray(brut)) throw new ErreurBancContexte('banc-contexte.json : une liste de cas est attendue.');
	return brut.map((c: unknown, i): CasContexte => {
		if (!estObjet(c) || typeof c['nom'] !== 'string' || typeof c['position'] !== 'string' || typeof c['message'] !== 'string') {
			throw new ErreurBancContexte(`banc-contexte.json, cas ${i + 1} : « nom », « position » et « message » (textes) sont attendus.`);
		}
		const precedent = c['precedent'];
		return {
			nom: c['nom'],
			position: c['position'],
			message: c['message'],
			premier: c['premier'] === true,
			attendues: textes(c['attendues'] ?? [], 'attendues', i),
			interdites: textes(c['interdites'] ?? [], 'interdites', i),
			silence: c['silence'] === true,
			...(c['injectees'] === undefined ? {} : { injectees: textes(c['injectees'], 'injectees', i) }),
			...(typeof c['session'] === 'string' ? { session: c['session'] } : {}),
			...(typeof c['rang'] === 'number' ? { rang: c['rang'] } : {}),
			...(typeof precedent === 'string' || precedent === null ? { precedent } : {}),
			...(c['candidates'] === undefined ? {} : { candidates: lireCandidates(c['candidates'], i) }),
			...(c['jugements'] === undefined ? {} : { jugements: lireJugements(c['jugements'], i) }),
			...(c['saute'] === true ? { saute: true } : {}),
			...(c['prejugements'] === undefined ? {} : { prejugements: lirePrejugements(c['prejugements'], i) }),
			...(typeof c['valideLe'] === 'string' ? { valideLe: c['valideLe'] } : {}),
			...(typeof c['horodatageMs'] === 'number' ? { horodatageMs: c['horodatageMs'] } : {}),
			...(typeof c['extraitLe'] === 'string' ? { extraitLe: c['extraitLe'] } : {}),
			...(estObjet(c['modeles']) ? { modeles: { sens: c['modeles']['sens'] === true, reranker: c['modeles']['reranker'] === true } } : {}),
			...(estObjet(c['gguf']) ? { gguf: { sens: texteOuNull(c['gguf']['sens']), reranker: texteOuNull(c['gguf']['reranker']) } } : {}),
			...(Array.isArray(c['injectionsManuelles']) ? { injectionsManuelles: lireInjections(c['injectionsManuelles']) } : {}),
		};
	});
}

/** Cas du fichier ; aucun cas s'il n'existe pas encore. */
export async function lireCasDuFichier(fichier: string): Promise<CasContexte[]> {
	let texte: string;
	try {
		texte = await readFile(fichier, 'utf8');
	} catch (e) {
		if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
		throw e;
	}
	return lireCasContexte(texte);
}

/** Numéro du fichier provisoire suivant : deux écritures du même processus n'ont jamais le même. */
let ecritures = 0;

/**
 * Enregistre les cas sans jamais laisser un fichier à moitié écrit (fichier voisin propre à cette écriture, puis renommage ;
 * deux écritures du même processus, le service par exemple, ne se marchent pas dessus). En échec, le fichier provisoire est
 * retiré : un fichier provisoire numéroté ne serait jamais repris par une écriture suivante.
 */
export async function enregistrerCas(fichier: string, cas: readonly CasContexte[]): Promise<void> {
	const provisoire = `${fichier}.${process.pid}.${++ecritures}.tmp`;
	try {
		await writeFile(provisoire, `${JSON.stringify(cas, null, 2)}\n`);
		await rename(provisoire, fichier);
	} catch (erreur) {
		await rm(provisoire, { force: true }).catch(() => {});
		throw erreur;
	}
}
