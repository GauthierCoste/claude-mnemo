import { EMPLACEMENTS_PAR_DEFAUT, PROJET_PAR_DEFAUT } from '@mnemo/commun';
import { cleDeCasse, ficheDeDossier, nomDeFichier } from '../domaine/chemin.ts';
import { lireFiche } from '../domaine/fiche.ts';
import type { Fiche } from '../domaine/fiche.ts';
import { MARQUE_SECRET, masquerSecrets } from '../domaine/secrets.ts';
import type { Session } from '../domaine/session.ts';
import { cheminDeFiche, ecrireEtCommiter, enFichier, ficheVide, sousVerrou } from './commun.ts';
import type { Dependances, Pilotage } from './ports.ts';

/** Synthèse de l'épisode écrit sans IA. */
export const SYNTHESE_MINIMALE = 'Épisode minimal, écrit sans IA.';
/** git au-delà de ce délai : abandonné, l'épisode s'écrit sans fichiers. */
export const DELAI_GIT_EPISODE_MS = 2000;
/** Fichiers touchés notés dans un épisode, au plus. */
export const FICHIERS_EPISODE_MAX = 50;
/**
 * Avec une échéance (hook sans service) : temps gardé pour l'écriture sous verrou (état git de la mémoire, fiches, commit).
 * Mesuré sur une mémoire réelle (macOS, charge 6 à 8, verrou libre) : 62 à 67 ms pour dix écritures ; gardé à 450 ms (≈ ×7,
 * pour une machine plus chargée). En deçà, rien n'est commencé : l'épisode viendra plus tard (`reprendreAuDemarrage`).
 */
export const RESERVE_ECRITURE_MS = 450;
/** Noms essayés pour un épisode dont le nom est déjà pris par une autre session (« titre », « titre-2 »…). */
const ESSAIS_DE_NOM = 50;

const deux = (n: number) => String(n).padStart(2, '0');
/** Date locale « AAAA-MM-JJ » d'un instant. */
export function dateLocale(ms: number): string {
	const d = new Date(ms);
	return `${d.getFullYear()}-${deux(d.getMonth() + 1)}-${deux(d.getDate())}`;
}
/** Instant local « AAAA-MM-JJ HH:MM ». */
export function horodatageLocal(ms: number): string {
	const d = new Date(ms);
	return `${dateLocale(ms)} ${deux(d.getHours())}:${deux(d.getMinutes())}`;
}

/** Dossier d'épisodes d'un projet (nom tiré du projet) ; « divers » pour un projet vide ou qui ne donne pas un chemin valide. */
export function dossierEpisodes(projet: string): string {
	const divers = `${EMPLACEMENTS_PAR_DEFAUT.episodes}/${PROJET_PAR_DEFAUT}`;
	if (projet.trim() === '') return divers;
	const dossier = `${EMPLACEMENTS_PAR_DEFAUT.episodes}/${nomDeFichier(projet)}`;
	return cheminDeFiche(`${dossier}/x.md`) === null ? divers : dossier;
}

/** Un épisode minimal porte `minimal: true` dans son frontmatter ; celui de Claude ne le porte jamais. */
export const estMinimal = (fiche: Fiche): boolean => fiche.donnees.minimal === true;

/** Texte sans secret (jetons, clés : `[secret masqué]`). */
const masquer = (texte: string): string => masquerSecrets(texte).texte;

/** Fiche `episode` de `chemin` lue sur le disque, si sa donnée `session` vaut `session` (toute session si null) ; null sinon. */
async function lireEpisode(dep: Dependances, chemin: string, session: string | null): Promise<{ chemin: string; fiche: Fiche } | null> {
	const texte = await dep.coffre.lire(chemin);
	if (texte === null || (session !== null && !texte.includes(session))) return null;
	try {
		const fiche = lireFiche(chemin, texte);
		if (fiche.type !== 'episode' || typeof fiche.donnees.session !== 'string') return null;
		return session === null || fiche.donnees.session === session ? { chemin, fiche } : null;
	} catch {
		return null;
	}
}

/** Fiches `episode` indexées, où qu'elles soient rangées ; aucune si l'index est illisible. */
async function episodesIndexes(dep: Dependances): Promise<{ chemin: string; session: string | null; projet: string | null }[]> {
	const elements = await dep.index.elements({ genres: ['fiche'], typesFiche: ['episode'] }).catch(() => []);
	return elements.map((e) => ({ chemin: e.chemin, session: e.sessionEpisode ?? null, projet: e.projetEpisode ?? null }));
}

