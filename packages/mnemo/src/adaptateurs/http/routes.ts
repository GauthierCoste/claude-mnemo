import { ENTETE_REMPLACEMENT, ROUTES } from '@mnemo/contrat';
import type { BilanAmorceVue, ReponseEcarteesToujours, ReponseInjectionAutomatique, DossierVue, FilVue, GitDossierVue, MessageServeur, NiveauDossiersVue, ReponseDepot, ReponseDepotTraiter, ReponseDocuments, ReponseLancement, ReponseMarquerTraite, FenetreVue, LueVue, ReponseAServir, ReponseArretModeles, ReponseNiveauModeles, ReponseFenetres, ReponseProfils, ReponseQuotas, ReponseRecherche, ReponseServis, ReponseTraiter, ResultatEcriture, SanteVue, SessionTermineeVue } from '@mnemo/contrat';
import { avertissementsDe, CARACTERES_INVISIBLES, CHEMINS_LOT_MAX, demandeTout, estNiveauModeles, modelesPermis, NIVEAUX_MODELES, nomAffichable, OBJECTIF_MAX, PROFIL_TRAVAIL, SAUF_MAX } from '@mnemo/commun';
import type { AvecAvertissements, NiveauModeles } from '@mnemo/commun';
import { amorcer, marquerTraitees } from '../../application/amorcer.ts';
import { journaliserAvertissements } from '../../application/commun.ts';
import { confierLesDepots, confierLesFichesATraiter, lancerSession, traiterLesDossiers, traiterLesFiches } from '../../application/archiviste.ts';
import { dossiersNonRattachesAvecAvertissements } from '../../application/dossiers-non-rattaches.ts';
import { positionValide } from '../../application/position.ts';
import type { ContexteArchiviste, RefusArchiviste } from '../../application/archiviste.ts';
import type { BilanAmorcage } from '../../application/amorcer.ts';
import { chercherAvecAvis, voisins } from '../../application/chercher.ts';
import { deplacer, destinationDuDeplacement } from '../../application/deplacer.ts';
import { BORNES_DOCUMENTS, documentsDeLaMemoire, SANS_BORNE } from '../../application/documents.ts';
import { ecarterDuClassement } from '../../application/ecarter.ts';
import { noterGeste } from '../../application/gestes.ts';
import type { AprioriDesGestes } from '../../application/apriori.ts';
import type { DureeDuReranker } from '../../application/duree-reranker.ts';
import { affiner } from '../../application/affiner.ts';
import type { DemandeAffinage } from '../../application/affiner.ts';
import { estEtranger, traiterEvenement } from '../../application/evenements.ts';
import { modelesActifs } from '../../application/note-du-classement.ts';
import { coupuresDesInjections, reactiverInjection, SuiviIllisible } from '../../application/suivi-injection.ts';
import type { SuiviDesInjections } from '../../application/suivi-injection.ts';
import { dependancesDeSession } from '../../application/modeles-de-session.ts';
import { fichesDemandees } from '../../application/fiches-demandees.ts';
import { notesDuClassement, noteDuPorteur, porteursRecents, vecteurDuPorteur } from '../../application/porteurs-recents.ts';
import type { EntreeHook } from '../../application/evenements.ts';
import { filDuJour } from '../../application/fil.ts';
import { historiqueDesSessions } from '../../application/historique.ts';
import { lireElement, motifIntrouvable } from '../../application/lire.ts';
import { lister } from '../../application/lister.ts';
import { ErreurMoteurIndisponible, ErreurRepriseImpossible, ErreurSessionNonCommencee } from '../../application/pilote.ts';
import type { Pilote } from '../../application/pilote.ts';
import type { Dependances, DossiersRacine, MemoireClaude, Modeles, Pilotage, ProjetsClaude, SourceTranscription } from '../../application/ports.ts';
import { ErreurFichier } from '../../application/ports.ts';
import { dossierAccepte, ErreurDossier, niveauDossiers } from '../../application/dossiers.ts';
import type { GenreErreurDossier } from '../../application/dossiers.ts';
import { profilsDisponibles } from '../../application/profil.ts';
import { ecrireBrut, proposer } from '../../application/proposer.ts';
import { referencerDepot } from '../../application/referencer-depot.ts';
import { validerArguments, validerDemande, validerParametresRecherche, validerRequete } from '../../application/validation.ts';
import { cheminDeDepot, cheminDeLaRacine } from '../../domaine/chemin.ts';
import { messageDErreur } from '../../domaine/texte.ts';
import { estObjet } from '../../domaine/valeurs.ts';
import { estIdMoteur, MOTEUR_PAR_DEFAUT } from '../../domaine/moteurs/moteur.ts';
import type { IdMoteur } from '../../domaine/moteurs/moteur.ts';
import { memesQuotas, releveAGarder } from '../../domaine/quotas.ts';
import type { Quotas } from '../../domaine/quotas.ts';
import { estCauseNonVerifiee } from '../../domaine/refus-outil.ts';
import { estSourceDeDebut, estUuid } from '../../domaine/session.ts';
import type { EvenementHook, Session } from '../../domaine/session.ts';
import { deposerFichier, ErreurEspaceInsuffisant, ErreurTropVolumineux, tropVolumineux, verifierDepot } from '../../infra/fichiers-dossier.ts';
import { vueModeles } from './diffusion-modeles.ts';
import { cheminDeVue, vueFiche, vueGraphe } from './memoire-vues.ts';
import { estTraceDeDebut, titreDeFiche, titresDeLIndex as titresIndex, vueCoupures, vueEcarte, vueEcarteeToujours, vueInjection, vueServie, vueSession, vueSessionTerminee } from './vues.ts';

/** Chemin d'un dépôt (`?vers=`) selon `cheminDeDepot` du domaine ; refus lisible (400). */
function cheminDuDepot(vers: string | null): string {
	if (vers === null || vers === '') throw new ErreurHttp(400, 'Paramètre « vers » : chemin du fichier, relatif à la racine du dossier Mnemo.');
	const r = cheminDeDepot(vers);
	if (!r.ok) throw new ErreurHttp(400, `Paramètre « vers » refusé : « ${nomAffichable(vers)} » (${r.motif}).`);
	return r.chemin;
}

const depotExistant = (chemin: string): string => `Le fichier « ${chemin} » existe déjà : il n'est jamais remplacé.`;

/** Refus d'un dépôt : 413 (trop gros), 507 (disque), 400 (chemin) ; `fermer` : le corps n'a pas été lu en entier. */
function erreurDeDepot(erreur: unknown, fermer: boolean): unknown {
	if (erreur instanceof ErreurTropVolumineux) return new ErreurHttp(413, erreur.message, fermer);
	if (erreur instanceof ErreurEspaceInsuffisant) return new ErreurHttp(507, erreur.message, fermer);
	if (erreur instanceof ErreurFichier) return new ErreurHttp(400, erreur.message);
	return erreur;
}

const STATUT_ERREUR_DOSSIER: Record<GenreErreurDossier, number> = { refuse: 400, illisible: 404 };

/** Refus d'un chemin de dossier (`ErreurDossier`) traduit en réponse HTTP. */
function erreurDeDossier(erreur: unknown): unknown {
	if (erreur instanceof ErreurDossier) return new ErreurHttp(STATUT_ERREUR_DOSSIER[erreur.genre], erreur.message);
	return erreur;
}

/** `{ niveau }` d'un corps : un niveau des modèles (`null` aussi, si `nul` : la session suit le niveau de la machine) ; 400 sinon. */
function niveauDuCorps(corps: unknown, nul: true): NiveauModeles | null;
function niveauDuCorps(corps: unknown, nul: false): NiveauModeles;
function niveauDuCorps(corps: unknown, nul: boolean): NiveauModeles | null {
	const niveau = estObjet(corps) ? corps['niveau'] : undefined;
	if (estNiveauModeles(niveau) || (nul && niveau === null)) return niveau;
	const permis = NIVEAUX_MODELES.map((n) => `« ${n} »`).join(', ');
	throw new ErreurHttp(400, `Champ « niveau » invalide : ${permis}${nul ? ', ou null (comme partout)' : ''} attendu.`);
}

/** Corps JSON d'une requête : 1 Mo au plus. Dépôt de fichier : en flux, `ContexteRoutes.depotMax` au plus. */
export const CORPS_MAX = 1024 * 1024;

/** Une erreur rendue au client : `{ erreur }` (français) avec ce statut ; `fermer` : connexion fermée après la réponse. */
export class ErreurHttp extends Error {
	readonly statut: number;
	readonly fermer: boolean;
	constructor(statut: number, message: string, fermer = false) {
		super(message);
		this.name = 'ErreurHttp';
		this.statut = statut;
		this.fermer = fermer;
	}
}

/** `apres` : lancé par le serveur une fois la réponse écrite (jamais si elle ne l'est pas). */
export type Reponse = { statut: number; corps: unknown; apres?: () => void };

/**
 * Ce qu'une route reçoit : paramètres de requête, `:id` du chemin, en-têtes, corps (lu à la demande, borné par le
 * serveur ; `flux` pour une route `corps: 'flux'` : les morceaux tels qu'ils arrivent, jamais gardés, erreur si la connexion
 * est coupée avant la fin) ; `signal` : abandonné si la connexion se ferme avant la réponse.
 */
