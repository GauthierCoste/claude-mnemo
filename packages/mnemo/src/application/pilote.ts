import { OBJECTIF_MAX, PROFIL_ARCHIVISTE } from '@mnemo/commun';
import type { NiveauModeles } from '@mnemo/commun';
import { validerDossier } from './dossiers.ts';
import { dialogueOuvert, ETATS_RELANCES, objectifDe } from '../domaine/session.ts';
import type { Session } from '../domaine/session.ts';
import { CAPACITE_TAMPON, tamponCirculaire } from '../domaine/tampon.ts';
import { ecrireEpisodeMinimal, episodesDuProjet, texteDuBilan, trouverEpisode } from './episode.ts';
import { estIdMoteur, MOTEUR_PAR_DEFAUT } from '../domaine/moteurs/moteur.ts';
import type { IdMoteur } from '../domaine/moteurs/moteur.ts';
import type { CommandeMoteur, Dependances, ModeLancement, Moteur, MoteurDuService, Pilotage, Terminal } from './ports.ts';
import { avertissementDesHooks, avertissementDesReglagesMcp, lignesDAvertissement } from './moteurs/avertissements-de-session.ts';
import { projetDeSession } from './portees.ts';
import { positionNotee } from './dossiers-non-rattaches.ts';
import type { PositionDuProjet } from './position.ts';
import { chargerProfil } from './profil.ts';
import { refusDuMoteur } from '../domaine/profil.ts';
import { DOSSIER_MEMOIRE } from '../domaine/dossier-memoire.ts';
import { citerPosix, citerPowerShell } from '../domaine/citer.ts';

export type Pilote = {
	/**
	 * Lance une session. Profil `archiviste` : jamais deux ; les lancements passent l'un après l'autre, et s'il en existe un
	 * (non terminé), il est rendu tel quel (`existant`), sans rien lancer ni lui transmettre l'objectif.
	 */
	lancer(d: { profil: string; dossier: string; objectif?: string }): Promise<{ session: Session } | { session: Session; manuel: string } | { session: Session; existant: true } | { refus: string }>;
	pause(id: string): Promise<Session | null>;
	/**
	 * Rejette `ErreurMoteurIndisponible` si le moteur de la session n'a pas d'implémentation ici, `ErreurRepriseImpossible` s'il
	 * ne sait pas la reprendre (de même bilan, `confier`, `ligneDeReprise`, et `pause` d'une session qui tourne) ; bilan et
	 * `confier` rejettent `ErreurSessionNonCommencee` pour une session qui tourne sans avoir commencé chez son moteur.
	 */
	reprendre(id: string): Promise<Session | null>;
	entree(id: string, d: string): void;
	taille(id: string, c: number, l: number): void;
	abonner(id: string, f: (d: string) => void): { relecture: string; desabonner(): void } | null;
	surChangement(f: (s: Session) => void): () => void;
	/** Rend les ids relancés. */
	reprendreAuDemarrage(): Promise<string[]>;
	arreterTout(): Promise<void>;
	enCours(id: string): boolean;
	/**
	 * Pourquoi la session ne peut être ni mise en pause ni reprise par son moteur (Codex : son `fil` encore inconnu ; moteur
	 * sans implémentation dans ce service) ; null : elle le peut.
	 */
	motifSansReprise(s: Session): string | null;
	/**
	 * Termine une session. `bilan` : l'agent rédige l'épisode (consigne tapée dans le terminal ; une session qui ne tourne pas
	 * est d'abord reprise), puis la session est arrêtée à son premier `arret` ; rend la session dès la consigne tapée. Sans
	 * bilan : abandonnée et arrêtée (épisode minimal).
	 */
	terminer(id: string, options: { bilan: boolean }): Promise<Session | null>;
	/**
	 * Tape une ligne (puis Entrée) dans le terminal de la session, s'il est tenu ici. Un dialogue de permission peut être ouvert
	 * (dernier arrêt : `Notification`) : Échap d'abord, puis le `Stop` qui suit est attendu brièvement ; jamais d'Échap sinon, ni
	 * deux fois pour le même état (un dialogue déjà fermé, ou une ligne pas encore vue par les hooks). Les écritures d'une même
	 * session (lignes, frappes, arrêt) passent l'une après l'autre.
	 */
	taper(id: string, ligne: string): Promise<void>;
	/**
	 * Confie une ligne à une session : reprise d'abord si elle ne tourne pas (son `debut` attendu, 30 s au plus), puis tapée
	 * comme par `taper`. Rend la session ; rien n'est tapé si elle ne peut pas tourner ici (mode dégradé, reprise impossible).
	 */
	confier(id: string, ligne: string): Promise<Session | null>;
	/**
	 * Faux en mode dégradé (terminaux indisponibles, commande de Claude Code introuvable — le moteur de l'archiviste, seul
	 * appelant) : une session ne peut tourner qu'à la main.
	 */
	lancePossible(): boolean;
	/** Réécrit le plugin de la session (skills de son projet) d'après son état actuel ; rien si elle est inconnue. */
	reecrirePlugin(id: string): Promise<void>;
	/**
	 * Ligne de commande qui reprend la session dans le terminal de l'utilisateur, `consigne` pour premier message (plugin
	 * écrit) ; null si elle est inconnue ou terminée.
	 */
	ligneDeReprise(id: string, consigne?: string): Promise<string | null>;
	/**
	 * Niveau des modèles propre à la session (null : le retirer, elle suit celui de la machine). Ses outils MCP et ses hooks le
	 * relisent à chaque appel : il vaut aussitôt, sans relancer la session, et il est gardé à la reprise. Rend la session
	 * (null si elle est inconnue) ; les écouteurs (`surChangement`) l'apprennent.
	 */
	niveauModeles(id: string, niveau: NiveauModeles | null): Promise<Session | null>;
};

/** Une session dont le moteur n'a pas d'implémentation dans ce service ne se relance pas (jamais un autre moteur à sa place). */
export class ErreurMoteurIndisponible extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'ErreurMoteurIndisponible';
	}
}

/** Une session que son moteur ne sait pas reprendre (Codex, Mistral Vibe : son identifiant chez le moteur encore inconnu) : rien n'est lancé. */
export class ErreurRepriseImpossible extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'ErreurRepriseImpossible';
	}
}

