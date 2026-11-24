import { lireFiche } from '../../domaine/fiche.ts';
import type { Session } from '../../domaine/session.ts';
import { dateLocale, ecrireEpisode, enTexteEpisode, FICHIERS_EPISODE_MAX, horodatageLocal, trouverEpisode } from '../episode.ts';
import type { ContenuEpisode } from '../episode.ts';
import type { Dependances } from '../ports.ts';
import { motifTitreInvalide, refuse } from '../commun.ts';
import type { Resultat } from '../commun.ts';

/**
 * Épisode de la session, rédigé par Claude au bilan : `synthese` (ce qui s'est passé), `decisions` (une
 * par ligne, avec sa raison), `resultat`, `fichiers` touchés (50 au plus).
 */
export type DemandeEpisode = { genre: 'episode'; titre: string; synthese: string; decisions?: string[]; resultat?: string; fichiers?: string[] };

const RE_TITRE_DE_SECTION = /^#{1,2} /mu;
const LONGUEUR_MAX_LIGNE = 1000;

/** Motif de refus de la forme de l'épisode (hors session), sinon null. */
function motifEpisodeInvalide(d: DemandeEpisode): string | null {
	const motifTitre = motifTitreInvalide(d.titre);
	if (motifTitre !== null) return motifTitre;
	if (d.synthese.trim() === '') return 'La synthèse de l\'épisode est vide.';
	if (RE_TITRE_DE_SECTION.test(d.synthese)) return 'La synthèse ne doit pas contenir de titre « # » ou « ## ».';
	if (d.resultat !== undefined && RE_TITRE_DE_SECTION.test(d.resultat)) return 'Le résultat ne doit pas contenir de titre « # » ou « ## ».';
	for (const decision of d.decisions ?? []) {
		if (decision.trim() === '') return 'Une décision est vide.';
		if (/[\r\n]/u.test(decision)) return 'Chaque décision tient sur une seule ligne.';
		if (decision.length > LONGUEUR_MAX_LIGNE) return `Une décision dépasse ${LONGUEUR_MAX_LIGNE} caractères.`;
	}
	const fichiers = d.fichiers ?? [];
	if (fichiers.length > FICHIERS_EPISODE_MAX) return `Au plus ${FICHIERS_EPISODE_MAX} fichiers touchés (${fichiers.length} reçus).`;
	for (const fichier of fichiers) {
		if (fichier.trim() === '' || /[\r\n]/u.test(fichier) || fichier.length > LONGUEUR_MAX_LIGNE) return `Fichier touché invalide : « ${fichier.slice(0, 80)} » (une ligne non vide).`;
	}
	return null;
}

/** La session d'origine, d'après l'état des sessions ; null si l'état manque ou ne la connaît pas. */
async function sessionDOrigine(dep: Dependances, id: string): Promise<Session | null> {
	try {
		return (await dep.sessions?.lire(id)) ?? null;
	} catch {
		return null;
	}
}

/**
 * Écrit (ou remplace sur place) l'épisode de la session d'origine (`dep.origine`), sous verrou (appelant). Session connue de
 * l'état : son projet, son début, son profil, sa branche, son objectif ; inconnue : ceux de son épisode déjà écrit (retrouvé
 * par son id), sinon aucun début (le nom prend la date du jour). `fin` : maintenant ; fichiers touchés : ceux donnés, sinon
 * ceux de l'épisode remplacé ; source `session <id>`. Secrets masqués.
 */
export async function proposerEpisode(dep: Dependances, demande: DemandeEpisode): Promise<Resultat> {
	const origine = dep.origine;
	if (origine === undefined) return refuse('Un épisode s\'écrit seulement dans une session Mnemo (au bilan de fin de session).');
	const motif = motifEpisodeInvalide(demande);
	if (motif !== null) return refuse(motif);
	const maintenant = dep.systeme.maintenant().getTime();
	const session = await sessionDOrigine(dep, origine.session);
	const projet = session?.projet ?? origine.projet;
	const ancien = await trouverEpisode(dep, origine.session, projet);
	const avant = ancien?.fiche.donnees ?? {};
	const debutAncien = typeof avant.debut === 'string' ? avant.debut : null;
	const debut = session !== null ? horodatageLocal(session.creeeMs) : debutAncien;
	const fichiers = demande.fichiers?.map((f) => f.trim()) ?? (Array.isArray(avant.fichiers) ? avant.fichiers.slice(0, FICHIERS_EPISODE_MAX) : []);
	const profil = session?.profil ?? (typeof avant.profil === 'string' ? avant.profil : null);
	const contenu: ContenuEpisode = {
		session: origine.session,
		projet,
		// le nom d'un nouvel épisode : date du début, sinon du jour (un épisode existant garde son chemin)
		date: debut?.slice(0, 10) ?? dateLocale(maintenant),
		titre: demande.titre,
		titreDeRepli: `Session ${profil ?? 'Mnemo'}`,
		synthese: demande.synthese,
		decisions: demande.decisions ?? [],
		resultat: demande.resultat ?? '',
		donnees: {
			session: origine.session,
			profil,
			debut,
			fin: horodatageLocal(maintenant),
			branche: session?.branche ?? avant.branche ?? null,
			objectif: session?.objectif ?? avant.objectif ?? null,
			fichiers,
			source: `session ${origine.session}`,
		},
	};
	// la fiche doit se relire telle quelle (titre, synthèse, sections)
	try {
		const { chemin, texte, fiche } = enTexteEpisode(dep, contenu);
		const relue = lireFiche(chemin, texte);
		if (relue.titre !== fiche.titre || relue.synthese !== fiche.synthese || JSON.stringify(relue.autresSections) !== JSON.stringify(fiche.autresSections)) throw new Error('différence');
	} catch {
		return refuse('Cet épisode ne survivrait pas à sa relecture : reformule le titre, la synthèse, les décisions ou le résultat.');
	}
	const r = await ecrireEpisode(dep, contenu, { minimal: false });
	if (r.statut === 'ecrit') return { statut: 'ecrit', fiche: r.chemin, aConfirmer: false, commit: r.commit };
	return { statut: 'doublon', fiche: r.chemin };
}
