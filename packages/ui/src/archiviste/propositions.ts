/**
 * Ce qui attend l'avis de l'utilisateur (« À arbitrer » de Mémoire › Archiviste, sur le `Fil`) : faits « à
 * confirmer », montées de niveau de consignes et modifications de consignes ou de profils proposées par une session ; et
 * la demande `proposer` qui tranche chacun.
 * Correspondance : fait → `confirmer` / `rejeter` / `fait` avec `remplace` (correction) ; montée → `niveau` (appliquer)
 * ou `niveau` avec `retirerProposition` (rejeter une proposition de session) ; modification → `modification` avec
 * `appliquerProposition` ou `retirerProposition`.
 */
import type { FilVue, NiveauVue, RegleVue } from '@mnemo/contrat';
import { TEXTES, type Textes } from '../langue/textes.ts';
import { titreFiche } from '../sessions/servis.ts';

type TextesPropositions = Textes['archiviste']['propositions'];

export type Proposition = {
	cle: string;
	genre: 'a_confirmer' | 'montee' | 'modification';
	fiche: string;
	texte: string;
	/** Source, motif, niveau proposé. */
	detail: string;
	/** Fait : son ancre (`f-0003`) ; montée : null. */
	ancre: string | null;
	/** Fait : sa catégorie, gardée par une correction ; montée : null. */
	categorie: string | null;
	/**
	 * Fait : fin de validité, exclue (une fin incluse passe au lendemain), gardée par une correction ; sinon null. Le début
	 * de validité n'est pas dans `ElementIndexe` : une correction ne le reprend pas. La citation non plus (le texte change).
	 */
	valideFin: string | null;
	/** Montée : niveau et règle visés ; `proposee` vrai pour une proposition de session (rejetable). Fait : null. */
	vise: { niveau: NiveauVue; regle?: RegleVue; proposee: boolean } | null;
	/** Ce que la proposition reprend du fil : de quoi réécrire `texte` et `detail` dans la langue de l'interface. */
	origine: OrigineProposition;
};

export type OrigineProposition =
	| { genre: 'a_confirmer'; element: FilVue['aConfirmer'][number] }
	| { genre: 'montee'; montee: FilVue['montees'][number] }
	| { genre: 'modification'; modification: FilVue['modifications'][number] };

export type Choix = 'confirmer' | 'rejeter' | { corriger: string };

/** Source des demandes de l'interface : l'utilisateur (le service HTTP est un canal de l'utilisateur). */
const SOURCE_UTILISATEUR = { type: 'utilisateur', ref: 'utilisateur' } as const;

export function libelleNiveau(n: NiveauVue, t: TextesPropositions = TEXTES.fr.archiviste.propositions): string {
	return t.niveaux[n] ?? n;
}

/** Ancre d'un identifiant de fait `chemin#^f-0003` (ou `chemin#f-0003`) ; null sans `#`. */
function ancreDe(id: string): string | null {
	const i = id.indexOf('#');
	return i < 0 ? null : id.slice(i + 1).replace(/^\^/, '') || null;
}

/** Lendemain d'une date AAAA-MM-JJ (calendrier, sans fuseau) ; la date telle quelle si elle est mal formée. */
function lendemain(date: string): string {
	const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
	if (!m) return date;
	const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + 1));
	return d.toISOString().slice(0, 10);
}

function texteRegle(r: RegleVue, t: TextesPropositions): string {
	return t.regle(t.regles[r.type] ?? r.type, r.motifs);
}

/** Texte et détail d'une proposition dans la langue de l'interface ; le texte d'un fait ou d'une consigne est du contenu. */
export function libellesProposition(o: OrigineProposition, t: TextesPropositions = TEXTES.fr.archiviste.propositions): { texte: string; detail: string } {
	if (o.genre === 'a_confirmer') {
		const e = o.element;
		return { texte: e.texte.split('\n')[0]!, detail: t.detailFait(e.source, e.categorie, e.date) };
	}
	if (o.genre === 'montee') {
		const m = o.montee;
		const p = m.proposition;
		const detail = p
			? t.monteeProposee(p.source, p.date || null, libelleNiveau(p.niveau, t), p.regle ? texteRegle(p.regle, t) : null)
			: t.consigneRepetee(libelleNiveau(m.niveau, t));
		return { texte: m.texte, detail };
	}
	const m = o.modification;
	return { texte: t.modifierCibles(m.cibles), detail: t.modificationProposee(m.source, m.date || null, m.changements) };
}

