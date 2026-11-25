/**
 * Un hook par ressource du service : seuls ces hooks appellent l'`Api`. Les sessions sont tenues par les messages
 * `sessions` / `session` du WebSocket (une seule lecture initiale, aucune requête périodique).
 */
import { PARAMETRES_TOUT } from '@mnemo/commun';
import type { NiveauModeles } from '@mnemo/commun';
import {
	ROUTES,
	type EcarteVue,
	type EcarteeToujoursVue,
	type FenetreVue,
	type InjectionVue,
	type ReponseEcarteesToujours,
	type ReponseInjectionAutomatique,
	type ReponseAServir,
	type ReponseFenetres,
	type QuotasDesMoteursVue,
	type QuotasVue,
	type ReponseQuotas,
	type EntreeServieVue,
	type LueVue,
	type EtatModelesVue,
	type ReponseArretModeles,
	type ReponseNiveauModeles,
	type SessionVue,
	type DonneesGraphe,
	type NiveauDossiersVue,
	type FicheVue,
	type FilVue,
	type GitDossierVue,
	type LotVue,
	type ReponseLots,
	type ReponseMoteurs,
	type ReponseDocuments,
	type ApercuProfilVue,
	type ClaudeDesktopVue,
	type ProfilDetailVue,
	type ReponseProfils,
	type ReglagesVue,
	type ReponseRecherche,
	type SanteVue,
	type SessionTermineeVue,
	type TrouveVue,
} from '@mnemo/contrat';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { Niveau } from '../dossiers/arbre.ts';
import { estAbandon } from './api.ts';
import type { Client } from './contexte.tsx';
import { useCacheRessources, useClient } from './contexte.tsx';
import { useRessource, type Ressource } from './ressources.ts';

export const ATTENTE_RECHERCHE_MS = 200;

/** Chemin d'une route à `:id` (session), l'identifiant encodé. */
export const avecId = (route: string, id: string): string => route.replace(':id', encodeURIComponent(id));

export function useSante(): Ressource<SanteVue> {
	const { api } = useClient();
	return useRessource('sante', () => api.lire<SanteVue>(ROUTES.sante));
}

/** Nom affiché de la racine du dossier Mnemo : le dernier segment de son chemin, rendu avec le séparateur du poste (`\\` sous Windows). */
export function nomDeRacine(racine: string): string {
	return racine.split(/[\\/]/u).filter(Boolean).pop() ?? 'racine';
}

export function useNomRacine(): string {
	return nomDeRacine(useSante().donnees?.racine ?? '');
}

/** Réglages du dossier (`.mnemo/reglages.json`), lus à l'ouverture de la vue Réglages. */
export function useReglages(): Ressource<ReglagesVue> {
	const { api } = useClient();
	return useRessource('reglages', () => api.lire<ReglagesVue>(ROUTES.reglages));
}

/** Configuration de l'app Claude (Claude Desktop), lue à l'ouverture de Réglages › App Claude ; jamais de valeur de variable. */
export function useClaudeDesktop(): Ressource<ClaudeDesktopVue> {
	const { api } = useClient();
	return useRessource('claude-desktop', () => api.lire<ClaudeDesktopVue>(ROUTES.claudeDesktop));
}

/**
 * Moteurs du service (agents de code) : trouvés ou non, version, modèles proposés ; `poste` : avec l'état du poste
 * (déclaration MCP, hooks), plus lent, pour Réglages › Système.
 */
export function useMoteurs(poste = false): Ressource<ReponseMoteurs> {
	const { api } = useClient();
	return useRessource(poste ? 'moteurs:poste' : 'moteurs', () => api.lire<ReponseMoteurs>(ROUTES.moteurs, poste ? { poste: '1' } : undefined));
}

/** Profils de session qui peuvent être lancés ; relus quand la mémoire change (un profil ajouté sous `profils/`). */
export function useProfils(): Ressource<ReponseProfils> {
	const { api } = useClient();
	return useRessource(ROUTES.profils, () => api.lire<ReponseProfils>(ROUTES.profils), { memoire: true });
}

/** Détail éditable d'un profil (Réglages › Profils) ; relu quand la mémoire change. `nom` null : rien à lire. */
export function useProfil(nom: string | null): Ressource<ProfilDetailVue> {
	const { api } = useClient();
	return useRessource(nom === null ? null : `profil:${nom}`, () => api.lire<ProfilDetailVue>(avecId(ROUTES.profil, nom!)), { memoire: true });
}