/** Vrai si les deux noms de projet désignent le même dossier d'épisodes (forme de nom de fichier, casse ignorée). */
export const memeProjet = (a: string, b: string): boolean => cleDeCasse(dossierEpisodes(a)) === cleDeCasse(dossierEpisodes(b));

/**
 * Épisode de la session `session`, par sa donnée `session` seule (le projet d'une session peut changer en cours de route) :
 * d'abord dans l'index, où qu'il soit rangé, puis dans le dossier par défaut du projet (un épisode écrit depuis la dernière
 * synchronisation n'est pas encore indexé). Une fiche illisible est ignorée. `fiches` : les fiches du dossier par défaut.
 */
async function chercherEpisode(dep: Dependances, session: string, projet: string): Promise<{ trouve: { chemin: string; fiche: Fiche } | null; fiches: string[] }> {
	const { fiches } = await dep.coffre.lister(dossierEpisodes(projet));
	for (const indexe of await episodesIndexes(dep)) {
		if (indexe.session !== session) continue;
		const trouve = await lireEpisode(dep, indexe.chemin, session);
		if (trouve !== null) return { trouve, fiches };
	}
	for (const chemin of fiches) {
		const trouve = await lireEpisode(dep, chemin, session);
		if (trouve !== null) return { trouve, fiches };
	}
	return { trouve: null, fiches };
}

/** Épisode de la session dans le dossier de son projet (par son id, quelle que soit sa date), ou null. */
export async function trouverEpisode(dep: Dependances, session: string, projet: string): Promise<{ chemin: string; fiche: Fiche } | null> {
	return (await chercherEpisode(dep, session, projet)).trouve;
}

/**
 * Épisodes du projet, par id de session (rattrapage groupé, historique des sessions) : ceux que l'index rattache au projet
 * (donnée `projet`), où qu'ils soient rangés, et ceux du dossier par défaut du projet. Une fiche illisible est ignorée.
 */
export async function episodesDuProjet(dep: Dependances, projet: string): Promise<Map<string, { chemin: string; fiche: Fiche }>> {
	const episodes = new Map<string, { chemin: string; fiche: Fiche }>();
	const chemins = new Set((await episodesIndexes(dep)).filter((e) => e.projet !== null && memeProjet(e.projet, projet)).map((e) => e.chemin));
	for (const chemin of (await dep.coffre.lister(dossierEpisodes(projet))).fiches) chemins.add(chemin);
	for (const chemin of chemins) {
		const trouve = await lireEpisode(dep, chemin, null);
		if (trouve !== null) episodes.set(trouve.fiche.donnees.session as string, trouve);
	}
	return episodes;
}

/**
 * Chemin libre pour un nouvel épisode : `<dossier>/<date>-<nom du titre>.md`, suffixé si une fiche du dossier le prend (casse
 * comprise). Seules les fiches du dossier du projet (`fiches`, déjà lues) sont comparées.
 */
function cheminLibre(projet: string, date: string, titre: string, fiches: string[]): string {
	const base = `${dossierEpisodes(projet)}/${date}-${nomDeFichier(titre)}`;
	const existantes = new Set(fiches.map(cleDeCasse));
	for (let n = 1; n <= ESSAIS_DE_NOM; n++) {
		const chemin = cheminDeFiche(n === 1 ? `${base}.md` : `${base}-${n}.md`);
		if (chemin !== null && !existantes.has(cleDeCasse(chemin))) return chemin;
	}
	throw new Error(`Aucun nom libre pour l'épisode « ${titre} ».`);
}

/**
 * Fiches `dossier` manquantes de `episodes/` et de `episodes/<projet>/` (sans parcourir toute la mémoire) ; une variante de
 * casse déjà là compte comme présente.
 */
