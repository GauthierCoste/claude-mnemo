/**
 * Réglages d'un dossier Mnemo (`.mnemo/reglages.json`, état local, jamais dans la mémoire versionnée) : la seule source des
 * valeurs réglables. Les défauts sont le comportement de Mnemo sans fichier. Lecture tolérante (un réglage absent ou invalide
 * prend son défaut, avec un avertissement : jamais d'exception) ; modification stricte (une valeur invalide refuse le lot).
 */
import { ACCENT_PAR_DEFAUT, CARACTERES_INVISIBLES, estCouleurHex, GROUPES_REGLAGES } from '@mnemo/commun';
import type { GroupeReglage } from '@mnemo/commun';
import { estTypeFiche } from './fiche.ts';
import type { TypeFiche } from './fiche.ts';
import { estObjet } from './valeurs.ts';

export const NAVIGATEURS = ['auto', 'chrome', 'edge', 'brave', 'arc', 'defaut'] as const;
export type Navigateur = (typeof NAVIGATEURS)[number];

export type Reglages = {
	projets: { marqueurs: string[] };
	contexte: {
		similariteRecherche: number;
		cartesPerimetre: number;
		cartesNommees: number;
		poidsInjection: number;
		demiVieInjection: number;
	};
	/** Groupe « Mémoire » : ses réglages sont les règles de SCHEMA.md (`reglages-memoire.ts`), jamais dans ce fichier. */
	memoire: Record<string, never>;
	recherche: {
		resultats: number;
		chronologie: number;
		graphe: number;
		reranker: number;
		poidsPosition: number;
		poidsConfiance: number;
		poidsMemoire: number;
		poidsFraicheur: number;
	};
	modeles: { inactiviteMinutes: number };
	archiviste: { typesAConfirmer: TypeFiche[] };
	service: { port: number; navigateur: Navigateur };
	/** Couleur principale de l'interface, `#rrggbb` ; l'interface la pose sur `--ac` à l'exécution. */
	interface: { accent: string };
};

/** Quand une modification prend effet : tout de suite, au redémarrage du service, au prochain démarrage des modèles. */
export type EffetReglage = 'immediat' | 'service' | 'modeles';
export type ValeurReglage = number | string | string[];

export type ChampReglage = {
	/** `<groupe>.<nom>`, comme dans le fichier. */
	cle: string;
	groupe: GroupeReglage;
	libelle: string;
	/** Une ligne. */
	explication: string;
	genre: 'entier' | 'decimal' | 'liste' | 'choix' | 'choix-multiple' | 'couleur';
	defaut: ValeurReglage;
	min?: number;
	max?: number;
	unite?: string;
	choix?: readonly { valeur: string; libelle: string }[];
	/** Choix calculés à la lecture (les types de fiche du coffre) au lieu d'une liste `choix`. */
	choixDynamiques?: 'types-de-fiche';
	effet: EffetReglage;
};

