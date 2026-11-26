/**
 * L'entraînement de la note de confiance dans le service (page Mémoire › Entraîner ; spec « entraîner la note », § Service) :
 * les ports de `application/entrainement.ts` branchés sur le service (modèles déjà chargés, reranker en arrière-plan, niveau
 * des modèles respecté, gestes de l'état des sessions, juge Claude s'il est trouvé, apprentissage dans un fil à part), ses
 * routes, et la diffusion de son état (`{ type: 'entrainement' }`) à chaque changement, au plus quatre fois par seconde.
 */
import { join } from 'node:path';
import { ROUTES } from '@mnemo/contrat';
import type { DemandeReponseMessage, JugementVue, MessageServeur, ReponseAccepterSures, ReponseAnnulation, ReponseMessageAJuger, ReponseReponseMessage, VueEntrainement } from '@mnemo/contrat';
import { modelesPermis } from '@mnemo/commun';
import { extraireJugements, messagesDuJournal } from '../../application/banc-extraire.ts';
import { syntheseDe } from '../../application/banc-signaux.ts';
import type { GestesDuBanc } from '../../application/banc-signaux.ts';
import { creerEntrainement, ErreurEntrainement, PREPARER_MAX } from '../../application/entrainement.ts';
import type { Entrainement, PortsEntrainement } from '../../application/entrainement.ts';
import type { DureeDuReranker } from '../../application/duree-reranker.ts';
import { modelesActifs } from '../../application/note-du-classement.ts';
import type { Dependances, EtatSessions, Modeles, Pilotage, Reranker, Sens } from '../../application/ports.ts';
import { modelesSuivis } from '../../application/suivi-injection.ts';
import type { SuiviDesInjections } from '../../application/suivi-injection.ts';
import { DOSSIER_LOCAL } from '../../domaine/dossier-memoire.ts';
import { echelleDesSignaux } from '../../domaine/modele-de-note.ts';
import { requeteJointe } from '../../domaine/requete-du-message.ts';
import { estObjet } from '../../domaine/valeurs.ts';
import { apprentiNote } from '../../infra/apprenti-note.ts';
import { ErreurBancContexte } from '../../infra/banc-contexte-fichier.ts';
import { ggufInstalles } from '../../infra/coefficients-note-fichier.ts';
import { executeurReel } from '../../infra/executeur.ts';
import { bancDuService, fichiersDeLaNote, historiqueDuDossier } from '../../infra/fichiers-entrainement.ts';
import { ouvrirJournalEnLecture } from '../../infra/journal-en-lecture.ts';
import { jugeClaude } from '../../infra/juge-claude.ts';
import { trouverClaude } from '../../infra/moteurs/claude-code/trouver-claude.ts';
import { ErreurHttp } from './routes.ts';
import type { Reponse, Route } from './routes.ts';

export const CLAUDE_INTROUVABLE = 'Claude Code introuvable (commande claude absente du PATH, ou MNEMO_CLAUDE) : le pré-jugement par Claude n’est pas disponible.';

/** Ce que le service donne à l'entraînement. */
export type ServicePourEntrainement = {
	racine: string;
	dep: Dependances;
	pil: Pilotage;
	modeles: Modeles;
	dureeReranker?: DureeDuReranker;
	suivi?: SuiviDesInjections;
	surChangement(): void;
};

/** Ports remplacés (tests) : jamais de vrai juge, de vrai fil ni de vrais modèles dans les essais du service. */
export type RemplacementsEntrainement = Partial<Pick<PortsEntrainement, 'juge' | 'apprenti' | 'extraire' | 'journal' | 'maintenant'>>;

const SENS_ABSENT: Sens = { modele: () => null, vecteurs: async () => null };
const RERANKER_ABSENT: Reranker = { noter: async () => null };

