/**
 * Configuration de l'app Claude (Claude Desktop, `claude_desktop_config.json`) : `{ "mcpServers": { "<nom>": { "command",
 * "args"?, "env"? } }, …autres clés }`. Lecture (texte → structure), validation, transformations (brancher Mnemo, ajouter,
 * modifier, retirer un serveur) et texte à écrire. Les autres clés et les serveurs qu'on ne touche pas sont gardés tels quels ;
 * les valeurs des variables d'environnement ne sortent jamais d'ici que vers le fichier.
 */
import { estObjet } from './valeurs.ts';

/** Nom de l'entrée de Mnemo dans `mcpServers` : réservé, refusé pour les autres serveurs. */
export const NOM_MNEMO = 'mnemo';
export const MOTIF_NOM_SERVEUR = /^[A-Za-z0-9_.-]{1,64}$/u;
export const MOTIF_NOM_VARIABLE = /^[A-Za-z_][A-Za-z0-9_]*$/u;
export const COMMANDE_MAX = 1000;
export const ARGUMENTS_MAX = 50;
export const ARGUMENT_MAX = 4000;
/** Variables d'environnement d'un serveur (borne de l'écriture). */
export const VARIABLES_MAX = 100;
/** Valeur d'une variable d'environnement (borne de l'écriture). */
export const VALEUR_VARIABLE_MAX = 10_000;

/** Configuration lue : l'objet entier (toutes ses clés) et ses serveurs, dans l'ordre du fichier. */
export type ConfigClaudeDesktop = { brut: Record<string, unknown>; serveurs: Record<string, unknown> };

/** Serveur stdio que Mnemo sait réécrire : commande, arguments, variables (valeurs comprises). */
export type ServeurStdio = { commande: string; args: string[]; env: Record<string, string> };

/** Un serveur tel que la vue le montre : les noms des variables seulement ; `modifiable` faux : décrit autrement (lecture seule). */
export type ServeurVu = { nom: string; commande: string; args: string[]; env: string[]; modifiable: boolean };

/** Un serveur à écrire ; variable à `null` : garder sa valeur actuelle (modification seulement). */
export type DemandeServeur = { nom: string; commande: string; args: string[]; env: Record<string, string | null> };

export type EtatMnemo = 'absent' | 'branche' | 'perime';

/** Refus d'une écriture : `refuse` (demande invalide), `inconnu` (serveur absent), `existe` (nom déjà pris). */
export type RefusConfig = { ok: false; genre: 'refuse' | 'inconnu' | 'existe'; motif: string };
export type ResultatConfig = { ok: true; config: ConfigClaudeDesktop } | RefusConfig;

const refus = (genre: RefusConfig['genre'], motif: string): RefusConfig => ({ ok: false, genre, motif });

/**
 * Motif d'un JSON invalide sans rien du texte : le message de `JSON.parse` cite parfois un extrait du fichier autour de
 * l'erreur (« Unexpected token 's', ..."KEY":sk-…"... »), qui peut porter la valeur d'une variable ; seul un message qui
 * ne donne qu'une position est gardé.
 */
function motifJsonInvalide(erreur: unknown): string {
	const message = erreur instanceof Error ? erreur.message : '';
	return / in JSON at position \d+/u.test(message) && !message.includes('"') ? message : 'caractère inattendu';
}

/** Lit le texte du fichier ; `null` (fichier absent) : configuration vide. JSON invalide, racine ou `mcpServers` qui n'est pas un objet : erreur. */
export function lireConfigClaudeDesktop(texte: string | null): { ok: true; config: ConfigClaudeDesktop } | { ok: false; erreur: string } {
	if (texte === null) return { ok: true, config: { brut: {}, serveurs: {} } };
	let brut: unknown;
	try {
		// fichier vide ou blanc : vide, comme absent
		brut = texte.trim() === '' ? {} : JSON.parse(texte);
	} catch (erreur) {
		return { ok: false, erreur: `JSON invalide (${motifJsonInvalide(erreur)}).` };
	}
	if (!estObjet(brut)) return { ok: false, erreur: 'Le fichier ne contient pas un objet JSON.' };
	const serveurs = brut['mcpServers'];
	if (serveurs === undefined) return { ok: true, config: { brut, serveurs: {} } };
	if (!estObjet(serveurs)) return { ok: false, erreur: '« mcpServers » n’est pas un objet.' };
	return { ok: true, config: { brut, serveurs } };
}

/** Texte à écrire : la configuration entière, `mcpServers` à jour, JSON indenté de 2 espaces, `\n` final. */
export function texteConfigClaudeDesktop(config: ConfigClaudeDesktop): string {
	return `${JSON.stringify({ ...config.brut, mcpServers: config.serveurs }, null, 2)}\n`;
}

const listeDeTextes = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');

/**
 * Le serveur sous la forme que Mnemo sait réécrire sans rien perdre : `command` (texte non vide), `args` (textes) et `env`
 * (textes) facultatifs, `type: "stdio"` toléré ; tout autre champ, ou une valeur d'une autre forme : null (lecture seule).
 */
