import { TAILLE_MAX_DOCUMENT } from '@mnemo/commun';
import { ErreurFichier } from '../../src/application/ports.ts';
import type { Coffre, Dependances, Depot, Fichiers, Historique, Index, IndicateurConsignes, PluginInstalle } from '../../src/application/ports.ts';
import { afterEach } from 'vitest';
import { estUuid } from '../../src/domaine/session.ts';
import { cheminDeLaRacine, estCache } from '../../src/domaine/chemin.ts';
import { contenuEnMemoire } from '../../src/application/contenu.ts';
import { extractionLocale } from '../../src/application/extraire-passages.ts';
import { extracteursReels } from '../../src/infra/extracteurs/index.ts';
import { ouvrirIndex } from '../../src/infra/index-sqlite.ts';
import { ouvrirLots } from '../../src/infra/etat-sqlite.ts';
import { REGLAGES_PAR_DEFAUT } from '../../src/domaine/reglages.ts';
import type { EtatIndicateur } from '../../src/domaine/refus-outil.ts';

/** Dépôt git absent : aucun dossier n'est un dépôt. */
export const DEPOT_ABSENT: Depot = { etat: async () => null, fichiersModifies: async () => ({ fichiers: [], total: 0 }), statuts: async () => null };

export type FauxCommit = { message: string; chemins: string[] | 'tout'; session?: string };

const ouverts: Pick<Index, 'fermer'>[] = [];

/** Comme le vrai coffre : chemin normalisé (« . », « .. », « / » répétés), refusé s'il sort de la mémoire. */
function dansLaMemoire(chemin: string): string {
	const segments: string[] = [];
	for (const segment of chemin.split('/')) {
		if (segment === '' || segment === '.') continue;
		if (segment === '..') {
			if (segments.pop() === undefined) throw new Error(`Chemin hors de la mémoire : ${chemin}`);
		} else segments.push(segment);
	}
	return segments.join('/');
}

const visible = (chemin: string) => chemin.endsWith('.md') && !estCache(chemin);
afterEach(() => {
	while (ouverts.length > 0) ouverts.pop()!.fermer();
});

/** Documents du dossier (hors mémoire), en mémoire : mêmes refus que le vrai port (`cheminDeLaRacine`, racine, taille). */
export type FauxDocuments = Fichiers & {
	documents: Map<string, { octets: Uint8Array; mtimeMs: number }>;
	/** Dépose ou remplace un document ; sa date de modification avance. */
	deposer(chemin: string, contenu: string | Uint8Array): void;
	retirer(chemin: string): void;
};

export function fauxDocuments(): FauxDocuments {
	const documents = new Map<string, { octets: Uint8Array; mtimeMs: number }>();
	let horloge = 1000;
	const verifier = (chemin: string): void => {
		const r = cheminDeLaRacine(chemin);
		if (!r.ok || r.chemin === '') {
			throw new ErreurFichier(`Chemin de document refusé : « ${chemin} ».`);
		}
	};
	return {
		documents,
		deposer(chemin, contenu) {
			documents.set(chemin, { octets: typeof contenu === 'string' ? new TextEncoder().encode(contenu) : contenu, mtimeMs: ++horloge });
		},
		retirer(chemin) {
			documents.delete(chemin);
		},
		async etat(chemin) {
			verifier(chemin);
			const d = documents.get(chemin);
			return d === undefined ? null : { mtimeMs: d.mtimeMs, taille: d.octets.byteLength };
		},
		async cheminReel(chemin) {
			verifier(chemin);
			if (documents.has(chemin)) return chemin;
			const cle = chemin.toLowerCase();
			return [...documents.keys()].find((c) => c.toLowerCase() === cle) ?? null;
		},
		async ouvrir(chemin) {
			verifier(chemin);
			const d = documents.get(chemin);
			if (d !== undefined && d.octets.byteLength > TAILLE_MAX_DOCUMENT) throw new ErreurFichier(`Document trop volumineux : « ${chemin} ».`);
			return d === undefined ? null : { ...contenuEnMemoire(d.octets), fermer: async () => {} };
		},
	};
}

