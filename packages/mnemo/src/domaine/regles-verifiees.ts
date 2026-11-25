import type { Regle } from './consigne.ts';
import { OUTILS_CLAUDE_CODE } from './moteurs/claude-code/outils.ts';
import type { OutilsDuMoteur } from './moteurs/moteur.ts';
import type { CauseNonVerifiee } from './refus-outil.ts';

/**
 * Règles des consignes `verifiee`, appliquées par le hook `PreToolUse` : calcul pur, sans `node:path`.
 * C'est un rappel, pas un bac à sable : une action détournée (`env git push`, `bash -c "…"`, un script) passe.
 */
export type ActionOutil = { nom: string; entree: Record<string, unknown> };
/** Action que le hook n'a pas pu lire (entrée trop grosse, JSON illisible…) : elle ne se vérifie pas. */
export type ActionNonLue = { nonLue: CauseNonVerifiee };
/** Permis ; refusé parce que contraire à une consigne ; ou refusé parce que la vérification n'a pas pu se faire. */
export type Verdict = { refus: false } | { refus: true; consigne: string; motif: string } | { refus: true; cause: CauseNonVerifiee; detail: string | null };

const TYPES_REGLE: readonly string[] = ['chemins_interdits', 'commandes_interdites'];
export const MOTIFS_MAX = 20;
export const LONGUEUR_MAX_MOTIF = 200;
const RE_CONTROLE = /[\u0000-\u001f\u007f]/u;
const RE_LECTEUR = /^([A-Za-z]):(\/|$)/u;
const RE_ABSOLU = /^(?:\/|[A-Za-z]:\/)/u;
/** Au-delà, la correspondance n'est pas calculée (temps O(motif × texte)) : l'action est refusée, non vérifiée. */
export const LONGUEUR_MAX_CHEMIN = 4096;
export const LONGUEUR_MAX_COMMANDE = 16384;

/** Chemin découpé : `prefixe` « / », « C:/ » (lecteur en majuscule) ou « // » (UNC) ; null : relatif. */
type Decoupe = { prefixe: string | null; segments: string[] };

function decouper(brut: string): Decoupe {
	let chemin = brut.replace(/\\/gu, '/');
	let prefixe: string | null = null;
	const lecteur = RE_LECTEUR.exec(chemin);
	if (lecteur !== null) {
		prefixe = `${lecteur[1]!.toUpperCase()}:/`;
		chemin = chemin.slice(2);
	} else if (chemin.startsWith('//')) {
		prefixe = '//';
	} else if (chemin.startsWith('/')) {
		prefixe = '/';
	}
	return { prefixe, segments: chemin.split('/').filter((s) => s !== '' && s !== '.') };
}

/** « .. » résolus ; au-dessus de la racine du système, on y reste. */
function resoudre(segments: string[]): string[] {
	const pile: string[] = [];
	for (const segment of segments) {
		if (segment === '..') pile.pop();
		else pile.push(segment);
	}
	return pile;
}

/** Chemin absolu de `brut`, relatif résolu depuis `cwd` ; null si ni l'un ni l'autre n'est absolu. */
function absolu(brut: string, cwd: string): { prefixe: string; segments: string[] } | null {
	const d = decouper(brut);
	if (d.prefixe !== null) return { prefixe: d.prefixe, segments: resoudre(d.segments) };
	const base = decouper(cwd);
	if (base.prefixe === null) return null;
	return { prefixe: base.prefixe, segments: resoudre([...base.segments, ...d.segments]) };
}

const texteDe = (c: { prefixe: string; segments: string[] }) => c.prefixe + c.segments.join('/');
/** Un disque Windows ne distingue pas la casse. */
const estWindows = (prefixe: string) => /^[A-Z]:\/$/u.test(prefixe);