export function serveurStdio(brut: unknown): ServeurStdio | null {
	if (!estObjet(brut)) return null;
	for (const cle of Object.keys(brut)) if (cle !== 'command' && cle !== 'args' && cle !== 'env' && !(cle === 'type' && brut['type'] === 'stdio')) return null;
	const { command, args, env } = brut;
	if (typeof command !== 'string' || command.trim() === '') return null;
	if (args !== undefined && !listeDeTextes(args)) return null;
	if (env !== undefined && !(estObjet(env) && Object.values(env).every((v) => typeof v === 'string'))) return null;
	return { commande: command, args: args ?? [], env: (env ?? {}) as Record<string, string> };
}

/**
 * Adresse d'un serveur distant telle que la vue la montre : origine et chemin seulement, sans identifiants (`user:pass@`),
 * paramètres (`?…`, un jeton peut s'y trouver) ni fragment ; illisible : un texte neutre, jamais l'adresse brute.
 */
export function adresseVue(url: string): string {
	try {
		const u = new URL(url);
		u.username = '';
		u.password = '';
		u.search = '';
		u.hash = '';
		return u.href;
	} catch {
		return 'adresse illisible';
	}
}

/** Vue d'un serveur : jamais les valeurs des variables ; décrit autrement, ce qui s'en lit (commande, arguments, noms). */
function serveurVu(nom: string, brut: unknown): ServeurVu {
	const stdio = serveurStdio(brut);
	if (stdio !== null) return { nom, commande: stdio.commande, args: [...stdio.args], env: Object.keys(stdio.env), modifiable: true };
	const objet = estObjet(brut) ? brut : {};
	return {
		nom,
		commande: typeof objet['command'] === 'string' ? objet['command'] : typeof objet['url'] === 'string' ? adresseVue(objet['url']) : '',
		args: listeDeTextes(objet['args']) ? [...objet['args']] : [],
		env: estObjet(objet['env']) ? Object.keys(objet['env']) : [],
		modifiable: false,
	};
}

/** Les serveurs autres que Mnemo, dans l'ordre du fichier. */
export function serveursVus(config: ConfigClaudeDesktop): ServeurVu[] {
	return Object.entries(config.serveurs)
		.filter(([nom]) => nom !== NOM_MNEMO)
		.map(([nom, brut]) => serveurVu(nom, brut));
}

/** Entrée attendue de Mnemo : le Node durable, `main.ts`, `mcp`, et la racine en `MNEMO_RACINE`. */
export function entreeMnemo(node: string, main: string, racine: string): Record<string, unknown> {
	return { command: node, args: [main, 'mcp'], env: { MNEMO_RACINE: racine } };
}

/** `branche` : entrée identique à l'attendue ; `perime` : présente mais différente (autre Node, `main.ts` ou racine). */
export function etatMnemo(config: ConfigClaudeDesktop, attendue: Record<string, unknown>): EtatMnemo {
	if (!Object.hasOwn(config.serveurs, NOM_MNEMO)) return 'absent';
	return JSON.stringify(config.serveurs[NOM_MNEMO]) === JSON.stringify(attendue) ? 'branche' : 'perime';
}

const avecServeurs = (config: ConfigClaudeDesktop, serveurs: Record<string, unknown>): ConfigClaudeDesktop => ({ brut: config.brut, serveurs });

/** Branche (ou met à jour) l'entrée de Mnemo, à sa place si elle existe. */
export function brancherMnemo(config: ConfigClaudeDesktop, attendue: Record<string, unknown>): ConfigClaudeDesktop {
	return avecServeurs(config, { ...config.serveurs, [NOM_MNEMO]: attendue });
}

/** Retire l'entrée de Mnemo (sans effet si elle est absente). */
export function debrancherMnemo(config: ConfigClaudeDesktop): ConfigClaudeDesktop {
	const serveurs = { ...config.serveurs };
	delete serveurs[NOM_MNEMO];
	return avecServeurs(config, serveurs);
}

/** Nouveau nom refusé : Mnemo, quelle que soit la casse (confusion), et `__proto__`. */
const nomReserve = (nom: string): boolean => nom.toLowerCase() === NOM_MNEMO || nom === '__proto__';