/** Aperçu de ce que reçoit une session du profil `nom` ; relu quand la mémoire change. */
export function useApercuProfil(nom: string | null): Ressource<ApercuProfilVue> {
	const { api } = useClient();
	return useRessource(nom === null ? null : `apercu:${nom}`, () => api.lire<ApercuProfilVue>(avecId(ROUTES.profilApercu, nom!)), { memoire: true });
}

// --- Sessions : un magasin par client, alimenté par le WebSocket ---

/** `recue` : la liste a été reçue (message du WebSocket ou lecture initiale) ; avant, `lire` rend une liste vide d'attente. */
type MagasinSessions = { lire(): SessionVue[]; recue(): boolean; ecouter(f: () => void): () => void };
const magasins = new WeakMap<Client, MagasinSessions>();

function magasinSessions(client: Client): MagasinSessions {
	const existant = magasins.get(client);
	if (existant) return existant;
	let sessions: SessionVue[] = [];
	let recuParMessage = false;
	let recue = false;
	const ecouteurs = new Set<() => void>();
	const publier = (s: SessionVue[]) => {
		sessions = s;
		recue = true;
		for (const f of [...ecouteurs]) f();
	};
	client.connexion.surMessage((m) => {
		if (m.type === 'sessions') {
			recuParMessage = true;
			publier(m.sessions);
		} else if (m.type === 'session') {
			recuParMessage = true;
			const i = sessions.findIndex((s) => s.id === m.session.id);
			publier(i < 0 ? [...sessions, m.session] : sessions.map((s, j) => (j === i ? m.session : s)));
		}
	});
	// Lecture initiale : le message `sessions` de l'ouverture a pu arriver avant ce magasin.
	client.api.lire<{ sessions: SessionVue[] }>(ROUTES.sessions).then(
		(r) => {
			if (!recuParMessage && Array.isArray(r?.sessions)) publier(r.sessions);
		},
		() => {},
	);
	const magasin: MagasinSessions = {
		lire: () => sessions,
		recue: () => recue,
		ecouter(f) {
			ecouteurs.add(f);
			return () => void ecouteurs.delete(f);
		},
	};
	magasins.set(client, magasin);
	return magasin;
}

export function useSessions(): SessionVue[] {
	const magasin = magasinSessions(useClient());
	return useSyncExternalStore(magasin.ecouter, magasin.lire, magasin.lire);
}

/** Vrai dès que la liste des sessions a été reçue : une session absente l'est alors vraiment, pas seulement en attente. */
export function useSessionsRecues(): boolean {
	const magasin = magasinSessions(useClient());
	return useSyncExternalStore(magasin.ecouter, magasin.recue, magasin.recue);
}

/**
 * Sessions terminées (historique) : une ressource partagée par toutes les vues qui la lisent (`useRessource` : une lecture
 * pour toutes), relue quand une session vue vivante se termine (message `session`) ; `recharger` après un retrait.
 */
export function useHistorique(): Ressource<SessionTermineeVue[]> {
	const { api } = useClient();
	const sessions = useSessions();
	const base = useRessource('historique', async () => (await api.lire<{ sessions: SessionTermineeVue[] }>(ROUTES.historique)).sessions);
	const { recharger } = base;
	const etats = useRef(new Map<string, SessionVue['etat']>());
	useEffect(() => {
		let fin = false;
		for (const x of sessions) {
			const avant = etats.current.get(x.id);
			if (x.etat === 'terminee' && avant !== undefined && avant !== 'terminee') fin = true;
			etats.current.set(x.id, x.etat);
		}
		if (fin) recharger();
	}, [sessions, recharger]);
	return base;
}

/** Sessions vivantes, puis les terminées de l'historique qui n'y sont plus : pour nommer la session d'un commit ancien. */
export function useSessionsConnues(): SessionVue[] {
	const vivantes = useSessions();
	const historique = useHistorique().donnees;
	return useMemo(() => {
		const ids = new Set(vivantes.map((x) => x.id));
		return [...vivantes, ...(historique ?? []).filter((x) => !ids.has(x.id))];
	}, [vivantes, historique]);
}