export type Requete = {
	params: URLSearchParams;
	id: string;
	entete(nom: string): string | null;
	signal: AbortSignal;
	json(): Promise<unknown>;
	flux(): AsyncIterable<Uint8Array>;
};

/** Ce dont les routes ont besoin : cas d'usage, pilote, et la diffusion vers les clients WebSocket. */
export type ContexteRoutes = {
	dep: Dependances;
	pil: Pilotage;
	pilote: Pilote;
	racine: string;
	/** Le disque ne distingue pas la casse (consignes vérifiées). */
	sansCasse: boolean;
	/** Tâche de fond (épisode, git) : le service l'attend avant de s'arrêter. */
	enFond(tache: Promise<unknown>): void;
	diffuser(m: MessageServeur): void;
	/** Une session a changé (diffusée si sa vue a changé). */
	signaler(s: Session): void;
	/** Le service s'arrête : plus aucun lancement. */
	arrete(): boolean;
	/** Ce que `sante` dit du service : racine affichée (`~` abrégé) et absolue, version de Mnemo. */
	identite: { racine: string; racineAbsolue: string; version: string };
	/** État git d'un dossier (validé), gardé quelques secondes. */
	etatGit(dossier: string, tout: boolean): Promise<GitDossierVue>;
	/** Dossiers sous la racine, lus sur le disque. */
	dossiers: DossiersRacine;
	/** Mémoire native de Claude Code (lue, jamais écrite) et instructions des projets, pour `amorce`. */
	memoireClaude: MemoireClaude;
	projetsClaude: ProjetsClaude;
	/** Modèles locaux de la machine : état, démarrage et arrêt sur un geste de l'utilisateur, niveau. */
	modeles: Modeles;
	/** L'état des modèles a pu changer (un geste) : relu, et diffusé s'il a changé. */
	relireModeles(): void;
	/** Journal du service (avis d'un import, avertissements d'une écriture faite…). */
	journal: (message: string) => void;
	/** Taille maximale d'un dépôt (`TAILLE_MAX_DOCUMENT` en service ; abaissée par les tests). */
	depotMax: number;
	/** A priori des gestes et fiches écartées toujours, tenus en mémoire par le service ; actualisés après chaque geste. */
	apriori: AprioriDesGestes;
	/**
	 * Le suivi des injections automatiques, tenu en mémoire par le service (coupures par niveau) : relu en fond après chaque
	 * geste, il rediffuse lui-même la vue des sessions quand les coupures changent. Absent : lu à chaque demande, sans rediffusion.
	 */
	suivi?: SuiviDesInjections;
	/**
	 * Durée du reranker estimée d'après les durées mesurées de ses appels « injection » faits par ce service, et ses appels en
	 * cours : le hook de message ne le lance que si l'estimation est fiable, tient dans son temps et qu'aucun appel n'est en cours.
	 * Absente : pas de reranker au hook.
	 */
	dureeReranker?: DureeDuReranker;
};

type Route = { methode: 'GET' | 'POST' | 'PUT' | 'DELETE'; chemin: string; corps?: 'json' | 'flux'; action(r: Requete): Promise<Reponse> };

const ok = (corps: unknown, statut = 200): Reponse => ({ statut, corps });
/** Avance tolérée d'un horodatage de hook sur l'horloge du service. */
const AVANCE_MAX_MS = 60_000;

/** Champs connus et types d'un corps JSON objet ; sinon 400 avec le motif. */
function champs(brut: unknown, table: Record<string, { requis: boolean; max: number }>): Record<string, string | undefined> {
	if (!estObjet(brut)) throw new ErreurHttp(400, 'Corps attendu : un objet JSON.');
	for (const cle of Object.keys(brut)) if (!(cle in table)) throw new ErreurHttp(400, `Champ inconnu « ${cle} ».`);
	const sortie: Record<string, string | undefined> = {};
	for (const [cle, regle] of Object.entries(table)) {
		const v = brut[cle];
		if (v === undefined) {
			if (regle.requis) throw new ErreurHttp(400, `Champ « ${cle} » : obligatoire.`);
			continue;
		}
		if (typeof v !== 'string') throw new ErreurHttp(400, `Champ « ${cle} » : texte attendu.`);
		if (v.length > regle.max) throw new ErreurHttp(400, `Champ « ${cle} » : ${regle.max} caractères au plus.`);
		sortie[cle] = v;
	}
	return sortie;
}

/** Bilan d'amorçage pour l'interface ; `aTraiter` : fiches en attente de l'archiviste (toutes) ; `archiviste` : où en est leur remise. */
export function vueBilanAmorce(b: BilanAmorcage, aTraiter: number, archiviste: BilanAmorceVue['archiviste']): BilanAmorceVue {
	const compte = (c: { ajoutees: number; mises_a_jour: number; inchangees: number }) => ({ nouvelles: c.ajoutees, modifiees: c.mises_a_jour, inchangees: c.inchangees });
	return {
		notes: compte(b),
		instructions: compte(b.instructions),
		rattachees: b.rattachees,
		secrets: b.secrets,
		ignores: b.ignores,
		fiches: b.aTraiter.map((a) => a.fiche),
		aTraiter,
		archiviste,
		...avertissementsDe(b),
		commit: b.commit,
	};
}

/** Nombre de chemins admis dans un champ. */
type Bornes = { min: number; max: number };
const LOT: Bornes = { min: 1, max: CHEMINS_LOT_MAX };

/** `{ <champ> }` : liste dans `bornes`, chacun accepté par `accepter` (sinon 400 avec le motif), sans doublon. */
function listeDeChemins(brut: unknown, champ: string, bornes: Bornes, genre: string, accepter: (c: string) => string): string[] {
	if (!estObjet(brut)) throw new ErreurHttp(400, 'Corps attendu : un objet JSON.');
	for (const cle of Object.keys(brut)) if (cle !== champ) throw new ErreurHttp(400, `Champ inconnu « ${cle} ».`);
	const chemins = brut[champ];
	if (!Array.isArray(chemins) || chemins.length < bornes.min) throw new ErreurHttp(400, `Champ « ${champ} » : liste${bornes.min > 0 ? ' non vide' : ''} de ${genre} attendue.`);
	if (chemins.length > bornes.max) throw new ErreurHttp(400, `Champ « ${champ} » : ${bornes.max} ${genre} au plus.`);
	const sortie = new Set<string>();
	for (const c of chemins) {
		if (typeof c !== 'string' || c.length > 4096) throw new ErreurHttp(400, `Champ « ${champ} » : chemins de ${genre} attendus.`);
		sortie.add(accepter(c));
	}
	return [...sortie];
}

/**
 * Fiches `.md` relatives à la mémoire (ni `..`, ni chemin absolu, ni `\`, ni caractère de contrôle) ; le cas d'usage ne
 * retient que les fiches `source`, où qu'elles soient rangées.
 */
function cheminsDeSources(brut: unknown, champ: string, bornes: Bornes): string[] {
	return listeDeChemins(brut, champ, bornes, 'fiches', (c) => {
		const chemin = CARACTERES_INVISIBLES.test(c) ? null : cheminDeVue(c);
		if (chemin === null || chemin !== c) throw new ErreurHttp(400, `Chemin refusé : « ${nomAffichable(c)} » (fiche .md relative à la mémoire).`);
		return chemin;
	});
}

/** Dossiers de projet relatifs à la racine du dossier Mnemo (ni `..`, ni chemin absolu, ni `\`) ; le cas d'usage ne retient que les non rattachés. */
function dossiersDeProjet(brut: unknown): string[] {
	return listeDeChemins(brut, 'chemins', LOT, 'dossiers', (c) => {
		const dossier = CARACTERES_INVISIBLES.test(c) || c === '' ? null : positionValide(c);
		if (dossier === null || dossier !== c) throw new ErreurHttp(400, `Dossier refusé : « ${nomAffichable(c)} » (relatif à la racine du dossier Mnemo).`);
		return dossier;
	});
}

const EVENEMENTS: readonly EvenementHook[] = ['debut', 'message', 'outil', 'apres_outil', 'arret', 'fin'];