export const CHAMPS_REGLAGES: readonly ChampReglage[] = [
	{
		cle: 'contexte.cartesPerimetre',
		groupe: 'contexte',
		libelle: 'Cartes du périmètre au premier message',
		explication: 'Cartes (titre, chemin, première phrase) proposées au premier message pour les fiches du périmètre de la position.',
		genre: 'entier',
		defaut: 10,
		min: 0,
		max: 30,
		unite: 'cartes',
		effet: 'immediat',
	},
	{
		cle: 'contexte.cartesNommees',
		groupe: 'contexte',
		libelle: 'Cartes des fiches nommées par message',
		explication: 'Cartes proposées au plus, à chaque message, pour les fiches dont le titre ou un alias est cité dans le message.',
		genre: 'entier',
		defaut: 5,
		min: 0,
		max: 15,
		unite: 'cartes',
		effet: 'immediat',
	},
	{
		cle: 'contexte.poidsInjection',
		groupe: 'contexte',
		libelle: 'Poids d’une fiche injectée à la main sur ses voisines',
		explication: 'Ajouté à la note des fiches reliées à une fiche que tu injectes à la main, de 0 à 1 (0,25 : 25 points ; le sens du message vaut de 0 à 1).',
		genre: 'decimal',
		defaut: 0.25,
		min: 0,
		max: 1,
		effet: 'immediat',
	},
	{
		cle: 'contexte.demiVieInjection',
		groupe: 'contexte',
		libelle: 'Demi-vie de ce poids, en messages',
		explication: 'Messages (hors messages muets) après lesquels le poids d’une fiche injectée à la main sur ses voisines a diminué de moitié.',
		genre: 'entier',
		defaut: 3,
		min: 1,
		max: 20,
		unite: 'messages',
		effet: 'immediat',
	},
	{
		cle: 'contexte.similariteRecherche',
		groupe: 'contexte',
		libelle: 'Similarité minimale (recherche)',
		explication: 'Proximité de sens minimale d’un résultat de recherche (outils, interface, CLI), de 0 à 1.',
		genre: 'decimal',
		defaut: 0.45,
		min: 0.1,
		max: 0.95,
		effet: 'immediat',
	},
	{
		cle: 'archiviste.typesAConfirmer',
		groupe: 'archiviste',
		libelle: 'Types de fiche à confirmer',
		explication: 'Une information proposée dans une fiche de ces types attend ta confirmation avant d’être injectée.',
		genre: 'choix-multiple',
		defaut: [],
		choixDynamiques: 'types-de-fiche',
		effet: 'immediat',
	},
	{
		cle: 'recherche.resultats',
		groupe: 'recherche',
		libelle: 'Résultats par recherche',
		explication: 'Résultats rendus par `chercher` quand la demande n’en fixe pas le nombre (outils, interface).',
		genre: 'entier',
		defaut: 10,
		min: 1,
		max: 50,
		effet: 'immediat',
	},
	{
		cle: 'recherche.chronologie',
		groupe: 'recherche',
		libelle: 'Résultats de la chronologie',
		explication: 'Faits rendus par `chronologie` quand la demande n’en fixe pas le nombre.',
		genre: 'entier',
		defaut: 30,
		min: 1,
		max: 200,
		effet: 'immediat',
	},
	{
		cle: 'recherche.graphe',
		groupe: 'recherche',
		libelle: 'Fiches suivies par le graphe',
		explication: 'Premières fiches de la recherche dont les liens sont suivis (un saut).',
		genre: 'entier',
		defaut: 5,
		min: 0,
		max: 20,
		effet: 'immediat',
	},
	{
		cle: 'recherche.reranker',
		groupe: 'recherche',
		libelle: 'Candidats au reranker',
		explication: 'Premiers candidats reclassés par le reranker (s’il tourne) ; plus, c’est plus juste et plus lent.',
		genre: 'entier',
		defaut: 40,
		min: 5,
		max: 100,
		effet: 'immediat',
	},
	{
		cle: 'recherche.poidsPosition',
		groupe: 'recherche',
		libelle: 'Poids du projet courant',
		explication: 'Ajouté à la note d’un résultat situé dans le voisinage du projet courant, de 0 à 0,5 (0,1 : 10 points ; la pertinence vaut de 0 à 1).',
		genre: 'decimal',
		defaut: 0.1,
		min: 0,
		max: 0.5,
		effet: 'immediat',
	},
	{
		cle: 'recherche.poidsConfiance',
		groupe: 'recherche',
		libelle: 'Poids de la confiance',
		explication: 'Retiré à la note d’un résultat peu fiable, au prorata de ce qui manque à sa confiance, de 0 à 0,5 (0,1 : 10 points au plus).',
		genre: 'decimal',
		defaut: 0.1,
		min: 0,
		max: 0.5,
		effet: 'immediat',
	},
	{
		cle: 'recherche.poidsMemoire',
		groupe: 'recherche',
		libelle: 'Poids de la mémoire',
		explication: 'Ajouté à la note d’un résultat qui vient de la mémoire (fiches et faits), de 0 à 0,5 (0,05 : 5 points).',
		genre: 'decimal',
		defaut: 0.05,
		min: 0,
		max: 0.5,
		effet: 'immediat',
	},
	{
		cle: 'recherche.poidsFraicheur',
		groupe: 'recherche',
		libelle: 'Poids de la fraîcheur',
		explication: 'Ajouté à la note d’un résultat récent, de 0 à 0,5, réduit de moitié après un an (0,05 : 5 points au plus).',
		genre: 'decimal',
		defaut: 0.05,
		min: 0,
		max: 0.5,
		effet: 'immediat',
	},
	{
		cle: 'projets.marqueurs',
		groupe: 'projets',
		libelle: 'Marqueurs de projet',
		explication: 'Un dossier qui contient l’un de ces fichiers ou dossiers porte ◆ dans l’arbre des dossiers (casse ignorée).',
		genre: 'liste',
		defaut: ['.git', 'package.json', 'composer.json', 'pyproject.toml', 'Cargo.toml', 'go.mod'],
		effet: 'immediat',
	},
	{
		cle: 'modeles.inactiviteMinutes',
		groupe: 'modeles',
		libelle: 'Arrêt pour inactivité',
		explication: 'Sans service Mnemo, les modèles locaux s’arrêtent après ce temps sans requête. Avec le service, ils restent démarrés et s’arrêtent avec lui.',
		genre: 'entier',
		defaut: 15,
		min: 1,
		max: 240,
		unite: 'minutes',
		effet: 'modeles',
	},
	{
		cle: 'service.port',
		groupe: 'service',
		libelle: 'Port du service',
		explication: 'Port local de l’interface ; le changer change son adresse (favori, application installée, lanceur).',
		genre: 'entier',
		defaut: 4747,
		min: 1024,
		max: 65535,
		effet: 'service',
	},
	{
		cle: 'service.navigateur',
		groupe: 'service',
		libelle: 'Navigateur du lanceur',
		explication: 'Navigateur qui ouvre la fenêtre de Mnemo (« mnemo ouvrir » et le lanceur macOS).',
		genre: 'choix',
		defaut: 'auto',
		choix: [
			{ valeur: 'auto', libelle: 'Automatique (Chrome, sinon Edge, sinon par défaut)' },
			{ valeur: 'chrome', libelle: 'Google Chrome' },
			{ valeur: 'edge', libelle: 'Microsoft Edge' },
			{ valeur: 'brave', libelle: 'Brave' },
			{ valeur: 'arc', libelle: 'Arc' },
			{ valeur: 'defaut', libelle: 'Navigateur par défaut' },
		],
		effet: 'immediat',
	},
	{
		cle: 'interface.accent',
		groupe: 'interface',
		libelle: 'Couleur principale de l’interface',
		explication: 'Couleur des éléments actifs, des liens, des titres et du focus ; le logo ne change pas.',
		genre: 'couleur',
		defaut: ACCENT_PAR_DEFAUT,
		effet: 'immediat',
	},
];