/** Les gestes de l'état des sessions, pour l'a priori des cas préparés (comme le banc les lit), les plus anciens d'abord. */
async function gestesDuService(etat: EtatSessions): Promise<GestesDuBanc> {
	const [gestes, ecartees, sessions] = await Promise.all([etat.gestes({ limite: null }), etat.ecarteesToujours(), etat.lister({ archivees: true })]);
	return {
		gestes: [...gestes].reverse(),
		ecarteesToujours: new Set(ecartees.filter((e) => e.retablieMs === null).map((e) => e.fiche)),
		dossierDe: new Map(sessions.map((s) => [s.id, s.dossier])),
	};
}

const arret = (): Error => Object.assign(new Error('préparation arrêtée'), { name: 'AbortError' });

/** L'entraînement branché sur le service. */
export function entrainementDuService(s: ServicePourEntrainement, remplacements: RemplacementsEntrainement = {}): Entrainement {
	const { racine, dep, pil } = s;
	const fichiers = fichiersDeLaNote(racine);
	const installes = () => dep.note?.().installes ?? ggufInstalles();
	const ports: PortsEntrainement = {
		banc: bancDuService(racine),
		// le journal lu sans migration ni écriture, comme le banc le lit (une lecture à part de la base du service)
		journal: async () => {
			const lecture = ouvrirJournalEnLecture(join(racine, DOSSIER_LOCAL, 'etat.sqlite'));
			try {
				return await messagesDuJournal(lecture);
			} finally {
				lecture.fermer();
			}
		},
		// les modèles du service, au niveau de la machine ; le reranker en arrière-plan : un hook n'attend jamais la préparation
		extraire: async (messages, o) => {
			const permis = modelesPermis((await s.modeles.etat()).niveau);
			const reranker = !permis.reranker ? RERANKER_ABSENT : s.dureeReranker === undefined ? dep.reranker : s.dureeReranker.envelopper(dep.reranker, { arrierePlan: true });
			const d: Dependances = { ...dep, sens: permis.sens ? dep.sens : SENS_ABSENT, reranker };
			return extraireJugements(d, messages, {
				requeteJointe,
				gguf: installes(),
				gestes: await gestesDuService(pil.etat),
				avancement: (faits, total) => {
					if (o.signal.aborted) throw arret();
					o.avancement(faits, total);
				},
			});
		},
		syntheses: async (chemins) => {
			if (chemins.length === 0) return new Map();
			return new Map((await dep.index.elements({ genres: ['fiche'], chemins: [...chemins] })).map((e) => [e.chemin, syntheseDe(e)]));
		},
		juge: () => {
			const claude = trouverClaude(pil.hote.env, pil.hote.plateforme as NodeJS.Platform);
			return claude === null ? { raison: CLAUDE_INTROUVABLE } : { juge: jugeClaude({ executer: executeurReel(), claude, env: pil.hote.env }) };
		},
		note: {
			...fichiers,
			modeles: () => modelesSuivis(pil.etat, modelesActifs(dep), s.suivi),
			installes,
			echelle: () => echelleDesSignaux(dep.reglages().contexte),
			empreintes: async () => new Map((await dep.index.fiches()).map((f) => [f.chemin, f.empreinte])),
		},
		apprenti: apprentiNote(),
		historique: historiqueDuDossier(racine),
		maintenant: () => dep.systeme.maintenant(),
		surChangement: s.surChangement,
		...remplacements,
	};
	return creerEntrainement(ports);
}

/**
 * La diffusion de l'état, au plus une fois par `intervalleMs` : chaque signal est suivi d'une diffusion de l'état d'alors (le
 * dernier changement est toujours diffusé), jamais deux lectures en même temps.
 */