/** Motif du refus d'une demande (forme, bornes), null si elle est valide. */
function motifDemande(d: DemandeServeur): string | null {
	if (!MOTIF_NOM_SERVEUR.test(d.nom)) return `Nom « ${d.nom.slice(0, 80)} » refusé : 1 à 64 lettres, chiffres, « _ », « . » ou « - ».`;
	if (nomReserve(d.nom)) return `Le nom « ${d.nom} » est réservé${d.nom === '__proto__' ? '' : ' à la mémoire Mnemo'}.`;
	if (d.commande.trim() === '') return 'Commande vide.';
	if (d.commande.length > COMMANDE_MAX) return `Commande trop longue (${COMMANDE_MAX} caractères au plus).`;
	if (d.args.length > ARGUMENTS_MAX) return `Trop d'arguments (${ARGUMENTS_MAX} au plus).`;
	if (d.args.some((a) => a.length > ARGUMENT_MAX)) return `Argument trop long (${ARGUMENT_MAX} caractères au plus).`;
	const noms = Object.keys(d.env);
	if (noms.length > VARIABLES_MAX) return `Trop de variables d'environnement (${VARIABLES_MAX} au plus).`;
	const mauvais = noms.find((n) => !MOTIF_NOM_VARIABLE.test(n));
	if (mauvais !== undefined) return `Variable « ${mauvais.slice(0, 80)} » refusée : lettres, chiffres et « _ », sans chiffre au début.`;
	if (Object.values(d.env).some((v) => v !== null && v.length > VALEUR_VARIABLE_MAX)) return `Valeur de variable trop longue (${VALEUR_VARIABLE_MAX} caractères au plus).`;
	return null;
}

/** Variables écrites : une valeur `null` garde la valeur actuelle (`actuelles`) ; sans valeur actuelle, refus. */
function variablesEcrites(env: DemandeServeur['env'], actuelles: Record<string, string>): { ok: true; env: Record<string, string> } | RefusConfig {
	const sortie: [string, string][] = [];
	for (const [nom, valeur] of Object.entries(env)) {
		if (valeur !== null) sortie.push([nom, valeur]);
		else if (Object.hasOwn(actuelles, nom)) sortie.push([nom, actuelles[nom]!]);
		else return refus('refuse', `Variable « ${nom} » : valeur requise (elle n'existe pas encore).`);
	}
	return { ok: true, env: Object.fromEntries(sortie) };
}

/** Entrée écrite d'un serveur : `args` et `env` omis quand ils sont vides. */
function entreeServeur(commande: string, args: string[], env: Record<string, string>): Record<string, unknown> {
	return { command: commande, ...(args.length > 0 ? { args: [...args] } : {}), ...(Object.keys(env).length > 0 ? { env } : {}) };
}

/**
 * Ajoute un serveur (`ancienNom` absent : le nom ne doit pas être pris) ou modifie `ancienNom` (stdio seulement ; renommé à
 * sa place si `nom` diffère, le nouveau nom ne devant pas être pris). Une variable à `null` garde sa valeur actuelle ; une
 * variable absente de la demande est retirée.
 */
export function ecrireServeur(config: ConfigClaudeDesktop, demande: DemandeServeur, ancienNom?: string): ResultatConfig {
	const motif = motifDemande(demande);
	if (motif !== null) return refus('refuse', motif);
	let actuelles: Record<string, string> = {};
	if (ancienNom !== undefined) {
		if (ancienNom === NOM_MNEMO) return refus('refuse', `Le serveur « ${NOM_MNEMO} » se règle par « Mémoire Mnemo ».`);
		if (!Object.hasOwn(config.serveurs, ancienNom)) return refus('inconnu', `Serveur inconnu : « ${ancienNom.slice(0, 80)} ».`);
		const stdio = serveurStdio(config.serveurs[ancienNom]);
		if (stdio === null) return refus('refuse', `Le serveur « ${ancienNom} » est décrit autrement que par une commande : il ne se modifie pas ici.`);
		actuelles = stdio.env;
	}
	if (demande.nom !== ancienNom && Object.hasOwn(config.serveurs, demande.nom)) return refus('existe', `Un serveur s'appelle déjà « ${demande.nom} ».`);
	const variables = variablesEcrites(demande.env, actuelles);
	if (!variables.ok) return variables;
	const entree = entreeServeur(demande.commande, demande.args, variables.env);
	if (ancienNom === undefined) return { ok: true, config: avecServeurs(config, { ...config.serveurs, [demande.nom]: entree }) };
	// renommage : à la même place dans le fichier (`fromEntries` : un nom comme « __proto__ » reste une clé comme les autres)
	const serveurs = Object.fromEntries(Object.entries(config.serveurs).map(([nom, brut]) => (nom === ancienNom ? [demande.nom, entree] : [nom, brut])));
	return { ok: true, config: avecServeurs(config, serveurs) };
}

/** Retire un serveur, quelle que soit sa forme (retrait explicite) ; jamais Mnemo par ce chemin. */
export function retirerServeur(config: ConfigClaudeDesktop, nom: string): ResultatConfig {
	if (nom === NOM_MNEMO) return refus('refuse', `Le serveur « ${NOM_MNEMO} » se débranche par « Mémoire Mnemo ».`);
	if (!Object.hasOwn(config.serveurs, nom)) return refus('inconnu', `Serveur inconnu : « ${nom.slice(0, 80)} ».`);
	const serveurs = { ...config.serveurs };
	delete serveurs[nom];
	return { ok: true, config: avecServeurs(config, serveurs) };
}