const MARQUEURS_MAX = 50;
const MARQUEUR_LONGUEUR_MAX = 100;

const decrire = (v: ValeurReglage): string => (Array.isArray(v) ? (v.length === 0 ? 'aucun' : v.join(', ')) : String(v));

/** La valeur validée et normalisée, ou le motif du refus. */
export function validerValeur(champ: ChampReglage, v: unknown): { ok: true; valeur: ValeurReglage } | { ok: false; motif: string } {
	switch (champ.genre) {
		case 'entier':
		case 'decimal': {
			const entier = champ.genre === 'entier';
			if (typeof v !== 'number' || !Number.isFinite(v) || (entier && !Number.isInteger(v)) || v < champ.min! || v > champ.max!) {
				return { ok: false, motif: `${entier ? 'entier' : 'nombre'} de ${champ.min} à ${champ.max} attendu` };
			}
			return { ok: true, valeur: v };
		}
		case 'couleur': {
			if (!estCouleurHex(v)) return { ok: false, motif: 'couleur #rrggbb attendue (six chiffres hexadécimaux)' };
			return { ok: true, valeur: v.toLowerCase() };
		}
		case 'liste': {
			if (!Array.isArray(v) || v.length === 0 || v.length > MARQUEURS_MAX) return { ok: false, motif: `liste de 1 à ${MARQUEURS_MAX} noms attendue` };
			const noms: string[] = [];
			for (const brut of v) {
				const nom = typeof brut === 'string' ? brut.trim() : '';
				if (nom === '' || nom.length > MARQUEUR_LONGUEUR_MAX || /[/\\]/u.test(nom) || CARACTERES_INVISIBLES.test(nom) || nom === '.' || nom === '..') {
					return { ok: false, motif: 'noms de fichier ou de dossier attendus (sans « / » ni « \\ »)' };
				}
				if (!noms.some((n) => n.toLowerCase() === nom.toLowerCase())) noms.push(nom);
			}
			return { ok: true, valeur: noms };
		}
		case 'choix': {
			if (typeof v !== 'string' || !champ.choix!.some((c) => c.valeur === v)) return { ok: false, motif: `une valeur parmi ${champ.choix!.map((c) => c.valeur).join(', ')} attendue` };
			return { ok: true, valeur: v };
		}
		case 'choix-multiple': {
			if (champ.choixDynamiques === 'types-de-fiche') {
				if (!Array.isArray(v) || v.some((x) => !estTypeFiche(x))) return { ok: false, motif: 'une liste de types de fiche attendue' };
				return { ok: true, valeur: [...new Set(v as string[])] };
			}
			if (!Array.isArray(v) || v.some((x) => typeof x !== 'string' || !champ.choix!.some((c) => c.valeur === x))) {
				return { ok: false, motif: `une liste parmi ${champ.choix!.map((c) => c.valeur).join(', ')} attendue` };
			}
			return { ok: true, valeur: [...new Set(v as string[])] };
		}
	}
}