/**
 * Une session qui tourne mais n'a pas encore commencé chez son moteur (Codex : aucun `debut` reçu, son `fil` inconnu) : son
 * écran pose peut-être une question à l'utilisateur (approbation du dossier, « Trust and continue » choisi par défaut), à
 * laquelle une ligne tapée répondrait. Rien n'y est tapé.
 */
export class ErreurSessionNonCommencee extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'ErreurSessionNonCommencee';
	}
}

const NON_COMMENCEE =
	'la session n\'a pas encore commencé chez son moteur (aucun hook `debut` reçu : une question attend peut-être l\'utilisateur dans son terminal, comme l\'approbation du dossier par Codex, ou aucun message n\'a encore été envoyé) ; rien n\'y est tapé';

/** Raison pour laquelle la session ne peut pas tourner avec son moteur dans ce service. */
/** Motif d'une session dont le moteur n'a pas d'implémentation ici (sans point final : repris dans une phrase). */
const motifMoteurInconnu = (moteur: string): string => `moteur « ${moteur} » sans implémentation dans ce service : la session ne peut pas être relancée`;
const moteurIndisponible = (moteur: string): string => `Moteur « ${moteur} » sans implémentation dans ce service : la session ne peut pas être relancée.`;
const repriseImpossible = (motif: string): string => `Reprise impossible : ${motif}.`;

const COLONNES = 120;
const LIGNES = 32;
const TAILLE_MAX = 1000;
/** Entre deux relances au démarrage du service. */
const ESPACEMENT_RELANCES_MS = 300;
/** Battement : `vuVivantMs` des sessions tenues, rafraîchi à cet intervalle (borne la fenêtre des restes reconnus). */
export const BATTEMENT_MS = 10_000;
/** Bilan d'une session qui ne tourne pas : attente de son `debut` après la reprise, au plus. */
const ATTENTE_DEBUT_BILAN_MS = 30_000;
/** Bilan : filet — sans bilan lu puis `arret` dans ce délai après la demande, la session est arrêtée (épisode minimal). */
const ATTENTE_ARRET_BILAN_MS = 10 * 60_000;
/** Lecture des avertissements d'une session (hooks, déclaration MCP) avant son lancement, au plus. */
const DELAI_AVERTISSEMENTS_MS = 1000;
/** Intervalle de lecture de l'état pendant un bilan (les hooks l'écrivent, parfois sans passer par le service). */
const SONDAGE_BILAN_MS = 200;

/**
 * Un terminal tenu par le pilote : sa sortie (tampon, abonnés) et la promesse de sa fin traitée. `ecritMajMs` : `majMs` de
 * l'état lu quand le pilote y a écrit pour la dernière fois (Échap ou ligne) ; tant qu'aucun hook ne l'a fait avancer, un
 * dialogue lu dans l'état est périmé (déjà fermé, ou la ligne n'a pas encore été vue) et ne vaut pas un nouvel Échap.
 * `arret` : son arrêt est demandé, plus rien n'y est tapé.
 */
type Vivant = {
	terminal: Terminal;
	moteur: MoteurDuService['moteur'];
	tampon: ReturnType<typeof tamponCirculaire>;
	abonnes: Set<(d: string) => void>;
	fini: Promise<void>;
	ecritMajMs: number | null;
	arret: boolean;
};

const NOM_DE_VARIABLE = /^[A-Za-z_][A-Za-z0-9_]*$/u;

/**
 * Ligne de commande à coller dans son propre terminal (mode dégradé) : se placer dans `dossier`, retirer les variables
 * interdites présentes, poser celles de la session, lancer la commande trouvée du moteur (introuvable : `parDefaut`) avec ses
 * arguments. Chaque valeur entre apostrophes (POSIX ou PowerShell, comme la déclaration MCP du jalon 3) ; sous PowerShell, un
 * argument qui porte un guillemet double demande le passage « Standard » des arguments (PowerShell 7.3 ou plus).
 */
export function ligneManuelle(
	lanceur: CommandeMoteur | null,
	args: string[],
	dossier: string,
	ajouts: Record<string, string>,
	retirees: string[],
	plateforme: string,
	parDefaut = 'claude',
): string {
	const variables = Object.entries(ajouts).filter(([cle]) => NOM_DE_VARIABLE.test(cle));
	const sans = retirees.filter((cle) => NOM_DE_VARIABLE.test(cle));
	if (plateforme === 'win32') {
		const commande = lanceur === null ? parDefaut : citerPowerShell(lanceur.commande);
		const morceaux = [`Set-Location -LiteralPath ${citerPowerShell(dossier)}`];
		for (const cle of sans) morceaux.push(`Remove-Item -ErrorAction SilentlyContinue Env:${cle}`);
		for (const [cle, valeur] of variables) morceaux.push(`$env:${cle} = ${citerPowerShell(valeur)}`);
		const tous = [...(lanceur?.avant ?? []), ...args];
		morceaux.push(`& ${commande} ${tous.map(citerPowerShell).join(' ')}`);
		// un guillemet double dans un argument n'arrive intact au programme qu'en mode « Standard » (PowerShell 7.3 ou plus)
		if (!tous.some((a) => a.includes('"'))) return morceaux.join('; ');
		return `$PSNativeCommandArgumentPassing = 'Standard'; ${morceaux.join('; ')}  # PowerShell 7.3 ou plus`;
	}
	const commande = lanceur === null ? parDefaut : citerPosix(lanceur.commande);
	const env = sans.length > 0 ? `env ${sans.map((cle) => `-u ${cle}`).join(' ')} ` : '';
	const affectations = variables.map(([cle, valeur]) => `${cle}=${citerPosix(valeur)} `).join('');
	return `cd ${citerPosix(dossier)} && ${env}${affectations}${commande} ${[...(lanceur?.avant ?? []), ...args].map(citerPosix).join(' ')}`;
}

/** Champs modifiables d'une session. */
type Champs = Parameters<Pilotage['etat']['modifier']>[1];

/**
 * Le pilote tient les terminaux des sessions de ce service : lancement (fichiers de session écrits, le moteur de la session dans
 * un pseudo-terminal), pause, reprise, relance au démarrage, arrêt de tout. Une session n'a jamais deux processus : un terminal tenu,
 * un lancement en cours, ou un `pid` enregistré vivant et lancé pour elle (processus d'un autre service, jamais signalé)
 * bloquent la reprise. Un pid enregistré mort peut laisser des restes dans son groupe (plantage du service) : ceux qui sont
 * prouvés (nés pendant sa vie, d'après sa trace et son battement) sont tués avant toute relance. `battementMs` : tests.
 */