/**
 * Clé d'une entrée servie : un message `servi` déjà présent dans la liste du service n'est pas doublé ; rediffusée (classement
 * noté en fond), elle remplace la précédente.
 */
const cleServie = (e: EntreeServieVue) => `${e.horodatageMs}|${e.ids.join(',')}`;
const RECUES_MAX = 200;

/** La liste, l'entrée de même clé remplacée par `e`, ou `e` en tête ; null si elle y est déjà telle quelle. */
function avecEntree(liste: readonly EntreeServieVue[], e: EntreeServieVue, cle: (e: EntreeServieVue) => string): EntreeServieVue[] | null {
	const i = liste.findIndex((x) => cle(x) === cle(e));
	if (i < 0) return [e, ...liste].slice(0, RECUES_MAX);
	if (liste[i] === e || JSON.stringify(liste[i]) === JSON.stringify(e)) return null;
	return liste.map((x, j) => (j === i ? e : x));
}

/**
 * Entrées servies à une session : la liste du service, plus les messages `servi` reçus depuis l'ouverture (plus récents
 * d'abord), sans doublon ; une entrée reçue remplace celle du service de même clé. Les messages sont gardés à travers les
 * rechargements : un `servi` arrivé pendant une lecture n'est pas perdu. Les fiches lues suivent les messages `lues`.
 */
export function useServis(id: string | null): Ressource<EntreeServieVue[]> & { lues: LueVue[]; injections: InjectionVue[] } {
	const client = useClient();
	const brut = useRessource(id === null ? null : `servis:${id}`, async () => {
		const r = await client.api.lire<{ servis: EntreeServieVue[]; lues?: (LueVue | string)[]; injections?: InjectionVue[] }>(avecId(ROUTES.servis, id ?? ''));
		// un service plus ancien envoie des chemins seuls : sans heure, la lue se place en dernier ; ni injections
		return { servis: r.servis, lues: (r.lues ?? []).map((l) => (typeof l === 'string' ? { chemin: l, horodatageMs: 0 } : l)), injections: r.injections ?? [] };
	});
	const base = { ...brut, donnees: brut.donnees?.servis };
	const [recues, setRecues] = useState<{ pour: string | null; entrees: EntreeServieVue[] }>({ pour: id, entrees: [] });
	// fiches lues reçues par `lues` (après un outil) : la liste entière, plus récente que celle de la route
	const [luesRecues, setLuesRecues] = useState<{ pour: string | null; lues: LueVue[] } | null>(null);
	useEffect(() => {
		setRecues({ pour: id, entrees: [] });
		setLuesRecues(null);
		if (id === null) return;
		return client.connexion.surMessage((m) => {
			if (m.type === 'lues' && m.session === id) setLuesRecues({ pour: id, lues: m.lues });
			if (m.type !== 'servi' || m.entree.session !== id) return;
			setRecues((r) => {
				const entrees = r.pour === id ? r.entrees : [];
				const suivantes = avecEntree(entrees, m.entree, cleServie);
				return suivantes === null ? r : { pour: id, entrees: suivantes };
			});
		});
	}, [client, id]);
	const recuesIci = recues.pour === id ? recues.entrees : [];
	const parCle = new Map(recuesIci.map((e) => [cleServie(e), e]));
	const connues = new Set((base.donnees ?? []).map(cleServie));
	const enPlus = recuesIci.filter((e) => !connues.has(cleServie(e)));
	const duService = (base.donnees ?? []).map((e) => parCle.get(cleServie(e)) ?? e);
	const donnees = base.donnees === undefined && enPlus.length === 0 ? undefined : [...enPlus, ...duService];
	const lues = luesRecues !== null && luesRecues.pour === id ? luesRecues.lues : (brut.donnees?.lues ?? []);
	return { ...base, donnees, lues, injections: brut.donnees?.injections ?? [] };
}

export type EcarteesToujours = {
	/** Fiches que Mnemo ne suggère plus jamais (« Ne plus jamais suggérer »), les plus anciennes d'abord. */
	liste: EcarteeToujoursVue[];
	/** Écarte la fiche toujours ; `session` : celle du geste (rejeté en `ErreurApi`). */
	ecarter(chemin: string, session?: string): Promise<void>;
	/** La rétablit : Mnemo peut de nouveau la suggérer (rejeté en `ErreurApi`). */
	retablir(chemin: string): Promise<void>;
};

