import type { NiveauModeles } from '@mnemo/commun';
import { MOTEUR_PAR_DEFAUT } from '@mnemo/commun';

export type EtatSession = 'travaille' | 'attend' | 'a_relire' | 'en_pause' | 'terminee';
export type EvenementHook = 'debut' | 'message' | 'outil' | 'apres_outil' | 'arret' | 'fin';
/** Origine d'un `SessionStart` (champ `source` de Claude Code). */
export const SOURCES_DE_DEBUT = ['startup', 'resume', 'clear', 'compact'] as const;
export type SourceDeDebut = (typeof SOURCES_DE_DEBUT)[number];
export const estSourceDeDebut = (v: unknown): v is SourceDeDebut => typeof v === 'string' && (SOURCES_DE_DEBUT as readonly string[]).includes(v);

/** Pourquoi le service arrête le processus : décide ce que `fin` veut dire. */
export type ArretAttendu = 'pause' | 'bilan' | 'abandon' | 'service' | null;
/**
 * Cause du dernier `arret` : `stop` (Claude a fini son tour : prompt libre) ou `notification` (Claude Code attend l'utilisateur,
 * le plus souvent une demande de permission : un dialogue est ouvert).
 */
export type CauseArret = 'stop' | 'notification';

export type Session = {
	id: string;
	profil: string;
	/** Relatif à la racine, '' = racine. */
	dossier: string;
	position: string;
	/** Dossier d'épisodes. */
	projet: string;
	objectif: string | null;
	etat: EtatSession;
	creeeMs: number;
	majMs: number;
	arretAttendu: ArretAttendu;
	bilanDemandeMs: number | null;
	commitDebut: string | null;
	branche: string | null;
	pid: number | null;
	/**
	 * Trace du processus lancé, pour reconnaître ses restes après un plantage du service : démarrage de la machine (ms, à la
	 * seconde), instant du lancement, dernier instant où le service l'a vu vivant (battement). Absents : rien n'est prouvé.
	 */
	demarrageMachineMs?: number | null;
	lanceMs?: number | null;
	vuVivantMs?: number | null;
	/** Bilan : instant du premier `message` reçu après `bilanDemandeMs` (la consigne du bilan soumise) ; null sinon. */
	bilanLuMs?: number | null;
	/** Cause du dernier `arret`, effacée par `debut`, `message` et `outil` (null : aucun arrêt depuis). */
	dernierArret?: CauseArret | null;
	/**
	 * Outil dont le dialogue est ouvert (`arret` `notification` qui le nomme : Codex, Mistral Vibe) : seul un `apres_outil` de
	 * ce même outil le ferme ; null : inconnu (GitHub Copilot CLI, Claude Code), n'importe quel `apres_outil` le ferme.
	 */
	dialogueOutil?: string | null;
	/** Instant où l'épisode de la session a été écrit ou constaté (rattrapage au démarrage : déjà fait au-delà). */
	episodeMs?: number | null;
	/** Vrai si aucune fiche ne couvre le dossier de la session (`dossier_projet`) : sa position est alors la racine. */
	dossierNonRattache?: boolean;
	/**
	 * Niveau des modèles propre à la session ; absent, elle suit celui de la machine. Elle a le plus restrictif des deux
	 * (`niveauEffectif`). Gardé à la reprise.
	 */
	niveauModeles?: NiveauModeles;
	/**
	 * Moteur et modèle enregistrés au lancement : une reprise garde les siens. Absents (session d'avant les moteurs) : Claude
	 * Code et son modèle par défaut ; `modele` « » : le modèle par défaut du moteur. `moteur` est gardé tel qu'enregistré,
	 * même inconnu de ce Mnemo (`IdMoteur` quand il est connu) : une telle session ne se relance pas.
	 */
	moteur?: string;
	modele?: string;
	/** Identifiant de la session chez son moteur, appris par un hook (absent : inconnu, ou le moteur reçoit déjà l'uuid). */
	fil?: string;
};

/** Ce qu'un événement de hook dit de sa session chez son moteur. */
type EvenementDeFil = { moteur?: string; fil?: string; evenement?: string; source?: string };

const memeMoteur = (session: Pick<Session, 'moteur'>, evenement: EvenementDeFil): boolean => (session.moteur ?? MOTEUR_PAR_DEFAUT) === (evenement.moteur ?? MOTEUR_PAR_DEFAUT);

/**
 * `/clear` dans la session, chez un moteur qui en change l'identifiant (Mistral Vibe : non mesuré) : un `debut` de source
 * `clear`, du même moteur, portant un autre `fil` que celui appris ; rend ce nouveau `fil`, à noter ; null sinon.
 */