/** Entrée de `mnemo hook` (celle qu'il traduit de Claude Code) : forme vérifiée, sinon 400. */
function entreeHook(brut: unknown): EntreeHook {
	if (!estObjet(brut)) throw new ErreurHttp(400, 'Événement attendu : un objet JSON.');
	const { evenement, session, horodatageMs, cwd, prompt, outil, arret, sansContexte, source, moteur, fil } = brut;
	if (typeof evenement !== 'string' || !EVENEMENTS.includes(evenement as EvenementHook)) throw new ErreurHttp(400, 'Événement inconnu.');
	if (typeof session !== 'string' || (session !== '' && !estUuid(session))) throw new ErreurHttp(400, 'Session : uuid ou « » attendu.');
	if (typeof horodatageMs !== 'number' || !Number.isFinite(horodatageMs)) throw new ErreurHttp(400, 'Horodatage : nombre attendu.');
	if (horodatageMs < 0 || horodatageMs > Date.now() + AVANCE_MAX_MS) throw new ErreurHttp(400, 'Horodatage hors bornes.');
	if (cwd !== null && typeof cwd !== 'string') throw new ErreurHttp(400, 'cwd : texte ou null attendu.');
	const entree: EntreeHook = { evenement: evenement as EvenementHook, session, horodatageMs, cwd: cwd === '' ? null : (cwd as string | null) };
	if (prompt !== undefined) {
		if (typeof prompt !== 'string') throw new ErreurHttp(400, 'prompt : texte attendu.');
		entree.prompt = prompt;
	}
	if (outil !== undefined) {
		if (estObjet(outil) && estCauseNonVerifiee(outil.nonLue)) entree.outil = { nonLue: outil.nonLue };
		else if (estObjet(outil) && typeof outil.nom === 'string' && estObjet(outil.entree)) entree.outil = { nom: outil.nom, entree: outil.entree };
		else throw new ErreurHttp(400, 'outil : { nom, entree } ou { nonLue } attendu.');
	}
	if (arret !== undefined) {
		if (arret !== 'stop' && arret !== 'notification') throw new ErreurHttp(400, 'arret : « stop » ou « notification » attendu.');
		entree.arret = arret;
	}
	if (sansContexte !== undefined) {
		if (typeof sansContexte !== 'boolean') throw new ErreurHttp(400, 'sansContexte : booléen attendu.');
		entree.sansContexte = sansContexte;
	}
	if (source !== undefined) {
		if (!estSourceDeDebut(source)) throw new ErreurHttp(400, 'source : startup, resume, clear ou compact attendu.');
		entree.source = source;
	}
	if (moteur !== undefined) {
		if (!estIdMoteur(moteur)) throw new ErreurHttp(400, 'moteur : identifiant de moteur attendu.');
		entree.moteur = moteur;
	}
	if (fil !== undefined) {
		if (typeof fil !== 'string' || fil === '' || fil.length > 200) throw new ErreurHttp(400, 'fil : identifiant de session du moteur attendu.');
		entree.fil = fil;
	}
	return entree;
}

/** Marge gardée, avant l'instant où le hook cesse d'attendre, pour l'écriture de la réponse et son transport. */
const MARGE_REPONSE_HOOK_MS = 50;
/** Ce qu'attendait au plus un hook qui ne transmet pas son échéance (version plus ancienne), depuis son envoi. */
const ATTENTE_HOOK_SANS_ECHEANCE_MS = 300;
/** Une lecture de transcription (jauge, quotas) au-delà : abandonnée, la suivante de la session peut partir. */
const DELAI_LECTURE_TRANSCRIPTION_MS = 2000;

/**
 * Échéance de `message` et `apres_outil` : un hook qui n'attend plus la réponse recalcule seul, en excluant les fiches notées
 * servies ; le service ne note donc une fiche servie que si sa réponse arrive avant que le hook cesse d'attendre (`echeanceMs`,
 * ou à défaut une attente prudente). Les autres événements ne servent rien : pas d'échéance. 400 si `echeanceMs` est mal formé.
 */
/** Au-delà, un horodatage de hook n'est pas l'instant où son processus a démarré (horloge décalée, événement rejoué). */
const DUREE_HOOK_MAX_MS = 10_000;
/** Injections (à la main ou par Mnemo) d'une session rendues au panneau Contexte, les plus récentes. */
const INJECTIONS_VUES_MAX = 200;

/**
 * Début du hook : l'horodatage de l'événement est l'instant où le processus du hook a démarré ; le journal mesure depuis lui la
 * durée du hook entière (démarrage, appel du service, calcul). Un horodatage dans le futur, ou trop ancien : mesuré depuis l'appel.
 */
function debutDuHook(horodatageMs: number): { debutMs?: number } {
	const maintenant = Date.now();
	return horodatageMs <= maintenant && horodatageMs >= maintenant - DUREE_HOOK_MAX_MS ? { debutMs: horodatageMs } : {};
}

function echeanceDuHook(brut: unknown, evenement: EvenementHook): number | undefined {
	const echeanceMs = estObjet(brut) ? brut.echeanceMs : undefined;
	if (echeanceMs !== undefined && (typeof echeanceMs !== 'number' || !Number.isFinite(echeanceMs) || echeanceMs < 0 || echeanceMs > Date.now() + AVANCE_MAX_MS)) {
		throw new ErreurHttp(400, 'echeanceMs : instant (ms) attendu.');
	}
	if (evenement !== 'message' && evenement !== 'apres_outil') return undefined;
	return (echeanceMs ?? Date.now() + ATTENTE_HOOK_SANS_ECHEANCE_MS) - MARGE_REPONSE_HOOK_MS;
}

/** Chemin de la transcription du moteur joint au hook, pour la seule jauge de la fenêtre de contexte ; hors de `EntreeHook`. */
function transcriptionDuHook(brut: unknown): string | undefined {
	const transcription = estObjet(brut) ? brut.transcription : undefined;
	if (transcription === undefined) return undefined;
	if (typeof transcription !== 'string' || transcription === '') throw new ErreurHttp(400, 'transcription : chemin attendu.');
	return transcription;
}

/** Valeur d'une validation de `validation.ts`, ou 400 avec son motif. */
function valide<T>(v: { ok: true; valeur: T } | { ok: false; motif: string }): T {
	if (!v.ok) throw new ErreurHttp(400, `Refusé : ${v.motif}`);
	return v.valeur;
}

/** Paramètres de requête choisis (absents omis), pour les validations de `validation.ts`. */
function parametres(params: URLSearchParams, noms: Record<string, string>): Record<string, unknown> {
	const sortie: Record<string, unknown> = {};
	for (const [param, nom] of Object.entries(noms)) {
		const v = params.get(param);
		if (v !== null) sortie[nom] = v;
	}
	return sortie;
}