/** Fiches écartées toujours : lues au service, partagées par le panneau Contexte et la page Mémoire, relues après chaque geste. */
export function useEcarteesToujours(): EcarteesToujours {
	const { api } = useClient();
	const base = useRessource('ecartees-toujours', async () => (await api.lire<ReponseEcarteesToujours>(ROUTES.ecarteesToujours)).ecarteesToujours);
	const { recharger } = base;
	return {
		liste: base.donnees ?? [],
		ecarter: useCallback(
			async (chemin: string, session?: string) => {
				await api.envoyer<ReponseEcarteesToujours>(ROUTES.ecarteesToujours, { chemin, ...(session === undefined ? {} : { session }) });
				recharger();
			},
			[api, recharger],
		),
		retablir: useCallback(
			async (chemin: string) => {
				await api.supprimer<ReponseEcarteesToujours>(ROUTES.ecarteesToujours, { chemin });
				recharger();
			},
			[api, recharger],
		),
	};
}

/** Réactive l'injection automatique coupée par le suivi (geste noté dans `session`) ; la vue des sessions est rediffusée. */
export function useReactiverInjection(): (session: string) => Promise<ReponseInjectionAutomatique> {
	const { api } = useClient();
	return useCallback((session: string) => api.envoyer<ReponseInjectionAutomatique>(ROUTES.injectionAutomatique, { session }), [api]);
}

/**
 * Entrées servies à toutes les sessions, reçues par les messages `servi` depuis le montage (plus récentes d'abord, 200 au
 * plus) : ce que l'archiviste a fourni (tiroir de l'archiviste).
 */
export function useServisRecus(): EntreeServieVue[] {
	const { connexion } = useClient();
	const [recues, setRecues] = useState<EntreeServieVue[]>([]);
	useEffect(
		() =>
			connexion.surMessage((m) => {
				if (m.type !== 'servi') return;
				setRecues((r) => avecEntree(r, m.entree, (e) => `${e.session}|${cleServie(e)}`) ?? r);
			}),
		[connexion],
	);
	return recues;
}

export type Ecartes = {
	ecartes: EcarteVue[];
	/** « Ne plus suggérer » : l'élément est écarté des prochains calculs de la session (rejeté en `ErreurApi`). */
	ecarter(id: string): Promise<void>;
	retablir(id: string): Promise<void>;
};

/**
 * Écartés d'une session : lus au service, puis tenus par la réponse des gestes et par les messages `ecartes` (autre fenêtre),
 * gardés par session tant que le composant vit.
 */
export function useEcartes(session: string): Ecartes {
	const { api, connexion } = useClient();
	const route = avecId(ROUTES.ecartes, session);
	const base = useRessource(`ecartes:${session}`, async () => (await api.lire<{ ecartes: EcarteVue[] }>(route)).ecartes);
	const [recus, setRecus] = useState<ReadonlyMap<string, EcarteVue[]>>(() => new Map());
	const noter = useCallback((id: string, ecartes: EcarteVue[]) => setRecus((r) => new Map(r).set(id, ecartes)), []);
	useEffect(() => connexion.surMessage((m) => m.type === 'ecartes' && noter(m.session, m.ecartes)), [connexion, noter]);
	return {
		ecartes: recus.get(session) ?? base.donnees ?? [],
		async ecarter(id) {
			noter(session, (await api.envoyer<{ ecartes: EcarteVue[] }>(route, { id })).ecartes);
		},
		async retablir(id) {
			noter(session, (await api.supprimer<{ ecartes: EcarteVue[] }>(route, { id })).ecartes);
		},
	};
}

export type AServir = {
	/** Fiches demandées à injecter, en attente du prochain message de la session. */
	chemins: string[];
	/** « Injecter dans la session » : la fiche est injectée entière au prochain message de la session (rejeté en `ErreurApi`). */
	servir(chemin: string): Promise<void>;
	annuler(chemin: string): Promise<void>;
};

