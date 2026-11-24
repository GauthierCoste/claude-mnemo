import { OBJECTIF_MAX, PROFIL_ARCHIVISTE } from '@mnemo/commun';
import { validerDossier } from './dossiers.ts';
import { dialogueOuvert, ETATS_RELANCES, objectifDe } from '../domaine/session.ts';
import type { Session } from '../domaine/session.ts';
import { CAPACITE_TAMPON, tamponCirculaire } from '../domaine/tampon.ts';
import { ecrireEpisodeMinimal, episodesDuProjet, texteDuBilan, trouverEpisode } from './episode.ts';
import { argumentsClaude, assemblerPlugin, environnementClaude, estInterdite, premierMessage } from './plugin.ts';
import { PAUSE_APRES_ECHAP_MS } from './ports.ts';
import type { Dependances, Pilotage, Terminal } from './ports.ts';
import { projetDeSession } from './portees.ts';
import { positionNotee } from './dossiers-non-rattaches.ts';
import type { PositionDuProjet } from './position.ts';
import { chargerProfil } from './profil.ts';
import { DOSSIER_MEMOIRE } from '../domaine/dossier-memoire.ts';

export type Pilote = {
	/**
	 * Lance une session. Profil `archiviste` : jamais deux ; les lancements passent l'un après l'autre, et s'il en existe un
	 * (non terminé), il est rendu tel quel (`existant`), sans rien lancer ni lui transmettre l'objectif.
	 */
	lancer(d: { profil: string; dossier: string; objectif?: string }): Promise<{ session: Session } | { session: Session; manuel: string } | { session: Session; existant: true } | { refus: string }>;
	pause(id: string): Promise<Session | null>;
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
	 * Termine une session. `bilan` : Claude rédige l'épisode (consigne tapée dans le terminal ; une session qui ne tourne pas
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
	/** Faux en mode dégradé (terminaux indisponibles, `claude` introuvable) : une session ne peut tourner qu'à la main. */
	lancePossible(): boolean;
	/** Réécrit le plugin de la session (skills de son projet) d'après son état actuel ; rien si elle est inconnue. */
	reecrirePlugin(id: string): Promise<void>;
	/**
	 * Ligne de commande qui reprend la session dans le terminal de l'utilisateur, `consigne` pour premier message (plugin
	 * écrit) ; null si elle est inconnue ou terminée.
	 */
	ligneDeReprise(id: string, consigne?: string): Promise<string | null>;
};

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
/** Intervalle de lecture de l'état pendant un bilan (les hooks l'écrivent, parfois sans passer par le service). */
const SONDAGE_BILAN_MS = 200;
/**
 * Après l'Échap qui ferme un dialogue de permission : attente du `Stop` qui suit, au plus. Claude Code ne lance pas `Stop`
 * quand l'utilisateur interrompt (doc des hooks) : passé ce délai, le dialogue est tenu pour fermé et la ligne est tapée.
 */
const ATTENTE_STOP_APRES_ECHAP_MS = 1000;

/**
 * Un terminal tenu par le pilote : sa sortie (tampon, abonnés) et la promesse de sa fin traitée. `ecritMajMs` : `majMs` de
 * l'état lu quand le pilote y a écrit pour la dernière fois (Échap ou ligne) ; tant qu'aucun hook ne l'a fait avancer, un
 * dialogue lu dans l'état est périmé (déjà fermé, ou la ligne n'a pas encore été vue) et ne vaut pas un nouvel Échap.
 * `arret` : son arrêt est demandé, plus rien n'y est tapé.
 */
type Vivant = {
	terminal: Terminal;
	tampon: ReturnType<typeof tamponCirculaire>;
	abonnes: Set<(d: string) => void>;
	fini: Promise<void>;
	ecritMajMs: number | null;
	arret: boolean;
};

const citerPosix = (texte: string): string => `'${texte.replaceAll("'", "'\\''")}'`;
const citerPowerShell = (texte: string): string => `'${texte.replaceAll("'", "''")}'`;
const NOM_DE_VARIABLE = /^[A-Za-z_][A-Za-z0-9_]*$/u;