/** Les routes du service (chemins : `ROUTES` du contrat). */
export function routes(ctx: ContexteRoutes): Route[] {
	const { dep, pil, pilote, apriori } = ctx;
	/** Recherche complète en cours par clé de remplacement (la suivante de même clé l'abandonne). */
	const recherchesEnCours = new Map<string, AbortController>();
	const vue = (s: Session) => vueSession(s, pilote.enCours(s.id), pilote.motifSansReprise(s), apriori.suggestions(s.id), ctx.suivi === undefined ? [] : vueCoupures(ctx.suivi.derniere()), pilote.attendPremierMessage(s));
	/**
	 * Après un geste : l'a priori relit les gestes nouveaux (et les écartées toujours si `ecartees`), puis la vue de chaque
	 * session dont les suggestions « écartée toujours » ont changé est rediffusée. Une panne de lecture n'empêche pas le geste
	 * d'être fait.
	 */
	const apresGeste = async (ecartees = false): Promise<void> => {
		// le suivi des injections ne dépend pas de l'a priori : relu même si l'a priori est en panne
		const suivi = apresSuivi();
		try {
			const changees = await apriori.actualiser({ ecartees });
			for (const id of changees) {
				const s = await pil.etat.lire(id).catch(() => null);
				if (s !== null) ctx.signaler(s);
			}
		} catch (erreur) {
			ctx.journal(`a priori des gestes : relecture impossible (${messageDErreur(erreur)}).`);
		}
		await suivi;
	};
	/**
	 * Après un geste ou une réactivation : le suivi des injections est relu (une relecture à la fois, plus une en attente) ; s'il
	 * change, il rediffuse lui-même la vue des sessions.
	 */
	const apresSuivi = async (): Promise<void> => {
		await ctx.suivi?.actualiser().catch((erreur: unknown) => ctx.journal(`suivi des injections : relecture impossible (${messageDErreur(erreur)}).`));
	};
	/** Les fiches écartées toujours (pas celles rétablies), avec leur titre. */
	const ecarteesToujours = async (): Promise<Reponse> => {
		const titres = await titresDeLIndex();
		const actives = (await pil.etat.ecarteesToujours()).filter((e) => e.retablieMs === null);
		return ok({ ecarteesToujours: actives.map((e) => vueEcarteeToujours(e, titres)) } satisfies ReponseEcarteesToujours);
	};
	/** Les niveaux de modèle dont l'injection automatique est coupée par le suivi, lus dans le journal des gestes. */
	const coupures = async () => vueCoupures(await coupuresDesInjections(pil.etat, modelesActifs(dep)));
	const session = async (id: string): Promise<Session> => {
		const s = estUuid(id) ? await pil.etat.lire(id) : null;
		if (s === null) throw new ErreurHttp(404, 'Session inconnue.');
		return s;
	};
	const titresDeLIndex = (): Promise<Map<string, string>> => titresIndex(dep.index);
	/** Fiches lues par la session (outils `lire`, `voisins`), la plus récente d'abord, sans doublon, à l'heure de leur dernière lecture. */
	const luesDe = async (id: string): Promise<LueVue[]> => {
		const lues = new Map<string, LueVue>();
		for (const a of (await pil.etat.actions(id)).filter((x) => x.action === 'lue').reverse()) {
			if (!lues.has(a.chemin)) lues.set(a.chemin, { chemin: a.chemin, horodatageMs: a.horodatageMs });
		}
		return [...lues.values()];
	};
	/** Dernières lues diffusées par session : un outil qui ne lit rien ne rediffuse pas la même liste. */
	const luesDiffusees = new Map<string, string>();
	/** Action du pilote sur une session existante : la session après, ou 404. */
	const surSession = (action: (id: string) => Promise<Session | null>) => async (r: Requete) => {
		await session(r.id);
		const apres = await action(r.id).catch((erreur: unknown) => {
			if (erreur instanceof ErreurMoteurIndisponible || erreur instanceof ErreurRepriseImpossible || erreur instanceof ErreurSessionNonCommencee) throw new ErreurHttp(409, erreur.message);
			throw erreur;
		});
		if (apres === null) throw new ErreurHttp(404, 'Session inconnue.');
		return ok({ session: vue(apres) });
	};
	/** Un geste sur les modèles de la machine, puis leur nouvel état, rendu et diffusé aux autres clients. */
	const apresGesteModeles = (geste: () => Promise<void>) => async (): Promise<Reponse> => {
		await geste();
		ctx.relireModeles();
		return ok(vueModeles(await ctx.modeles.etat()));
	};
	const demandees = fichesDemandees();
	/** Le reranker de `d` compté (appels en cours) et mesuré (appels « injection ») par le service ; une enveloppe par appel. */
	const avecRerankerMesure = (d: Dependances): Dependances => (ctx.dureeReranker === undefined ? d : { ...d, reranker: ctx.dureeReranker.envelopper(d.reranker) });
	/** Dernier message porteur de chaque session (vecteur compris) : les gestes de l'interface le reprennent. */
	const porteurs = porteursRecents();
	/** L'affinage en cours de chaque session : une demande plus récente de la même session le coupe (caduc). */
	const affinages = new Map<string, AbortController>();
	/**
	 * L'affinage du classement d'un message (spec § 3.6), après la diffusion de son entrée : le reranker s'il est en marche et
	 * permis à la session (niveau Complets) ; sinon le sens seul, s'il manquait au hook. Ses appels au reranker ne retiennent pas
	 * le hook ; chaque écriture de l'entrée est rediffusée (même horodatage) ; fait, la mémoire des porteurs reçoit le classement
	 * affiné si c'est encore le dernier message porteur.
	 */
	const affinerLeMessage = async (s: Session, d: DemandeAffinage, controle: AbortController): Promise<void> => {
		try {
			const permis = modelesPermis(s.niveauModeles ?? 'complets');
			const etatModeles = permis.reranker || (permis.sens && !d.sens) ? await ctx.modeles.etat() : null;
			const reranker = permis.reranker && etatModeles?.reranker === 'pret';
			const sens = !d.sens && permis.sens && etatModeles?.sens === 'pret';
			if (!reranker && !sens) return;
			const duree = ctx.dureeReranker;
			const depAffinage = dependancesDeSession(duree === undefined ? dep : { ...dep, reranker: duree.envelopper(dep.reranker, { arrierePlan: true }) }, pil.etat, s.id);
			const fait = await affiner(depAffinage, pil.etat, d, {
				signal: controle.signal,
				reranker,
				...(duree === undefined ? {} : { estimer: (documents: number) => duree.estimer(documents) }),
				diffuser: async () => {
					// même horodatage : l'entrée du message, relue telle que l'affinage l'a laissée
					const entree = (await pil.etat.servis(s.id, 5, 'message')).find((e) => e.horodatageMs === d.horodatageMs);
					if (entree !== undefined) ctx.diffuser({ type: 'servi', entree: vueServie(entree, await titresDeLIndex()) });
				},
			});
			const porteur = porteurs.lire(s.id);
			if (fait !== null && porteur !== null && porteur.rang === d.rang) {
				porteurs.noter(s.id, { ...porteur, classement: notesDuClassement(fait.classement), vecteur: fait.vecteur ?? porteur.vecteur });
			}
		} finally {
			if (affinages.get(s.id) === controle) affinages.delete(s.id);
		}
	};
	/** Fiches à injecter au prochain message de la session, rendues et diffusées après un changement. */
	const aServirDiffuses = (id: string, chemins: string[]): Reponse => {
		ctx.diffuser({ type: 'aServir', session: id, chemins });
		return ok({ chemins } satisfies ReponseAServir);
	};
	/** Télémétrie du moteur (Claude Code par défaut) ; null : moteur inconnu de ce service. */
	const telemetrie = (moteur: IdMoteur = MOTEUR_PAR_DEFAUT) => pil.moteurs[moteur]?.moteur.telemetrie ?? null;
	/** Quotas de l'abonnement de chaque moteur, communs à toutes ses sessions : le dernier relevé de chacun. */
	const quotasParMoteur: Partial<Record<IdMoteur, Quotas>> = {};
	/**
	 * Note un relevé des quotas d'un moteur ; diffusé si les fenêtres changent (`quotas` en plus pour Claude Code, que lisent
	 * les anciens clients) ; sinon seul l'instant du relevé est mis à jour.
	 */
	const noterQuotas = (moteur: IdMoteur, recus: Quotas): void => {
		const avant = quotasParMoteur[moteur];
		quotasParMoteur[moteur] = recus;
		if (memesQuotas(avant, recus)) return;
		if (moteur === MOTEUR_PAR_DEFAUT) ctx.diffuser({ type: 'quotas', quotas: recus });
		ctx.diffuser({ type: 'quotasMoteurs', moteurs: { ...quotasParMoteur } });
	};
	const reponseQuotas = (): ReponseQuotas => ({ quotas: quotasParMoteur[MOTEUR_PAR_DEFAUT] ?? null, moteurs: { ...quotasParMoteur } });
	/**
	 * Fenêtre de contexte de chaque session, relue dans sa transcription (par le moteur qui a lancé le hook) après un hook,
	 * avec les quotas de l'abonnement quand le moteur les y écrit (Codex) ; diffusés s'ils changent. Jauge seulement : la
	 * transcription n'est jamais lue pour le contexte injecté.
	 */
	const fenetres = new Map<string, FenetreVue>();
	const relireFenetre = async (session: string, source: SourceTranscription, moteur: IdMoteur = MOTEUR_PAR_DEFAUT): Promise<void> => {
		const lecture = telemetrie(moteur)?.fenetre;
		if (lecture === undefined) return;
		const lue = await lecture.lire(source);
		if (lue === null) return;
		const { fenetre, quotas } = lue;
		// une transcription peut être vieille (session reprise, service redémarré) : seul un relevé récent est gardé
		const garde = quotas === undefined ? null : releveAGarder(quotasParMoteur[moteur], quotas, Date.now());
		if (garde !== null) noterQuotas(moteur, garde);
		if (fenetre === undefined) return;
		const avant = fenetres.get(session);
		if (avant !== undefined && avant.utilises === fenetre.utilises && avant.max === fenetre.max && avant.avantResume === fenetre.avantResume) return;
		fenetres.set(session, fenetre);
		ctx.diffuser({ type: 'fenetre', session, fenetre });
	};
	/**
	 * Une seule lecture à la fois par session, chacune bornée à `DELAI_LECTURE_TRANSCRIPTION_MS` : un hook arrivé pendant une
	 * lecture en demande une autre, faite juste après (la transcription a pu changer entre-temps) ; les suivants s'y joignent.
	 */
	const lectures = new Map<string, { encore: (() => Promise<void>) | null }>();
	const relireApresHook = (session: string, relire: () => Promise<void>): void => {
		const enCours = lectures.get(session);
		if (enCours !== undefined) {
			enCours.encore = relire;
			return;
		}
		const etat: { encore: (() => Promise<void>) | null } = { encore: null };
		lectures.set(session, etat);
		void (async () => {
			let suivante: (() => Promise<void>) | null = relire;
			while (suivante !== null) {
				// bornée : une lecture qui ne finit pas (disque lent, fichier spécial) ne coince jamais la file de la session
				let minuteur: NodeJS.Timeout | undefined;
				await Promise.race([suivante().catch(() => {}), new Promise<void>((fin) => (minuteur = setTimeout(fin, DELAI_LECTURE_TRANSCRIPTION_MS)))]);
				clearTimeout(minuteur);
				suivante = etat.encore;
				etat.encore = null;
			}
			lectures.delete(session);
		})();
	};
	/** Écartés de la session, rendus et diffusés après un changement. */
	const ecartesDiffuses = async (id: string): Promise<Reponse> => {
		const ecartes = (await pil.etat.ecartes(id)).map(vueEcarte);
		ctx.diffuser({ type: 'ecartes', session: id, ecartes });
		return ok({ ecartes });
	};
	/** File des imports de la mémoire de Claude : un à la fois. */
	let imports: Promise<unknown> = Promise.resolve();
	const archiviste: ContexteArchiviste = { dep, pil, pilote, enFond: ctx.enFond, arrete: ctx.arrete, journal: ctx.journal };
	const refus = (r: RefusArchiviste): ErreurHttp => new ErreurHttp(r.arret ? 503 : r.conflit ? 409 : 400, r.refus);
	/** Réponse de `sourcesTraiter` et `sourcesTraiterToutes` : 409 (`aucune`) si rien n'est à traiter. */
	const repondreTraiter = (traitees: Awaited<ReturnType<typeof traiterLesFiches>>, aucune: string): Reponse => {
		if (traitees === null) throw new ErreurHttp(409, aucune);
		if ('refus' in traitees.remise) throw refus(traitees.remise);
		return ok({ chemins: traitees.chemins, ...traitees.remise } satisfies ReponseTraiter);
	};
	/** Avertissements d'une écriture faite : rendus avec le succès, et journalisés. */
	const journaliser = (r: AvecAvertissements): void => journaliserAvertissements(r, ctx.journal);
	/** Résultat d'une écriture : 400 si refusée (409 : conflit d'édition) ; les clients sont prévenus si la mémoire a changé. */
	const ecriture = (r: Awaited<ReturnType<typeof ecrireBrut>>): Reponse => {
		if (r.statut === 'refuse') throw new ErreurHttp(400, `Refusé : ${r.motif}`);
		if (r.statut === 'conflit') throw new ErreurHttp(409, r.motif);
		if (r.statut === 'ecrit' || r.statut === 'repetition' || r.statut === 'retire') ctx.diffuser({ type: 'memoire', modifieeMs: Date.now() });
		if (r.statut === 'ecrit' || r.statut === 'repetition') journaliser(r);
		return ok(r satisfies ResultatEcriture);
	};

	return [
		{
			methode: 'GET',
			chemin: ROUTES.sante,
			action: async () => ok({ ok: true, pid: process.pid, ...ctx.identite, terminaux: pil.terminaux.disponibles() } satisfies SanteVue),
		},

		{
			methode: 'GET',
			chemin: ROUTES.sessions,
			action: async (r) => ok({ sessions: (await pil.etat.lister({ archivees: r.params.get('archivees') === '1' })).map(vue) }),
		},
		{
			methode: 'POST',
			chemin: ROUTES.sessions,
			corps: 'json',
			action: async (r) => {
				const d = champs(await r.json(), {
					profil: { requis: false, max: 100 },
					dossier: { requis: true, max: 4096 },
					objectif: { requis: false, max: OBJECTIF_MAX },
				});
				const lance = await lancerSession(archiviste, { profil: d.profil ?? PROFIL_TRAVAIL, dossier: d.dossier!, ...(d.objectif === undefined ? {} : { objectif: d.objectif }) });
				if ('refus' in lance) throw refus(lance);
				return ok({ session: vue(lance.session), ...(lance.manuel === undefined ? {} : { manuel: lance.manuel }) } satisfies ReponseLancement, lance.nouvelle ? 201 : 200);
			},
		},
		{ methode: 'GET', chemin: ROUTES.profils, action: async () => ok((await profilsDisponibles(dep)) satisfies ReponseProfils) },
		{ methode: 'GET', chemin: ROUTES.session, action: async (r) => ok({ session: vue(await session(r.id)) }) },
		{
			methode: 'DELETE',
			chemin: ROUTES.session,
			// retire de l'historique : l'état de la session chez Mnemo et son plugin ; jamais la transcription de Claude Code
			// (~/.claude), ni l'épisode ou les fiches de la mémoire
			action: async (r) => {
				const s = await session(r.id);
				if (s.etat !== 'terminee' || pilote.enCours(s.id)) throw new ErreurHttp(409, 'Seule une session terminée (sans terminal ouvert) peut être retirée de l’historique.');
				// le plugin d'abord : en cas d'échec, la session reste dans l'historique et le retrait peut être refait
				await pil.plugin.retirer(s.id);
				const resultat = await pil.etat.supprimer(s.id);
				if (resultat === 'inconnue') throw new ErreurHttp(404, 'Session inconnue.');
				if (resultat === 'non_terminee') throw new ErreurHttp(409, 'Seule une session terminée peut être retirée de l’historique.');
				apriori.oublierSession(s.id);
				return ok({ id: s.id });
			},
		},
		{
			methode: 'GET',
			chemin: ROUTES.historique,
			action: async () =>
				ok({ sessions: (await historiqueDesSessions(dep, pil.etat)).map((t) => vueSessionTerminee(t, pilote.enCours(t.session.id))) } satisfies { sessions: SessionTermineeVue[] }),
		},
		{ methode: 'POST', chemin: ROUTES.pause, corps: 'json', action: surSession((id) => pilote.pause(id)) },
		{ methode: 'POST', chemin: ROUTES.reprise, corps: 'json', action: surSession((id) => pilote.reprendre(id)) },
		{ methode: 'POST', chemin: ROUTES.bilan, corps: 'json', action: surSession((id) => pilote.terminer(id, { bilan: true })) },
		{ methode: 'POST', chemin: ROUTES.abandon, corps: 'json', action: surSession((id) => pilote.terminer(id, { bilan: false })) },
		{
			methode: 'GET',
			chemin: ROUTES.servis,
			action: async (r) => {
				await session(r.id);
				// le panneau n'affiche que le dernier classement : les autres entrées partent sans le leur, que la base ne lit même pas
				const lues = await luesDe(r.id);
				const titres = await titresDeLIndex();
				// fiches injectées à la main ou par Mnemo (avec leur %), d'après le journal des gestes ; illisible : rien de plus
				const injections = (await pil.etat.gestes({ session: r.id, sortes: ['injectee_main', 'injectee_auto'], sansVecteur: true, limite: INJECTIONS_VUES_MAX }).catch(() => [])).map(vueInjection);
				return ok({
					servis: (await pil.etat.servis(r.id, 200, undefined, { classement: 'dernier' })).filter((e) => !estTraceDeDebut(e)).map((e) => vueServie(e, titres)),
					lues,
					coupures: await coupures(),
					injections,
				} satisfies ReponseServis);
			},
		},
		{ methode: 'GET', chemin: ROUTES.modeles, action: async () => ok(vueModeles(await ctx.modeles.etat())) },
		{ methode: 'POST', chemin: ROUTES.modelesDemarrer, corps: 'json', action: apresGesteModeles(() => ctx.modeles.demarrer()) },
		{
			methode: 'POST',
			chemin: ROUTES.modelesArreter,
			corps: 'json',
			action: async () => {
				const arret = await ctx.modeles.arreter();
				ctx.journal(`modèles arrêtés à la demande : ${typeof arret === 'object' ? `${arret.enChargement} serveur(s) encore en chargement` : arret}.`);
				ctx.relireModeles();
				return ok({ ...vueModeles(await ctx.modeles.etat()), arret } satisfies ReponseArretModeles);
			},
		},
		{
			methode: 'PUT',
			chemin: ROUTES.modelesNiveau,
			corps: 'json',
			action: async (r) => {
				const niveau = niveauDuCorps(await r.json(), false);
				const arret = await ctx.modeles.changerNiveau(niveau);
				ctx.relireModeles();
				return ok({ ...vueModeles(await ctx.modeles.etat()), arret } satisfies ReponseNiveauModeles);
			},
		},
		{
			methode: 'PUT',
			chemin: ROUTES.sessionModeles,
			corps: 'json',
			action: async (r) => {
				const niveau = niveauDuCorps(await r.json(), true);
				const s = await session(r.id);
				if (s.etat === 'terminee') throw new ErreurHttp(409, 'Session terminée : son niveau des modèles ne sert plus.');
				// la vue changée part aux clients par l'écouteur des sessions du pilote
				const apres = await pilote.niveauModeles(s.id, niveau);
				if (apres === null) throw new ErreurHttp(404, 'Session inconnue.');
				return ok({ session: vue(apres) });
			},
		},
		{
			methode: 'GET',
			chemin: ROUTES.ecartes,
			action: async (r) => {
				await session(r.id);
				return ok({ ecartes: (await pil.etat.ecartes(r.id)).map(vueEcarte) });
			},
		},
		{
			methode: 'POST',
			chemin: ROUTES.ecartes,
			corps: 'json',
			action: async (r) => {
				const { id } = champs(await r.json(), { id: { requis: true, max: 4096 } });
				const s = await session(r.id);
				const titres = await titresDeLIndex();
				const { resultat, porteur } = await ecarterDuClassement(pil.etat, s, id!, undefined, (chemin) => titreDeFiche(chemin, titres));
				if (resultat === 'introuvable') throw new ErreurHttp(404, 'Élément absent des derniers classements de la session.');
				if (resultat === 'terminee') throw new ErreurHttp(409, 'Session terminée : plus rien à écarter.');
				// un geste seulement si l'élément n'était pas déjà écarté ; le message est celui de l'entrée où il a été trouvé
				if (resultat === 'ecarte') {
					const recent = porteurs.lire(s.id);
					const fiche = id!.split('#')[0]!;
					// la note : la ligne de la fiche au dernier classement gardé en mémoire (sinon l'état la cherche dans les dernières entrées)
					const note = noteDuPorteur(recent, fiche, porteur?.rang);
					await noterGeste(dep, pil.etat, {
						geste: 'ecartee_ici',
						session: s.id,
						fiche,
						horodatageMs: Date.now(),
						vecteur: vecteurDuPorteur(recent),
						...(porteur === undefined ? {} : { porteur }),
						...(note === undefined ? {} : { note }),
					});
					await apresGeste();
				}
				return ecartesDiffuses(s.id);
			},
		},
		{
			methode: 'DELETE',
			chemin: ROUTES.ecartes,
			action: async (r) => {
				const id = r.params.get('id');
				if (id === null || id === '') throw new ErreurHttp(400, 'Paramètre « id » : obligatoire.');
				const s = await session(r.id);
				const resultat = await pil.etat.retablir(s.id, id);
				if (resultat === 'terminee') throw new ErreurHttp(409, 'Session terminée : plus rien à rétablir.');
				if (resultat === 'retabli') {
					const recent = porteurs.lire(s.id);
					const fiche = id.split('#')[0]!;
					const note = noteDuPorteur(recent, fiche);
					await noterGeste(dep, pil.etat, { geste: 'retablie', session: s.id, fiche, horodatageMs: Date.now(), vecteur: vecteurDuPorteur(recent), ...(note === undefined ? {} : { note }) });
					await apresGeste();
				}
				return ecartesDiffuses(s.id);
			},
		},
		{ methode: 'GET', chemin: ROUTES.ecarteesToujours, action: ecarteesToujours },
		{ methode: 'GET', chemin: ROUTES.injectionAutomatique, action: async () => ok({ coupures: await coupures() } satisfies ReponseInjectionAutomatique) },
		{
			methode: 'POST',
			chemin: ROUTES.injectionAutomatique,
			corps: 'json',
			// réactivation de l'injection automatique coupée par le suivi : un geste par niveau réactivé, dans la session donnée
			action: async (r) => {
				const d = champs(await r.json(), { session: { requis: false, max: 100 }, niveau: { requis: false, max: 20 } });
				if (d.niveau !== undefined && d.niveau !== 'complets' && d.niveau !== 'sens') throw new ErreurHttp(400, 'niveau : « complets » ou « sens » attendu.');
				const s = d.session === undefined ? null : await session(d.session);
				const reactives = await reactiverInjection(dep, pil.etat, modelesActifs(dep), { session: s?.id ?? '', horodatageMs: Date.now(), ...(d.niveau === undefined ? {} : { niveau: d.niveau }) }).catch((e: unknown) => {
					// état de coupure inconnu : aucun geste, l'utilisateur réessaie
					if (e instanceof SuiviIllisible) throw new ErreurHttp(503, 'Suivi des injections illisible : réessayez.');
					throw e;
				});
				if (reactives.length > 0) {
					ctx.journal(`injection automatique réactivée par l'utilisateur : ${reactives.join(', ')}.`);
					await apresSuivi();
				}
				return ok({ coupures: await coupures() } satisfies ReponseInjectionAutomatique);
			},
		},
		{
			methode: 'POST',
			chemin: ROUTES.ecarteesToujours,
			corps: 'json',
			// « Ne plus jamais suggérer » : la fiche sort des candidates partout, jusqu'à son rétablissement
			action: async (r) => {
				const d = champs(await r.json(), { chemin: { requis: true, max: 4096 }, session: { requis: false, max: 100 } });
				const chemin = d.chemin!;
				// un réglage de la fiche, pas de la session : accepté aussi depuis une session terminée (le geste y est noté)
				const s = d.session === undefined ? null : await session(d.session);
				if (!(await dep.index.fiches()).some((f) => f.chemin === chemin)) throw new ErreurHttp(404, `Fiche inconnue : « ${chemin} ».`);
				const horodatageMs = Date.now();
				const resultat = await pil.etat.ecarterToujours({ fiche: chemin, session: s?.id ?? null, horodatageMs });
				if (resultat === 'ecartee' && s !== null) {
					await noterGeste(dep, pil.etat, { geste: 'ecartee_toujours', session: s.id, fiche: chemin, horodatageMs, vecteur: vecteurDuPorteur(porteurs.lire(s.id)) });
				}
				await apresGeste(true);
				return ecarteesToujours();
			},
		},
		{
			methode: 'DELETE',
			chemin: ROUTES.ecarteesToujours,
			action: async (r) => {
				const chemin = r.params.get('chemin');
				if (chemin === null || chemin === '') throw new ErreurHttp(400, 'Paramètre « chemin » : obligatoire.');
				const retiree = await pil.etat.retablirToujours(chemin, Date.now());
				if (retiree === null) throw new ErreurHttp(404, `Fiche non écartée toujours : « ${chemin} ».`);
				// le rétablissement annule l'écart dans la session où il a été fait (son vote négatif ne compte plus)
				const s = retiree.session === null ? null : await pil.etat.lire(retiree.session);
				if (s !== null) await noterGeste(dep, pil.etat, { geste: 'retablie', session: s.id, fiche: chemin, horodatageMs: Date.now(), vecteur: vecteurDuPorteur(porteurs.lire(s.id)) });
				await apresGeste(true);
				return ecarteesToujours();
			},
		},

		{
			methode: 'GET',
			chemin: ROUTES.fenetres,
			action: async () => ok({ fenetres: Object.fromEntries(fenetres) } satisfies ReponseFenetres),
		},
		{
			methode: 'GET',
			chemin: ROUTES.quotas,
			action: async () => ok(reponseQuotas()),
		},
		{
			methode: 'POST',
			chemin: ROUTES.quotas,
			corps: 'json',
			// relevé de `mnemo ligne-etat`, envoyé par chaque session : le plus récent vaut pour tout le compte
			action: async (r) => {
				const brut = await r.json();
				const recus = telemetrie()?.quotas(estObjet(brut) ? brut.rate_limits : undefined) ?? null;
				if (recus === null) throw new ErreurHttp(400, 'Aucune fenêtre de quota lisible.');
				noterQuotas(MOTEUR_PAR_DEFAUT, { ...recus, releveMs: Date.now() });
				return ok(reponseQuotas());
			},
		},
		{
			methode: 'GET',
			chemin: ROUTES.aServir,
			action: async (r) => {
				await session(r.id);
				return ok({ chemins: demandees.voir(r.id) } satisfies ReponseAServir);
			},
		},
		{
			methode: 'POST',
			chemin: ROUTES.aServir,
			corps: 'json',
			// « Injecter dans la session » : la fiche est injectée entière au prochain message de la session (jamais après un outil)
			action: async (r) => {
				const { chemin } = champs(await r.json(), { chemin: { requis: true, max: 4096 } });
				const s = await session(r.id);
				if (s.etat === 'terminee') throw new ErreurHttp(409, 'Session terminée : plus rien à injecter.');
				if (!(await dep.index.fiches()).some((f) => f.chemin === chemin)) throw new ErreurHttp(404, `Fiche inconnue : « ${chemin} ».`);
				return aServirDiffuses(s.id, demandees.demander(s.id, chemin!));
			},
		},
		{
			methode: 'DELETE',
			chemin: ROUTES.aServir,
			action: async (r) => {
				const chemin = r.params.get('chemin');
				if (chemin === null || chemin === '') throw new ErreurHttp(400, 'Paramètre « chemin » : obligatoire.');
				const s = await session(r.id);
				return aServirDiffuses(s.id, demandees.retirer(s.id, chemin));
			},
		},
		{
			methode: 'POST',
			chemin: ROUTES.hook,
			corps: 'json',
			action: async (r) => {
				const appelMs = Date.now();
				const brut = await r.json();
				const entree = entreeHook(brut);
				const echeance = echeanceDuHook(brut, entree.evenement);
				const transcription = transcriptionDuHook(brut);
				// un autre moteur que celui de la session, ou un autre fil : ni état, ni contexte, ni jauge ; un `outil` est tout de même vérifié
				const etranger = await estEtranger(pil, entree);
				if (etranger && entree.evenement !== 'outil') return ok({});
				// le reranker compté et mesuré par le service ; les modèles de la session bornés par son niveau (relu à chaque appel)
				const depMesure = avecRerankerMesure(dep);
				const depDuHook = entree.session === '' ? depMesure : dependancesDeSession(depMesure, pil.etat, entree.session);
				// le classement du message, à affiner après la réponse (noté par le hook, lancé après la diffusion de son entrée)
				const aAffiner: { demande: DemandeAffinage | null; controle: AbortController | null } = { demande: null, controle: null };
				// ce qui attend que la réponse soit écrite (gestes des fiches injectées par Mnemo)
				const aLaReponse: Array<() => Promise<unknown>> = [];
				// `fin` d'un moteur qui l'envoie sans quitter (Codex : `/new`, `/resume`) pendant que son processus tourne ici : ignoré,
				// la fin est traitée à la sortie du processus
				const finIgnoree = entree.evenement === 'fin' && pilote.enCours(entree.session) && pil.moteurs[entree.moteur ?? MOTEUR_PAR_DEFAUT]?.moteur.hooks.finIgnoreeSiVivante === true;
				const reponse = finIgnoree ? {} : await traiterEvenement(depDuHook, pil, entree, {
					froid: 'permis',
					...(echeance === undefined ? {} : { echeance }),
					...debutDuHook(entree.horodatageMs),
					appelMs,
					racine: ctx.racine,
					sansCasse: ctx.sansCasse,
					enFond: ctx.enFond,
					demandees,
					porteurs,
					apriori,
					...(ctx.suivi === undefined ? {} : { suivi: ctx.suivi }),
					aLaReponse: (tache) => aLaReponse.push(tache),
					...(ctx.dureeReranker === undefined ? {} : { dureeReranker: ctx.dureeReranker }),
					rattachee: (id) => pilote.reecrirePlugin(id),
					affiner: (d) => {
						aAffiner.demande = d;
						// un message porteur plus récent : l'affinage du précédent est caduc, coupé avant son prochain morceau
						affinages.get(d.session)?.abort();
						aAffiner.controle = new AbortController();
						affinages.set(d.session, aAffiner.controle);
					},
				});
				if (etranger) return ok(reponse);
				if (entree.session !== '') {
					const s = await pil.etat.lire(entree.session).catch(() => null);
					// un message (injection à la main) ou une lecture après une carte a pu noter un geste : l'a priori le relit, hors du chemin du hook
					if (entree.evenement === 'message' || entree.evenement === 'apres_outil') ctx.enFond(apresGeste());
					if (s !== null) {
						ctx.signaler(s);
						// les fiches demandées partent au message (jamais après un outil) : l'interface voit tout de suite ➤ s'éteindre et ◆ paraître
						if (entree.evenement === 'message') ctx.diffuser({ type: 'aServir', session: s.id, chemins: demandees.voir(s.id) });
						// après un outil, une fiche a pu être lue : le panneau Contexte l'apprend sans relire `servis`
						if (entree.evenement === 'apres_outil') {
							const lues = await luesDe(s.id).catch(() => null);
							const texte = JSON.stringify(lues);
							if (lues !== null && luesDiffusees.get(s.id) !== texte) {
								luesDiffusees.set(s.id, texte);
								ctx.diffuser({ type: 'lues', session: s.id, lues });
							}
						}
						// un message porteur est journalisé même sans contexte rendu (son classement) : diffusé aussi (le WebSocket ne rediffuse pas une entrée déjà connue)
						if (entree.evenement === 'message' || (reponse.contexte !== undefined && entree.evenement === 'debut')) {
							// après la réponse : le hook n'attend ni la relecture du journal ni les titres de l'index
							const { demande: demandeAffinage, controle } = aAffiner;
							ctx.enFond(
								(async () => {
									const [dernier] = await pil.etat.servis(s.id, 1);
									if (dernier !== undefined) ctx.diffuser({ type: 'servi', entree: vueServie(dernier, await titresDeLIndex()) });
									if (demandeAffinage !== null && controle !== null) await affinerLeMessage(s, demandeAffinage, controle);
								})().catch(() => {}),
							);
						}
					}
				}
				// après la réponse, hors du chemin du hook (ni sa réponse ni son échéance n'attendent la lecture), aux seuls événements
				// où le moteur écrit dans sa transcription ce qu'on y lit
				if (entree.session !== '' && (transcription !== undefined || entree.fil !== undefined) && telemetrie(entree.moteur)?.evenementsLus.has(entree.evenement) === true) {
					const source: SourceTranscription = { ...(transcription === undefined ? {} : { chemin: transcription }), ...(entree.fil === undefined ? {} : { fil: entree.fil }), dossier: entree.cwd };
					setImmediate(() => relireApresHook(entree.session, () => relireFenetre(entree.session, source, entree.moteur)));
				}
				if (aLaReponse.length === 0) return ok(reponse);
				// la réponse écrite : les gestes, puis le suivi qui les lit
				return {
					...ok(reponse),
					apres: () =>
						ctx.enFond(
							(async () => {
								for (const tache of aLaReponse) await tache().catch(() => {});
								// l'entrée du message porte maintenant ses fiches injectées par Mnemo : le panneau les voit (◆ auto)
								const [dernier] = await pil.etat.servis(entree.session, 1).catch(() => []);
								if (dernier !== undefined && dernier.horodatageMs === entree.horodatageMs) ctx.diffuser({ type: 'servi', entree: vueServie(dernier, await titresDeLIndex()) });
								await apresSuivi();
							})(),
						),
				};
			},
		},

		{
			methode: 'GET',
			chemin: ROUTES.memoireListe,
			action: async (r) => ok(await lister(dep, valide(validerArguments('lister', parametres(r.params, { dossier: 'dossier' }))).dossier ?? '')),
		},
		{
			methode: 'GET',
			chemin: ROUTES.memoireElement,
			action: async (r) => {
				const { id } = valide(validerArguments('lire', parametres(r.params, { id: 'id' })));
				const lu = await lireElement(dep, id);
				if (lu === null) throw new ErreurHttp(404, `${motifIntrouvable(id).replace(/^i/u, 'I')}`);
				return ok(lu);
			},
		},
		{
			methode: 'GET',
			chemin: ROUTES.documents,
			action: async (r) => {
				const { recents, aTraiter, total, totalATraiter } = await documentsDeLaMemoire(dep, demandeTout((cle) => r.params.get(cle)) ? SANS_BORNE : BORNES_DOCUMENTS);
				const { dossiers, avertissements } = await dossiersNonRattachesAvecAvertissements(dep, pil.etat);
				return ok({ documents: recents, aTraiter, totalDocuments: total, totalATraiter, dossiersNonRattaches: dossiers, avertissements } satisfies ReponseDocuments);
			},
		},
		{
			methode: 'POST',
			chemin: ROUTES.sourcesTraiter,
			corps: 'json',
			action: async (r) => repondreTraiter(await traiterLesFiches(archiviste, { chemins: cheminsDeSources(await r.json(), 'chemins', LOT) }), 'Aucune de ces fiches n’est à traiter.'),
		},
		{
			methode: 'POST',
			chemin: ROUTES.sourcesTraiterToutes,
			corps: 'json',
			action: async (r) => repondreTraiter(await traiterLesFiches(archiviste, { sauf: cheminsDeSources(await r.json(), 'sauf', { min: 0, max: SAUF_MAX }) }), 'Aucune fiche n’est à traiter hors de celles déjà confiées.'),
		},
		{
			methode: 'POST',
			chemin: ROUTES.dossiersTraiter,
			corps: 'json',
			action: async (r) => {
				const traites = await traiterLesDossiers(archiviste, dossiersDeProjet(await r.json()));
				if (traites === null) throw new ErreurHttp(409, 'Aucun de ces dossiers n’est à rattacher.');
				if ('refus' in traites.remise) throw refus(traites.remise);
				return ok({ chemins: traites.chemins, ...traites.remise } satisfies ReponseTraiter);
			},
		},
		{
			methode: 'POST',
			chemin: ROUTES.sourcesMarquerTraite,
			corps: 'json',
			// canal de l'utilisateur : retire la marque, rien d'autre ; tout le lot ou rien, en un commit
			action: async (r) => {
				const marquees = await marquerTraitees(dep, cheminsDeSources(await r.json(), 'chemins', LOT));
				journaliser(marquees);
				if (marquees.traites.length > 0) ctx.diffuser({ type: 'memoire', modifieeMs: Date.now() });
				return ok(marquees satisfies ReponseMarquerTraite);
			},
		},
		{
			methode: 'GET',
			chemin: ROUTES.recherche,
			// `rapide=1` : les mots seuls (premier temps de la palette) ; sinon sens et reranker s'ils tournent (jamais lancés
			// d'ici : geste de l'utilisateur), note par résultat. L'abandon (connexion fermée, ou recherche complète plus
			// récente de même clé de remplacement) saute les étapes restantes.
			action: async (r) => {
				const a = valide(validerParametresRecherche(r.params));
				const requete = valide(
					validerRequete(
						{
							texte: a.q,
							...(a.dossier ? { perimetre: a.dossier } : {}),
							...(a.limite === undefined ? {} : { limite: a.limite }),
							...(a.genre === undefined ? {} : a.genre === 'document' ? { typesFiche: ['source'] } : { typesFicheExclus: ['source'] }),
						},
						{ texte: 'q', perimetre: 'dossier', limite: 'limite' },
					),
				);
				const onglet = r.entete(ENTETE_REMPLACEMENT.toLowerCase());
				if (onglet !== null && !/^[\w:-]{1,100}$/u.test(onglet)) throw new ErreurHttp(400, `Refusé : en-tête « ${ENTETE_REMPLACEMENT} » invalide.`);
				const remplacable = onglet !== null && a.rapide !== true;
				const remplacee = new AbortController();
				if (remplacable) {
					recherchesEnCours.get(onglet)?.abort();
					recherchesEnCours.set(onglet, remplacee);
				}
				try {
					const { trouves, avis, notes } = await chercherAvecAvis(avecRerankerMesure(dep), requete, {
						rapide: a.rapide === true,
						demarrer: false,
						signal: AbortSignal.any([r.signal, remplacee.signal]),
					});
					return ok({ trouves: trouves.map((t) => ({ ...t, note: notes?.get(t.id) ?? null })), avis } satisfies ReponseRecherche);
				} catch (e) {
					if (remplacee.signal.aborted && !r.signal.aborted) throw new ErreurHttp(409, 'Recherche remplacée par une plus récente.');
					throw e;
				} finally {
					if (remplacable && recherchesEnCours.get(onglet) === remplacee) recherchesEnCours.delete(onglet);
				}
			},
		},
		{
			methode: 'GET',
			chemin: ROUTES.voisins,
			action: async (r) => {
				const { id } = valide(validerArguments('voisins', parametres(r.params, { id: 'id' })));
				const v = await voisins(dep, id);
				if (v === null) throw new ErreurHttp(404, `Fiche introuvable : « ${id} ».`);
				return ok(v);
			},
		},
		{
			methode: 'POST',
			chemin: ROUTES.proposer,
			corps: 'json',
			// canal de l'utilisateur : la source `utilisateur` y est crue (un niveau est appliqué, pas seulement proposé)
			action: async (r) => ecriture(await proposer(dep, valide(validerDemande(await r.json())), { appliquerDirectement: true })),
		},
		{
			methode: 'POST',
			chemin: ROUTES.deplacer,
			corps: 'json',
			action: async (r) => {
				const { id, dossier, nom } = valide(validerArguments('deplacer', await r.json()));
				return ecriture(await deplacer(dep, id, destinationDuDeplacement(id, dossier, nom)));
			},
		},
		{
			methode: 'GET',
			chemin: ROUTES.fil,
			action: async (r) => {
				const jour = r.params.get('jour');
				if (jour !== null && !/^\d{4}-\d{2}-\d{2}$/u.test(jour)) throw new ErreurHttp(400, `Date invalide : « ${jour} » (attendu AAAA-MM-JJ).`);
				try {
					return ok((jour === null ? await filDuJour(dep) : await filDuJour(dep, jour)) satisfies FilVue);
				} catch (erreur) {
					if (erreur instanceof Error && /^Date invalide/u.test(erreur.message)) throw new ErreurHttp(400, erreur.message);
					throw erreur;
				}
			},
		},

		{ methode: 'GET', chemin: ROUTES.graphe, action: async () => ok(await vueGraphe(dep)) },
		{
			methode: 'GET',
			chemin: ROUTES.fiche,
			action: async (r) => {
				const brut = r.params.get('chemin');
				if (brut === null || brut === '') throw new ErreurHttp(400, 'Paramètre « chemin » : chemin de la fiche, relatif à la mémoire.');
				const chemin = cheminDeVue(brut);
				if (chemin === null) throw new ErreurHttp(400, `Chemin de fiche invalide : « ${brut} ».`);
				const fiche = await vueFiche(dep, pil.etat, chemin, demandeTout((cle) => r.params.get(cle)));
				if (fiche === null) throw new ErreurHttp(404, `Fiche introuvable : « ${chemin} ».`);
				return ok(fiche);
			},
		},
		{
			methode: 'POST',
			chemin: ROUTES.brut,
			corps: 'json',
			// canal de l'utilisateur seulement : ni le schéma MCP ni `validerDemande` ne connaissent ce genre
			action: async (r) => {
				const d = champs(await r.json(), { chemin: { requis: true, max: 4096 }, texte: { requis: true, max: CORPS_MAX }, empreinte: { requis: true, max: 100 } });
				return ecriture(await ecrireBrut(dep, { genre: 'brut', chemin: d.chemin!, texte: d.texte!, empreinte: d.empreinte! }));
			},
		},
		{
			methode: 'GET',
			chemin: ROUTES.dossiers,
			action: async (r) => {
				const contexte = { racine: ctx.dossiers, marqueurs: dep.reglages().projets.marqueurs, sessions: await pil.etat.lister() };
				try {
					return ok((await niveauDossiers(contexte, r.params.get('chemin') ?? '')) satisfies NiveauDossiersVue);
				} catch (erreur) {
					throw erreurDeDossier(erreur);
				}
			},
		},
		{
			methode: 'GET',
			chemin: ROUTES.dossierGit,
			action: async (r) => {
				const brut = r.params.get('chemin');
				if (brut === null) throw new ErreurHttp(400, 'Paramètre « chemin » : dossier relatif à la racine du dossier Mnemo.');
				let dossier: string;
				try {
					dossier = dossierAccepte(brut);
				} catch (erreur) {
					throw erreurDeDossier(erreur);
				}
				if ((await pil.hote.dossier(dossier)) === null) throw new ErreurHttp(404, `Dossier introuvable : « ${dossier} ».`);
				try {
					return ok(await ctx.etatGit(dossier, demandeTout((cle) => r.params.get(cle))));
				} catch (erreur) {
					throw new ErreurHttp(503, `État git illisible : ${erreur instanceof Error ? erreur.message : String(erreur)}`);
				}
			},
		},

		{
			methode: 'GET',
			chemin: ROUTES.depotVerifier,
			// avant l'envoi, sans corps : un refus (chemin, fichier déjà là, trop gros, disque trop petit) arrive toujours intact
			action: async (r) => {
				const chemin = cheminDuDepot(r.params.get('vers'));
				const brute = r.params.get('taille');
				const taille = brute === null ? null : Number(brute);
				if (taille !== null && (!Number.isSafeInteger(taille) || taille < 0)) throw new ErreurHttp(400, 'Paramètre « taille » : nombre d\'octets attendu.');
				if (taille !== null && taille > ctx.depotMax) throw new ErreurHttp(413, tropVolumineux(chemin, ctx.depotMax));
				let resultat: 'libre' | 'existe';
				try {
					resultat = await verifierDepot(ctx.racine, chemin, taille);
				} catch (erreur) {
					throw erreurDeDepot(erreur, false);
				}
				if (resultat === 'existe') throw new ErreurHttp(409, depotExistant(chemin));
				return ok({ chemin });
			},
		},
		{
			methode: 'POST',
			chemin: ROUTES.depot,
			corps: 'flux',
			action: async (r) => {
				const chemin = cheminDuDepot(r.params.get('vers'));
				const annonce = Number(r.entete('content-length'));
				let resultat: { empreinte: string } | 'existe';
				try {
					resultat = await deposerFichier(ctx.racine, chemin, r.flux(), ctx.depotMax, { annonce: Number.isSafeInteger(annonce) ? annonce : null });
				} catch (erreur) {
					// refus en cours d'envoi : le reste du corps n'est pas lu, la connexion est fermée après la réponse
					throw erreurDeDepot(erreur, true);
				}
				if (resultat === 'existe') throw new ErreurHttp(409, depotExistant(chemin));
				let reference: Awaited<ReturnType<typeof referencerDepot>>;
				try {
					reference = await referencerDepot(dep, { chemin, empreinte: resultat.empreinte });
				} catch (erreur) {
					throw new ErreurHttp(500, `Fichier déposé (« ${chemin} »), mais sa fiche source n'a pas pu être écrite : ${messageDErreur(erreur)}`);
				}
				ctx.diffuser({ type: 'memoire', modifieeMs: Date.now() });
				journaliser(reference);
				return ok({ chemin, ...avertissementsDe(reference) } satisfies ReponseDepot, 201);
			},
		},
		{
			methode: 'POST',
			chemin: ROUTES.depotTraiter,
			corps: 'json',
			action: async (r) => {
				const documents = listeDeChemins(await r.json(), 'chemins', LOT, 'documents', (c) => {
					const r = cheminDeLaRacine(c);
					if (!r.ok || r.chemin === '') throw new ErreurHttp(400, `Chemin refusé : « ${nomAffichable(c)} » (document relatif à la racine du dossier Mnemo${r.ok ? '' : ` : ${r.motif}`}).`);
					return r.chemin;
				});
				return ok((await confierLesDepots(archiviste, documents)) satisfies ReponseDepotTraiter);
			},
		},
		{
			methode: 'POST',
			chemin: ROUTES.amorce,
			corps: 'json',
			// lecture seule de la configuration de Claude Code ; les fichiers nouveaux ou modifiés vont à l'archiviste qui tourne
			// une seule consigne, rejouable (elle désigne le marqueur « à traiter »), tapée en fond : la réponse ne l'attend pas
			action: async () => {
				// deux clics rapprochés : le second attend la fin du premier (puis ne trouve plus rien à écrire)
				const tour = imports.then(() => amorcer(dep, ctx.memoireClaude, ctx.projetsClaude));
				imports = tour.catch(() => undefined);
				const bilan = await tour;
				if (bilan.commit !== null) ctx.diffuser({ type: 'memoire', modifieeMs: Date.now() });
				journaliserAvertissements(bilan, (a) => ctx.journal(`amorce : ${a}`));
				const remise = await confierLesFichesATraiter(archiviste, 'amorce');
				return ok(vueBilanAmorce(bilan, remise.fiches.length, remise.archiviste) satisfies BilanAmorceVue);
			},
		},
	];
}

/** Route d'une méthode et d'un chemin (motif `:id` : un segment, décodé) : la route et l'id, ou null. */
export function trouverRoute(liste: Route[], methode: string, chemin: string): { route: Route; id: string } | null {
	for (const route of liste) {
		if (route.methode !== methode) continue;
		const [avant, apres] = route.chemin.split(':id') as [string, string | undefined];
		if (apres === undefined) {
			if (chemin === avant) return { route, id: '' };
			continue;
		}
		if (!chemin.startsWith(avant) || !chemin.endsWith(apres)) continue;
		const id = chemin.slice(avant.length, chemin.length - apres.length);
		if (id === '' || id.includes('/')) continue;
		try {
			return { route, id: decodeURIComponent(id) };
		} catch {
			// encodage invalide : aucune session ne porte cet id
		}
	}
	return null;
}

export type { Route };
