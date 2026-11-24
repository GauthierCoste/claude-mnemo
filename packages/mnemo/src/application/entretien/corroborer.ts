import { ecrireFait, faitsEgaux, lireFait, LONGUEUR_MAX_CITATION, LONGUEUR_MAX_FAIT } from '../../domaine/fait.ts';
import type { Corroboration, Fait } from '../../domaine/fait.ts';
import { confianceActuelle, confianceAvecSource } from '../../domaine/confiance-cumulee.ts';
import { analyserFiche } from '../../domaine/fiche.ts';
import { ancreDeFait, aujourdhui, cheminDeFiche, cheminExistant, dossiersManquants, ecrireEtCommiter, enFichier, ficheDeSourceACreer, lireFicheExistante, mentionDeSource, motifCheminInvalide, motifSourceInvalide, refuse } from '../commun.ts';
import type { Resultat, SourceProposee } from '../commun.ts';
import type { Dependances } from '../ports.ts';
import { chargerRegles } from '../regles-du-coffre.ts';
import { motifIntouchable } from './garde.ts';
import { lireLaMemoire } from './memoire-lue.ts';
import { cleDeSource, sourcesDuFait } from './sources-du-fait.ts';

/** Ajoute à l'information `ancre` de la fiche `id` une source (`{ ref, type }` comme `proposer`) et sa citation facultative. */
export type DemandeCorroboration = { action: 'corroborer'; id: string; ancre: string; source: SourceProposee; citation?: string };

/**
 * Corrobore une information, en un commit `mnemo: corrobore <chemin>#^f-X` : une ligne `  + src: … | corroboré <jour>`
 * (et sa citation) s'ajoute sous elle, son texte ne change pas, sa confiance est recalculée (sources cumulées,
 * `confianceAvecSource`). Une fiche de source absente est créée comme par `proposer`, dans le même commit. Refusé : ancre
 * absente, information barrée, référence déjà présente (sa source ou une corroboration, liens résolus), consigne, profil,
 * chemin fixe. Appelant sous verrou.
 */
export async function corroborer(dep: Dependances, demande: DemandeCorroboration): Promise<Resultat> {
	const chemin = cheminDeFiche(demande.id);
	if (chemin === null) return refuse(motifCheminInvalide(demande.id));
	const motifSource = motifSourceInvalide(demande.source);
	if (motifSource !== null) return refuse(motifSource);
	const source = mentionDeSource(demande.source);
	if (typeof source === 'string') return refuse(source);
	const citation = demande.citation?.trim();
	if (citation !== undefined) {
		if (citation === '') return refuse('La citation est vide : omets-la, ou donne le passage cité.');
		if (citation.length > LONGUEUR_MAX_CITATION) return refuse(`La citation dépasse ${LONGUEUR_MAX_CITATION} caractères.`);
		if (/[\r\n]/u.test(citation)) return refuse('La citation doit tenir sur une seule ligne.');
	}
	const jour = aujourdhui(dep);
	const corroboration: Corroboration = { source: source.mention, le: jour };
	if (citation !== undefined) corroboration.citation = citation;
	if (ecrireFait({ texte: '-', finIncluse: false, aConfirmer: false, barre: false, corroborations: [corroboration] })[1]!.length > LONGUEUR_MAX_FAIT) {
		return refuse(`La ligne de la source (« + src: … | corroboré ${jour} ») dépasserait ${LONGUEUR_MAX_FAIT} caractères : raccourcis la référence.`);
	}

	const vise = ancreDeFait(demande.ancre, chemin);
	if ('motif' in vise) return refuse(vise.motif);
	const variante = await cheminExistant(dep, chemin);
	if (variante !== null) return refuse(variante);
	const memoire = await lireLaMemoire(dep);
	const texte = memoire.textes.get(chemin);
	if (texte === undefined) return refuse(`La fiche ${chemin} n'existe pas.`);
	const intouchable = motifIntouchable(chemin, analyserFiche(chemin, texte).fiche.type, memoire.textes.keys(), false);
	if (intouchable !== null) return refuse(intouchable);
	const fiche = await lireFicheExistante(dep, chemin);
	if (typeof fiche === 'string') return refuse(fiche);
	let fait: Fait | undefined;
	for (const ligne of fiche.faits) if ('fait' in ligne && ligne.fait.ancre === vise.ancre) fait = ligne.fait;
	if (fait === undefined) return refuse(`L'information ^${vise.ancre} n'existe pas dans ${chemin}.`);
	if (fait.barre) return refuse(`L'information ^${vise.ancre} de ${chemin} est barrée : elle ne se corrobore pas (propose plutôt une information nouvelle).`);

	const sources = await sourcesDuFait(dep, fait, memoire.designee);
	const cle = cleDeSource(source.mention, memoire.designee);
	const deja = sources.find((s) => s.cle === cle);
	if (deja !== undefined) {
		return refuse(`L'information ^${vise.ancre} cite déjà cette référence (${deja.mention}) : une même source ne compte qu'une fois. Corrobore-la par une autre source.`);
	}

	const regles = await chargerRegles(dep);
	const ecrite = fait.confiance !== undefined;
	const avant = confianceActuelle(regles, fait, sources);
	fait.confiance = confianceAvecSource(regles, fait, sources, demande.source.type);
	fait.corroborations = [...(fait.corroborations ?? []), corroboration];
	const lignes = ecrireFait(fait);
	if (!faitsEgaux(lireFait(lignes[0]!, ...lignes.slice(1)), fait)) {
		return refuse('Cette source ne survivrait pas à sa relecture depuis la fiche : reformule la référence ou la citation.');
	}
	fiche.updated = jour;

	const aEcrire = [enFichier(dep, fiche)];
	const ficheSource = await ficheDeSourceACreer(dep, demande.source, source);
	if (typeof ficheSource === 'string') return refuse(ficheSource);
	if (ficheSource !== null) {
		aEcrire.push(enFichier(dep, ficheSource));
		const dossiers = await dossiersManquants(dep, ficheSource.chemin);
		if (typeof dossiers === 'string') return refuse(dossiers);
		aEcrire.push(...dossiers.map((d) => enFichier(dep, d)));
	}
	const commit = await ecrireEtCommiter(dep, aEcrire, `mnemo: corrobore ${chemin}#^${vise.ancre}`);
	const changements = [
		`source ajoutée : ${source.mention}`,
		`confiance ${avant} %${ecrite ? '' : ' (non écrite : celle de sa première source)'} → ${fait.confiance} %`,
		...(ficheSource === null ? [] : [`fiche de source créée : ${ficheSource.chemin}`]),
	];
	return { statut: 'ecrit', fiche: chemin, ancre: vise.ancre, aConfirmer: false, commit, changements };
}