/** Fiches demandées à servir à une session : lues au service, puis tenues par la réponse des gestes et par les messages `aServir`. */
export function useAServir(session: string): AServir {
	const { api, connexion } = useClient();
	const route = avecId(ROUTES.aServir, session);
	const base = useRessource(`aServir:${session}`, async () => (await api.lire<ReponseAServir>(route)).chemins);
	const [recus, setRecus] = useState<ReadonlyMap<string, string[]>>(() => new Map());
	const noter = useCallback((id: string, chemins: string[]) => setRecus((r) => new Map(r).set(id, chemins)), []);
	useEffect(() => connexion.surMessage((m) => m.type === 'aServir' && noter(m.session, m.chemins)), [connexion, noter]);
	return {
		chemins: recus.get(session) ?? base.donnees ?? [],
		async servir(chemin) {
			noter(session, (await api.envoyer<ReponseAServir>(route, { chemin })).chemins);
		},
		async annuler(chemin) {
			noter(session, (await api.supprimer<ReponseAServir>(route, { chemin })).chemins);
		},
	};
}

const AUCUN_QUOTA: QuotasDesMoteursVue = {};

/**
 * Quotas de l'abonnement de chaque moteur (communs à toutes ses sessions) : lus au service, puis tenus par les messages
 * `quotasMoteurs` ; vide tant qu'aucun n'est relevé. Un service sans `moteurs` ni `quotasMoteurs` : ceux de Claude Code seuls
 * (`quotas`, réponse et message).
 */
export function useQuotas(): QuotasDesMoteursVue {
	const { api, connexion } = useClient();
	const base = useRessource('quotas', () => api.lire<ReponseQuotas>(ROUTES.quotas));
	const [recus, setRecus] = useState<QuotasDesMoteursVue | null>(null);
	// `quotas` (Claude Code) d'un service qui n'envoie pas `quotasMoteurs` : rangé sous Claude Code, tant qu'aucun `quotasMoteurs` n'est reçu
	const [claudeSeul, setClaudeSeul] = useState<QuotasVue | null>(null);
	useEffect(
		() =>
			connexion.surMessage((m) => {
				if (m.type === 'quotasMoteurs') setRecus(m.moteurs);
				else if (m.type === 'quotas') setClaudeSeul(m.quotas);
			}),
		[connexion],
	);
	const lue = base.donnees;
	const duService = useMemo(() => {
		const moteurs = lue === undefined ? AUCUN_QUOTA : (lue.moteurs ?? (lue.quotas === null ? AUCUN_QUOTA : { 'claude-code': lue.quotas }));
		return claudeSeul === null ? moteurs : { ...moteurs, 'claude-code': claudeSeul };
	}, [lue, claudeSeul]);
	return recus ?? duService;
}

/**
 * Fenêtre de contexte de Claude Code d'une session : lue au service (toutes les sessions, une requête partagée), puis tenue
 * par les messages `fenetre` ; null tant qu'aucune réponse de l'agent n'a été vue.
 */
export function useFenetre(session: string): FenetreVue | null {
	const { api, connexion } = useClient();
	const base = useRessource('fenetres', () => api.lire<ReponseFenetres>(ROUTES.fenetres));
	const [recue, setRecue] = useState<FenetreVue | null>(null);
	useEffect(() => {
		setRecue(null);
		return connexion.surMessage((m) => {
			if (m.type === 'fenetre' && m.session === session) setRecue(m.fenetre);
		});
	}, [connexion, session]);
	return recue ?? base.donnees?.fenetres[session] ?? null;
}

/**
 * État des modèles locaux de la machine, lu seulement quand `utile`, puis tenu par les messages `modeles` (et par la réponse
 * d'un geste) ; `demarrer` (geste de l'utilisateur : le service n'attend pas leur chargement), `arreter`, `changerNiveau`
 * (celui de la machine).
 */