async function dossiersDEpisodes(dep: Dependances, projet: string, fiches: string[]): Promise<Fiche[]> {
	const dossier = dossierEpisodes(projet);
	const manquantes: Fiche[] = [];
	const racine = ficheDeDossier(EMPLACEMENTS_PAR_DEFAUT.episodes);
	const deRacine = (await dep.coffre.lister(EMPLACEMENTS_PAR_DEFAUT.episodes)).fiches.map(cleDeCasse);
	if (!deRacine.includes(cleDeCasse(racine))) manquantes.push(ficheVide(dep, racine, 'dossier', EMPLACEMENTS_PAR_DEFAUT.episodes));
	const duProjet = ficheDeDossier(dossier);
	if (!fiches.map(cleDeCasse).includes(cleDeCasse(duProjet))) manquantes.push(ficheVide(dep, duProjet, 'dossier', dossier.slice(dossier.lastIndexOf('/') + 1)));
	return manquantes;
}

/**
 * Ce qu'un épisode contient. `date` : celle du nom de fichier (début de la session, sinon jour de l'écriture) ; `titreDeRepli` :
 * le titre si celui donné n'est qu'un secret ; `donnees` : celles du frontmatter, dans l'ordre (session, profil, debut, fin,
 * branche, objectif, fichiers, source, minimal).
 */
export type ContenuEpisode = {
	session: string;
	projet: string;
	date: string;
	titre: string;
	titreDeRepli: string;
	synthese: string;
	decisions: string[];
	resultat: string;
	donnees: Record<string, unknown>;
};

/** Secrets masqués partout où l'épisode les écrirait : titre (donc chemin et commit), textes, objectif, branche, fichiers. */
function sansSecrets(c: ContenuEpisode): ContenuEpisode {
	const titre = masquer(c.titre).trim();
	const donnees = { ...c.donnees };
	for (const cle of ['objectif', 'branche']) if (typeof donnees[cle] === 'string') donnees[cle] = masquer(donnees[cle]);
	if (Array.isArray(donnees.fichiers)) donnees.fichiers = donnees.fichiers.map((f) => (typeof f === 'string' ? masquer(f) : f));
	return {
		...c,
		titre: titre.replaceAll(MARQUE_SECRET, '').trim() === '' ? c.titreDeRepli : titre,
		synthese: masquer(c.synthese),
		decisions: c.decisions.map(masquer),
		resultat: masquer(c.resultat),
		donnees,
	};
}

export type EcritureEpisode = { statut: 'ecrit'; chemin: string; commit: string } | { statut: 'inchange'; chemin: string } | { statut: 'garde'; chemin: string };

/** Fiche d'épisode (identifiant de l'ancienne gardé), secrets masqués. */
export function ficheEpisode(dep: Dependances, chemin: string, brut: ContenuEpisode, ancienne: Fiche | null): Fiche {
	const contenu = sansSecrets(brut);
	const donnees = { session: contenu.session, projet: contenu.projet, ...structuredClone(contenu.donnees) };
	const fiche = ficheVide(dep, chemin, 'episode', contenu.titre.trim(), donnees);
	if (ancienne !== null && ancienne.id !== '') fiche.id = ancienne.id;
	fiche.synthese = contenu.synthese.trim();
	if (contenu.decisions.length > 0) fiche.autresSections.push({ titre: 'Décisions', corps: contenu.decisions.map((d) => `- ${d.trim()}`).join('\n') });
	if (contenu.resultat.trim() !== '') fiche.autresSections.push({ titre: 'Résultat', corps: contenu.resultat.trim() });
	return fiche;
}

/** Fiche et texte qu'aurait l'épisode (chemin provisoire) : de quoi vérifier qu'il se relit, avant de prendre le verrou. */
export function enTexteEpisode(dep: Dependances, contenu: ContenuEpisode): { chemin: string; fiche: Fiche; texte: string } {
	const chemin = `${dossierEpisodes(contenu.projet)}/relecture.md`;
	const fiche = ficheEpisode(dep, chemin, contenu, null);
	return { chemin, fiche, texte: enFichier(dep, fiche).texte };
}

/**
 * Écrit l'épisode de la session (appelant sous verrou) : une fiche par session, remplacée sur place si elle existe (même
 * chemin). `minimal` : un épisode de Claude déjà là est gardé (`garde`), et avec `siAbsent`, tout épisode déjà là. Un texte
 * identique n'est pas réécrit (`inchange`). Secrets masqués (chemin, contenu, commit). Seul le dossier du projet est lu.
 * Un commit `mnemo: episode <chemin>` par écriture. Un épisode minimal remplacé par celui de Claude est renommé d'après le
 * titre de Claude (`<date>-<titre>.md`), dans le même commit.
 */