/** Valeur d'un réglage par sa clé (`<groupe>.<nom>`). */
export function valeurDuReglage(r: Reglages, cle: string): ValeurReglage {
	const [groupe, nom] = cle.split('.') as [string, string];
	return (r as unknown as Record<string, Record<string, ValeurReglage>>)[groupe]![nom]!;
}

function avecValeur(r: Reglages, cle: string, valeur: ValeurReglage): Reglages {
	const [groupe, nom] = cle.split('.') as [GroupeReglage, string];
	return { ...r, [groupe]: { ...r[groupe], [nom]: valeur } } as Reglages;
}

function defauts(): Reglages {
	const vide = Object.fromEntries(GROUPES_REGLAGES.map((g) => [g, {}])) as unknown as Reglages;
	return CHAMPS_REGLAGES.reduce((r, c) => avecValeur(r, c.cle, structuredClone(c.defaut)), vide);
}

export const REGLAGES_PAR_DEFAUT: Reglages = defauts();

/**
 * Réglages d'un contenu de fichier déjà analysé (`undefined` : pas de fichier). Tolérante : un réglage absent prend son défaut,
 * un réglage invalide aussi, avec un avertissement ; un réglage inconnu est ignoré avec un avertissement.
 */
export function lireReglages(brut: unknown): { reglages: Reglages; avertissements: string[] } {
	if (brut === undefined) return { reglages: defauts(), avertissements: [] };
	if (!estObjet(brut)) return { reglages: defauts(), avertissements: ['Fichier de réglages illisible (objet JSON attendu) : valeurs par défaut.'] };
	const avertissements: string[] = [];
	let reglages = defauts();
	for (const champ of CHAMPS_REGLAGES) {
		const groupe = brut[champ.groupe];
		if (!estObjet(groupe)) continue;
		const v = groupe[champ.cle.split('.')[1]!];
		if (v === undefined) continue;
		const r = validerValeur(champ, v);
		if (r.ok) reglages = avecValeur(reglages, champ.cle, r.valeur);
		else avertissements.push(`Réglage « ${champ.cle} » (${champ.libelle}) invalide : ${r.motif} ; défaut : ${decrire(champ.defaut)}.`);
	}
	for (const [groupe, contenu] of Object.entries(brut)) {
		if (!(GROUPES_REGLAGES as readonly string[]).includes(groupe)) {
			avertissements.push(`Réglage inconnu « ${groupe} » : ignoré.`);
			continue;
		}
		if (!estObjet(contenu)) {
			avertissements.push(`Groupe de réglages « ${groupe} » invalide (objet attendu) : défauts.`);
			continue;
		}
		for (const nom of Object.keys(contenu)) {
			if (!CHAMPS_REGLAGES.some((c) => c.cle === `${groupe}.${nom}`)) avertissements.push(`Réglage inconnu « ${groupe}.${nom} » : ignoré.`);
		}
	}
	return { reglages, avertissements };
}

