import { plier } from '@mnemo/commun';
import type { Regle } from '../domaine/consigne.ts';
import type { Fait } from '../domaine/fait.ts';
import { lireFiche } from '../domaine/fiche.ts';
import { MOTS_VIDES } from '../domaine/requete.ts';
import { typeSourcePersonnel } from '../domaine/regles.ts';
import type { ActionOutil } from '../domaine/regles-verifiees.ts';
import { descripteurDeSource } from '../domaine/source.ts';
import { ecrireEtCommiter, lienDeMention, sousVerrou } from './commun.ts';
import type { Dependances } from './ports.ts';
import { proposer } from './proposer.ts';
import type { SourceProposee } from './proposer.ts';
import { servir } from './servir.ts';
import { SANS_EXTRACTION, synchroniser } from './synchroniser.ts';
import { verifierAction } from './verifier-action.ts';
import { texteDuRefus } from '../domaine/refus-outil.ts';

/** Un fait que l'archiviste doit tirer d'un document : `termes` (mots ou valeurs obligatoires), `citation` (passage exact). */
export type FaitAttendu = { document: string; termes: string[]; citation: string };
/** Une décision clé : couverte si un fait extrait contient tous ses `termes` (voir `couvre`). */
export type DecisionCle = { document: string; termes: string[] };
/**
 * Une contradiction à arbitrer : `ancien` (texte d'un fait de la mémoire de départ), `nouveau` (valeur qui distingue le fait
 * tiré d'un document récent), `attendu` : l'ancien barré et remplacé, ou le nouveau à confirmer.
 */
export type PaireContradictoire = { ancien: string; nouveau: string; attendu: 'a_confirmer' | 'remplace' };
/**
 * Un cas du banc de consignes. `regle` fait de la consigne une consigne `verifiee` ; `action` est jugée par la vérification
 * du hook `outil` (`attendu`) ; `message` doit servir la consigne (hook `message`).
 */
export type CasConsigne = { consigne: string; regle?: Regle; action?: ActionOutil; attendu?: 'refus' | 'permis'; message?: string };

/** Un fait extrait, tel que le banc le note : `source` est le chemin du document cité (relatif à la racine du dossier). */
export type FaitExtrait = { texte: string; citation: string | null; source: string };

const MOIS = ['janvier', 'fevrier', 'mars', 'avril', 'mai', 'juin', 'juillet', 'aout', 'septembre', 'octobre', 'novembre', 'decembre'];
const RE_DATE_LONGUE = new RegExp(`\\b(1er|\\d{1,2})\\s+(${MOIS.join('|')})\\s+(\\d{4})\\b`, 'gu');
const RE_DATE_COURTE = /\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/gu;
/**
 * Jetons d'un texte normalisé : une date AAAA-MM-JJ, un nombre (chiffres, groupes de milliers séparés par une espace
 * « 14 800 », décimales après « , » ou « . ») qu'aucune lettre ne suit, ou un mot (lettres et chiffres mêlés : « 16h »,
 * « 5a68c4 »).
 */
const RE_JETON = /(\d{4}-\d{2}-\d{2})(?![a-z0-9])|(\d+(?:[   ]\d{3})*(?:[.,]\d+)?)(?![a-z0-9])|([a-z0-9]+)/gu;
/** Une citation fidèle : 15 caractères au moins, et 60 % au moins des mots significatifs du fait. */
const LONGUEUR_MIN_CITATION = 15;
const PART_MIN_MOTS = 0.6;

const deux = (n: string) => n.padStart(2, '0');

/** Minuscules, sans accents, dates françaises (« 1er mars 2026 », « 05/02/2026 ») ramenées à AAAA-MM-JJ. */
function normaliser(texte: string): string {
	return plier(texte)
		.replace(RE_DATE_LONGUE, (_, jour: string, mois: string, annee: string) => `${annee}-${deux(String(MOIS.indexOf(mois) + 1))}-${deux(jour === '1er' ? '1' : jour)}`)
		.replace(RE_DATE_COURTE, (_, jour: string, mois: string, annee: string) => `${annee}-${deux(mois)}-${deux(jour)}`);
}

