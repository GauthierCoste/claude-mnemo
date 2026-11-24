/**
 * Ce qui attend l'avis de l'utilisateur (« À arbitrer » de Mémoire › Archiviste, sur le `Fil`) : faits « à
 * confirmer », montées de niveau de consignes et modifications de consignes ou de profils proposées par une session ; et
 * la demande `proposer` qui tranche chacun.
 * Correspondance : fait → `confirmer` / `rejeter` / `fait` avec `remplace` (correction) ; montée → `niveau` (appliquer)
 * ou `niveau` avec `retirerProposition` (rejeter une proposition de session) ; modification → `modification` avec
 * `appliquerProposition` ou `retirerProposition`.
 */
import type { FilVue, NiveauVue, RegleVue } from '@mnemo/contrat';
import { titreFiche } from '../sessions/servis.ts';

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
};

export type Choix = 'confirmer' | 'rejeter' | { corriger: string };

/** Source des demandes de l'interface : l'utilisateur (le service HTTP est un canal de l'utilisateur). */
const SOURCE_UTILISATEUR = { type: 'utilisateur', ref: 'utilisateur' } as const;

const LIBELLES_NIVEAU: Record<NiveauVue, string> = { rappelee: 'rappelée', toujours: 'toujours', verifiee: 'vérifiée' };

export function libelleNiveau(n: NiveauVue): string {
	return LIBELLES_NIVEAU[n] ?? n;
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

function texteRegle(r: RegleVue): string {
	const genre = r.type === 'commandes_interdites' ? 'commandes interdites' : 'chemins interdits';
	return `${genre} : ${r.motifs.join(', ')}`;
}

export function propositionsDuFil(fil: FilVue): Proposition[] {
	const faits = fil.aConfirmer.map((e): Proposition => {
		const morceaux = [e.source ?? 'source inconnue', e.categorie, e.date ? `appris le ${e.date}` : null].filter((x): x is string => !!x);
		return {
			cle: e.id,
			genre: 'a_confirmer',
			fiche: e.chemin,
			texte: e.texte.split('\n')[0]!,
			detail: morceaux.join(' · '),
			ancre: ancreDe(e.id),
			categorie: e.categorie,
			valideFin: e.valideFin ? (e.finIncluse ? lendemain(e.valideFin) : e.valideFin) : null,
			vise: null,
		};
	});
	const montees = fil.montees.map((m): Proposition => {
		const p = m.proposition;
		const regle = p?.regle;
		const detail = p
			? `Proposé par ${p.source}${p.date ? ` le ${p.date}` : ''} : niveau « ${libelleNiveau(p.niveau)} »${regle ? ` (${texteRegle(regle)})` : ''}`
			: `Consigne répétée : passer au niveau « ${libelleNiveau(m.niveau)} »`;
		return {
			cle: `niveau:${m.fiche}`,
			genre: 'montee',
			fiche: m.fiche,
			texte: m.texte,
			detail,
			ancre: null,
			categorie: null,
			valideFin: null,
			vise: { niveau: p?.niveau ?? m.niveau, ...(regle ? { regle } : {}), proposee: p !== null },
		};
	});
	const modifications = fil.modifications.map((m): Proposition => ({
		cle: `modification:${m.fiche}`,
		genre: 'modification',
		fiche: m.fiche,
		texte: `Modifier ${m.cibles.join(', ')}`,
		detail: `Proposé par ${m.source}${m.date ? ` le ${m.date}` : ''}${m.changements.length > 0 ? ` : ${m.changements.join(' ; ')}` : ''}`,
		ancre: null,
		categorie: null,
		valideFin: null,
		vise: null,
	}));
	return [...faits, ...montees, ...modifications];
}

/** Corps de `proposer` pour le choix de l'utilisateur ; erreur si le choix n'a pas de sens pour cette proposition. */
export function demandePour(p: Proposition, choix: Choix): unknown {
	if (p.genre === 'a_confirmer') {
		if (p.ancre === null) throw new Error(`Information sans ancre dans ${p.fiche}.`);
		if (choix === 'confirmer' || choix === 'rejeter') return { genre: choix, fiche: p.fiche, ancre: p.ancre };
		const texte = choix.corriger.trim();
		if (!texte) throw new Error('La correction est vide.');
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
		throw new Error('Une modification proposée se confirme ou se rejette, elle ne se corrige pas.');
	}
	const vise = p.vise;
	if (vise === null) throw new Error(`Montée sans niveau visé dans ${p.fiche}.`);
	if (choix === 'confirmer') return { genre: 'niveau', fiche: p.fiche, niveau: vise.niveau, ...(vise.regle ? { regle: vise.regle } : {}), source: { ...SOURCE_UTILISATEUR } };
	if (choix === 'rejeter') {
		if (!vise.proposee) throw new Error(`Aucune proposition de session à rejeter pour ${titreFiche(p.fiche)}.`);
		return { genre: 'niveau', fiche: p.fiche, retirerProposition: true, source: { ...SOURCE_UTILISATEUR } };
	}
	throw new Error('Une montée de niveau se confirme ou se rejette, elle ne se corrige pas.');
}
