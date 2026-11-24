import { arbitrer, doitEtreConfirme } from '../../domaine/arbitrage.ts';
import type { Candidat, Existant } from '../../domaine/arbitrage.ts';
import { ecrireFait, estCategorie, estDate, faitsEgaux, lireFait, LONGUEUR_MAX_CITATION, LONGUEUR_MAX_FAIT, memeEnonce } from '../../domaine/fait.ts';
import type { Fait, Nature } from '../../domaine/fait.ts';
import { prochaineAncre } from '../../domaine/fiche.ts';
import type { Fiche, TypeFiche } from '../../domaine/fiche.ts';
import { nomDeLaFiche } from '../../domaine/chemin.ts';
import { confiance } from '../../domaine/regles.ts';
import type { Dependances } from '../ports.ts';
import { chargerRegles } from '../regles-du-coffre.ts';
import { ancreDeFait, aujourdhui, cheminDeFiche, cheminExistant, dossiersManquants, ecrireEtCommiter, enFichier, ficheDeSourceACreer, ficheVide, lireFicheExistante, mentionDeSource, motifCheminInvalide, motifCollision, motifSourceInvalide, motifTitreInvalide, motifTypeInvalide, refuse, TYPES_PERSONNELS, typeDeSourceDe } from '../commun.ts';
import type { Resultat, SourceProposee } from '../commun.ts';

export type DemandeFait = {
	genre: 'fait';
	fiche: string;
	titreSiNouvelle?: string;
	typeSiNouvelle?: TypeFiche;
	texte: string;
	categorie?: string;
	nature: Nature;
	source: SourceProposee;
	citation?: string;
	valideDebut?: string;
	valideFin?: string;
	/** Ancre du fait visé : sert à l'arbitrage, ne force pas le remplacement. */
	remplace?: string;
	/** La source annule et remplace le fait visé (nouvelle version du même document) : remplacement forcé. */
	annuleEtRemplace?: boolean;
	/** L'agent a vu les éléments proches et veut ajouter quand même : saute leur recherche. */
	apresProches?: boolean;
};

export function motifFaitInvalide(demande: DemandeFait): string | null {
	if (cheminDeFiche(demande.fiche) === null) return motifCheminInvalide(demande.fiche);
	if (demande.titreSiNouvelle !== undefined) {
		const motifTitre = motifTitreInvalide(demande.titreSiNouvelle);
		if (motifTitre !== null) return motifTitre;
	}
	if (demande.typeSiNouvelle !== undefined) {
		const motifType = motifTypeInvalide(demande.typeSiNouvelle);
		if (motifType !== null) return motifType;
		if (demande.typeSiNouvelle === 'consigne') return 'Une consigne passe par le genre consigne.';
		if (demande.typeSiNouvelle === 'profil') return 'Un profil ne s\'écrit pas par proposer.';
	}
	const texte = demande.texte.trim();
	if (texte === '') return 'Le texte de l\'information est vide.';
	if (texte.length > LONGUEUR_MAX_FAIT) return `Le texte de l'information dépasse ${LONGUEUR_MAX_FAIT} caractères.`;
	if (texte.includes(' | ') || texte.includes('~~')) return 'Le texte de l\'information ne doit contenir ni « | » entouré d\'espaces, ni « ~~ ».';
	if (/[\r\n]/u.test(demande.texte)) return 'Le texte de l\'information doit tenir sur une seule ligne.';
	const motifSource = motifSourceInvalide(demande.source);
	if (motifSource !== null) return motifSource;
	if (demande.citation !== undefined) {
		if (demande.citation.length > LONGUEUR_MAX_CITATION) return `La citation dépasse ${LONGUEUR_MAX_CITATION} caractères.`;
		if (/[\r\n]/u.test(demande.citation)) return 'La citation doit tenir sur une seule ligne.';
	}
	for (const date of [demande.valideDebut, demande.valideFin]) {
		if (date !== undefined && !estDate(date)) return `Date de validité invalide : « ${date} » (attendu AAAA-MM-JJ, date existante).`;
	}
	if (demande.valideDebut !== undefined && demande.valideFin !== undefined && demande.valideDebut > demande.valideFin) {
		return `Période de validité inversée : le début (${demande.valideDebut}) est après la fin (${demande.valideFin}).`;
	}
	if (demande.categorie !== undefined && !estCategorie(demande.categorie)) {
		return `Catégorie invalide : « ${demande.categorie} » (minuscules, chiffres, « _ » ou « - », 40 caractères au plus).`;
	}
	return null;
}

const doublon = (fiche: string, ancre: string | undefined): Resultat => (ancre === undefined ? { statut: 'doublon', fiche } : { statut: 'doublon', fiche, ancre });