export async function ecrireEpisode(dep: Dependances, contenu: ContenuEpisode, mode: { minimal: boolean; siAbsent?: boolean }): Promise<EcritureEpisode> {
	const { trouve: existant, fiches } = await chercherEpisode(dep, contenu.session, contenu.projet);
	if (existant !== null && mode.minimal && (mode.siAbsent === true || !estMinimal(existant.fiche))) return { statut: 'garde', chemin: existant.chemin };
	// Un épisode minimal (nommé d'après l'objectif de la session) que Claude remplace prend le nom de son titre ; un épisode
	// rangé ailleurs que dans le dossier du projet garde son chemin.
	const renomme = existant !== null && !mode.minimal && estMinimal(existant.fiche) && fiches.includes(existant.chemin);
	const titre = sansSecrets(contenu).titre;
	const chemin = existant === null ? cheminLibre(contenu.projet, contenu.date, titre, fiches) : renomme ? cheminLibre(contenu.projet, contenu.date, titre, fiches.filter((c) => c !== existant.chemin)) : existant.chemin;
	const fiche = ficheEpisode(dep, chemin, contenu, existant?.fiche ?? null);
	const { texte } = enFichier(dep, fiche);
	if (existant !== null && (await dep.coffre.lire(chemin)) === texte) return { statut: 'inchange', chemin };
	const dossiers = await dossiersDEpisodes(dep, contenu.projet, fiches);
	const commit = await ecrireEtCommiter(dep, [{ chemin, texte }, ...dossiers.map((f) => enFichier(dep, f))], `mnemo: episode ${chemin}`, existant !== null && existant.chemin !== chemin ? [existant.chemin] : []);
	return { statut: 'ecrit', chemin, commit };
}

/** Valeur de `promesse`, ou `repli` après `delaiMs` ou sur une erreur. */
async function avantDelai<T>(promesse: Promise<T>, delaiMs: number, repli: T): Promise<T> {
	let minuteur: ReturnType<typeof setTimeout> | undefined;
	const delai = new Promise<T>((resoudre) => {
		minuteur = setTimeout(() => resoudre(repli), Math.max(0, delaiMs));
	});
	try {
		return await Promise.race([promesse.catch(() => repli), delai]);
	} finally {
		clearTimeout(minuteur);
	}
}

/** Branche (celle notée au début, sinon celle du dépôt) et fichiers modifiés depuis le début ; toute erreur → rien. */
async function infosGit(pil: Pick<Pilotage, 'depot'>, session: Session): Promise<{ branche: string | null; fichiers: string[]; total: number }> {
	const [etat, modifies] = await Promise.all([
		session.branche !== null ? Promise.resolve(null) : pil.depot.etat(session.dossier).catch(() => null),
		pil.depot.fichiersModifies(session.dossier, session.commitDebut, FICHIERS_EPISODE_MAX).catch(() => ({ fichiers: [], total: 0 })),
	]);
	return { branche: session.branche ?? etat?.branche ?? null, ...modifies };
}

/** Résultat d'un épisode minimal : vide si tous les fichiers modifiés sont notés ; sinon leur nombre réel (la liste reste dans `fichiers`). */
function resultatMinimal(fichiers: string[], total: number): string {
	if (total <= fichiers.length) return '';
	return `${total} fichiers modifiés, dont les ${fichiers.length} premiers :`;
}

/**
 * Options : `echeance` (`Date.now()`) : celle de l'appelant (hook) — l'écriture n'est commencée que s'il reste au moins
 * `RESERVE_ECRITURE_MS` une fois le verrou pris, et l'attente du verrou s'arrête à temps ; `delaiGitMs` : git abandonné
 * au-delà (2 s par défaut) ; `siAbsent` : rien si la session a déjà un épisode (rattrapage).
 */
export type OptionsEpisodeMinimal = { echeance?: number; delaiGitMs?: number; siAbsent?: boolean };

/**
 * Épisode minimal, sans IA : objectif, dates, branche, fichiers modifiés d'après git (git en erreur ou
 * trop lent : sans fichiers), `minimal: true`. Un épisode de Claude déjà écrit est gardé ; un épisode minimal est mis à jour
 * sur place. Rend le chemin écrit, ou null si rien n'est écrit (gardé, inchangé, échéance trop proche).
 */