export function diffusionLimitee(diffuser: () => Promise<void>, intervalleMs = 250): { signaler(): void; fermer(): void } {
	let derniere = -Infinity;
	let minuteur: ReturnType<typeof setTimeout> | null = null;
	let enVol = false;
	let encore = false;
	let ferme = false;
	const partir = async (): Promise<void> => {
		minuteur = null;
		if (enVol) {
			encore = true;
			return;
		}
		enVol = true;
		derniere = Date.now();
		try {
			await diffuser();
		} catch {
			// état illisible un instant : le prochain changement rediffusera
		} finally {
			enVol = false;
			if (encore) {
				encore = false;
				signaler();
			}
		}
	};
	const signaler = (): void => {
		if (ferme || minuteur !== null) return;
		minuteur = setTimeout(() => void partir(), Math.max(0, derniere + intervalleMs - Date.now()));
		minuteur.unref?.();
	};
	return {
		signaler,
		fermer() {
			ferme = true;
			if (minuteur !== null) clearTimeout(minuteur);
		},
	};
}

const JUGEMENTS: readonly JugementVue[] = ['pertinente', 'non_pertinente', 'indecise'];
const CHEMINS_MAX = 500;

/** Un corps sans champ (`{}` ou vide) ; sinon 400. */
function corpsVide(brut: unknown): void {
	if (!estObjet(brut)) throw new ErreurHttp(400, 'Corps attendu : un objet JSON.');
	for (const cle of Object.keys(brut)) throw new ErreurHttp(400, `Champ inconnu « ${cle} ».`);
}

/** `{ nombre? }` de `preparer` ; sinon 400. */
function nombreAPreparer(brut: unknown): number | undefined {
	if (!estObjet(brut)) throw new ErreurHttp(400, 'Corps attendu : { nombre? }.');
	for (const cle of Object.keys(brut)) if (cle !== 'nombre') throw new ErreurHttp(400, `Champ inconnu « ${cle} ».`);
	const n = brut['nombre'];
	if (n === undefined) return undefined;
	if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > PREPARER_MAX) throw new ErreurHttp(400, `Champ « nombre » : un entier de 1 à ${PREPARER_MAX}.`);
	return n;
}

const indiceValide = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;

/** La réponse à un message (`DemandeReponseMessage`) ; sinon 400. */
function reponseAuMessage(brut: unknown): DemandeReponseMessage {
	if (!estObjet(brut)) throw new ErreurHttp(400, 'Corps attendu : { indice, jugements, resteNonUtile, silence?, passer? }.');
	const permis = new Set(['indice', 'jugements', 'resteNonUtile', 'silence', 'passer']);
	for (const cle of Object.keys(brut)) if (!permis.has(cle)) throw new ErreurHttp(400, `Champ inconnu « ${cle} ».`);
	const { indice, jugements, resteNonUtile, silence, passer } = brut;
	if (!indiceValide(indice)) throw new ErreurHttp(400, 'Champ « indice » : un entier positif ou nul.');
	if (!estObjet(jugements) || Object.keys(jugements).length > CHEMINS_MAX) throw new ErreurHttp(400, `Champ « jugements » : un objet chemin → jugement (${CHEMINS_MAX} au plus).`);
	for (const [chemin, j] of Object.entries(jugements)) {
		if (chemin.length > 4096 || !JUGEMENTS.includes(j as JugementVue)) throw new ErreurHttp(400, `Champ « jugements » : jugement inconnu (${JUGEMENTS.join(', ')}).`);
	}
	if (typeof resteNonUtile !== 'boolean') throw new ErreurHttp(400, 'Champ « resteNonUtile » : vrai ou faux.');
	if (silence !== undefined && typeof silence !== 'boolean') throw new ErreurHttp(400, 'Champ « silence » : vrai ou faux.');
	if (passer !== undefined && typeof passer !== 'boolean') throw new ErreurHttp(400, 'Champ « passer » : vrai ou faux.');
	if (silence === true && passer === true) throw new ErreurHttp(400, '« silence » et « passer » ne vont pas ensemble.');
	return { indice, jugements: jugements as Record<string, JugementVue>, resteNonUtile, ...(silence === undefined ? {} : { silence }), ...(passer === undefined ? {} : { passer }) };
}