export function useModeles(utile: boolean): {
	etat: EtatModelesVue | undefined;
	demarrer(): Promise<void>;
	arreter(): Promise<ReponseArretModeles['arret']>;
	/** Rend l'arrêt qu'a causé un modèle retiré (null : aucun). */
	changerNiveau(niveau: NiveauModeles): Promise<ReponseNiveauModeles['arret']>;
} {
	const { api, connexion } = useClient();
	const base = useRessource(utile ? 'modeles' : null, () => api.lire<EtatModelesVue>(ROUTES.modeles));
	const [recu, setRecu] = useState<EtatModelesVue | null>(null);
	/** Diffusions reçues : la réponse d'un geste arrivée après une diffusion plus récente n'est pas appliquée. */
	const diffusions = useRef(0);
	// écoute même quand l'état n'est pas utile : un état reçu (à l'accueil, après une reconnexion compris) reste le plus récent
	useEffect(
		() =>
			connexion.surMessage((m) => {
				if (m.type !== 'modeles') return;
				diffusions.current++;
				setRecu(m.modeles);
			}),
		[connexion],
	);
	const geste = async <T extends EtatModelesVue>(envoi: () => Promise<T>): Promise<T> => {
		const avant = diffusions.current;
		const r = await envoi();
		if (diffusions.current === avant) setRecu(r);
		return r;
	};
	return {
		etat: recu ?? base.donnees,
		async demarrer() {
			await geste(() => api.envoyer<EtatModelesVue>(ROUTES.modelesDemarrer, undefined));
		},
		async arreter() {
			return (await geste(() => api.envoyer<ReponseArretModeles>(ROUTES.modelesArreter, undefined))).arret;
		},
		async changerNiveau(niveau) {
			return (await geste(() => api.remplacer<ReponseNiveauModeles>(ROUTES.modelesNiveau, { niveau }))).arret;
		},
	};
}

/**
 * Niveau des modèles propre à une session (null : suivre celui de la machine) ; la session à jour revient par le message
 * `session`.
 */
export function useNiveauModelesSession(): (session: string, niveau: NiveauModeles | null) => Promise<void> {
	const { api } = useClient();
	return useCallback(
		async (session, niveau) => {
			await api.remplacer<{ session: SessionVue }>(avecId(ROUTES.sessionModeles, session), { niveau });
		},
		[api],
	);
}

/**
 * Niveaux de l'arbre des dossiers : `suivre` reçoit les niveaux visibles ; chacun est relu quand il le devient (montage,
 * dépliage, nouvel essai après un échec), l'ancienne lecture restant affichée en attendant.
 */
export function useNiveauxDossiers(): { niveaux: ReadonlyMap<string, Niveau>; suivre(chemins: readonly string[]): void } {
	const { api } = useClient();
	const cache = useCacheRessources();
	const [niveaux, setNiveaux] = useState<ReadonlyMap<string, Niveau>>(() => new Map());
	const visibles = useRef(new Set<string>());
	const suivre = useCallback(
		(chemins: readonly string[]) => {
			const poser = (chemin: string, niveau: Niveau) => setNiveaux((n) => new Map(n).set(chemin, niveau));
			const avant = visibles.current;
			visibles.current = new Set(chemins);
			for (const chemin of chemins) {
				if (avant.has(chemin)) continue;
				const cle = `dossiers:${chemin}`;
				const garde = cache.get(cle) as NiveauDossiersVue | undefined;
				if (garde !== undefined) setNiveaux((n) => (n.has(chemin) ? n : new Map(n).set(chemin, garde)));
				api.lire<NiveauDossiersVue>(ROUTES.dossiers, { chemin }).then(
					(niveau) => {
						cache.set(cle, niveau);
						poser(chemin, niveau);
					},
					(erreur: unknown) => {
						if (!estAbandon(erreur)) poser(chemin, { erreur: erreur instanceof Error ? erreur.message : String(erreur) });
					},
				);
			}
		},
		[api, cache],
	);
	return { niveaux, suivre };
}

/** État git du dossier `chemin` ; `tout` : tous ses fichiers modifiés (`PARAMETRES_TOUT`), une lecture à part. */
export function useGitDossier(chemin: string | null, tout = false): Ressource<GitDossierVue> {
	const { api } = useClient();
	const params = { chemin: chemin ?? '', ...(tout ? PARAMETRES_TOUT : {}) };
	return useRessource(chemin === null ? null : `git:${JSON.stringify(params)}`, () => api.lire<GitDossierVue>(ROUTES.dossierGit, params));
}

export function useGraphe(): Ressource<DonneesGraphe> {
	const { api } = useClient();
	return useRessource('graphe', () => api.lire<DonneesGraphe>(ROUTES.graphe), { memoire: true });
}

