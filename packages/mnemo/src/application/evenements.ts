import type { CauseArret, EvenementHook, Session, SourceDeDebut } from '../domaine/session.ts';
import { objectifDe } from '../domaine/session.ts';
import { ecrireEpisodeMinimal } from './episode.ts';
import type { Classe, Dependances, Pilotage } from './ports.ts';
import type { NoteDuGeste } from '../domaine/gestes.ts';
import { positionDeSession, positionNotee } from './dossiers-non-rattaches.ts';
import type { Position } from './position.ts';
import { raisonDeMutisme } from '../domaine/message-muet.ts';
import { ficheTouchee } from '../domaine/outil-de-session.ts';
import { BUDGET_HOOK_MS } from './chercher.ts';
import type { FichesDemandees } from './fiches-demandees.ts';
import { cartesDuJournal, dejaLuesDe } from './cartes.ts';
import { classementDuJournal } from './classement-du-message.ts';
import { servir } from './servir.ts';
import type { DemandeServir, Servi } from './servir.ts';
import { verifierAction } from './verifier-action.ts';
import { noterGeste } from './gestes.ts';
import { noteDuPorteur, notesDuClassement, vecteurDuPorteur } from './porteurs-recents.ts';
import type { PorteursRecents } from './porteurs-recents.ts';
import { refusDelai, refusSurErreur, reponseDe, selonIndicateur } from '../domaine/refus-outil.ts';
import type { AccordNonVerifie } from '../domaine/refus-outil.ts';
import type { ActionNonLue, ActionOutil, Verdict } from '../domaine/regles-verifiees.ts';

/**
 * Un événement de hook Claude Code, traduit : `session` (uuid de la session, « » si inconnue), `horodatageMs` (instant de
 * l'événement : un plus ancien que le dernier appliqué ne change pas l'état), `cwd` (dossier courant de Claude Code, absolu),
 * `prompt` (`message`), `outil` (`outil` : nom et entrée de l'outil), `arret` (`arret` : `Stop` ou `Notification` ; `stop`
 * par défaut), `sansContexte` (`debut`, `message` d'un profil qui ne les demande pas : l'état seulement, rien de servi).
 */
export type EntreeHook = {
	evenement: EvenementHook;
	session: string;
	horodatageMs: number;
	cwd: string | null;
	prompt?: string;
	outil?: ActionOutil | ActionNonLue;
	arret?: CauseArret;
	sansContexte?: boolean;
	/** `SessionStart` : `clear` et `compact` vident le contexte de Claude, les fiches injectées redeviennent à servir. */
	source?: SourceDeDebut;
};

/**
 * Ce que Claude Code reçoit : un contexte à ajouter (`debut`, `message`), ou le refus d'un outil (`outil`, motif pour Claude) ;
 * `avis` : action permise sans avoir pu être vérifiée, pour le journal du hook.
 */
export type ReponseHook = { contexte?: string; refus?: string; avis?: string };

/**
 * Réglages du traitement : `froid` (voir `servir`) ; `racine` : dossier Mnemo absolu, pour tirer la position du `cwd` ;
 * `echeance` (`Date.now()`) : celle du processus du hook, ou pour le service l'instant où le hook cesse de l'attendre — `servir`
 * finit au plus tard `MARGE_SORTIE_MS` avant ; au-delà, rien n'est rendu, ni noté servi, ni journalisé ; `debutMs` : début du hook (le journal mesure depuis lui ; sinon depuis l'appel) ; `sansCasse` :
 * le disque ne distingue pas la casse (macOS, Windows), pour les chemins des consignes vérifiées.
 */
export type ReglagesEvenement = {
	froid: 'permis' | 'si-budget';
	racine?: string;
	echeance?: number;
	debutMs?: number;
	sansCasse?: boolean;
	/**
	 * Le service : ce qui n'a pas à retarder la réponse au hook (épisode de `fin`, branche et commit de `debut`) lui est
	 * confié, en arrière-plan. Sans lui (`mnemo hook` sans service), c'est fait ici, avant l'échéance.
	 */
	enFond?: (tache: Promise<unknown>) => void;
	/** Délai de git pour l'épisode minimal (défaut : 2 s ; le hook sans service : 600 ms). */
	delaiGitMs?: number;
	/**
	 * Le service : une session vient d'être rattachée par ce hook (lien posé en cours de route) ; son plugin est réécrit (skills du
	 * projet), ce qui sert à une reprise faite hors du service. Un rattachement déjà noté par `mnemo hook` sans service ne l'appelle pas.
	 */
	rattachee?: (session: string) => Promise<void>;
	/** Le service : fiches que l'utilisateur a demandé d'injecter, injectées entières au prochain message de la session (jamais après un outil). */
	demandees?: FichesDemandees;
	/**
	 * Le service : dernier message porteur de chaque session (rang, position, vecteur), noté à chaque message porteur ; les gestes
	 * en reprennent le vecteur. Sans lui (`mnemo hook` sans service), seule l'injection à la main garde le vecteur de son message.
	 */
	porteurs?: PorteursRecents;
};