/**
 * Ligne de commande à coller dans son propre terminal (mode dégradé) : se placer dans `dossier`, retirer les variables
 * interdites présentes, poser celles de la session, lancer `claude` (ou la commande trouvée) avec ses arguments. Chaque valeur
 * entre apostrophes (POSIX ou PowerShell, comme la déclaration MCP du jalon 3).
 */
export function ligneManuelle(
	claude: { commande: string; avant: string[] } | null,
	args: string[],
	dossier: string,
	ajouts: Record<string, string>,
	retirees: string[],
	plateforme: string,
): string {
	const variables = Object.entries(ajouts).filter(([cle]) => NOM_DE_VARIABLE.test(cle));
	const sans = retirees.filter((cle) => NOM_DE_VARIABLE.test(cle));
	if (plateforme === 'win32') {
		const commande = claude === null ? 'claude' : citerPowerShell(claude.commande);
		const morceaux = [`Set-Location -LiteralPath ${citerPowerShell(dossier)}`];
		for (const cle of sans) morceaux.push(`Remove-Item -ErrorAction SilentlyContinue Env:${cle}`);
		for (const [cle, valeur] of variables) morceaux.push(`$env:${cle} = ${citerPowerShell(valeur)}`);
		morceaux.push(`& ${commande} ${[...(claude?.avant ?? []), ...args].map(citerPowerShell).join(' ')}`);
		return morceaux.join('; ');
	}
	const commande = claude === null ? 'claude' : citerPosix(claude.commande);
	const env = sans.length > 0 ? `env ${sans.map((cle) => `-u ${cle}`).join(' ')} ` : '';
	const affectations = variables.map(([cle, valeur]) => `${cle}=${citerPosix(valeur)} `).join('');
	return `cd ${citerPosix(dossier)} && ${env}${affectations}${commande} ${[...(claude?.avant ?? []), ...args].map(citerPosix).join(' ')}`;
}

/** Champs modifiables d'une session. */
type Champs = Parameters<Pilotage['etat']['modifier']>[1];