/** Les refus de l'entraînement en réponses HTTP. */
async function traduire<T>(action: () => Promise<T>): Promise<T> {
	try {
		return await action();
	} catch (e) {
		if (e instanceof ErreurEntrainement) throw new ErreurHttp(e.genre === 'introuvable' ? 404 : 409, e.message);
		if (e instanceof ErreurBancContexte) throw new ErreurHttp(409, `Fichier des jugements illisible : ${e.message}`);
		throw e;
	}
}

/** Routes de l'entraînement ; `enFond` : la tâche lancée, attendue par l'arrêt du service. */
export function routesEntrainement(e: Entrainement, o: { enFond(tache: Promise<unknown>): void }): Route[] {
	const etat = async (statut = 200): Promise<Reponse> => ({ statut, corps: (await e.etat()) satisfies VueEntrainement });
	const lancer = (demarrer: (corps: unknown) => Promise<{ fin: Promise<void> }>) => async (r: { json(): Promise<unknown> }): Promise<Reponse> => {
		const corps = await r.json();
		const { fin } = await traduire(() => demarrer(corps));
		o.enFond(fin);
		return etat(202);
	};
	return [
		{ methode: 'GET', chemin: ROUTES.entrainement, action: () => etat() },
		{
			methode: 'POST',
			chemin: ROUTES.entrainementPreparer,
			corps: 'json',
			action: lancer((c) => {
				const nombre = nombreAPreparer(c);
				return e.preparer(nombre === undefined ? {} : { nombre });
			}),
		},
		{
			methode: 'POST',
			chemin: ROUTES.entrainementPrejuger,
			corps: 'json',
			action: lancer((c) => {
				corpsVide(c);
				return e.prejuger();
			}),
		},
		{
			methode: 'POST',
			chemin: ROUTES.entrainementApprendre,
			corps: 'json',
			action: lancer((c) => {
				corpsVide(c);
				return e.apprendre({ origine: 'manuel' });
			}),
		},
		{
			methode: 'POST',
			chemin: ROUTES.entrainementArreter,
			action: async () => {
				if (!e.arreter()) throw new ErreurHttp(409, 'Aucune tâche en cours.');
				return etat();
			},
		},
		{
			methode: 'POST',
			chemin: ROUTES.entrainementRevenir,
			action: async () => {
				await traduire(() => e.revenir());
				return etat();
			},
		},
		{
			methode: 'GET',
			chemin: ROUTES.entrainementMessage,
			action: async (r) => {
				const brut = r.params.get('indice');
				const indice = brut === null || brut === '' ? undefined : Number(brut);
				if (indice !== undefined && !indiceValide(indice)) throw new ErreurHttp(400, 'Paramètre « indice » : un entier positif ou nul.');
				const message = await traduire(() => e.message(indice));
				return { statut: 200, corps: { message } satisfies ReponseMessageAJuger };
			},
		},
		{
			methode: 'POST',
			chemin: ROUTES.entrainementMessage,
			corps: 'json',
			action: async (r) => {
				const { indice, ...reponse } = reponseAuMessage(await r.json());
				const resultat = await traduire(() => e.repondre(indice, reponse));
				return { statut: 200, corps: resultat satisfies ReponseReponseMessage };
			},
		},
		{
			methode: 'POST',
			chemin: ROUTES.entrainementAnnuler,
			action: async () => ({ statut: 200, corps: (await traduire(() => e.annuler())) satisfies ReponseAnnulation }),
		},
		{
			methode: 'POST',
			chemin: ROUTES.entrainementAccepterSures,
			action: async () => ({ statut: 200, corps: (await traduire(() => e.accepterSures())) satisfies ReponseAccepterSures }),
		},
	];
}

/** Le message diffusé : l'état entier. */
export const messageEntrainement = (etat: VueEntrainement): MessageServeur => ({ type: 'entrainement', etat });
