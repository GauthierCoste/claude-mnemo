import type { EcarteeToujoursVue, EcarteVue, EntreeServieVue, SessionTermineeVue, SessionVue, SuggestionEcarteeToujoursVue } from '@mnemo/contrat';
import { estMinimal } from '../../application/episode.ts';
import type { SessionTerminee } from '../../application/historique.ts';
import type { Ecarte, EcarteeToujours, EntreeServie } from '../../application/ports.ts';
import type { SuggestionEcarteeToujours } from '../../domaine/apriori-gestes.ts';
import { nomDeLaFiche } from '../../domaine/chemin.ts';
import { dialogueOuvert } from '../../domaine/session.ts';
import { texteDossierNonRattache } from '../../domaine/rattachement.ts';
import type { Session } from '../../domaine/session.ts';

/**
 * Ce que l'API montre d'une session : les champs du contrat, rien de plus (ni pid, ni trace du processus, ni arrêt attendu).
 * `terminal` : un terminal de ce service est attaché à la session. `suggestions` : fiches écartées par la session que la règle
 * des 3 sessions propose d'écarter toujours (champ absent s'il n'y en a pas).
 */
export function vueSession(s: Session, terminal: boolean, suggestions: readonly SuggestionEcarteeToujours[] = []): SessionVue {
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
	};
}

function vueSuggestion(s: SuggestionEcarteeToujours): SuggestionEcarteeToujoursVue {
	return { chemin: s.fiche, sessions: s.sessions.length, jours: s.jours };
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
		classement: e.classement.slice(0, CLASSEMENT_VU_MAX).map((c) => ({
			id: c.id,
			titre: c.titre ?? titreDeFiche(c.id.split('#')[0]!, titres),
			note: c.signaux === undefined ? c.note : (c.p ?? null),
			servi: c.servi,
			rang: c.rang,
		})),
		muet: e.muet,
		cartes: e.cartes.map((c) => ({
			id: c.chemin,
			titre: titreDeFiche(c.chemin, titres),
			raison: c.raison,
			...(c.depuis === undefined ? {} : { depuis: { id: c.depuis, titre: titreDeFiche(c.depuis, titres) } }),
			...(c.note === undefined ? {} : { note: c.note }),
		})),
		...(e.affinage === undefined ? {} : { affinage: e.affinage }),
		titres: Object.fromEntries(e.ids.map((id) => id.split('#')[0]!).map((chemin) => [chemin, titreDeFiche(chemin, titres)])),
	};
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
