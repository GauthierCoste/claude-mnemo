import type { ClassementVue, CoupureInjectionVue, EcarteeToujoursVue, EcarteVue, EntreeServieVue, InjectionVue, SessionTermineeVue, SessionVue, SuggestionEcarteeToujoursVue } from '@mnemo/contrat';
import { estMinimal } from '../../application/episode.ts';
import type { SessionTerminee } from '../../application/historique.ts';
import type { Classe, Ecarte, EcarteeToujours, EntreeServie, GesteNote } from '../../application/ports.ts';
import type { SuggestionEcarteeToujours } from '../../domaine/apriori-gestes.ts';
import type { CoupuresDInjection } from '../../domaine/suivi-injection.ts';
import { nomDeLaFiche } from '../../domaine/chemin.ts';
import { dialogueOuvert } from '../../domaine/session.ts';
import { texteDossierNonRattache } from '../../domaine/rattachement.ts';
import type { Session } from '../../domaine/session.ts';

/**
 * Ce que l'API montre d'une session : les champs du contrat, rien de plus (ni pid, ni trace du processus, ni arrêt attendu).
 * `terminal` : un terminal de ce service est attaché à la session. `suggestions` : fiches écartées par la session que la règle
 * des 3 sessions propose d'écarter toujours (champ absent s'il n'y en a pas).
 */
export function vueSession(s: Session, terminal: boolean, suggestions: readonly SuggestionEcarteeToujours[] = [], coupures: readonly CoupureInjectionVue[] = []): SessionVue {
	return {
		id: s.id,
		profil: s.profil,
		dossier: s.dossier,
		position: s.position,
		projet: s.projet,
		dossierNonRattache: s.dossierNonRattache === true ? texteDossierNonRattache(s.dossier) : null,
		objectif: s.objectif,
		etat: s.etat,
		creeeMs: s.creeeMs,
		majMs: s.majMs,
		bilanDemandeMs: s.bilanDemandeMs,
		commitDebut: s.commitDebut,
		branche: s.branche,
		terminal,
		dialogueOuvert: dialogueOuvert(s),
		niveauModeles: s.niveauModeles ?? null,
		...(suggestions.length === 0 ? {} : { suggestionsEcarteeToujours: suggestions.map(vueSuggestion) }),
		...(coupures.length === 0 ? {} : { injectionCoupee: [...coupures] }),
	};
}

function vueSuggestion(s: SuggestionEcarteeToujours): SuggestionEcarteeToujoursVue {
	return { chemin: s.fiche, sessions: s.sessions.length, jours: s.jours };
}

/** Les niveaux coupés par le suivi des injections, Complets d'abord. */
export function vueCoupures(c: CoupuresDInjection): CoupureInjectionVue[] {
	return [c.complets, c.sens].flatMap((x) => (x === null ? [] : [{ niveau: x.niveau, injections: x.injections, ecartees: x.ecartees, depuisMs: x.depuisMs, motif: x.motif }]));
}

export function vueEcarteeToujours(e: EcarteeToujours, titres: ReadonlyMap<string, string>): EcarteeToujoursVue {
	return { chemin: e.fiche, titre: titreDeFiche(e.fiche, titres), horodatageMs: e.horodatageMs };
}

/** Une session de l'historique et son épisode (titre : celui de la fiche, sinon son nom de fichier). */
export function vueSessionTerminee(t: SessionTerminee, terminal: boolean): SessionTermineeVue {
	const e = t.episode;
	return {
		...vueSession(t.session, terminal),
		episode: e === null ? null : { chemin: e.chemin, titre: e.fiche.titre || nomDeLaFiche(e.chemin), minimal: estMinimal(e.fiche) },
	};
}

/** Titre d'une fiche : son vrai titre si l'index le connaît, sinon son nom de fichier. */
export function titreDeFiche(chemin: string, titres: ReadonlyMap<string, string>): string {
	return titres.get(chemin) || nomDeLaFiche(chemin);
}

/** Titres des fiches de l'index (vide si l'index est illisible : le nom du fichier en tient lieu). Un seul endroit : route du hook et sondage. */
export async function titresDeLIndex(index: { titres(): Promise<{ chemin: string; titre: string }[]> }): Promise<Map<string, string>> {
	return new Map((await index.titres().catch(() => [])).map((t) => [t.chemin, t.titre]));
}

/** Lignes du classement envoyées au panneau Contexte : il en montre le haut ; le journal garde le reste (apprentissage). */
export const CLASSEMENT_VU_MAX = 30;