/** Extrait de la demande gardé avec une entrée servie (et la trace d'un écarté) : large, la demande est journalisée presque entière. */
export const DEMANDE_MAX = 20_000;

/** Branche et commit de départ notés au `debut` : git au-delà de ce délai est abandonné. */
export const DELAI_GIT_DEBUT_MS = 1000;

/** Temps laissé, après `servir`, pour le journal et la sortie avant l'échéance du processus. */
export const MARGE_SORTIE_MS = 100;

/**
 * Temps qu'il doit rester avant l'échéance pour noter ce qui part (fiches servies, cartes, journal) : sinon rien n'est noté ni
 * rendu, et le hook (en repli local) sert ce qui n'a pas été noté.
 */
export const MARGE_ECRITURE_MS = 30;

/** « C:\a\b\ » → « C:/a/b » : séparateurs en « / », sans « / » final (sauf la racine du système). */
function net(chemin: string): string {
	const avant = chemin.replace(/\\/gu, '/');
	const sans = avant.replace(/\/+$/u, '');
	return sans === '' ? '/' : sans;
}

/** Chemin de `cwd` relatif à `racine`, séparé par « / » (« » : la racine elle-même) ; null s'il est hors de la racine. Calcul pur. */
export function relatifALaRacine(racine: string, cwd: string): string | null {
	const r = net(racine);
	const c = net(cwd);
	// lettre de lecteur et casse : un disque Windows ne les distingue pas
	const windows = /^[A-Za-z]:/u.test(r);
	const [rc, cc] = windows ? [r.toLowerCase(), c.toLowerCase()] : [r, c];
	if (cc === rc) return '';
	const prefixe = rc.endsWith('/') ? rc : `${rc}/`;
	return cc.startsWith(prefixe) ? c.slice(prefixe.length) : null;
}

/**
 * Position servie : celle de la session (`positionDeSession`) ; sans session, celle du dossier courant de Claude Code, notée
 * dans l'état s'il n'est pas rattaché ; la racine à défaut.
 */
async function positionDe(
	dep: Dependances,
	pil: Pick<Pilotage, 'etat'>,
	session: Session | null,
	entree: EntreeHook,
	reglages: ReglagesEvenement,
	sansSynchroniser = false,
): Promise<Position> {
	if (session !== null) {
		// l'index tel qu'il est : `proposer` l'a déjà mis à jour, et `servir` le synchronise juste après (un lien écrit à la main compte au hook suivant)
		const chemin = await positionDeSession(dep, pil.etat, session, { sansSynchroniser: true });
		if (chemin !== session.position && reglages.rattachee !== undefined) {
			const tache = reglages.rattachee(session.id).catch(() => {});
			if (reglages.enFond !== undefined) reglages.enFond(tache);
			else await tache;
		}
		return { chemin };
	}
	if (entree.cwd === null || reglages.racine === undefined) return { chemin: '' };
	const relatif = relatifALaRacine(reglages.racine, entree.cwd);
	if (relatif === null) return { chemin: '' };
	return { chemin: (await positionNotee(dep, pil.etat, relatif, { sansSynchroniser })).chemin };
}

/** Valeur de `promesse`, ou `repli` si elle n'est pas là avant `echeance` (`Date.now()`) ; une erreur donne aussi `repli`. */
async function avantEcheance<T>(promesse: Promise<T>, echeance: number | undefined, repli: T): Promise<T> {
	const garde = promesse.catch(() => repli);
	if (echeance === undefined) return garde;
	let minuteur: ReturnType<typeof setTimeout> | undefined;
	const delai = new Promise<T>((resoudre) => {
		minuteur = setTimeout(() => resoudre(repli), Math.max(0, echeance - Date.now()));
	});
	try {
		return await Promise.race([garde, delai]);
	} finally {
		clearTimeout(minuteur);
	}
}