export function fauxPorts(): Dependances & {
	fichiers: Map<string, string>;
	commits: FauxCommit[];
	modificationsManuelles: string[];
	documents: FauxDocuments;
	indicateur: IndicateurConsignes & { etat: EtatIndicateur };
	pluginsClaude: { plugins: PluginInstalle[]; avertissements: string[]; skills: string[] } & Dependances['pluginsClaude'];
} {
	const fichiers = new Map<string, string>();
	const commits: FauxCommit[] = [];
	const modificationsManuelles: string[] = [];
	const index = ouvrirIndex(':memory:');
	ouverts.push(index);
	// lots d'informations : la vraie table, en mémoire (fermée après chaque test)
	const lots = ouvrirLots(':memory:');
	ouverts.push(lots);
	const mtimes = new Map<string, number>();
	let compteur = 0;
	let compteurUuid = 0;
	let horloge = 0;

	const coffre: Coffre = {
		lire: async (chemin) => fichiers.get(dansLaMemoire(chemin)) ?? null,
		ecrire: async (brut, texte) => {
			const chemin = dansLaMemoire(brut);
			fichiers.set(chemin, texte);
			mtimes.set(chemin, ++horloge);
		},
		// Les dossiers n'existent que par leurs fichiers : un dossier sans fichier est absent ; seuls des .DS_Store : retirés.
		retirerDossierVide: async (brut) => {
			const dossier = dansLaMemoire(brut);
			if (dossier === '') return 'racine';
			const dedans = [...fichiers.keys()].filter((c) => c.startsWith(`${dossier}/`));
			if (fichiers.has(dossier)) return 'pas_un_dossier';
			if (dedans.length === 0) return 'absent';
			if (dedans.some((c) => c.slice(c.lastIndexOf('/') + 1) !== '.DS_Store')) return 'non_vide';
			for (const c of dedans) fichiers.delete(c);
			return 'retire';
		},
		deplacerDossier: async (de, vers) => {
			const [source, cible] = [dansLaMemoire(de), dansLaMemoire(vers)];
			const dedans = [...fichiers.keys()].filter((c) => c.startsWith(`${source}/`));
			if (dedans.length === 0) throw new Error(`${de} n'est pas un dossier.`);
			if (fichiers.has(cible) || [...fichiers.keys()].some((c) => c.startsWith(`${cible}/`))) throw new Error(`${vers} existe déjà.`);
			for (const c of dedans) {
				fichiers.set(`${cible}${c.slice(source.length)}`, fichiers.get(c)!);
				fichiers.delete(c);
				mtimes.set(`${cible}${c.slice(source.length)}`, ++horloge);
			}
		},
		retirerDossier: async (brut) => {
			const dossier = dansLaMemoire(brut);
			for (const c of [...fichiers.keys()]) if (c.startsWith(`${dossier}/`)) fichiers.delete(c);
		},
		supprimer: async (brut) => {
			const chemin = dansLaMemoire(brut);
			fichiers.delete(chemin);
			mtimes.delete(chemin);
		},
		lister: async (brut) => {
			const dossier = dansLaMemoire(brut);
			const prefixe = dossier === '' ? '' : `${dossier}/`;
			const fiches: string[] = [];
			const dossiers = new Set<string>();
			for (const chemin of [...fichiers.keys()].sort()) {
				if (!chemin.startsWith(prefixe) || !visible(chemin)) continue;
				const reste = chemin.slice(prefixe.length);
				if (reste.includes('/')) dossiers.add(`${prefixe}${reste.split('/')[0]!}`);
				else fiches.push(chemin);
			}
			return { fiches, dossiers: [...dossiers] };
		},
		toutesLesFiches: async () => [...fichiers.keys()].filter(visible).sort(),
		etats: async () =>
			[...fichiers.keys()]
				.filter(visible)
				.sort()
				.map((chemin) => ({ chemin, mtimeMs: mtimes.get(chemin) ?? 0, taille: Buffer.byteLength(fichiers.get(chemin) ?? '') })),
	};
	const historique: Historique = {
		initialiser: async () => {},
		modificationsEnCours: async () => [...modificationsManuelles],
		commit: async (message, chemins, session): Promise<string | null> => {
			commits.push({ message, chemins, ...(session !== undefined && estUuid(session) ? { session } : {}) });
			modificationsManuelles.length = 0;
			return `c${String(commits.length).padStart(6, '0')}`;
		},
		// Tous les commits des tests datent de « maintenant » (horloge fixe du faux système).
		journal: async (_depuis, limite) =>
			commits
				.map((c, i) => ({ hash: `c${String(i + 1).padStart(6, '0')}`, dateMs: new Date(2026, 10, 22, 12, 0, 0).getTime(), message: c.message, fichiers: c.chemins === 'tout' ? [] : c.chemins, session: c.session ?? null }))
				.reverse()
				.slice(0, limite),
	};

	const docs = fauxDocuments();
	return {
		coffre,
		historique,
		verrou: { avec: (action) => action() },
		index,
		lots,
		documents: docs,
		extraction: extractionLocale(extracteursReels()),
		// aucun modèle : la recherche se fait par les mots
		sens: { modele: () => null, vecteurs: async () => null },
		reranker: { noter: async () => null },
		// réglages par défaut ; un test les change en remplaçant `reglages`
		reglages: () => REGLAGES_PAR_DEFAUT,
		// plugins Claude Code : un test remplit `plugins` (et `skills` pour les skills personnelles)
		pluginsClaude: {
			plugins: [],
			avertissements: [],
			skills: [],
			async installes() {
				return { plugins: this.plugins, avertissements: this.avertissements };
			},
			async skillsPersonnelles() {
				return this.skills;
			},
		},
		// index en mémoire, donc présent : sans note, l'indicateur est strict ; un test le change par `etat`
		indicateur: {
			etat: { genre: 'absent', indexExiste: true } as EtatIndicateur,
			async noter(presentes: boolean, horodatageMs: number) {
				this.etat = { genre: 'note', presentes, horodatageMs };
			},
			async marquerIllisible() {
				this.etat = { genre: 'illisible' };
			},
			async lire() {
				return this.etat;
			},
		},
		systeme: {
			maintenant: () => new Date(2026, 10, 22, 12, 0, 0),
			nouvelId: () => `ID${String(++compteur).padStart(4, '0')}`,
			nouvelUuid: () => `00000000-0000-4000-8000-${String(++compteurUuid).padStart(12, '0')}`,
		},
		fichiers,
		commits,
		modificationsManuelles,
	};
}