/**
 * Le pilote tient les terminaux des sessions de ce service : lancement (plugin assemblé, `claude` dans un pseudo-terminal),
 * pause, reprise (`--resume`), relance au démarrage, arrêt de tout. Une session n'a jamais deux `claude` : un terminal tenu,
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
	 * depuis la dernière écriture du pilote (Échap ou ligne) : deux Échap de suite ouvrent le retour arrière de Claude Code.
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
	 * dont le `fin` n'a pas abouti (processus tué) → `terminee`. Bilan ou abandon d'une session lancée : son épisode minimal
	 * est assuré (s'il n'y en a aucun : le `fin` a pu manquer de temps) ; jamais pour un lancement raté (`lanceMs` absent).
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
		if (apres !== null && finale && (apres.lanceMs ?? null) !== null) await assurerEpisode(apres);
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
	 * Assemble et écrit le plugin, puis lance `claude` dans un terminal ; sans terminal possible (mode dégradé, `claude`
	 * introuvable, lancement en échec), rend la ligne de commande à coller. Lève si le plugin ou le dossier font défaut.
	 */
	const lancePossible = (): boolean => pil.plugin.claude !== null && pil.terminaux.disponibles().ok;

	/** Plugin écrit, arguments, environnement et dossier de `claude` pour cette session ; `manuel` : la même chose en une ligne à coller. */
	const preparer = async (session: Session, mode: 'nouvelle' | 'reprise', objectif?: string) => {
		const profil = await chargerProfil(dep, session.profil);
		const plugin = await pil.plugin.ecrire(session.id, await assemblerPlugin(dep, session, profil, pil.plugin.appel));
		const args = [...argumentsClaude(session, profil, { plugin, racine: pil.plugin.racine }, mode, objectif), ...(mode === 'reprise' ? premierMessage(objectif) : [])];
		const env = environnementClaude(pil.hote.env, session, pil.plugin.racine);
		const dossier = await dossierDe(session);
		const manuel = (): { manuel: string } => {
			const ajouts = environnementClaude({}, session, pil.plugin.racine);
			const retirees = Object.keys(pil.hote.env).filter((cle) => pil.hote.env[cle] !== undefined && estInterdite(cle.toUpperCase()));
			return { manuel: ligneManuelle(pil.plugin.claude, args, dossier, ajouts, retirees, pil.hote.plateforme) };
		};
		return { args, env, dossier, manuel };
	};

	const demarrer = async (session: Session, mode: 'nouvelle' | 'reprise', objectif?: string): Promise<{ manuel: string } | { terminal: Terminal }> => {
		const { args, env, dossier, manuel } = await preparer(session, mode, objectif);
		const claude = pil.plugin.claude;
		if (claude === null || !pil.terminaux.disponibles().ok) return manuel();
		let terminal: Terminal;
		const lanceMs = Date.now();
		try {
			terminal = pil.terminaux.lancer({ commande: claude.commande, args: [...claude.avant, ...args], dossier, env, colonnes: COLONNES, lignes: LIGNES });
		} catch {
			return manuel();
		}
		const vivant: Vivant = { terminal, tampon: tamponCirculaire(CAPACITE_TAMPON), abonnes: new Set(), fini: Promise.resolve(), ecritMajMs: null, arret: false };
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
	 * Arrête le terminal tenu, à son tour dans la file de la session ; un dialogue de permission peut être ouvert (dernier arrêt
	 * `Notification`, pas encore traité par une écriture du pilote) : Échap avant `/exit`.
	 */
	const arreterSession = async (id: string): Promise<void> => {
		const v = vivants.get(id);
		if (v === undefined) return;
		await enFile(id, async () => {
			v.arret = true;
			const s = await pil.etat.lire(id).catch(() => null);
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
		const etat = await pil.hote.processus(s.pid, s.id);
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
		const claude = pil.plugin.claude;
		if (claude === null || !pil.terminaux.disponibles().ok) return s;
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
	 * (épisode minimal si Claude n'a rien écrit). Si elle cesse de tourner, la surveillance s'arrête.
	 */
	const surveillerBilan = (id: string, depuisMs: number): void => {
		bilans.get(id)?.();
		let actif = true;
		const arreter = () => {
			actif = false;
		};
		bilans.set(id, arreter);
		void (async () => {
			// un `Stop` (tour fini) : une `Notification` (Claude demande une permission) ne termine pas le bilan
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
			if (echapNecessaire(v, s)) {
				v.ecritMajMs = s.majMs;
				v.terminal.ecrire('\x1b');
				await new Promise((r) => setTimeout(r, PAUSE_APRES_ECHAP_MS));
				await attendreEtat(id, (apres) => !dialogueOuvert(apres), ATTENTE_STOP_APRES_ECHAP_MS - PAUSE_APRES_ECHAP_MS);
				if (!toujours(id, v)) return;
				s = (await pil.etat.lire(id).catch(() => null)) ?? s;
			}
			// la ligne n'est vue par l'état qu'à son hook `message` : d'ici là, le dialogue qu'il montre encore est périmé
			if (s !== null) v.ecritMajMs = s.majMs;
			v.terminal.ecrire(`${ligne}\r`);
		});
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

	/** Claude rédige le bilan dans son terminal : une session qu'on ne peut pas faire tourner est rendue sans bilan demandé. */
	const bilan = async (id: string): Promise<Session | null> => {
		await enLancement.get(id);
		const s = await pil.etat.lire(id);
		if (s === null || s.etat === 'terminee') return s;
		if (!(await assurerVivante(id))) return pil.etat.lire(id);
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
		if (await assurerVivante(id)) await taper(id, ligne);
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
		if (s.pid !== null && (await pil.hote.processus(s.pid, s.id)) === 'session') return s;
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
			if (!vivants.has(id)) {
				// rien à arrêter ici (mode dégradé, processus fini) : la session n'est plus relancée au démarrage
				if (s.etat === 'en_pause') return s;
				if (s.pid !== null && (await pil.hote.processus(s.pid, s.id)) === 'session') return s;
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
				const apres = await reprendre(s.id);
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
			if (session === null) return;
			await pil.plugin.ecrire(id, await assemblerPlugin(dep, session, await chargerProfil(dep, session.profil), pil.plugin.appel));
		},

		async ligneDeReprise(id, consigne) {
			const s = await pil.etat.lire(id);
			if (s === null || s.etat === 'terminee') return null;
			return (await preparer(s, 'reprise', consigne)).manuel().manuel;
		},

		terminer(id, options) {
			if (arrete) return pil.etat.lire(id);
			return suivi(options.bilan ? bilan(id) : abandonnerSession(id));
		},
	};
}