/** Chemin relatif à la racine (« » : la racine), ou null s'il est hors d'elle. */
function relatif(chemin: { prefixe: string; segments: string[] }, racine: { prefixe: string; segments: string[] }, sansCasse: boolean): string | null {
	if (chemin.prefixe !== racine.prefixe || chemin.segments.length < racine.segments.length) return null;
	const cle = (s: string) => (sansCasse || estWindows(racine.prefixe) ? s.toLowerCase() : s);
	for (const [i, segment] of racine.segments.entries()) {
		if (cle(segment) !== cle(chemin.segments[i]!)) return null;
	}
	return chemin.segments.slice(racine.segments.length).join('/');
}

/**
 * Chemins écrits par l'action (outils d'écriture du moteur, `cheminsEcrits`) : relatifs à la racine du dossier Mnemo, en
 * « / » ; un chemin hors de la racine est rendu absolu (« /etc/x », « D:/x »). null : outil non concerné. `sansCasse` :
 * la racine se reconnaît à la casse près (macOS ; un disque à lettre l'est toujours).
 */
export function cheminsTouches(action: ActionOutil, racine: string, cwd: string, sansCasse = false, outils: OutilsDuMoteur = OUTILS_CLAUDE_CODE): string[] | null {
	const bruts = outils.cheminsEcrits(action);
	if (bruts === null) return null;
	const base = absolu(racine, '/');
	const chemins: string[] = [];
	for (const brut of bruts) {
		const chemin = absolu(brut, cwd);
		if (chemin === null) continue;
		const dedans = base === null ? null : relatif(chemin, base, sansCasse);
		chemins.push(dedans ?? texteDe(chemin));
	}
	return chemins;
}

/** Mots de tête qui ne changent pas la commande lancée : chaque forme dépouillée est aussi comparée aux motifs. */
const PREFIXES_DE_COMMANDE = new Set(['sudo', 'command', 'exec', 'nohup', 'time', '!', 'then', 'do', 'else', '(', '{']);
/** Préfixes dont les options qui suivent sont sautées ; options de `sudo` qui prennent un argument (sauté aussi). */
const PREFIXES_A_OPTIONS = new Set(['sudo', 'time']);
const OPTIONS_A_ARGUMENT_SUDO = new Set(['-u', '-g', '-h', '-p', '-C', '-D']);
/** Formes au plus par commande simple (brute comprise) : au-delà, les préfixes suivants ne sont plus retirés. */
export const FORMES_MAX = 32;
const RE_AFFECTATION = /^[A-Za-z_][A-Za-z0-9_]*=/u;

/** Fin du premier mot (espaces réduits), guillemets respectés. */
function finDuPremierMot(commande: string): number {
	let guillemet: string | null = null;
	for (let i = 0; i < commande.length; i++) {
		const c = commande[i]!;
		if (guillemet !== null) {
			if (c === '\\' && guillemet === '"') i++;
			else if (c === guillemet) guillemet = null;
		} else if (c === '"' || c === '\'') {
			guillemet = c;
		} else if (c === '\\') {
			i++;
		} else if (c === ' ') {
			return i;
		}
	}
	return commande.length;
}

/** Premier mot et reste (après l'espace) ; null s'il n'y a qu'un mot. */
function premierMot(commande: string): { mot: string; reste: string } | null {
	const fin = finDuPremierMot(commande);
	return fin === commande.length ? null : { mot: commande.slice(0, fin), reste: commande.slice(fin + 1) };
}

/**
 * Formes d'une commande simple (espaces réduits) comparées aux motifs : la brute, puis chacune de celles qui restent en
 * retirant un à un, en tête, les affectations `VAR=val` et les préfixes (`sudo`, `nohup`, `(` collé…), avec les options qui
 * suivent `sudo` ou `time`. Une règle qui vise le préfixe (`sudo *`) garde donc la forme brute. `FORMES_MAX` au plus.
 */