export function creerPilote(dep: Dependances, pil: Pilotage, options: { battementMs?: number } = {}): Pilote {
	const vivants = new Map<string, Vivant>();
	/**
	 * Une file par session pour tout ce qui écrit dans son terminal (ligne tapée, frappes, arrêt) : chaque action attend la fin
	 * de la précédente ; l'échec de l'une ne bloque pas les suivantes. `enAttente` : actions pas encore finies.
	 */
	const files = new Map<string, { queue: Promise<void>; enAttente: number }>();
	const enFile = <T>(id: string, action: () => Promise<T>): Promise<T> => {
		let file = files.get(id);
		if (file === undefined) {
			file = { queue: Promise.resolve(), enAttente: 0 };
			files.set(id, file);
		}
		const f = file;
		f.enAttente += 1;
		const resultat = f.queue.then(action);
		f.queue = resultat.then(
			() => {},
			() => {},
		).finally(() => {
			f.enAttente -= 1;
			if (f.enAttente === 0 && files.get(id) === f) files.delete(id);
		});
		return resultat;
	};
	/**
	 * Faut-il Échap avant d'écrire ? Seulement si un dialogue est ouvert d'après l'état ET qu'un hook a fait avancer `majMs`
	 * depuis la dernière écriture du pilote (Échap ou ligne) : deux Échap de suite ouvrent le retour arrière (Claude Code).
	 * Seul endroit où cette décision est prise (le terminal n'envoie Échap que sur demande).
	 */
	const echapNecessaire = (v: Vivant, s: Session | null): s is Session =>
		s !== null && dialogueOuvert(s) && (v.ecritMajMs === null || s.majMs > v.ecritMajMs);
	/** Un seul minuteur pour le battement de toutes les sessions tenues ; arrêté quand il n'y en a plus, et par `arreterTout`. */
	let battement: ReturnType<typeof setInterval> | null = null;
	const arreterBattement = (): void => {
		if (battement !== null) clearInterval(battement);
		battement = null;
	};
	const demarrerBattement = (): void => {
		if (battement !== null || arrete) return;
		battement = setInterval(() => {
			const ids = [...vivants.keys()];
			if (ids.length === 0) {
				arreterBattement();
				return;
			}
			pil.etat.battre(ids, Date.now()).catch(() => {});
		}, options.battementMs ?? BATTEMENT_MS);
	};
	/** Lancements et reprises en cours, par session : la promesse se résout quand ils sont finis. */
	const enLancement = new Map<string, Promise<void>>();
	const ecouteurs = new Set<(s: Session) => void>();
	let arrete = false;
	/** Lancements et reprises en cours : `arreterTout` les attend avant d'arrêter, pour que rien ne lui survive. */
	const enVol = new Set<Promise<unknown>>();
	/** Lancements d'archiviste, l'un après l'autre (jamais deux archivistes). */
	let lancementsArchiviste: Promise<unknown> = Promise.resolve();
	const suivi = <T>(promesse: Promise<T>): Promise<T> => {
		enVol.add(promesse);
		const retirer = () => enVol.delete(promesse);
		promesse.then(retirer, retirer);
		return promesse;
	};
	/** Marque la session en lancement ; rend la fonction qui la libère. */
	const marquer = (id: string): (() => void) => {
		let liberer: () => void = () => {};
		enLancement.set(
			id,
			new Promise<void>((r) => {
				liberer = r;
			}),
		);
		return () => {
			enLancement.delete(id);
			liberer();
		};
	};

	const signaler = (s: Session | null): void => {
		if (s === null) return;
		for (const f of ecouteurs) {
			try {
				f(s);
			} catch {
				// un écouteur en panne n'empêche ni les autres, ni le pilote
			}
		}
	};
	const modifier = async (id: string, champs: Champs): Promise<Session | null> => {
		const s = await pil.etat.modifier(id, champs);
		signaler(s);
		return s;
	};

	/**
	 * Épisode minimal d'une session qui n'en a pas (rattrapage : `fin` n'a pas pu l'écrire) ; aucune erreur ne remonte.
	 * `finMs` : sa dernière activité connue.
	 */
	const assurerEpisode = async (s: Session, present = false): Promise<void> => {
		let ecrit = present;
		if (!ecrit) {
			const chemin = await ecrireEpisodeMinimal(dep, pil, s, s.majMs, { siAbsent: true }).catch(() => null);
			ecrit = chemin !== null || (await trouverEpisode(dep, s.id, s.projet).catch(() => null)) !== null;
		}
		// noté : le rattrapage ne la revérifie plus (un épisode effacé ou déplacé n'est jamais recréé), sauf activité nouvelle
		if (ecrit) await pil.etat.modifier(s.id, { episodeMs: Math.max(Date.now(), s.majMs) }).catch(() => null);
	};
	/** L'épisode de la session a déjà été écrit ou constaté depuis sa dernière activité. */
	const episodeNote = (s: Session): boolean => (s.episodeMs ?? null) !== null && s.episodeMs! >= s.majMs;

	/**
	 * Fin du processus : pid effacé ; pause → `en_pause` ; fin imprévue d'une session active → `a_relire` ; bilan ou abandon
	 * dont le `fin` n'a pas abouti (processus tué) → `terminee`. Bilan ou abandon d'une session lancée, ou session passée ici à
	 * `a_relire` (son `fin` manqué, ou ignoré tant que le processus tournait : Codex) : son épisode minimal est assuré (s'il
	 * n'y en a aucun) ; jamais pour un lancement raté (`lanceMs` absent).
	 */
	const apresFin = async (id: string): Promise<void> => {
		const s = await pil.etat.lire(id);
		if (s === null) return;
		const champs: Champs = { pid: null };
		if (s.arretAttendu === 'pause' && s.etat !== 'terminee') champs.etat = 'en_pause';
		else if (s.arretAttendu === null && (s.etat === 'travaille' || s.etat === 'attend')) champs.etat = 'a_relire';
		const finale = s.arretAttendu === 'bilan' || s.arretAttendu === 'abandon';
		if (finale && s.etat !== 'terminee') champs.etat = 'terminee';
		const apres = await modifier(id, champs);
		if (apres !== null && (finale || champs.etat === 'a_relire') && (apres.lanceMs ?? null) !== null) await assurerEpisode(apres);
	};

	/**
	 * Rattrapage au démarrage : épisode minimal des sessions `a_relire`, et des sessions terminées après un lancement (bilan ou
	 * abandon), qui n'en ont pas. Une lecture du dossier d'épisodes par projet. Borné : une session dont l'épisode est noté
	 * (`episodeMs`, au moins sa dernière activité) n'est plus vérifiée ; un épisode trouvé est noté.
	 */
	const rattraperEpisodes = async (): Promise<void> => {
		const parProjet = new Map<string, ReadonlyMap<string, unknown>>();
		for (const s of await pil.etat.lister({ archivees: true }).catch(() => [] as Session[])) {
			if (arrete) return;
			const aRattraper = s.etat === 'a_relire' || (s.etat === 'terminee' && (s.lanceMs ?? null) !== null && (s.arretAttendu === 'bilan' || s.arretAttendu === 'abandon'));
			if (!aRattraper || episodeNote(s)) continue;
			let ids = parProjet.get(s.projet);
			if (ids === undefined) {
				ids = await episodesDuProjet(dep, s.projet).catch(() => new Map());
				parProjet.set(s.projet, ids);
			}
			await assurerEpisode(s, ids.has(s.id));
		}
	};

	/**
	 * Le service s'arrête : `service`, sauf si un autre arrêt est déjà attendu (une pause en cours reste une pause). Un bilan en
	 * cours devient `service` lui aussi, sa demande (`bilanDemandeMs`) gardée : il est redemandé au redémarrage.
	 */
	const marquerArretService = async (id: string): Promise<void> => {
		const s = await pil.etat.lire(id);
		if (s !== null && (s.arretAttendu === null || s.arretAttendu === 'bilan')) await pil.etat.modifier(id, { arretAttendu: 'service' });
	};

	/** Dossier de lancement de la session : chemin absolu, revalidé sur son chemin réel (un lien vers `_mnemo/` est refusé). */
	const dossierDe = async (session: Session): Promise<string> => {
		const d = await pil.hote.dossier(session.dossier);
		const memoire = session.dossier === DOSSIER_MEMOIRE;
		if (d === null || (!memoire && !validerDossier(d.reel).ok)) throw new Error(`Dossier de session introuvable ou refusé : « ${session.dossier} ».`);
		return d.absolu;
	};

	/**
	 * Le moteur de la session (Claude Code pour une session d'avant les moteurs, sans moteur enregistré) ; null : inconnu de
	 * ce service, ou sans implémentation (jamais Claude Code à sa place).
	 */
	const moteurDe = (session: Pick<Session, 'moteur'>): MoteurDuService | null => {
		const id = session.moteur ?? MOTEUR_PAR_DEFAUT;
		return estIdMoteur(id) ? (pil.moteurs[id] ?? null) : null;
	};
	/** Motif qui empêche pause et reprise : celui du moteur, ou son absence de ce service. */
	const motifSansReprise = (s: Session): string | null => {
		const duService = moteurDe(s);
		return duService === null ? motifMoteurInconnu(s.moteur ?? MOTEUR_PAR_DEFAUT) : duService.moteur.motifSansReprise(s);
	};
	/** Ce que la ligne de commande d'un processus lancé pour la session contient (son uuid, à défaut de moteur connu). */
	const marqueDe = (s: Session): string => moteurDe(s)?.moteur.marqueDeSession(s.id) ?? s.id;

	const lancePossible = (): boolean => (pil.moteurs[MOTEUR_PAR_DEFAUT]?.commande ?? null) !== null && pil.terminaux.disponibles().ok;

	/**
	 * Fichiers de session écrits, arguments, environnement et dossier du moteur pour cette session ; `manuel` : la même chose en
	 * une ligne à coller. Lève si les fichiers, le dossier ou le moteur font défaut.
	 */
	const preparer = async (session: Session, mode: ModeLancement, objectif?: string) => {
		const duService = moteurDe(session);
		if (duService === null) throw new ErreurMoteurIndisponible(moteurIndisponible(session.moteur ?? MOTEUR_PAR_DEFAUT));
		const { moteur, commande } = duService;
		const sansReprise = mode === 'reprise' ? moteur.motifSansReprise(session) : null;
		if (sansReprise !== null) throw new ErreurRepriseImpossible(repriseImpossible(sansReprise));
		const profil = await chargerProfil(dep, session.profil);
		const fichiers = await moteur.fichiersDeSession(dep, session, profil, pil.plugin.appel);
		const dossierFichiers = await pil.plugin.ecrire(session.id, fichiers);
		const lancement = moteur.preparer({
			session,
			profil,
			mode,
			...(objectif === undefined ? {} : { objectif }),
			dossierFichiers,
			fichiers,
			racine: pil.plugin.racine,
			appel: pil.plugin.appel,
			env: pil.hote.env,
		});
		const dossier = await dossierDe(session);
		const manuel = (): { manuel: string } => ({ manuel: ligneManuelle(commande, lancement.args, dossier, lancement.ajouts, lancement.retirees, pil.hote.plateforme, moteur.commandeParDefaut) });
		return { moteur, commande, args: lancement.args, env: lancement.env, dossier, manuel };
	};

	/**
	 * Avertissements à écrire en tête du terminal d'une session : hooks de Mnemo installés pour tout le poste (Codex, Mistral Vibe) qu'elle
	 * n'exécutera pas (absents, d'une autre installation, non approuvés) ; réglages de la déclaration MCP de l'utilisateur qui
	 * s'appliquent aussi à elle. Lus sans bloquer : au-delà de `DELAI_AVERTISSEMENTS_MS`, rien n'est dit.
	 */
	const avertissementsDuMoteur = async (moteur: Moteur): Promise<string[]> => {
		const hooks = async (): Promise<string | null> => {
			if (moteur.hooksDuPoste === undefined) return null;
			const lu = await moteur.hooksDuPoste.lire({ node: pil.plugin.appel.node, main: pil.plugin.appel.main, env: pil.hote.env }).catch((erreur: unknown) => ({ echec: (erreur as Error).message }));
			return avertissementDesHooks(moteur, lu);
		};
		const mcp = async (): Promise<string | null> => (moteur.reglagesMcp === undefined ? null : avertissementDesReglagesMcp(moteur.nom, await moteur.reglagesMcp(pil.hote.env)));
		const borne = (p: Promise<string | null>): Promise<string | null> => {
			let minuteur: ReturnType<typeof setTimeout> | undefined;
			const delai = new Promise<null>((r) => {
				minuteur = setTimeout(() => r(null), DELAI_AVERTISSEMENTS_MS);
			});
			return Promise.race([p.catch(() => null), delai]).finally(() => clearTimeout(minuteur));
		};
		return (await Promise.all([borne(hooks()), borne(mcp())])).filter((a): a is string => a !== null);
	};

	/**
	 * Prépare la session, puis lance son moteur dans un terminal ; sans terminal possible (mode dégradé, commande du moteur
	 * introuvable, lancement en échec), rend la ligne de commande à coller. Les hooks du moteur absents ou non approuvés ne
	 * l'empêchent pas : une ligne le dit en tête du terminal.
	 */
	const demarrer = async (session: Session, mode: ModeLancement, objectif?: string): Promise<{ manuel: string } | { terminal: Terminal }> => {
		const { moteur, commande, args, env, dossier, manuel } = await preparer(session, mode, objectif);
		if (commande === null || !pil.terminaux.disponibles().ok) return manuel();
		const avertissements = await avertissementsDuMoteur(moteur);
		let terminal: Terminal;
		const lanceMs = Date.now();
		try {
			terminal = pil.terminaux.lancer({ commande: commande.commande, args: [...commande.avant, ...args], dossier, env, colonnes: COLONNES, lignes: LIGNES, touches: moteur.touches });
		} catch {
			return manuel();
		}
		const vivant: Vivant = { terminal, moteur, tampon: tamponCirculaire(CAPACITE_TAMPON), abonnes: new Set(), fini: Promise.resolve(), ecritMajMs: null, arret: false };
		// avant toute sortie du moteur : le terminal n'a encore aucun abonné, la relecture la montrera d'abord
		for (const avertissement of avertissements) vivant.tampon.ajouter(lignesDAvertissement(avertissement));
		terminal.surSortie((d) => {
			vivant.tampon.ajouter(d);
			for (const f of vivant.abonnes) {
				try {
					f(d);
				} catch {
					// un abonné en panne ne freine jamais le terminal
				}
			}
		});
		vivant.fini = new Promise<void>((resoudre) => {
			// la session reste tenue jusqu'à ce que sa fin soit écrite : une reprise ne peut pas s'intercaler
			terminal.surFin(() => {
				apresFin(session.id)
					.catch(() => {})
					.finally(() => {
						if (vivants.get(session.id) === vivant) vivants.delete(session.id);
						resoudre();
						// signalée de nouveau, maintenant sans terminal : l'interface voit `terminal: false`
						pil.etat.lire(session.id).then(signaler, () => {});
					});
			});
		});
		vivants.set(session.id, vivant);
		demarrerBattement();
		// trace du processus : de quoi reconnaître ses restes après un plantage du service
		await modifier(session.id, { pid: terminal.pid, lanceMs, demarrageMachineMs: pil.hote.demarrageMachineMs(), vuVivantMs: Date.now() });
		// arrêt du service pendant le lancement : rien ne doit lui survivre
		if (arrete) {
			await marquerArretService(session.id);
			await arreterSession(session.id);
		}
		return { terminal };
	};

	/**
	 * La session tenue n'a pas encore commencé chez son moteur : il ne sait pas encore la reprendre (Codex : `fil` inconnu tant
	 * qu'aucun `debut` n'est reçu). État illisible : tenue pour commencée.
	 */
	const nonCommencee = (v: Vivant, s: Session | null): boolean => s !== null && v.moteur.motifSansReprise(s) !== null;

	/**
	 * Arrête le terminal tenu, à son tour dans la file de la session ; un dialogue de permission peut être ouvert (dernier arrêt
	 * `Notification`, pas encore traité par une écriture du pilote) : Échap avant `/exit`. Session pas encore commencée chez son
	 * moteur : aucune touche, le processus est terminé par signaux.
	 */
	const arreterSession = async (id: string): Promise<void> => {
		const v = vivants.get(id);
		if (v === undefined) return;
		await enFile(id, async () => {
			v.arret = true;
			const s = await pil.etat.lire(id).catch(() => null);
			// pas encore commencée : aucune touche (une Entrée répondrait à sa place à la question de l'écran), signaux seulement
			if (nonCommencee(v, s)) {
				await v.terminal.arreter(undefined, { sansTouche: true });
				return;
			}
			const echap = echapNecessaire(v, s);
			if (echap) v.ecritMajMs = s.majMs;
			await v.terminal.arreter(undefined, { echap });
		});
		await v.fini;
	};

	/**
	 * Pid enregistré d'une session que ce pilote ne tient pas : `ailleurs` si un autre service la fait encore tourner (jamais
	 * signalé) ; sinon le pid est effacé (`efface`) — mort (après avoir tué ses restes prouvés) ou réattribué à un autre
	 * processus. `libre` : aucun pid enregistré.
	 */
	const verifierPid = async (s: Session): Promise<'ailleurs' | 'efface' | 'libre'> => {
		if (s.pid === null || vivants.has(s.id)) return 'libre';
		const etat = await pil.hote.processus(s.pid, marqueDe(s));
		if (etat === 'session') return 'ailleurs';
		if (etat === 'mort') await pil.hote.nettoyerRestes(s);
		await modifier(s.id, { pid: null });
		return 'efface';
	};

	const reprendre = (id: string): Promise<Session | null> => {
		if (vivants.has(id) || enLancement.has(id) || arrete) return pil.etat.lire(id);
		const liberer = marquer(id);
		return suivi(reprendreSession(id).finally(liberer));
	};

	const reprendreSession = async (id: string): Promise<Session | null> => {
		const s = await pil.etat.lire(id);
		if (s === null || s.etat === 'terminee') return s;
		const duService = moteurDe(s);
		if (duService === null) throw new ErreurMoteurIndisponible(moteurIndisponible(s.moteur ?? MOTEUR_PAR_DEFAUT));
		const sansReprise = duService.moteur.motifSansReprise(s);
		if (sansReprise !== null) throw new ErreurRepriseImpossible(repriseImpossible(sansReprise));
		if (duService.commande === null || !pil.terminaux.disponibles().ok) return s;
		if ((await verifierPid(s)) === 'ailleurs') return pil.etat.lire(id);
		// un bilan d'avant (interrompu par une pause) est oublié : seul `reprendreAuDemarrage` en redemande un
		const prete = await modifier(id, { arretAttendu: null, etat: 'attend', bilanDemandeMs: null, bilanLuMs: null });
		if (prete === null) return null;
		try {
			await demarrer(prete, 'reprise');
		} catch {
			// plugin ou dossier en défaut : rien ne tourne, la session reste à relire (le bilan la reprendra)
			await arreterSession(id).catch(() => {});
			return modifier(id, { etat: 'a_relire' });
		}
		return pil.etat.lire(id);
	};

	/** Lancement raté à mi-chemin : la session est abandonnée (jamais reprise), son terminal éventuel arrêté. */
	const abandonner = async (id: string): Promise<void> => {
		await modifier(id, { etat: 'terminee', arretAttendu: 'abandon' }).catch(() => null);
		await arreterSession(id).catch(() => {});
	};

	const lancer = async (d: { profil: string; dossier: string; objectif?: string }): Promise<{ session: Session } | { session: Session; manuel: string } | { refus: string }> => {
		const accepte = validerDossier(d.dossier);
		if (!accepte.ok) return { refus: accepte.message };
		const relatif = accepte.chemin;
		const trouve = await pil.hote.dossier(relatif);
		if (trouve === null) return { refus: `Dossier introuvable : « ${relatif} ».` };
		const reel = validerDossier(trouve.reel);
		if (!reel.ok) return { refus: `${reel.message} Chemin demandé : « ${relatif} ».` };
		const objectif = d.objectif?.trim() ?? '';
		if (objectif.length > OBJECTIF_MAX) return { refus: `Objectif trop long (${objectif.length} caractères, ${OBJECTIF_MAX} au plus).` };
		const profil = await chargerProfil(dep, d.profil);
		// ce que l'éditeur refuse, revérifié (fiche écrite à la main)
		const refus = refusDuMoteur(profil);
		if (refus !== null) return { refus: `Le profil « ${profil.nom} » ne peut pas être lancé : ${refus.motif}.` };
		// le moteur du profil doit être implémenté ici ; introuvable sur le poste, la ligne à coller est rendue (mode dégradé),
		// sauf pour un moteur dont la ligne ne lancerait rien (`sansCommande: 'refus'` : Codex, Mistral Vibe) : refusé
		const duService = moteurDe(profil);
		if (duService === null) return { refus: `Le profil « ${profil.nom} » utilise le moteur « ${profil.moteur} », pas encore pris en charge par ce service.` };
		const { moteur: duProfil, commande } = duService;
		if (commande === null && duProfil.sansCommande === 'refus') {
			return { refus: `Le profil « ${profil.nom} » utilise ${duProfil.nom}, introuvable sur ce poste (commande « ${duProfil.commandeParDefaut} ») : installe-le, puis relance le service.` };
		}
		// une version trop ancienne du moteur est refusée ; illisible, elle n'empêche rien
		if (commande !== null && duProfil.version !== undefined && duProfil.refusDeVersion !== undefined) {
			const tropAncien = duProfil.refusDeVersion(await duProfil.version(commande, pil.hote.env));
			if (tropAncien !== null) return { refus: `Le profil « ${profil.nom} » ne peut pas être lancé : ${tropAncien}.` };
		}
		const memoire = profil.lancement === 'memoire';
		// une session lancée dans la mémoire est à sa racine
		const trouvee: PositionDuProjet = memoire ? { chemin: '', rattachement: null } : await positionNotee(dep, pil.etat, relatif);
		const position = trouvee.chemin;
		const maintenant = dep.systeme.maintenant().getTime();
		const session: Session = {
			id: dep.systeme.nouvelUuid(),
			profil: profil.nom,
			dossier: memoire ? DOSSIER_MEMOIRE : relatif,
			position,
			// dossier d'épisodes : le projet ou le client de la position
			projet: await projetDeSession(dep, position),
			dossierNonRattache: trouvee.rattachement?.rattache === false,
			objectif: objectif === '' ? null : objectifDe(objectif),
			etat: 'attend',
			creeeMs: maintenant,
			majMs: maintenant,
			arretAttendu: null,
			bilanDemandeMs: null,
			commitDebut: null,
			branche: null,
			pid: null,
			// moteur et modèle du profil au lancement : la reprise garde ceux-ci, même si le profil change ensuite
			moteur: profil.moteur,
			modele: profil.modele,
		};
		const liberer = marquer(session.id);
		try {
			await pil.etat.creer(session);
			signaler(session);
			let r: Awaited<ReturnType<typeof demarrer>>;
			try {
				r = await demarrer(session, 'nouvelle', objectif === '' ? undefined : objectif);
			} catch (erreur) {
				await abandonner(session.id);
				return { refus: `Lancement impossible : ${(erreur as Error).message}` };
			}
			const apres = (await pil.etat.lire(session.id)) ?? session;
			return 'manuel' in r ? { session: apres, manuel: r.manuel } : { session: apres };
		} finally {
			liberer();
		}
	};

	/** Bilans en cours, par session : la fonction qui arrête leur surveillance. */
	const bilans = new Map<string, () => void>();

	/** Attend une condition sur l'état de la session (lu toutes les `SONDAGE_BILAN_MS`) ; faux après `delaiMs` ou si elle ne tourne plus. */
	const attendreEtat = async (id: string, condition: (s: Session) => boolean, delaiMs: number): Promise<boolean> => {
		const fin = Date.now() + delaiMs;
		while (Date.now() < fin && !arrete && vivants.has(id)) {
			const s = await pil.etat.lire(id).catch(() => null);
			if (s !== null && condition(s)) return true;
			await new Promise((r) => setTimeout(r, SONDAGE_BILAN_MS));
		}
		return false;
	};

	/**
	 * Surveille un bilan : la session est arrêtée (`fin` → `terminee`) au premier `Stop` qui suit la consigne du bilan soumise
	 * (`bilanLuMs`, noté par l'état au premier `message` après la demande) : `attend`, dernier événement après `bilanLuMs`. Un
	 * `arret` sans ce `message` (fin du tour en cours) n'arrête rien. Filet : 10 minutes après la demande, arrêtée quand même
	 * (épisode minimal si l'agent n'a rien écrit). Si elle cesse de tourner, la surveillance s'arrête.
	 */
	const surveillerBilan = (id: string, depuisMs: number): void => {
		bilans.get(id)?.();
		let actif = true;
		const arreter = () => {
			actif = false;
		};
		bilans.set(id, arreter);
		void (async () => {
			// un `Stop` (tour fini) : une `Notification` ou une `PermissionRequest` (l'agent demande une permission) ne termine pas le bilan
			const lu = (s: Session) =>
				s.arretAttendu === 'bilan' && (s.bilanLuMs ?? null) !== null && s.etat === 'attend' && s.dernierArret === 'stop' && s.majMs > s.bilanLuMs!;
			const vu = await attendreEtat(id, (s) => !actif || lu(s), depuisMs + ATTENTE_ARRET_BILAN_MS - Date.now());
			const aTerme = !vu && actif && !arrete && vivants.has(id) && Date.now() >= depuisMs + ATTENTE_ARRET_BILAN_MS;
			if (bilans.get(id) === arreter) bilans.delete(id);
			if (actif && !arrete && (vu || aTerme)) await suivi(arreterSession(id)).catch(() => {});
		})();
	};

	/** Le terminal tenu pour `id`, s'il est toujours `v` et que son arrêt n'est pas demandé. */
	const toujours = (id: string, v: Vivant): boolean => vivants.get(id) === v && !v.arret;

	const taper = (id: string, ligne: string): Promise<void> => {
		const v = vivants.get(id);
		if (v === undefined) return Promise.resolve();
		return enFile(id, async () => {
			if (!toujours(id, v)) return;
			let s = await pil.etat.lire(id).catch(() => null);
			if (nonCommencee(v, s)) return;
			if (echapNecessaire(v, s)) {
				const { echap, pauseApresEchapMs, attenteApresEchapMs } = v.moteur.touches;
				v.ecritMajMs = s.majMs;
				v.terminal.ecrire(echap);
				await new Promise((r) => setTimeout(r, pauseApresEchapMs));
				await attendreEtat(id, (apres) => !dialogueOuvert(apres), attenteApresEchapMs - pauseApresEchapMs);
				if (!toujours(id, v)) return;
				s = (await pil.etat.lire(id).catch(() => null)) ?? s;
			}
			// la ligne n'est vue par l'état qu'à son hook `message` : d'ici là, le dialogue qu'il montre encore est périmé
			if (s !== null) v.ecritMajMs = s.majMs;
			const { entree, pauseAvantEntreeMs } = v.moteur.touches;
			if (pauseAvantEntreeMs <= 0) {
				v.terminal.ecrire(`${ligne}${entree}`);
				return;
			}
			// l'Entrée à part : collée à la ligne, Codex la prend dans le collage et n'envoie rien
			v.terminal.ecrire(ligne);
			await new Promise((r) => setTimeout(r, pauseAvantEntreeMs));
			if (toujours(id, v)) v.terminal.ecrire(entree);
		});
	};

	/**
	 * Lève `ErreurSessionNonCommencee` si la session tenue n'a pas encore commencé chez son moteur : le bilan ou la consigne
	 * seraient tapés dans une question de l'écran.
	 */
	const pasAvantDebut = async (id: string, quoi: string): Promise<void> => {
		const v = vivants.get(id);
		if (v === undefined) return;
		if (nonCommencee(v, await pil.etat.lire(id).catch(() => null))) throw new ErreurSessionNonCommencee(`${quoi} : ${NON_COMMENCEE}.`);
	};

	/** Une session qui ne tourne pas est reprise, et son `debut` attendu (30 s au plus) ; vrai si elle tourne ici ensuite. */
	const assurerVivante = async (id: string): Promise<boolean> => {
		if (!vivants.has(id)) {
			const repriseMs = Date.now();
			await reprendre(id);
			if (!vivants.has(id)) return false;
			await attendreEtat(id, (apres) => apres.majMs >= repriseMs, ATTENTE_DEBUT_BILAN_MS);
		}
		return vivants.has(id) && !arrete;
	};

	/** L'agent rédige le bilan dans son terminal : une session qu'on ne peut pas faire tourner est rendue sans bilan demandé. */
	const bilan = async (id: string): Promise<Session | null> => {
		await enLancement.get(id);
		const s = await pil.etat.lire(id);
		if (s === null || s.etat === 'terminee') return s;
		if (!(await assurerVivante(id))) return pil.etat.lire(id);
		await pasAvantDebut(id, 'Bilan impossible');
		const bilanDemandeMs = Date.now();
		const demandee = await modifier(id, { arretAttendu: 'bilan', bilanDemandeMs, bilanLuMs: null });
		if (demandee === null) return null;
		await taper(id, texteDuBilan(demandee));
		surveillerBilan(id, bilanDemandeMs);
		return demandee;
	};

	const confier = async (id: string, ligne: string): Promise<Session | null> => {
		await enLancement.get(id);
		const s = await pil.etat.lire(id);
		if (s === null || s.etat === 'terminee') return s;
		if (await assurerVivante(id)) {
			await pasAvantDebut(id, 'Consigne non transmise');
			await taper(id, ligne);
		}
		return pil.etat.lire(id);
	};

	/** Bilan redemandé après une reprise au démarrage : son `debut` attendu (30 s au plus), puis le bilan. */
	const redemanderBilan = async (id: string, repriseMs: number): Promise<void> => {
		await attendreEtat(id, (apres) => apres.majMs >= repriseMs, ATTENTE_DEBUT_BILAN_MS);
		if (!arrete && vivants.has(id)) await bilan(id);
	};

	/** Sans bilan : abandonnée ; arrêtée si elle tourne ici (son `fin` écrit l'épisode minimal), sinon terminée aussitôt. */
	const abandonnerSession = async (id: string): Promise<Session | null> => {
		await enLancement.get(id);
		const s = await pil.etat.lire(id);
		if (s === null || s.etat === 'terminee') return s;
		bilans.get(id)?.();
		bilans.delete(id);
		if (vivants.has(id)) {
			await modifier(id, { arretAttendu: 'abandon' });
			await arreterSession(id);
			return pil.etat.lire(id);
		}
		// un processus d'un autre service, lancé pour elle : jamais signalé d'ici
		if (s.pid !== null && (await pil.hote.processus(s.pid, marqueDe(s))) === 'session') return s;
		const terminee = await modifier(id, { arretAttendu: 'abandon', etat: 'terminee', pid: null });
		if (terminee !== null) await assurerEpisode(terminee);
		return pil.etat.lire(id);
	};

	return {
		lancer(d) {
			if (arrete) return Promise.resolve({ refus: 'Le service s’arrête : aucune session ne peut être lancée.' });
			if (d.profil !== PROFIL_ARCHIVISTE) return suivi(lancer(d));
			// un seul archiviste : le tour de chacun commence après le précédent, et le trouve s'il a abouti
			const tour = lancementsArchiviste.then(async () => {
				const [existant] = (await pil.etat.lister()).filter((x) => x.profil === PROFIL_ARCHIVISTE && x.etat !== 'terminee').sort((a, b) => b.majMs - a.majMs);
				if (existant !== undefined) return { session: existant, existant: true as const };
				return lancer(d);
			});
			lancementsArchiviste = tour.catch(() => undefined);
			return suivi(tour);
		},

		async pause(id) {
			// un lancement ou une reprise en cours : on attend qu'il aboutisse, puis on l'arrête
			await enLancement.get(id);
			const s = await pil.etat.lire(id);
			if (s === null || s.etat === 'terminee') return s;
			if (!vivants.has(id) && s.etat === 'en_pause') return s;
			// une pause qu'aucune reprise ne suivrait : refusée, que la session tourne ici ou non ; l'abandon reste possible
			const sansReprise = motifSansReprise(s);
			if (sansReprise !== null) throw new ErreurRepriseImpossible(`Pause impossible : ${sansReprise} ; abandonne-la à la place.`);
			if (!vivants.has(id)) {
				// rien à arrêter ici (mode dégradé, processus fini) : la session n'est plus relancée au démarrage
				if (s.pid !== null && (await pil.hote.processus(s.pid, marqueDe(s))) === 'session') return s;
				return modifier(id, { etat: 'en_pause' });
			}
			await modifier(id, { arretAttendu: 'pause' });
			await arreterSession(id);
			return pil.etat.lire(id);
		},

		reprendre,

		entree(id, d) {
			const v = vivants.get(id);
			if (v === undefined) return;
			// rien en file : aussitôt ; sinon après les actions en cours (une ligne tapée après un Échap, un arrêt)
			if (!files.has(id)) {
				v.terminal.ecrire(d);
				return;
			}
			enFile(id, async () => {
				if (toujours(id, v)) v.terminal.ecrire(d);
			}).catch(() => {});
		},

		taille(id, c, l) {
			const valide = (n: number) => Number.isInteger(n) && n >= 1 && n <= TAILLE_MAX;
			if (valide(c) && valide(l)) vivants.get(id)?.terminal.redimensionner(c, l);
		},

		abonner(id, f) {
			const v = vivants.get(id);
			if (v === undefined) return null;
			const relecture = v.tampon.lire();
			v.abonnes.add(f);
			return { relecture, desabonner: () => v.abonnes.delete(f) };
		},

		surChangement(f) {
			ecouteurs.add(f);
			return () => ecouteurs.delete(f);
		},

		async reprendreAuDemarrage() {
			// `fin` n'a pas pu écrire certains épisodes (hook à court de temps, processus tué) : écrits maintenant
			await rattraperEpisodes();
			const relancees: string[] = [];
			for (const s of await pil.etat.lister()) {
				if (arrete) break;
				if (!ETATS_RELANCES.includes(s.etat) || vivants.has(s.id)) continue;
				const pid = await verifierPid(s);
				if (pid === 'ailleurs') {
					// processus d'un service précédent, lancé pour cette session : jamais signalé ; elle attend qu'on la reprenne
					await modifier(s.id, { etat: 'en_pause' });
					continue;
				}
				if (pid === 'efface' && s.arretAttendu === null && (s.etat === 'travaille' || s.etat === 'attend')) {
					// plantage du service précédent : son processus a disparu sans `fin` ; à relire, avec son épisode minimal
					const aRelire = await modifier(s.id, { etat: 'a_relire' });
					if (aRelire !== null) await assurerEpisode(aRelire);
				}
				// un bilan interrompu par l'arrêt (ou le plantage) du service est redemandé, une fois la session reprise et son `debut` passé
				const refaireBilan = (s.arretAttendu === 'service' || s.arretAttendu === 'bilan') && s.bilanDemandeMs !== null;
				if (relancees.length > 0) await new Promise((r) => setTimeout(r, ESPACEMENT_RELANCES_MS));
				const repriseMs = Date.now();
				// moteur sans implémentation ici : la session reste en l'état, jamais relancée par un autre moteur ; moteur qui ne
				// sait pas la reprendre (Codex sans `fil`) : à relire, avec son épisode minimal
				const apres = await reprendre(s.id).catch(async (erreur: unknown) => {
					if (erreur instanceof ErreurMoteurIndisponible) return null;
					if (!(erreur instanceof ErreurRepriseImpossible)) throw erreur;
					const aRelire = await modifier(s.id, { etat: 'a_relire', arretAttendu: null, pid: null });
					if (aRelire !== null) await assurerEpisode(aRelire);
					return null;
				});
				if (apres !== null && vivants.has(s.id)) {
					relancees.push(s.id);
					if (refaireBilan) void suivi(redemanderBilan(s.id, repriseMs)).catch(() => {});
				}
			}
			return relancees;
		},

		async arreterTout() {
			arrete = true;
			arreterBattement();
			for (const arret of bilans.values()) arret();
			bilans.clear();
			await Promise.allSettled([...enVol]);
			const ids = [...vivants.keys()];
			for (const id of ids) await marquerArretService(id).catch(() => null);
			await Promise.all(ids.map((id) => arreterSession(id).catch(() => {})));
			// filet : aucun pid ne reste enregistré pour un processus arrêté ici
			for (const id of ids) await modifier(id, { pid: null }).catch(() => null);
		},

		enCours(id) {
			return vivants.has(id);
		},

		motifSansReprise,

		taper(id, ligne) {
			if (arrete) return Promise.resolve();
			return suivi(taper(id, ligne));
		},

		confier(id, ligne) {
			if (arrete) return pil.etat.lire(id);
			return suivi(confier(id, ligne));
		},

		lancePossible,
		async reecrirePlugin(id) {
			const session = await pil.etat.lire(id);
			const moteur = session === null ? null : moteurDe(session);
			if (session === null || moteur === null) return;
			await pil.plugin.ecrire(id, await moteur.moteur.fichiersDeSession(dep, session, await chargerProfil(dep, session.profil), pil.plugin.appel));
		},

		async ligneDeReprise(id, consigne) {
			const s = await pil.etat.lire(id);
			if (s === null || s.etat === 'terminee') return null;
			return (await preparer(s, 'reprise', consigne)).manuel().manuel;
		},

		niveauModeles(id, niveau) {
			return modifier(id, { niveauModeles: niveau });
		},

		terminer(id, options) {
			if (arrete) return pil.etat.lire(id);
			return suivi(options.bilan ? bilan(id) : abandonnerSession(id));
		},
	};
}