export function propositionsDuFil(fil: FilVue, t: TextesPropositions = TEXTES.fr.archiviste.propositions): Proposition[] {
	const faits = fil.aConfirmer.map((e): Proposition => {
		const origine = { genre: 'a_confirmer', element: e } as const;
		return {
			cle: e.id,
			genre: 'a_confirmer',
			fiche: e.chemin,
			...libellesProposition(origine, t),
			ancre: ancreDe(e.id),
			categorie: e.categorie,
			valideFin: e.valideFin ? (e.finIncluse ? lendemain(e.valideFin) : e.valideFin) : null,
			vise: null,
			origine,
		};
	});
	const montees = fil.montees.map((m): Proposition => {
		const p = m.proposition;
		const regle = p?.regle;
		const origine = { genre: 'montee', montee: m } as const;
		return {
			cle: `niveau:${m.fiche}`,
			genre: 'montee',
			fiche: m.fiche,
			...libellesProposition(origine, t),
			ancre: null,
			categorie: null,
			valideFin: null,
			vise: { niveau: p?.niveau ?? m.niveau, ...(regle ? { regle } : {}), proposee: p !== null },
			origine,
		};
	});
	const modifications = fil.modifications.map((m): Proposition => {
		const origine = { genre: 'modification', modification: m } as const;
		return {
			cle: `modification:${m.fiche}`,
			genre: 'modification',
			fiche: m.fiche,
			...libellesProposition(origine, t),
			ancre: null,
			categorie: null,
			valideFin: null,
			vise: null,
			origine,
		};
	});
	return [...faits, ...montees, ...modifications];
}

/** Corps de `proposer` pour le choix de l'utilisateur ; erreur si le choix n'a pas de sens pour cette proposition. */
export function demandePour(p: Proposition, choix: Choix, t: TextesPropositions = TEXTES.fr.archiviste.propositions): unknown {
	const erreurs = t.erreurs;
	if (p.genre === 'a_confirmer') {
		if (p.ancre === null) throw new Error(erreurs.sansAncre(p.fiche));
		if (choix === 'confirmer' || choix === 'rejeter') return { genre: choix, fiche: p.fiche, ancre: p.ancre };
		const texte = choix.corriger.trim();
		if (!texte) throw new Error(erreurs.correctionVide);
		return {
			genre: 'fait',
			fiche: p.fiche,
			texte,
			...(p.categorie ? { categorie: p.categorie } : {}),
			...(p.valideFin ? { valideFin: p.valideFin } : {}),
			nature: 'declare',
			source: { ...SOURCE_UTILISATEUR },
			remplace: p.ancre,
		};
	}
	if (p.genre === 'modification') {
		if (choix === 'confirmer') return { genre: 'modification', fiche: p.fiche, appliquerProposition: true, source: { ...SOURCE_UTILISATEUR } };
		if (choix === 'rejeter') return { genre: 'modification', fiche: p.fiche, retirerProposition: true, source: { ...SOURCE_UTILISATEUR } };
		throw new Error(erreurs.modificationNonCorrigible);
	}
	const vise = p.vise;
	if (vise === null) throw new Error(erreurs.monteeSansNiveau(p.fiche));
	if (choix === 'confirmer') return { genre: 'niveau', fiche: p.fiche, niveau: vise.niveau, ...(vise.regle ? { regle: vise.regle } : {}), source: { ...SOURCE_UTILISATEUR } };
	if (choix === 'rejeter') {
		if (!vise.proposee) throw new Error(erreurs.aucunePropositionDeSession(titreFiche(p.fiche)));
		return { genre: 'niveau', fiche: p.fiche, retirerProposition: true, source: { ...SOURCE_UTILISATEUR } };
	}
	throw new Error(erreurs.monteeNonCorrigible);
}