export function formesDeCommande(commande: string): string[] {
	const formes = [commande];
	let reste = commande;
	while (formes.length < FORMES_MAX) {
		if (reste.startsWith('(')) {
			reste = reste.slice(1).trimStart();
		} else {
			const tete = premierMot(reste);
			if (tete === null || !(PREFIXES_DE_COMMANDE.has(tete.mot) || RE_AFFECTATION.test(tete.mot))) break;
			reste = tete.reste;
			if (PREFIXES_A_OPTIONS.has(tete.mot)) {
				for (let option = premierMot(reste); option !== null && option.mot.startsWith('-'); option = premierMot(reste)) {
					reste = option.reste;
					if (tete.mot === 'sudo' && OPTIONS_A_ARGUMENT_SUDO.has(option.mot)) reste = premierMot(reste)?.reste ?? reste;
				}
			}
		}
		if (reste === '') break;
		formes.push(reste);
	}
	return formes;
}

/**
 * Coupe une ligne de commande en commandes simples (`;`, `&&`, `||`, `|`, `&`, retour à la ligne ; hors guillemets), espaces
 * réduits. Un `#` hors guillemets, en début de mot et hors de `${…}`, `$(…)` et accents graves ouvre un commentaire.
 */
function decouperCommandes(ligne: string): string[] {
	const commandes: string[] = [];
	let courante = '';
	let guillemet: '"' | '\'' | null = null;
	// imbrication de `${…}` et `$(…)` (avec leurs parenthèses et accolades intérieures), et accents graves
	let profondeur = 0;
	let accent = false;
	const pousser = (): void => {
		const nette = courante.replace(/\s+/gu, ' ').trim();
		if (nette !== '') commandes.push(nette);
		courante = '';
	};
	for (let i = 0; i < ligne.length; i++) {
		const c = ligne[i]!;
		const suivant = ligne[i + 1];
		if (guillemet === '\'') {
			courante += c;
			if (c === '\'') guillemet = null;
			continue;
		}
		if (guillemet === '"') {
			courante += c;
			if (c === '\\' && suivant !== undefined) {
				courante += suivant;
				i++;
			} else if (c === '"') {
				guillemet = null;
			}
			continue;
		}
		if (c === '\\' && suivant !== undefined) {
			// continuation de ligne : une espace ; sinon le caractère échappé est gardé tel quel
			courante += suivant === '\n' ? ' ' : c + suivant;
			i++;
		} else if (c === '"' || c === '\'') {
			guillemet = c;
			courante += c;
		} else if (c === '$' && (suivant === '{' || suivant === '(')) {
			profondeur++;
			courante += c + suivant;
			i++;
		} else if (profondeur > 0 && (c === '{' || c === '(')) {
			profondeur++;
			courante += c;
		} else if (profondeur > 0 && (c === '}' || c === ')')) {
			profondeur--;
			courante += c;
		} else if (c === '`') {
			accent = !accent;
			courante += c;
		} else if (c === '#' && profondeur === 0 && !accent && (courante === '' || /\s/u.test(courante.at(-1)!))) {
			// commentaire : jusqu'à la fin de la ligne
			while (i + 1 < ligne.length && ligne[i + 1] !== '\n') i++;
		} else if (c === ';' || c === '\n' || c === '\r') {
			pousser();
		} else if (c === '|') {
			if (suivant === '|' || suivant === '&') i++;
			pousser();
		} else if (c === '&') {
			if (suivant === '&') {
				i++;
				pousser();
			} else if (courante.endsWith('>') || courante.endsWith('<') || suivant === '>') {
				courante += c; // redirection : 2>&1, &>fichier
			} else {
				pousser(); // tâche de fond
			}
		} else {
			courante += c;
		}
	}
	pousser();
	return commandes;
}

/** Commandes simples de l'entrée de l'outil de commande du moteur ; null pour un autre outil. */
export function commandesDe(action: ActionOutil, outils: OutilsDuMoteur = OUTILS_CLAUDE_CODE): string[] | null {
	const commande = outils.commande(action);
	return commande === null ? null : decouperCommandes(commande);
}