/** Clé de comparaison des termes : `normaliser`, puis lettres et chiffres seuls (« 14 800 € » → « 14800 »). */
export function cle(texte: string): string {
	return normaliser(texte).replace(/[^a-z0-9]/gu, '');
}

/** Un jeton : `exact` pour une date ou un nombre (forme canonique : « 2,10 » → « 2.1 », « 14 800 » → « 14800 »). */
type Jeton = { valeur: string; exact: boolean };

function jetons(texte: string): Jeton[] {
	return [...normaliser(texte).matchAll(RE_JETON)].map(([, date, nombre, mot]): Jeton => {
		if (date !== undefined) return { valeur: date, exact: true };
		if (nombre !== undefined) return { valeur: String(Number(nombre.replace(/[   ]/gu, '').replace(',', '.'))), exact: true };
		return { valeur: mot!, exact: false };
	});
}

/** Dates et nombres d'un texte, en forme canonique. */
const valeurs = (texte: string) => new Set(jetons(texte).filter((j) => j.exact).map((j) => j.valeur));

/** Un jeton du texte porte celui d'un terme : même valeur pour une date ou un nombre, début de mot pour un mot. */
const porte = (jeton: Jeton, terme: Jeton) => (terme.exact ? jeton.exact && jeton.valeur === terme.valeur : !jeton.exact && jeton.valeur.startsWith(terme.valeur));

/**
 * Vrai si le texte porte chacun des termes, à l'accent et à la casse près : une date ou un nombre comme valeur entière
 * (« 4 » n'est pas dans « 24 », ni « 20 » dans « 2026-02-03 ») ; un mot comme début d'un mot (« cass » dans « cassés »,
 * jamais « port » dans « transport ») ; un terme de plusieurs jetons, à la suite.
 */
export function couvre(texte: string, termes: string[]): boolean {
	const dans = jetons(texte);
	return termes.every((t) => {
		const voulus = jetons(t);
		if (voulus.length === 0) return false;
		for (let i = 0; i + voulus.length <= dans.length; i++) if (voulus.every((v, k) => porte(dans[i + k]!, v))) return true;
		return false;
	});
}

/** Mots significatifs : quatre lettres au moins, hors mots vides. */
const motsSignificatifs = (texte: string) => [...new Set(jetons(texte).filter((j) => !j.exact && /^[a-z]{4,}$/u.test(j.valeur) && !MOTS_VIDES.has(j.valeur)).map((j) => j.valeur))];

/**
 * Espaces réduits, forme NFC, apostrophes et guillemets typographiques ramenés aux droits (sans espace autour d'un
 * guillemet) : la citation se compare au document « mot pour mot » à cette réduction près.
 */