/** Trace d'un /clear ou /compact au journal (entrée de début sans rien servi) : pour le message d'avant, jamais montrée. */
export function estTraceDeDebut(e: Pick<EntreeServie, 'moment' | 'ids' | 'texte'>): boolean {
	return e.moment === 'debut' && e.ids.length === 0 && e.texte === '';
}

export function vueServie(e: EntreeServie, titres: ReadonlyMap<string, string> = new Map()): EntreeServieVue {
	return {
		session: e.session,
		moment: e.moment,
		horodatageMs: e.horodatageMs,
		ids: [...e.ids],
		texte: e.texte,
		ms: e.ms,
		sens: e.sens,
		// classement vivant (une ligne a des signaux) : pas de % tant qu'aucune note apprise ne donne `p` (ordre seul) ; titre relu dans l'index
		classement: e.classement.slice(0, CLASSEMENT_VU_MAX).map((c) => vueClasse(c, titres)),
		muet: e.muet,
		cartes: e.cartes.map((c) => ({
			id: c.chemin,
			titre: titreDeFiche(c.chemin, titres),
			raison: c.raison,
			...(c.depuis === undefined ? {} : { depuis: { id: c.depuis, titre: titreDeFiche(c.depuis, titres) } }),
			...(c.note === undefined ? {} : { note: c.note }),
		})),
		...(e.affinage === undefined ? {} : { affinage: e.affinage }),
		...(e.calibree === undefined ? {} : { calibree: e.calibree, mesure: mesureDe(e) }),
		titres: Object.fromEntries(e.ids.map((id) => id.split('#')[0]!).map((chemin) => [chemin, titreDeFiche(chemin, titres)])),
	};
}

/** Une ligne du classement : les champs du classement vivant seulement s'ils sont là (une entrée ancienne n'en a aucun). */
function vueClasse(c: Classe, titres: ReadonlyMap<string, string>): ClassementVue {
	const s = c.signaux;
	return {
		id: c.id,
		titre: c.titre ?? titreDeFiche(c.id.split('#')[0]!, titres),
		note: s === undefined ? c.note : (c.p ?? null),
		servi: c.servi,
		rang: c.rang,
		...(s === undefined
			? {}
			: {
					p: c.p ?? null,
					signaux: {
						...(s.logit === undefined ? {} : { logit: s.logit }),
						cosinus: s.cosinus,
						cosinusRelatif: s.cosinusRelatif,
						...(s.cosinusZ === undefined ? {} : { cosinusZ: s.cosinusZ }),
						bm25Relatif: s.bm25Relatif,
						...(s.apriori === undefined ? {} : { apriori: s.apriori }),
						signalSession: s.signalSession,
					},
				}),
		...(c.auto === true ? { auto: true as const } : {}),
		...(c.piste === true ? { piste: true as const } : {}),
		...(c.raison === undefined ? {} : { raison: c.raison }),
	};
}

/**
 * Ce qui a noté un classement : ordre seul s'il n'est pas calibré ; sinon Complets si une ligne notée (`p`) l'a été avec le logit
 * du reranker, Sens seul autrement.
 */
function mesureDe(e: EntreeServie): 'complets' | 'sens' | 'ordre' {
	if (e.calibree !== true) return 'ordre';
	return e.classement.some((c) => typeof c.p === 'number' && c.signaux?.logit !== undefined) ? 'complets' : 'sens';
}

/** Une injection à la main ou par Mnemo, d'après son geste (`injectee_main`, `injectee_auto` avec `p` dans sa note). */
export function vueInjection(g: GesteNote): InjectionVue {
	const p = g.note?.['p'];
	return { chemin: g.fiche, mode: g.geste === 'injectee_auto' ? 'auto' : 'main', horodatageMs: g.horodatageMs, ...(g.geste === 'injectee_auto' && typeof p === 'number' ? { p } : {}) };
}

/** Ce que l'API montre d'un écarté. */
export function vueEcarte(e: Ecarte): EcarteVue {
	return { id: e.id, titre: e.titre, horodatageMs: e.horodatageMs };
}

/** Racine affichée : `~` pour le dossier personnel `maison` (séparateur gardé), sinon le chemin tel quel. */
export function racineAffichee(racine: string, maison: string): string {
	if (maison === '' || maison === '/') return racine;
	if (racine === maison) return '~';
	for (const separateur of ['/', '\\']) {
		if (racine.startsWith(maison + separateur)) return `~${racine.slice(maison.length)}`;
	}
	return racine;
}