/**
 * Automate d'un motif, simulé caractère par caractère (ensemble d'états actifs) : temps O(motif × texte), jamais de retour
 * arrière. Le nœud `i` mène à `i + 1` : `lit` (ce caractère), `un` (un caractère ; « / » seulement si `slash`), `etoile`
 * (boucle sur `i`, saut vide vers `i + 1` ; « / » seulement si `slash`), `entree` (saut vide vers `i + 1`, ne consomme
 * rien : l'entrée d'un groupe facultatif, distincte de la boucle d'une étoile). `sauts` : saut vide par-dessus un groupe.
 */
type Noeud = { genre: 'lit'; c: string } | { genre: 'un' | 'etoile'; slash: boolean } | { genre: 'entree' };
type Automate = { noeuds: Noeud[]; sauts: Map<number, number> };

/** Motif de chemin : `**` suivi de « / » est un groupe facultatif (toute suite de dossiers), « / » puis `**` final aussi. */
function automateDeChemin(motif: string[]): Automate {
	const noeuds: Noeud[] = [];
	const sauts = new Map<number, number>();
	for (let i = 0; i < motif.length; i++) {
		const c = motif[i]!;
		if (c === '/' && i === motif.length - 3 && motif[i + 1] === '*' && motif[i + 2] === '*') {
			sauts.set(noeuds.length, noeuds.length + 3);
			noeuds.push({ genre: 'entree' }, { genre: 'lit', c: '/' }, { genre: 'etoile', slash: true });
			break;
		}
		if (c === '*' && motif[i + 1] === '*') {
			if (motif[i + 2] === '/') {
				sauts.set(noeuds.length, noeuds.length + 3);
				noeuds.push({ genre: 'entree' }, { genre: 'etoile', slash: true }, { genre: 'lit', c: '/' });
				i += 2;
			} else {
				noeuds.push({ genre: 'etoile', slash: true });
				i += 1;
			}
		} else if (c === '*') {
			noeuds.push({ genre: 'etoile', slash: false });
		} else if (c === '?') {
			noeuds.push({ genre: 'un', slash: false });
		} else {
			noeuds.push({ genre: 'lit', c });
		}
	}
	return { noeuds, sauts };
}

/** Motif de commande : `*` toute suite, `?` un caractère, « / » compris. */
function automateDeCommande(motif: string[]): Automate {
	const noeuds = motif.map((c): Noeud => (c === '*' ? { genre: 'etoile', slash: true } : c === '?' ? { genre: 'un', slash: true } : { genre: 'lit', c }));
	return { noeuds, sauts: new Map() };
}

/** Sauts vides, tous vers l'avant : un seul passage croissant suffit. */
function fermer(automate: Automate, actifs: Uint8Array): void {
	const { noeuds, sauts } = automate;
	for (let i = 0; i < noeuds.length; i++) {
		if (actifs[i] !== 1) continue;
		const genre = noeuds[i]!.genre;
		if (genre === 'etoile' || genre === 'entree') actifs[i + 1] = 1;
		const saut = sauts.get(i);
		if (saut !== undefined) actifs[saut] = 1;
	}
}

/**
 * Le texte (en entier, ou par un préfixe si `prefixe`) est-il reconnu par l'automate ? `debuts` (rangs croissants de points
 * de code, 0 compris) : la reconnaissance peut aussi commencer à chacun d'eux — un seul passage pour toutes les formes d'une
 * commande, qui en sont des suffixes.
 */