/**
 * `outil` : l'action enfreint-elle une consigne vérifiée de la position ? Rapide : ni synchronisation, ni sens, ni modèle.
 * Ce qui empêche de vérifier (erreur, échéance passée moins la marge de sortie) suit l'indicateur ; sans racine connue : permis.
 */
async function verifierOutil(dep: Dependances, pil: Pick<Pilotage, 'etat'>, session: Session | null, entree: EntreeHook, reglages: ReglagesEvenement): Promise<ReponseHook> {
	const racine = reglages.racine;
	if (racine === undefined) return {};
	const fin = reglages.echeance === undefined ? undefined : reglages.echeance - MARGE_SORTIE_MS;
	const action = entree.outil ?? { nonLue: 'entree_illisible' };
	// lu d'abord, sans l'index : il décide si une vérification impossible refuse
	const indicateur = await dep.indicateur.lire();
	const verdict = await avantEcheance<Verdict | AccordNonVerifie>(
		(async () => {
			try {
				const position = await positionDe(dep, pil, session, entree, reglages, true);
				return await verifierAction(dep, position, action, { racine, cwd: entree.cwd ?? racine, sansCasse: reglages.sansCasse ?? false });
			} catch (erreur) {
				return selonIndicateur(refusSurErreur(erreur), indicateur);
			}
		})(),
		fin,
		selonIndicateur(refusDelai(), indicateur),
	);
	return reponseDe(verdict);
}

/**
 * Applique l'événement à l'état de la session (objectif posé au premier `message`). L'état est secondaire : une panne
 * (base occupée au-delà de l'attente permise) le laisse tel quel, la session est alors relue si possible, sinon inconnue.
 */
async function appliquer(pil: Pick<Pilotage, 'etat'>, entree: EntreeHook): Promise<Session | null> {
	if (entree.session === '') return null;
	const objectif = entree.evenement === 'message' && entree.prompt !== undefined ? objectifDe(entree.prompt) : null;
	const complement = {
		...(objectif === null ? {} : { objectif }),
		...(entree.evenement === 'arret' && entree.arret !== undefined ? { arret: entree.arret } : {}),
	};
	try {
		return await pil.etat.appliquer(entree.session, entree.evenement, entree.horodatageMs, Object.keys(complement).length === 0 ? undefined : complement);
	} catch {
		try {
			return await pil.etat.lire(entree.session);
		} catch {
			return null;
		}
	}
}

/**
 * `debut` d'une session qui n'a pas encore de commit de départ : branche et commit de son dossier (git borné à 1 s et à
 * l'échéance), notés s'ils arrivent à temps. Rend la tâche, ou null s'il n'y a rien à noter.
 */
function noterDepart(pil: Pick<Pilotage, 'etat' | 'depot'>, session: Session | null, reglages: ReglagesEvenement): Promise<void> | null {
	if (session === null || session.commitDebut !== null || session.etat === 'terminee') return null;
	const fin = reglages.echeance === undefined ? Date.now() + DELAI_GIT_DEBUT_MS : Math.min(Date.now() + DELAI_GIT_DEBUT_MS, reglages.echeance - MARGE_SORTIE_MS);
	return (async () => {
		const etat = await avantEcheance(pil.depot.etat(session.dossier), fin, null);
		if (etat === null || (reglages.echeance !== undefined && Date.now() >= reglages.echeance - MARGE_SORTIE_MS)) return;
		await pil.etat.modifier(session.id, { commitDebut: etat.commit, branche: etat.branche });
	})().catch(() => {});
}

/**
 * `fin` : épisode minimal si l'arrêt n'était pas attendu (`null`), s'il est abandonné, ou si le bilan n'a pas laissé
 * d'épisode ; rien pour une pause ou l'arrêt du service. Sans service, borné par l'échéance du hook (ce qui n'a pas pu s'écrire
 * à temps le sera au prochain démarrage du service : la session reste `a_relire`).
 */
async function finDeSession(dep: Dependances, pil: Pick<Pilotage, 'etat' | 'depot'>, session: Session | null, entree: EntreeHook, reglages: ReglagesEvenement): Promise<void> {
	if (session === null) return;
	const arret = session.arretAttendu;
	if (arret === 'pause' || arret === 'service') return;
	const chemin = await ecrireEpisodeMinimal(dep, pil, session, entree.horodatageMs, {
		...(reglages.echeance === undefined ? {} : { echeance: reglages.echeance - MARGE_SORTIE_MS }),
		...(reglages.delaiGitMs === undefined ? {} : { delaiGitMs: reglages.delaiGitMs }),
	});
	// écrit : le rattrapage du démarrage n'a plus à le vérifier (hors délai du hook : il le constatera)
	if (chemin !== null && (reglages.echeance === undefined || Date.now() < reglages.echeance - MARGE_SORTIE_MS)) {
		await pil.etat.modifier(session.id, { episodeMs: Date.now() }).catch(() => null);
	}
}