/**
 * Applique `valeurs` (`{ "<groupe>.<nom>": valeur }`, `null` : rétablir le défaut) à `r` ; tout ou rien : une clé inconnue ou
 * une valeur invalide refuse le lot, avec un motif par erreur.
 */
export function modifierReglages(r: Reglages, valeurs: Record<string, unknown>): { ok: true; reglages: Reglages } | { ok: false; motifs: string[] } {
	if (!estObjet(valeurs)) return { ok: false, motifs: ['Objet { "<groupe>.<nom>": valeur } attendu.'] };
	const motifs: string[] = [];
	let suivant = r;
	for (const [cle, v] of Object.entries(valeurs)) {
		const champ = CHAMPS_REGLAGES.find((c) => c.cle === cle);
		if (champ === undefined) {
			motifs.push(`Réglage inconnu « ${cle} ».`);
			continue;
		}
		if (v === null) {
			suivant = avecValeur(suivant, cle, structuredClone(champ.defaut));
			continue;
		}
		const resultat = validerValeur(champ, v);
		if (resultat.ok) suivant = avecValeur(suivant, cle, resultat.valeur);
		else motifs.push(`${champ.libelle} (${cle}) : ${resultat.motif}.`);
	}
	return motifs.length > 0 ? { ok: false, motifs } : { ok: true, reglages: suivant };
}

/** Contenu du fichier : seulement les réglages qui diffèrent du défaut (un défaut qui change plus tard s'applique). */
export function reglagesEnFichier(r: Reglages): Record<string, unknown> {
	return fusionnerFichier(undefined, r, CHAMPS_REGLAGES.map((c) => c.cle));
}

/**
 * Contenu du fichier après une modification : celui lu (`brut`, non modifié), où seuls les réglages `cles` prennent leur
 * valeur de `r` (retirés s'ils valent leur défaut). Le reste est gardé tel quel : réglages d'une version plus récente,
 * entrées invalides que l'on n'a pas touchées (elles restent signalées).
 */
export function fusionnerFichier(brut: unknown, r: Reglages, cles: readonly string[]): Record<string, unknown> {
	const sortie: Record<string, unknown> = estObjet(brut) ? structuredClone(brut) : {};
	for (const champ of CHAMPS_REGLAGES) {
		if (!cles.includes(champ.cle)) continue;
		const nom = champ.cle.split('.')[1]!;
		const groupe = Object.hasOwn(sortie, champ.groupe) && estObjet(sortie[champ.groupe]) ? (sortie[champ.groupe] as Record<string, unknown>) : {};
		const v = valeurDuReglage(r, champ.cle);
		if (JSON.stringify(v) === JSON.stringify(champ.defaut)) delete groupe[nom];
		else groupe[nom] = structuredClone(v);
		if (Object.keys(groupe).length === 0) delete sortie[champ.groupe];
		else sortie[champ.groupe] = groupe;
	}
	return sortie;
}