function reconnu(automate: Automate, texte: string[], prefixe: boolean, debuts: readonly number[] = [0]): boolean {
	const fin = automate.noeuds.length;
	let actifs = new Uint8Array(fin + 1);
	let prochain = 0;
	for (let rang = 0; rang <= texte.length; rang++) {
		if (debuts[prochain] === rang) {
			actifs[0] = 1;
			fermer(automate, actifs);
			while (debuts[prochain] === rang) prochain++;
		}
		if (rang === texte.length) break;
		const c = texte[rang]!;
		if (prefixe && actifs[fin] === 1) return true;
		const suivants = new Uint8Array(fin + 1);
		let vivant = false;
		for (let i = 0; i < fin; i++) {
			if (actifs[i] !== 1) continue;
			const noeud = automate.noeuds[i]!;
			if (noeud.genre === 'lit') {
				if (noeud.c === c) {
					suivants[i + 1] = 1;
					vivant = true;
				}
			} else if (noeud.genre !== 'entree' && (noeud.slash || c !== '/')) {
				suivants[noeud.genre === 'un' ? i + 1 : i] = 1;
				vivant = true;
			}
		}
		if (!vivant && prochain >= debuts.length) return false;
		fermer(automate, suivants);
		actifs = suivants;
	}
	return actifs[fin] === 1;
}

/** Points de code ; minuscules d'abord si `sansCasse`. */
const caracteres = (texte: string, sansCasse: boolean) => Array.from(sansCasse ? texte.toLowerCase() : texte);

/**
 * Le chemin (en « / ») correspond-il au motif, en entier ? `**` : toute suite de dossiers (`**` suivi de « /x » : x à toute
 * profondeur, racine comprise ; « d/ » suivi de `**` : d et tout ce qu'il contient) ; `*` : toute suite sans « / » ; `?` :
 * un caractère sauf « / » ; tout autre caractère est littéral. Temps O(motif × chemin).
 */
export function correspondGlob(motif: string, chemin: string, sansCasse: boolean): boolean {
	return reconnu(automateDeChemin(caracteres(motif, sansCasse)), caracteres(chemin, sansCasse), false);
}

/**
 * Commande simple dont une des formes (`formesDeCommande`) commence par le motif (`*` : toute suite, `?` : un caractère ;
 * espaces réduits) ; un seul passage, temps O(motif × commande).
 */
function correspondCommande(motif: string, commande: string, formes: readonly string[]): boolean {
	const net = motif.replace(/\s+/gu, ' ').trim();
	// les formes sont des suffixes de la commande : leur début, en rang de point de code
	const texte: string[] = [];
	const rangs = new Map<number, number>();
	let position = 0;
	for (const c of commande) {
		rangs.set(position, texte.length);
		texte.push(c);
		position += c.length;
	}
	rangs.set(position, texte.length);
	const debuts = formes.map((f) => rangs.get(commande.length - f.length)!).sort((a, b) => a - b);
	return reconnu(automateDeCommande(Array.from(net)), texte, true, debuts);
}

/** Motif de refus d'une règle (type connu ; 1 à 20 motifs de 1 à 200 caractères, non blancs, sans caractère de contrôle), sinon null. */
export function motifRegleInvalide(regle: Regle): string | null {
	if (typeof regle !== 'object' || regle === null || !TYPES_REGLE.includes(regle.type)) return `Type de règle inconnu : attendu « chemins_interdits » ou « commandes_interdites ».`;
	const motifs: unknown = regle.motifs;
	if (!Array.isArray(motifs) || motifs.length === 0 || motifs.length > MOTIFS_MAX) return `Une règle porte de 1 à ${MOTIFS_MAX} motifs.`;
	for (const motif of motifs) {
		if (typeof motif !== 'string' || motif.trim() === '' || motif.length > LONGUEUR_MAX_MOTIF) return `Chaque motif fait de 1 à ${LONGUEUR_MAX_MOTIF} caractères (non blancs).`;
		if (RE_CONTROLE.test(motif)) return 'Un motif ne doit contenir aucun caractère de contrôle (saut de ligne, tabulation…).';
		if (regle.type === 'chemins_interdits' && /(?:^|\/)\.\.(?:\/|$)/u.test(motif.trim().replace(/\\/gu, '/'))) {
			return `Un motif de chemin ne remonte pas avec « .. » : « ${motif} » (relatif à la racine, ou absolu).`;
		}
	}
	return null;
}