/**
 * Un événement de hook, par le service (`froid: 'permis'`) ou par `mnemo hook` sans service (`si-budget`) : l'état de la
 * session est mis à jour ; `debut` sert le contexte de début (question : l'objectif) et note branche et commit de départ,
 * `message` sert celui du prompt. Chaque contexte servi à une session connue est journalisé (durée, usage du sens). Session
 * inconnue de l'état : servie quand même, sans état ni journal. `outil` vérifie l'action contre les consignes vérifiées
 * (refus éventuel) ; `fin` écrit l'épisode minimal s'il le faut (`finDeSession`). Avec `enFond` (le service), git et
 * l'épisode ne retardent jamais la réponse.
 */
export async function traiterEvenement(dep: Dependances, pil: Pick<Pilotage, 'etat' | 'depot'>, entree: EntreeHook, reglages: ReglagesEvenement): Promise<ReponseHook> {
	const session = await appliquer(pil, entree);
	if (entree.evenement === 'fin') {
		const tache = finDeSession(dep, pil, session, entree, reglages).catch(() => {});
		if (reglages.enFond !== undefined) reglages.enFond(tache);
		else await tache;
		return {};
	}
	const depart = entree.evenement === 'debut' ? noterDepart(pil, session, reglages) : null;
	if (depart !== null && reglages.enFond !== undefined) reglages.enFond(depart);
	try {
		return await servirEvenement(dep, pil, session, entree, reglages);
	} finally {
		if (depart !== null && reglages.enFond === undefined) await depart;
	}
}

async function servirEvenement(dep: Dependances, pil: Pick<Pilotage, 'etat'>, session: Session | null, entree: EntreeHook, reglages: ReglagesEvenement): Promise<ReponseHook> {
	switch (entree.evenement) {
		case 'outil':
			return verifierOutil(dep, pil, session, entree, reglages);
		case 'debut':
			// rien n'est servi à l'ouverture ; la position est tenue (rattachement du dossier, plugin réécrit)
			await positionDe(dep, pil, session, entree, reglages);
			// /clear, /compact : Claude n'a plus les fiches injectées, elles redeviennent à servir
			if (session !== null && (entree.source === 'clear' || entree.source === 'compact')) await pil.etat.oublierInjections(session.id).catch(() => {});
			return {};
		case 'apres_outil':
			// rien n'est calculé ni servi après un outil : seule la fiche lue ou écrite est notée
			if (session !== null) await noterFicheTouchee(dep, pil, session, entree, reglages);
			return {};
		case 'message':
			return entree.sansContexte === true ? {} : servirAuMessage(dep, pil, session, entree, reglages);
		default:
			return {};
	}
}

/**
 * La fiche lue est notée avec son empreinte du moment (elle ne sera plus tenue pour vue si elle change) ; une écriture n'en note pas.
 * Lue ensuite par l'outil `lire` après une carte qui la proposait : geste `lue_apres_carte` (l'état n'en compte qu'un par proposition).
 */
async function noterFicheTouchee(dep: Dependances, pil: Pick<Pilotage, 'etat'>, session: Session, entree: EntreeHook, reglages: ReglagesEvenement): Promise<void> {
	const appel = entree.outil !== undefined && 'nom' in entree.outil ? entree.outil : null;
	const touchee = appel === null ? null : ficheTouchee(appel);
	if (touchee === null) return;
	const empreinte = touchee.action === 'lue' ? ((await dep.index.fiches().catch(() => [])).find((f) => f.chemin === touchee.chemin)?.empreinte ?? null) : null;
	await pil.etat.noterFicheServieLueOuEcrite(session.id, { chemin: touchee.chemin, action: touchee.action, horodatageMs: entree.horodatageMs, empreinte }).catch(() => {});
	// la lecture d'abord, le geste ensuite ; seul `lire` compte : `voisins` ne lit pas la fiche pour elle-même
	if (touchee.outil === 'lire') {
		const recent = reglages.porteurs?.lire(session.id) ?? null;
		const note = noteDuPorteur(recent, touchee.chemin);
		await noterGeste(dep, pil.etat, {
			geste: 'lue_apres_carte',
			session: session.id,
			fiche: touchee.chemin,
			empreinte,
			horodatageMs: entree.horodatageMs,
			vecteur: vecteurDuPorteur(recent),
			...(note === undefined ? {} : { note }),
		});
	}
}