export function filApresClear(session: Pick<Session, 'moteur' | 'fil'>, evenement: EvenementDeFil): string | null {
	if (evenement.evenement !== 'debut' || evenement.source !== 'clear' || !memeMoteur(session, evenement)) return null;
	return session.fil !== undefined && evenement.fil !== undefined && evenement.fil !== '' && evenement.fil !== session.fil ? evenement.fil : null;
}

/**
 * Un événement de hook qui n'est pas de cette session : envoyé par un autre moteur que le sien (un `codex` lancé depuis une
 * session Claude Code hérite de `MNEMO_SESSION`), ou portant un autre `fil` que celui déjà appris, sauf après `/clear`
 * (`filApresClear`). Sans effet.
 */
export function evenementEtranger(session: Pick<Session, 'moteur' | 'fil'>, evenement: EvenementDeFil): boolean {
	if (!memeMoteur(session, evenement)) return true;
	if (filApresClear(session, evenement) !== null) return false;
	return session.fil !== undefined && evenement.fil !== undefined && evenement.fil !== session.fil;
}

/**
 * Un dialogue du moteur (permission) attend peut-être l'utilisateur : la dernière chose vue est une `Notification`, reçue
 * depuis le dernier lancement du processus (`lanceMs` : un dialogue d'avant une reprise est fermé avec son processus). Seule
 * règle, pour l'interface comme pour le pilote.
 */
export const dialogueOuvert = (s: Pick<Session, 'etat' | 'dernierArret' | 'majMs' | 'lanceMs'>): boolean =>
	s.etat === 'attend' && s.dernierArret === 'notification' && ((s.lanceMs ?? null) === null || s.majMs > s.lanceMs!);

/**
 * Un `message` horodaté avant le dernier événement appliqué, mais après le lancement du processus, quand ce dernier événement
 * est le `debut` de ce lancement (`attend`, aucun arrêt depuis, `majMs` après `lanceMs`) : appliqué quand même. GitHub Copilot
 * CLI lance `sessionStart` et `userPromptSubmitted` ensemble (mesuré) : le `debut` peut être horodaté après le message qu'il
 * précède, et le message, ignoré, ne serait jamais vu (objectif, bilan lu, session au travail).
 */
export const messageApresSonDebut = (s: Pick<Session, 'etat' | 'dernierArret' | 'majMs' | 'lanceMs'>, horodatageMs: number): boolean =>
	s.etat === 'attend' && (s.dernierArret ?? null) === null && (s.lanceMs ?? null) !== null && s.majMs > s.lanceMs! && horodatageMs > s.lanceMs!;

/**
 * Un `apres_outil` de l'outil `outil` pendant un dialogue ouvert pour un autre outil nommé : il ne le ferme pas (outils lancés
 * en parallèle). Faux si l'un des deux noms est inconnu : l'après-outil ferme alors le dialogue, comme avant.
 */
export const autreOutilQueLeDialogue = (s: Pick<Session, 'dernierArret' | 'dialogueOutil'>, outil: string | undefined): boolean =>
	s.dernierArret === 'notification' && (s.dialogueOutil ?? null) !== null && outil !== undefined && outil !== s.dialogueOutil;

/** États dans lesquels une session est relancée (`claude --resume`) au redémarrage du service. */
export const ETATS_RELANCES: readonly EtatSession[] = ['travaille', 'attend', 'a_relire'];

const LONGUEUR_MAX_OBJECTIF = 200;

/** État d'une session après un événement de hook. `terminee` ne bouge plus. */
export function etatApres(s: Pick<Session, 'etat' | 'arretAttendu'>, e: EvenementHook): EtatSession {
	if (s.etat === 'terminee') return 'terminee';
	switch (e) {
		case 'debut':
		case 'arret':
			return 'attend';
		case 'message':
		case 'outil':
		case 'apres_outil':
			return 'travaille';
		case 'fin':
			switch (s.arretAttendu) {
				case 'pause':
					return 'en_pause';
				case 'service':
					return s.etat;
				case 'bilan':
				case 'abandon':
					return 'terminee';
				case null:
					return 'a_relire';
			}
	}
}

/** Objectif d'une session : la première ligne non vide du prompt, espaces réduits, 200 caractères au plus. */
export function objectifDe(prompt: string): string | null {
	for (const ligne of prompt.split(/\r?\n/)) {
		const propre = ligne.replace(/\s+/g, ' ').trim();
		if (propre !== '') return Array.from(propre).slice(0, LONGUEUR_MAX_OBJECTIF).join('');
	}
	return null;
}

const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

/** Identifiant de session valide : un uuid (exigé par `claude --session-id`, et sûr comme nom de dossier). */
export const estUuid = (texte: string): boolean => RE_UUID.test(texte);