/** Motif de chemin en « / », lecteur en majuscule, sans « ./ » initial. */
function motifDeChemin(motif: string): string {
	const net = motif.trim().replace(/\\/gu, '/').replace(/^(?:\.\/)+/u, '');
	return net.replace(RE_LECTEUR, (_, lecteur: string, fin: string) => `${lecteur.toUpperCase()}:${fin}`);
}

/** Racine du dossier Mnemo, dossier courant de l'action, disque sans casse ; `outils` : ceux du moteur (Claude Code par défaut). */
export type ContexteVerification = { racine: string; cwd: string; sansCasse: boolean; outils?: OutilsDuMoteur };

/** Motif de la règle qui correspond, null si aucun ; la cause si la correspondance ne peut pas être calculée. */
type Correspondance = { motif: string } | { cause: CauseNonVerifiee } | null;

function motifDeChemins(regle: Regle, action: ActionOutil, contexte: ContexteVerification, outils: OutilsDuMoteur): Correspondance {
	const chemins = cheminsTouches(action, contexte.racine, contexte.cwd, contexte.sansCasse, outils);
	if (chemins === null) return null;
	const racine = absolu(contexte.racine, '/');
	for (const chemin of chemins) {
		const dedans = !RE_ABSOLU.test(chemin);
		// un motif absolu vise aussi un chemin sous la racine
		const complet = dedans ? (racine === null ? null : texteDe({ prefixe: racine.prefixe, segments: [...racine.segments, ...(chemin === '' ? [] : chemin.split('/'))] })) : chemin;
		if (chemin.length > LONGUEUR_MAX_CHEMIN || (complet !== null && complet.length > LONGUEUR_MAX_CHEMIN)) return { cause: 'chemin_trop_long' };
		const sansCasse = contexte.sansCasse || (complet !== null && RE_LECTEUR.test(complet));
		for (const motif of regle.motifs) {
			const net = motifDeChemin(motif);
			if (RE_ABSOLU.test(net) ? complet !== null && correspondGlob(net, complet, sansCasse) : dedans && correspondGlob(net, chemin, sansCasse)) return { motif };
		}
	}
	return null;
}

function motifDeCommandes(regle: Regle, action: ActionOutil, outils: OutilsDuMoteur): Correspondance {
	const commandes = commandesDe(action, outils);
	if (commandes === null) return null;
	if (outils.commande(action)!.length > LONGUEUR_MAX_COMMANDE) return { cause: 'commande_trop_longue' };
	for (const commande of commandes) {
		const formes = formesDeCommande(commande);
		for (const motif of regle.motifs) {
			if (correspondCommande(motif, commande, formes)) return { motif };
		}
	}
	return null;
}

/**
 * Premier refus des consignes, dans leur ordre. Une consigne dont la règle est invalide, une action non lue ou trop longue
 * pour être comparée ne se vérifient pas : refus avec la cause. Sans aucune consigne, l'action est permise.
 */
export function verifier(consignes: { texte: string; regle: Regle }[], action: ActionOutil | ActionNonLue, contexte: ContexteVerification): Verdict {
	const outils = contexte.outils ?? OUTILS_CLAUDE_CODE;
	for (const { texte, regle } of consignes) {
		const invalide = motifRegleInvalide(regle);
		if (invalide !== null) return { refus: true, cause: 'consigne_illisible', detail: `« ${texte} » : ${invalide}` };
		if ('nonLue' in action) return { refus: true, cause: action.nonLue, detail: null };
		const trouve = regle.type === 'chemins_interdits' ? motifDeChemins(regle, action, contexte, outils) : motifDeCommandes(regle, action, outils);
		if (trouve === null) continue;
		if ('cause' in trouve) return { refus: true, cause: trouve.cause, detail: null };
		return { refus: true, consigne: texte, motif: trouve.motif };
	}
	return { refus: false };
}