/**
 * Le message, la position et ce que la session a déjà reçu (fiches servies, lues, écrites, cartes proposées, écartés, fiches
 * injectées à la main et leur âge) : ce que `servir` reçoit. Le message porteur est déjà compté (`servirAuMessage`) : l'âge lu
 * l'inclut. `premier` : premier message non muet de la session (le périmètre n'a pas encore été proposé) ; `rappels` :
 * rien n'a encore été servi à un message de la session.
 */
async function demandeDe(dep: Dependances, pil: Pick<Pilotage, 'etat'>, session: Session | null, entree: EntreeHook, reglages: ReglagesEvenement, fin: number): Promise<DemandeServir> {
	const position = await positionDe(dep, pil, session, entree, reglages);
	const ecartes = session === null ? [] : (await pil.etat.ecartes(session.id).catch(() => [])).map((e) => e.id);
	const serviesLuesEcrites = session === null ? [] : await pil.etat.fichesServiesLuesOuEcrites(session.id).catch(() => []);
	const proposees = session === null ? new Map<string, string>() : await pil.etat.cartesProposees(session.id).catch(() => new Map<string, string>());
	const message = entree.prompt ?? '';
	const muet = raisonDeMutisme(message);
	const injectees = session === null ? [] : await pil.etat.injectionsManuelles(session.id).catch(() => []);
	// seuls les messages comptent : un appel de l'outil `contexte` journalisé avant le premier message n'injecte aucun rappel
	const rappels = session !== null && (await pil.etat.servis(session.id, 1, 'message').catch(() => [])).length === 0;
	const premier = session !== null && muet === null && (await pil.etat.perimetrePropose(session.id).catch(() => 0)) === null;
	return {
		position: position.chemin,
		message,
		dejaServies: new Map(serviesLuesEcrites.map((f) => [f.chemin, f.empreinteInjectee])),
		dejaLues: dejaLuesDe(serviesLuesEcrites),
		proposees,
		ecartes,
		injectees,
		moment: 'message',
		muet,
		premier,
		fin,
		rappels,
	};
}

/**
 * Note la fiche de position et les fiches demandées injectées (et, pour ces dernières, l'injection à la main, qui pèse sur leurs
 * voisines), les cartes proposées (avec leur empreinte), et journalise le calcul pour le panneau Contexte, classement entier compris
 * (une entrée à chaque message porteur, même sans texte injecté).
 */
async function noterInjection(
	dep: Dependances,
	pil: Pick<Pilotage, 'etat'>,
	session: Session,
	entree: EntreeHook,
	demande: DemandeServir,
	servi: Servi,
	debutMs: number,
	rang: number | null,
	classement: Classe[],
	/** La note d'une fiche demandée : sa ligne au classement que l'utilisateur voyait (celui du message porteur précédent). */
	noteDemandee: (chemin: string) => NoteDuGeste | undefined,
): Promise<void> {
	const { position, cartes } = servi.calcul;
	const injectees = [...(position === null ? [] : [position]), ...servi.demandees];
	for (const f of injectees) {
		await pil.etat.noterFicheServieLueOuEcrite(session.id, { chemin: f.chemin, action: 'servie', horodatageMs: entree.horodatageMs, empreinte: f.empreinte }).catch(() => {});
	}
	// une fiche demandée qui est aussi la fiche de position, injectée comme telle, compte pour un geste
	const demandees = new Set(demande.demandees ?? []);
	for (const f of injectees.filter((f) => demandees.has(f.chemin))) await pil.etat.noterInjectionManuelle(session.id, f.chemin).catch(() => {});
	for (const c of cartes) {
		await pil.etat.noterCarteProposee(session.id, { chemin: c.chemin, empreinte: c.empreinte, horodatageMs: entree.horodatageMs }).catch(() => {});
	}
	// le périmètre est proposé une fois par session (et de nouveau après /clear ou /compact) ; sans fiche de position, il n'y avait rien à proposer :
	// une session rattachée ensuite à un dossier recevra son périmètre
	if (demande.premier && servi.calcul.positionFiche !== null) await pil.etat.noterPerimetrePropose(session.id, entree.horodatageMs).catch(() => {});
	try {
		await pil.etat.journaliser({
			session: session.id,
			moment: 'message',
			horodatageMs: entree.horodatageMs,
			ids: injectees.map((f) => f.chemin),
			texte: servi.texte,
			ms: Date.now() - debutMs,
			sens: servi.calcul.mesure !== 'aucune',
			demande: entree.prompt === undefined ? null : entree.prompt.slice(0, DEMANDE_MAX),
			classement,
			muet: demande.muet,
			cartes: cartesDuJournal(cartes),
			position: session.position,
		});
	} catch {
		// Journal perdu (base occupée) : le contexte est servi quand même.
	}
	// geste ➤ : le dernier message porteur de la session (celui qui porte la fiche s'il est porteur), avec son vecteur s'il a été calculé
	const vecteur = rang === null || servi.calcul.vecteur === undefined ? null : { rang, vecteur: servi.calcul.vecteur };
	for (const f of injectees.filter((f) => demandees.has(f.chemin))) {
		const note = noteDemandee(f.chemin);
		await noterGeste(dep, pil.etat, { geste: 'injectee_main', session: session.id, fiche: f.chemin, empreinte: f.empreinte, horodatageMs: entree.horodatageMs, vecteur, ...(note === undefined ? {} : { note }) });
	}
}