export async function ecrireEpisodeMinimal(dep: Dependances, pil: Pick<Pilotage, 'depot'>, session: Session, finMs: number, options: OptionsEpisodeMinimal = {}): Promise<string | null> {
	const reste = (): number => (options.echeance === undefined ? Number.POSITIVE_INFINITY : options.echeance - Date.now() - RESERVE_ECRITURE_MS);
	// un épisode déjà là qui doit rester : pas besoin de git
	const avant = await trouverEpisode(dep, session.id, session.projet);
	if (avant !== null && (options.siAbsent === true || !estMinimal(avant.fiche))) return null;
	const git = await avantDelai(infosGit(pil, session), Math.min(options.delaiGitMs ?? DELAI_GIT_EPISODE_MS, reste()), { branche: session.branche, fichiers: [], total: 0 });
	if (reste() <= 0) return null;
	const repli = `Session ${session.profil}`;
	const contenu: ContenuEpisode = {
		session: session.id,
		projet: session.projet,
		date: dateLocale(session.creeeMs),
		titre: session.objectif ?? repli,
		titreDeRepli: repli,
		synthese: SYNTHESE_MINIMALE,
		decisions: [],
		resultat: resultatMinimal(git.fichiers, git.total),
		donnees: {
			session: session.id,
			profil: session.profil,
			debut: horodatageLocal(session.creeeMs),
			fin: horodatageLocal(finMs),
			branche: git.branche,
			objectif: session.objectif,
			fichiers: git.fichiers,
			source: `session ${session.id}`,
			minimal: true,
		},
	};
	const ecrire = async (): Promise<string | null> => {
		const r = await ecrireEpisode(dep, contenu, { minimal: true, ...(options.siAbsent === true ? { siAbsent: true } : {}) });
		return r.statut === 'ecrit' ? r.chemin : null;
	};
	if (options.echeance === undefined) return sousVerrou(dep, ecrire);
	return ecrireAvantEcheance(dep, reste, ecrire);
}

/**
 * Écriture sous verrou bornée par l'échéance (hook) : l'attente du verrou est abandonnée quand il ne reste plus que la réserve
 * (l'acquisition tardive est relâchée aussitôt : rien n'est fait) ; le verrou pris, rien n'est commencé — pas même l'état git
 * de la mémoire — s'il reste moins que la réserve. Une écriture commencée va à son terme.
 */
async function ecrireAvantEcheance(dep: Dependances, reste: () => number, ecrire: () => Promise<string | null>): Promise<string | null> {
	let commence = false;
	let abandonne = false;
	let minuteur: ReturnType<typeof setTimeout> | undefined;
	const ecriture = dep.verrou
		.avec(async () => {
			if (abandonne || reste() <= 0) return null;
			commence = true;
			// comme `sousVerrou` : les retouches manuelles d'abord, dans leur propre commit
			const enCours = await dep.historique.modificationsEnCours();
			if (enCours.length > 0) await dep.historique.commit('mnemo: modification manuelle', 'tout');
			return ecrire();
		})
		.catch(() => null);
	const limite = new Promise<null>((resoudre) => {
		const verifier = (): void => {
			if (commence) return; // l'écriture est partie : on l'attend
			if (reste() <= 0) {
				abandonne = true;
				resoudre(null);
			} else minuteur = setTimeout(verifier, Math.max(1, reste()));
		};
		verifier();
	});
	try {
		return await Promise.race([ecriture, limite]);
	} finally {
		clearTimeout(minuteur);
	}
}

const CONTROLES = /[\u0000-\u001f\u007f-\u009f]+/gu;

/**
 * Consigne du bilan, tapée dans le terminal de la session : une seule ligne, sans caractère de contrôle (l'objectif vient de
 * l'utilisateur). Claude rédige l'épisode par `proposer` genre `episode`, puis propose 0 à 3 enseignements durables.
 */
export function texteDuBilan(session: Pick<Session, 'objectif'>): string {
	const objectif = session.objectif === null ? '' : ` Objectif de la session : « ${session.objectif} ».`;
	const texte =
		`Mnemo : bilan de fin de session.${objectif} Rédige l'épisode de cette session avec l'outil proposer, genre « episode » ` +
		'(titre, synthèse, décisions et leurs raisons, résultat, fichiers touchés), puis propose 0 à 3 enseignements durables ' +
		'(informations ou consignes) avec proposer. Ensuite, arrête-toi : Mnemo fermera la session.';
	return texte.replace(CONTROLES, ' ');
}
