import { lireConsigne, niveauPropose } from '../domaine/consigne.ts';
import type { Consigne, Niveau } from '../domaine/consigne.ts';
import type { ElementIndexe } from '../domaine/elements.ts';
import { appliquerCibles, lireModificationProposee, nomsDesCibles, TYPES_A_CONFIRMER } from '../domaine/modification.ts';
import { aujourdhui, lireFicheExistante } from './commun.ts';
import type { Dependances } from './ports.ts';
import { chargerRegles } from './regles-du-coffre.ts';

/** Commits relus au plus (la limite du journal). */
const COMMITS_MAX = 500;
const RE_JOUR = /^(\d{4})-(\d{2})-(\d{2})$/u;

/**
 * « Appris aujourd'hui » : rien n'est stocké, tout se relit de l'historique git et de l'index.
 * `montees` : `niveau` est le niveau visé (celui de la proposition d'une session, sinon la montée suggérée par les
 * répétitions) ; `proposition` n'est posée que pour une proposition de session. Confirmer, corriger, rejeter = `proposer`.
 */
export type Fil = {
	commits: { hash: string; dateMs: number; message: string; fiches: string[]; session: string | null }[];
	/** Vrai si le journal a atteint sa limite (500) : des commits plus anciens du jour manquent peut-être. */
	tronque: boolean;
	aConfirmer: ElementIndexe[];
	montees: { fiche: string; texte: string; niveau: Niveau; proposition: NonNullable<Consigne['proposition']> | null }[];
	/** Modifications de consignes et de profils proposées par une session : `changements`, ce qu'elles changeraient. */
	modifications: { fiche: string; titre: string; cibles: string[]; changements: string[]; date: string; source: string }[];
};

/** Début du jour `AAAA-MM-JJ` (heure locale) et du suivant (en millisecondes, et au format `AAAA-MM-JJ`) ; null si la date est mal formée. */
function bornesDuJour(jour: string): [number, number, string] | null {
	const m = RE_JOUR.exec(jour);
	if (m === null) return null;
	const [annee, mois, j] = [Number(m[1]), Number(m[2]), Number(m[3])];
	const debut = new Date(annee, mois - 1, j);
	if (debut.getFullYear() !== annee || debut.getMonth() !== mois - 1 || debut.getDate() !== j) return null;
	const suivant = new Date(annee, mois - 1, j + 1);
	const deux = (n: number) => String(n).padStart(2, '0');
	return [debut.getTime(), suivant.getTime(), `${suivant.getFullYear()}-${deux(suivant.getMonth() + 1)}-${deux(suivant.getDate())}`];
}

/** Le fil du jour (aujourd'hui par défaut, `AAAA-MM-JJ` en heure locale) : commits, éléments à confirmer, montées de niveau, modifications proposées. */
export async function filDuJour(dep: Dependances, jour: string = aujourdhui(dep)): Promise<Fil> {
	const bornes = bornesDuJour(jour);
	if (bornes === null) throw new Error(`Date invalide : « ${jour} » (attendu AAAA-MM-JJ).`);
	const [debut, fin, lendemain] = bornes;

	// Le journal s'arrête à la fin du jour : des commits plus récents ne noient pas ceux du jour demandé.
	const journal = await dep.historique.journal(jour, COMMITS_MAX, lendemain);
	const commits = journal
		.filter((c) => c.dateMs >= debut && c.dateMs < fin)
		.map((c) => ({ hash: c.hash, dateMs: c.dateMs, message: c.message, fiches: c.fichiers.filter((f) => f.endsWith('.md')), session: c.session }));

	const aConfirmer = await dep.index.elements({ statuts: ['a_confirmer'] });

	const regles = await chargerRegles(dep);
	const montees: Fil['montees'] = [];
	for (const element of await dep.index.elements({ genres: ['consigne'] })) {
		const fiche = await lireFicheExistante(dep, element.chemin);
		if (typeof fiche === 'string') continue; // fiche illisible : ignorée
		const consigne = lireConsigne(fiche);
		const proposition = consigne.proposition ?? null;
		const niveau = proposition?.niveau ?? niveauPropose(regles, consigne);
		if (niveau === null) continue;
		montees.push({ fiche: element.chemin, texte: consigne.texte, niveau, proposition });
	}
	const modifications: Fil['modifications'] = [];
	const vues = new Set<string>();
	for (const element of await dep.index.elements({ typesFiche: [...TYPES_A_CONFIRMER] })) {
		if (vues.has(element.chemin)) continue;
		vues.add(element.chemin);
		const fiche = await lireFicheExistante(dep, element.chemin);
		if (typeof fiche === 'string') continue;
		const proposee = lireModificationProposee(fiche.donnees);
		if (proposee === undefined) continue;
		const { changements } = appliquerCibles(fiche, proposee.cibles);
		modifications.push({ fiche: fiche.chemin, titre: fiche.titre, cibles: nomsDesCibles(proposee.cibles), changements, date: proposee.date, source: proposee.source });
	}
	return { commits, tronque: journal.length >= COMMITS_MAX, aConfirmer, montees, modifications };
}