async function servirAuMessage(dep: Dependances, pil: Pick<Pilotage, 'etat'>, session: Session | null, entree: EntreeHook, reglages: ReglagesEvenement): Promise<ReponseHook> {
	const debut = reglages.debutMs ?? Date.now();
	const fin = reglages.echeance === undefined ? Date.now() + BUDGET_HOOK_MS : Math.min(Date.now() + BUDGET_HOOK_MS, reglages.echeance - MARGE_SORTIE_MS);
	const demandees = session === null ? [] : (reglages.demandees?.prendre(session.id) ?? []);
	// un message porteur est compté d'abord (les injections à la main vieillissent d'un message avant d'être lues) et gardé comme
	// dernier message porteur, même si rien n'est injecté ensuite ; rang null : message muet ou état en panne
	const rang =
		session !== null && raisonDeMutisme(entree.prompt ?? '') === null
			? await pil.etat.noterMessagePorteur(session.id, (entree.prompt ?? '').slice(0, DEMANDE_MAX)).catch(() => null)
			: null;
	const lue = await demandeDe(dep, pil, session, entree, reglages, fin);
	const demande = demandees.length === 0 ? lue : { ...lue, demandees };
	const servi = await servir(dep, demande);
	const classement = classementDuJournal(servi.calcul.classement);
	// le classement que voyait l'utilisateur quand il a demandé une fiche : lu avant d'être remplacé par celui de ce message
	const precedent = session === null ? null : (reglages.porteurs?.lire(session.id) ?? null);
	if (session !== null && rang !== null) {
		reglages.porteurs?.noter(session.id, { rang, position: demande.position, vecteur: servi.calcul.vecteur ?? null, classement: notesDuClassement(classement) });
	}
	// noter prend du temps : il faut qu'il en reste assez pour noter puis répondre avant que le hook cesse d'attendre
	const aTempsPourNoter = aTemps(reglages, MARGE_ECRITURE_MS);
	let injecte = servi.texte !== '' && aTempsPourNoter;
	// un message porteur est journalisé même sans texte injecté : son classement en est la trace (panneau, apprentissage)
	if (session !== null && (injecte || (rang !== null && aTempsPourNoter))) {
		await noterInjection(dep, pil, session, entree, demande, servi, debut, rang, classement, (chemin) => noteDuPorteur(precedent, chemin));
		// après les écritures : le hook attend-il encore ? Sinon, la réponse ne lui parviendrait pas
		if (!aTemps(reglages)) injecte = false;
	}
	// le hook n'attend plus : les fiches demandées partiront au message suivant
	if (session !== null && !injecte && demandees.length > 0) reglages.demandees?.remettre(session.id, demandees);
	return injecte ? { contexte: servi.texte } : {};
}

/**
 * Reste-t-il au moins `margeMs` avant l'échéance (sans échéance : oui) ? Une fiche n'est notée servie que si le hook reçoit la
 * réponse.
 */
function aTemps(reglages: ReglagesEvenement, margeMs = 0): boolean {
	return reglages.echeance === undefined || Date.now() + margeMs < reglages.echeance;
}