const reduit = (texte: string) =>
	texte
		.normalize('NFC')
		.replace(/[‘’]/gu, "'")
		.replace(/[“”«»]/gu, '"')
		.replace(/\s+/gu, ' ')
		.replace(/ ?" ?/gu, '"')
		.trim();
const arrondi = (x: number) => Math.round(x * 1000) / 1000;
const part = (n: number, total: number) => (total === 0 ? 0 : arrondi(n / total));

/** Motif d'infidélité d'un fait, ou null s'il est fidèle à son document. */
function infidelite(fait: FaitExtrait, documents: Map<string, string>): string | null {
	if (fait.citation === null || fait.citation.trim() === '') return 'sans citation';
	const citation = reduit(fait.citation);
	if (citation.length < LONGUEUR_MIN_CITATION) return `citation trop courte (moins de ${LONGUEUR_MIN_CITATION} caractères)`;
	const document = documents.get(fait.source);
	if (document === undefined) return `document inconnu : ${fait.source}`;
	if (!reduit(document).includes(citation)) return `citation absente de ${fait.source}`;
	const cites = valeurs(citation);
	const absents = [...valeurs(fait.texte)].filter((v) => !cites.has(v));
	if (absents.length > 0) return `absent de la citation : ${absents.join(', ')}`;
	const motsCites = new Set(motsSignificatifs(citation));
	const mots = motsSignificatifs(fait.texte);
	const manquants = mots.filter((m) => !motsCites.has(m));
	return mots.length - manquants.length >= PART_MIN_MOTS * mots.length ? null : `mots de l'information absents de la citation : ${manquants.join(', ')}`;
}

/**
 * Note une extraction. Fidélité : part des faits dont la citation (15 caractères au moins) se retrouve mot pour mot
 * (espaces, apostrophes et guillemets réduits) dans le document cité, porte les nombres et les dates du fait et 60 % au
 * moins de ses mots significatifs. Couverture : part des décisions clés dont un fait porte tous les termes (`couvre`) ;
 * couverture fidèle : la même, par les seuls faits fidèles. `details` : faits attendus retrouvés, puis chaque fait
 * infidèle, décision et fait attendu manqués.
 */
export function noterExtraction(
	faits: FaitExtrait[],
	documents: Map<string, string>,
	attendus: FaitAttendu[],
	decisions: DecisionCle[],
): { fidelite: number; couverture: number; couvertureFidele: number; details: string[] } {
	const infideles: string[] = [];
	const fideles: FaitExtrait[] = [];
	for (const fait of faits) {
		const motif = infidelite(fait, documents);
		if (motif === null) fideles.push(fait);
		else infideles.push(`infidèle : « ${fait.texte} » — ${motif}`);
	}
	const couvertPar = (parmi: FaitExtrait[]) => (termes: string[]) => parmi.some((f) => couvre(f.texte, termes));
	const couvert = couvertPar(faits);
	const couvertFidelement = couvertPar(fideles);
	const decisionsManquees = decisions.filter((d) => !couvert(d.termes));
	const attendusManques = attendus.filter((a) => !couvert(a.termes));
	return {
		fidelite: part(fideles.length, faits.length),
		couverture: part(decisions.length - decisionsManquees.length, decisions.length),
		couvertureFidele: part(decisions.filter((d) => couvertFidelement(d.termes)).length, decisions.length),
		details: [
			`informations attendues retrouvées : ${attendus.length - attendusManques.length} / ${attendus.length}`,
			...infideles,
			...decisionsManquees.map((d) => `décision manquée : ${d.document} — ${d.termes.join(', ')}`),
			...attendusManques.map((a) => `information attendue manquée : ${a.document} — ${a.termes.join(', ')}`),
		],
	};
}

/** Faits de toutes les fiches lisibles d'une mémoire (chemin → Markdown), avec leur fiche. */
function faitsDesFiches(memoire: Map<string, string>): { chemin: string; fait: Fait }[] {
	const sortie: { chemin: string; fait: Fait }[] = [];
	for (const [chemin, texte] of memoire) {
		try {
			for (const ligne of lireFiche(chemin, texte).faits) if ('fait' in ligne) sortie.push({ chemin, fait: ligne.fait });
		} catch {
			// fiche illisible : sans faits
		}
	}
	return sortie;
}

/** Document cité par une fiche de source de la mémoire (son `chemin`), sinon le chemin de la fiche elle-même. */
/** Vrai si la fiche `chemin` de cette mémoire est lisible et de type `source`. */
function estSourceDeMemoire(memoire: Map<string, string>, chemin: string): boolean {
	const texte = memoire.get(chemin);
	try {
		return texte !== undefined && lireFiche(chemin, texte).type === 'source';
	} catch {
		return false;
	}
}

function documentDeSource(memoire: Map<string, string>, ficheSource: string): string {
	const texte = memoire.get(ficheSource);
	if (texte === undefined) return ficheSource;
	try {
		return descripteurDeSource(lireFiche(ficheSource, texte))?.document ?? ficheSource;
	} catch {
		return ficheSource;
	}
}

/**
 * Faits vivants (non barrés) tirés d'une fiche `source` citée par un lien : ce que l'archiviste a extrait. Un fait de l'utilisateur ou
 * d'une session n'en est pas. `source` : le document de la fiche de source (`chemin`), à défaut la fiche de source.
 */
export function faitsDeMemoire(memoire: Map<string, string>): FaitExtrait[] {
	const sortie: FaitExtrait[] = [];
	for (const { fait } of faitsDesFiches(memoire)) {
		if (fait.barre || fait.source === undefined) continue;
		// une mention personnelle (utilisateur, session…) ou un lien vers une fiche qui n'est pas une source n'est pas un document
		const ficheSource = typeSourcePersonnel(fait.source) === null ? lienDeMention(fait.source) : null;
		if (ficheSource === null || (memoire.has(ficheSource) && !estSourceDeMemoire(memoire, ficheSource))) continue;
		sortie.push({ texte: fait.texte, citation: fait.citation ?? null, source: documentDeSource(memoire, ficheSource) });
	}
	return sortie;
}

/** Numéro d'ancre (`f-0007` → 7) ; un fait sans ancre passe après les autres. */
const numeroDAncre = (f: Fait) => (f.ancre === undefined ? Number.MAX_SAFE_INTEGER : Number(f.ancre.slice(2)));

/**
 * Paires réussies dans la mémoire après extraction. L'ancien fait, dans chaque fiche qui porte son texte : le premier écrit
 * (plus petite ancre, les ancres croissent dans une fiche) ; un fait plus récent qui cite l'ancien texte n'est pas lui.
 * `remplace` = l'ancien est barré et un autre fait vivant de la fiche porte la valeur nouvelle (`couvre`) ;
 * `a_confirmer` = l'ancien est resté vivant et un fait vivant, à confirmer, porte la valeur nouvelle et le contredit.
 */
export function noterContradictions(memoireApres: Map<string, string>, paires: PaireContradictoire[]): { reussies: number; total: number } {
	const faits = faitsDesFiches(memoireApres);
	const reussie = (p: PaireContradictoire): boolean => {
		const porteurs = faits.filter((f) => cle(f.fait.texte).includes(cle(p.ancien)));
		for (const chemin of new Set(porteurs.map((a) => a.chemin))) {
			const ancien = porteurs
				.filter((a) => a.chemin === chemin)
				.map((a) => a.fait)
				.sort((a, b) => numeroDAncre(a) - numeroDAncre(b))[0]!;
			const nouveaux = faits.filter((f) => f.chemin === chemin && f.fait !== ancien && !f.fait.barre && couvre(f.fait.texte, [p.nouveau]));
			if (p.attendu === 'remplace' && ancien.barre && nouveaux.length > 0) return true;
			if (p.attendu === 'a_confirmer' && !ancien.barre && ancien.ancre !== undefined && nouveaux.some((n) => n.fait.aConfirmer && n.fait.contredit === ancien.ancre)) return true;
		}
		return false;
	};
	return { reussies: paires.filter(reussie).length, total: paires.length };
}

/** Écrit des fiches (chemin relatif à `_mnemo/` → Markdown) en un commit, sous verrou : la mémoire de départ d'un banc. */
export async function deposerFiches(dep: Dependances, fiches: { chemin: string; texte: string }[], message: string): Promise<string> {
	return sousVerrou(dep, () => ecrireEtCommiter(dep, fiches, message));
}

/** Racine et dossier courant fictifs des actions rejouées (la vérification ne touche pas au disque). */
export const CONTEXTE_CONSIGNES = { racine: '/banc', cwd: '/banc/code/heron', sansCasse: false };
const SOURCE_BANC: SourceProposee = { ref: 'utilisateur banc de consignes', type: 'utilisateur' };
/** Le banc mesure ce qui est servi, pas la latence d'un hook : `servir` a tout son temps. */
const ECHEANCE_SERVIR_MS = 10_000;

function decrire(action: ActionOutil): string {
	const e = action.entree;
	const cible = ['command', 'file_path', 'notebook_path'].map((k) => e[k]).find((v) => typeof v === 'string') ?? JSON.stringify(e);
	return `${action.nom} « ${String(cible)} »`;
}

/**
 * Banc de consignes, sans `claude` : chaque consigne (portée globale) est écrite comme le ferait l'utilisateur, au niveau
 * `verifiee` si un cas lui donne une règle (la première), sinon `rappelee` ; puis chaque cas est rejoué : son action par la
 * vérification du hook `outil` (un refus doit venir de sa consigne), son message par `servir` (la consigne doit être servie).
 */
export async function lancerBancConsignes(dep: Dependances, cas: CasConsigne[]): Promise<{ reussis: number; total: number; echecs: string[] }> {
	const regles = new Map<string, Regle | undefined>();
	for (const c of cas) if (regles.get(c.consigne) === undefined) regles.set(c.consigne, c.regle);
	const fiches = new Map<string, string>();
	const nonEcrites = new Map<string, string>();
	for (const [texte, regle] of regles) {
		const r = await proposer(dep, { genre: 'consigne', texte, portee: { genre: 'globale' }, source: SOURCE_BANC, apresProches: true });
		if (r.statut !== 'ecrit') {
			nonEcrites.set(texte, `consigne non écrite (${r.statut === 'refuse' ? r.motif : r.statut})`);
			continue;
		}
		fiches.set(texte, r.fiche);
		if (regle === undefined) continue;
		const n = await proposer(dep, { genre: 'niveau', fiche: r.fiche, niveau: 'verifiee', regle, source: SOURCE_BANC }, { appliquerDirectement: true });
		if (n.statut !== 'ecrit') nonEcrites.set(texte, `règle non posée (${n.statut === 'refuse' ? n.motif : n.statut})`);
	}
	await synchroniser(dep, SANS_EXTRACTION);

	const echecs: string[] = [];
	for (const c of cas) {
		const ratees: string[] = [];
		const nonEcrite = nonEcrites.get(c.consigne);
		if (nonEcrite !== undefined) ratees.push(nonEcrite);
		if (c.action !== undefined) {
			const verdict = await verifierAction(dep, { chemin: '' }, c.action, CONTEXTE_CONSIGNES);
			const juste = c.attendu === 'refus' ? verdict.refus && 'consigne' in verdict && verdict.consigne === c.consigne : !verdict.refus;
			if (!juste) ratees.push(`${decrire(c.action)} → ${verdict.refus ? texteDuRefus(verdict) : 'permis'}, attendu ${c.attendu ?? 'permis'}`);
		}
		if (c.message !== undefined) {
			const chemin = fiches.get(c.consigne);
			const servi = await servir(dep, {
				position: '',
				message: c.message,
				dejaServies: new Map(),
				dejaLues: new Map(),
				proposees: new Map(),
				ecartes: [],
				moment: 'message',
				muet: null,
				premier: false,
				fin: Date.now() + ECHEANCE_SERVIR_MS,
				// le banc vérifie qu'une consigne est trouvée par le message : les rappels joints d'office le fausseraient
				rappels: false,
			});
			const parmiLesFiches = chemin !== undefined && servi.calcul.cartes.some((f) => f.chemin === chemin);
			if (!parmiLesFiches && !servi.consignes.includes(c.consigne)) ratees.push(`message « ${c.message} » → consigne non servie`);
		}
		if (ratees.length > 0) echecs.push(`« ${c.consigne} » : ${ratees.join(' ; ')}`);
	}
	return { reussis: cas.length - echecs.length, total: cas.length, echecs };
}