/** La fiche `chemin` ; `toutesLesSessions` : sans la borne `SESSIONS_DE_FICHE_MAX` (une autre lecture, gardée à part). */
export function useFiche(chemin: string | null, toutesLesSessions: boolean): Ressource<FicheVue> {
	const { api } = useClient();
	const params = toutesLesSessions ? PARAMETRES_TOUT : {};
	return useRessource(chemin === null ? null : `fiche:${chemin}${toutesLesSessions ? ':tout' : ''}`, () => api.lire<FicheVue>(ROUTES.fiche, { chemin: chemin ?? '', ...params }), { memoire: true });
}

/**
 * Documents référencés dans la mémoire, récents et « à traiter » (Mémoire › Archiviste), relus quand la mémoire change ;
 * `tout` : listes entières, sans les bornes du service.
 */
export function useDocuments(tout: boolean): Ressource<ReponseDocuments> {
	const { api } = useClient();
	const lire = () => (tout ? api.lire<ReponseDocuments>(ROUTES.documents, { ...PARAMETRES_TOUT }) : api.lire<ReponseDocuments>(ROUTES.documents));
	return useRessource(tout ? 'documents:tout' : 'documents', lire, { memoire: true });
}

/**
 * Lots d'informations proposés par l'archiviste, en attente de l'utilisateur (« À arbitrer ») : relus quand la mémoire
 * change (un lot peut devenir périmé) et à chaque message `lots` (proposé, validé, rejeté, écarté).
 */
export function useLots(): Ressource<LotVue[]> {
	const { api, connexion } = useClient();
	const base = useRessource('lots', async () => (await api.lire<ReponseLots>(ROUTES.lots)).lots, { memoire: true });
	const { recharger } = base;
	useEffect(() => connexion.surMessage((m) => m.type === 'lots' && recharger()), [connexion, recharger]);
	return base;
}

/** `jour` au format AAAA-MM-JJ. */
export function useFil(jour: string): Ressource<FilVue> {
	const { api } = useClient();
	return useRessource(`fil:${jour}`, () => api.lire<FilVue>(ROUTES.fil, { jour }), { memoire: true });
}

/**
 * Recherche dans la mémoire, lancée `attenteMs` (200 ms par défaut) après la dernière frappe ; requête vide → rien. Le
 * service répond `{ trouves, avis }` (`chercherAvecAvis`) : seuls les éléments trouvés sont rendus. La requête précédente
 * est abandonnée (connexion fermée, clé de remplacement `graphe`) : le service ne finit pas une recherche caduque.
 */
export function useRecherche(q: string, attenteMs: number = ATTENTE_RECHERCHE_MS): Ressource<TrouveVue[]> {
	const { api } = useClient();
	const [attendue, setAttendue] = useState(q.trim());
	useEffect(() => {
		const t = setTimeout(() => setAttendue(q.trim()), attenteMs);
		return () => clearTimeout(t);
	}, [q, attenteMs]);
	return useRessource(
		attendue ? `recherche:${attendue}` : null,
		async (signal) => (await api.lire<ReponseRecherche>(ROUTES.recherche, { q: attendue }, { signal, remplacement: 'graphe' })).trouves,
		{ memoire: true },
	);
}

/**
 * Aujourd'hui (AAAA-MM-JJ, heure locale), recalculé au minuit local suivant et au retour sur l'onglet (une minuterie
 * peut dormir avec la machine).
 */
export function useAujourdhui(): string {
	const [jour, setJour] = useState(() => aujourdhui());
	useEffect(() => {
		const maj = () => setJour(aujourdhui());
		const maintenant = new Date();
		const minuit = new Date(maintenant.getFullYear(), maintenant.getMonth(), maintenant.getDate() + 1).getTime();
		const minuteur = setTimeout(maj, minuit - maintenant.getTime() + 50);
		window.addEventListener('focus', maj);
		document.addEventListener('visibilitychange', maj);
		return () => {
			clearTimeout(minuteur);
			window.removeEventListener('focus', maj);
			document.removeEventListener('visibilitychange', maj);
		};
	}, [jour]);
	return jour;
}

/** Aujourd'hui en AAAA-MM-JJ, heure locale. */
export function aujourdhui(maintenant: Date = new Date()): string {
	const d = (n: number) => String(n).padStart(2, '0');
	return `${maintenant.getFullYear()}-${d(maintenant.getMonth() + 1)}-${d(maintenant.getDate())}`;
}