export async function proposerFait(dep: Dependances, demande: DemandeFait): Promise<Resultat> {
	const motif = motifFaitInvalide(demande);
	if (motif !== null) return refuse(motif);
	const chemin = cheminDeFiche(demande.fiche)!;
	const source = mentionDeSource(demande.source);
	if (typeof source === 'string') return refuse(source);

	const regles = await chargerRegles(dep);
	const jour = aujourdhui(dep);

	const variante = await cheminExistant(dep, chemin);
	if (variante !== null) return refuse(variante);
	let fiche: Fiche;
	let nouvelle = false;
	if ((await dep.coffre.lire(chemin)) === null) {
		const collision = await motifCollision(dep, chemin);
		if (collision !== null) return refuse(collision);
		fiche = ficheVide(dep, chemin, demande.typeSiNouvelle ?? 'sujet', demande.titreSiNouvelle?.trim() ?? nomDeLaFiche(chemin));
		nouvelle = true;
	} else {
		const lue = await lireFicheExistante(dep, chemin);
		if (typeof lue === 'string') return refuse(lue);
		fiche = lue;
		if ((fiche.type === 'consigne' || fiche.type === 'profil') && !TYPES_PERSONNELS.includes(demande.source.type)) {
			return refuse(`Un document ne peut pas écrire une information dans ${chemin} (fiche de type ${fiche.type}).`);
		}
		fiche.updated = jour;
	}

	const fait: Fait = { texte: demande.texte.trim(), finIncluse: false, aConfirmer: false, barre: false };
	if (demande.categorie !== undefined) fait.categorie = demande.categorie;
	fait.nature = demande.nature;
	fait.source = source.mention;
	fait.appris = jour;
	if (demande.valideDebut !== undefined) fait.valideDebut = demande.valideDebut;
	if (demande.valideFin !== undefined) fait.valideFin = demande.valideFin;
	if (demande.citation !== undefined) fait.citation = demande.citation.trim();

	// Même énoncé qu'un fait vivant de la fiche : rien à écrire.
	for (const ligne of fiche.faits) {
		if ('fait' in ligne && !ligne.fait.barre && memeEnonce(fait, ligne.fait)) {
			return doublon(chemin, ligne.fait.ancre);
		}
	}

	const candidat: Candidat = {
		fait,
		typeSource: demande.source.type,
		remplaceExplicitement: demande.annuleEtRemplace === true,
		date: fait.valideDebut ?? jour,
	};
	let ancien: Fait | undefined;
	let existant: Existant | undefined;
	if (demande.remplace !== undefined) {
		const vise = ancreDeFait(demande.remplace, chemin);
		if ('motif' in vise) return refuse(vise.motif);
		for (const ligne of fiche.faits) {
			if ('fait' in ligne && ligne.fait.ancre === vise.ancre && !ligne.fait.barre) ancien = ligne.fait;
		}
		if (ancien === undefined) return refuse(`L'information à remplacer ^${vise.ancre} n'existe pas dans ${chemin} ou est déjà barrée.`);
		existant = { fait: ancien, typeSource: await typeDeSourceDe(dep, ancien), date: ancien.valideDebut ?? ancien.appris ?? jour };
	}
	const decision = arbitrer(regles, candidat, existant);
	if (decision === 'doublon') return doublon(chemin, ancien?.ancre);

	fait.confiance = confiance(regles, demande.source.type, demande.nature);
	// réglage `archiviste.typesAConfirmer` : une fiche de ces types ne reçoit une information qu'à confirmer
	fait.aConfirmer = doitEtreConfirme(regles, candidat, decision) || dep.reglages().archiviste.typesAConfirmer.includes(fiche.type);
	fait.ancre = prochaineAncre(fiche);
	if (decision === 'remplacer' && ancien !== undefined) {
		ancien.barre = true;
		ancien.invalideLe = jour;
		ancien.invalidePar = fait.ancre;
	}
	// Contradiction : on ne tranche pas ; le fait renvoie à celui qu'il contredit, que la confirmation barrera.
	if (decision === 'contradiction' && ancien?.ancre !== undefined) fait.contredit = ancien.ancre;

	const lignes = ecrireFait(fait);
	if (!faitsEgaux(lireFait(lignes[0]!, ...lignes.slice(1)), fait)) {
		return refuse('Cette information ne survivrait pas à sa relecture depuis la fiche : reformule le texte, la catégorie ou la source.');
	}
	fiche.faits.push({ fait });

	// Tout est sérialisé avant la première écriture ; la fiche principale s'écrit avant les autres.
	const aEcrire = [enFichier(dep, fiche)];
	if (nouvelle) {
		const dossiers = await dossiersManquants(dep, chemin);
		if (typeof dossiers === 'string') return refuse(dossiers);
		aEcrire.push(...dossiers.map((f) => enFichier(dep, f)));
	}
	const ficheSource = await ficheDeSourceACreer(dep, demande.source, source);
	if (typeof ficheSource === 'string') return refuse(ficheSource);
	if (ficheSource !== null) {
		aEcrire.push(enFichier(dep, ficheSource));
		// Comme toute fiche nouvelle : ses dossiers ascendants manquants, sans doublon avec ceux de la fiche principale.
		const dossiers = await dossiersManquants(dep, ficheSource.chemin);
		if (typeof dossiers === 'string') return refuse(dossiers);
		for (const dossier of dossiers) {
			if (!aEcrire.some((f) => f.chemin === dossier.chemin)) aEcrire.push(enFichier(dep, dossier));
		}
	}
	const commit = await ecrireEtCommiter(dep, aEcrire, `mnemo: information ${chemin}`);

	return { statut: 'ecrit', fiche: chemin, ancre: fait.ancre, aConfirmer: fait.aConfirmer, commit };
}
