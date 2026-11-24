/** Client HTTP du service : JSON, jeton en `Authorization: Bearer`, erreurs `{ erreur }` en `ErreurApi`. */
import { ENTETE_REMPLACEMENT, ROUTES, type ReponseDepot } from '@mnemo/contrat';

export class ErreurApi extends Error {
	readonly statut: number;
	constructor(message: string, statut: number) {
		super(message);
		this.name = 'ErreurApi';
		this.statut = statut;
	}
}

export type Api = {
	/**
	 * `signal` : la requête est abandonnée avec lui (l'erreur d'abandon est rendue telle quelle). `remplacement` : nom du
	 * consommateur (ex. `palette`) ; le service abandonne sa requête précédente de même nom dans cet onglet, qui est
	 * rendue comme un abandon (voir `estAbandon`), jamais comme une erreur.
	 */
	lire<T>(chemin: string, params?: Record<string, string>, options?: { signal?: AbortSignal; remplacement?: string }): Promise<T>;
	envoyer<T>(chemin: string, corps?: unknown): Promise<T>;
	/** PUT : remplace une ressource (les réglages). */
	remplacer<T>(chemin: string, corps: unknown): Promise<T>;
	supprimer<T>(chemin: string, params?: Record<string, string>): Promise<T>;
	/**
	 * Dépose un fichier (corps brut, `?vers=`) : d'abord une vérification sans corps (`depotVerifier` : fichier déjà là,
	 * chemin refusé, trop gros, disque trop petit), dont le refus arrive toujours intact ; puis l'envoi, le navigateur lisant
	 * le fichier en flux, jamais en entier en mémoire (`XMLHttpRequest` avec le `Blob` pour corps). `surProgression` reçoit
	 * les octets envoyés et le total ; `signal` annule l'envoi (rendu comme un abandon, voir `estAbandon` ; le service
	 * retire ce qu'il a reçu).
	 */
	deposer(vers: string, fichier: Blob, surProgression?: (envoyes: number, total: number) => void, signal?: AbortSignal): Promise<ReponseDepot>;
};

/** Vrai pour une requête abandonnée : par son signal, ou remplacée par une plus récente du même consommateur. */
export const estAbandon = (e: unknown): boolean => e instanceof DOMException && e.name === 'AbortError';

/** Ce que l'API utilise de `XMLHttpRequest` (le dépôt : seul moyen de suivre la progression d'un envoi). */
export type RequeteEnvoi = Pick<XMLHttpRequest, 'open' | 'setRequestHeader' | 'send' | 'abort' | 'status' | 'responseText'> & {
	upload: { onprogress: ((e: ProgressEvent) => void) | null };
	onload: (() => void) | null;
	onerror: (() => void) | null;
};

export function creerApi(o: {
	base: string;
	jeton: string;
	fetch: typeof fetch;
	surJetonRefuse: () => void;
	/** Fabrique de requête d'envoi (dépôt) ; par défaut `new XMLHttpRequest()`. */
	requeteEnvoi?: () => RequeteEnvoi;
}): Api {
	const onglet = crypto.randomUUID();
	const adresse = (chemin: string, params?: Record<string, string>) => {
		const requete = params && Object.keys(params).length > 0 ? `?${new URLSearchParams(params).toString()}` : '';
		return `${o.base}${chemin}${requete}`;
	};

	async function appeler<T>(url: string, init: RequestInit, remplacement?: string): Promise<T> {
		const entetes = new Headers(init.headers);
		entetes.set('Authorization', `Bearer ${o.jeton}`);
		if (remplacement !== undefined) entetes.set(ENTETE_REMPLACEMENT, `${onglet}:${remplacement}`);
		let reponse: Response;
		try {
			reponse = await o.fetch(url, { ...init, headers: entetes });
		} catch (e) {
			if (init.signal?.aborted) throw e;
			throw new ErreurApi('Service injoignable.', 0);
		}
		return interpreter<T>(reponse.status, await reponse.text(), remplacement);
	}

	/** Corps JSON d'une réponse ; hors 2xx, `ErreurApi` avec le motif `{ erreur }` du service (401 : jeton refusé signalé). */
	function interpreter<T>(statut: number, texte: string, remplacement?: string): T {
		let corps: unknown = null;
		try {
			corps = texte ? JSON.parse(texte) : null;
		} catch {
			corps = null;
		}
		if (statut < 200 || statut > 299) {
			// remplacée par une requête plus récente du même consommateur : un abandon, pas une erreur
			if (statut === 409 && remplacement !== undefined) throw new DOMException('Requête remplacée par une plus récente.', 'AbortError');
			if (statut === 401) o.surJetonRefuse();
			const motif = corps && typeof corps === 'object' && typeof (corps as { erreur?: unknown }).erreur === 'string' ? (corps as { erreur: string }).erreur : null;
			throw new ErreurApi(motif ?? (statut === 401 ? 'Jeton refusé.' : `Erreur du service (${statut}).`), statut);
		}
		return corps as T;
	}

	async function deposer(vers: string, fichier: Blob, surProgression?: (envoyes: number, total: number) => void, signal?: AbortSignal): Promise<ReponseDepot> {
		// sans corps : un refus ne se perd jamais dans un envoi coupé (« Service injoignable » à la place du motif)
		await appeler(adresse(ROUTES.depotVerifier, { vers, taille: String(fichier.size) }), { method: 'GET', ...(signal ? { signal } : {}) });
		signal?.throwIfAborted();
		return new Promise((resoudre, rejeter) => {
			const requete = o.requeteEnvoi?.() ?? new XMLHttpRequest();
			const annuler = (): void => {
				requete.abort();
				rejeter(new DOMException('Envoi annulé.', 'AbortError'));
			};
			signal?.addEventListener('abort', annuler, { once: true });
			const finir = (): void => signal?.removeEventListener('abort', annuler);
			requete.open('POST', adresse(ROUTES.depot, { vers }));
			requete.setRequestHeader('Authorization', `Bearer ${o.jeton}`);
			requete.setRequestHeader('Content-Type', 'application/octet-stream');
			requete.upload.onprogress = (e) => surProgression?.(e.loaded, e.lengthComputable ? e.total : fichier.size);
			// statut 0 : connexion refusée ou coupée (service arrêté, refus avant lecture du corps)
			requete.onerror = () => {
				finir();
				rejeter(new ErreurApi('Service injoignable.', 0));
			};
			requete.onload = () => {
				finir();
				try {
					resoudre(interpreter<ReponseDepot>(requete.status, requete.responseText));
				} catch (e) {
					rejeter(e);
				}
			};
			// le Blob est lu en flux par le navigateur, jamais copié en entier en mémoire
			requete.send(fichier);
		});
	}

	return {
		lire: (chemin, params, options) => appeler(adresse(chemin, params), { method: 'GET', ...(options?.signal ? { signal: options.signal } : {}) }, options?.remplacement),
		envoyer: (chemin, corps) =>
			appeler(adresse(chemin), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corps ?? {}) }),
		remplacer: (chemin, corps) => appeler(adresse(chemin), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corps) }),
		supprimer: (chemin, params) => appeler(adresse(chemin, params), { method: 'DELETE' }),
		deposer,
	};
}
