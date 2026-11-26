import { ecrireFait, estCategorie, faitsEgaux, lireFait, LONGUEUR_MAX_FAIT } from '../../domaine/fait.ts';
import type { Fait } from '../../domaine/fait.ts';
import { analyserFiche } from '../../domaine/fiche.ts';
import { retoucheDeSens } from '../../domaine/retouche.ts';
import { ancreDeFait, aujourdhui, cheminDeFiche, cheminExistant, ecrireEtCommiter, enFichier, lireFicheExistante, motifCheminInvalide, refuse } from '../commun.ts';
import type { Resultat } from '../commun.ts';
import type { Dependances } from '../ports.ts';
import { chargerRegles } from '../regles-du-coffre.ts';
import { motifIntouchable } from './garde.ts';

/** Corrige la forme de l'information `ancre` de la fiche `id` : son texte, sa catégorie, ou les deux (au moins un). */
export type DemandeRetouche = { action: 'retoucher_information'; id: string; ancre: string; texte?: string; categorie?: string };

/** Motif de refus de la forme d'une retouche (texte et catégorie donnés), sinon null. */
function motifRetoucheInvalide(demande: DemandeRetouche): string | null {
	if (demande.texte === undefined && demande.categorie === undefined) return 'Rien à retoucher : donner un `texte`, une `categorie`, ou les deux.';
	if (demande.texte !== undefined) {
		const texte = demande.texte.trim();
		if (texte === '') return 'Le texte de l\'information est vide.';
		if (texte.length > LONGUEUR_MAX_FAIT) return `Le texte de l'information dépasse ${LONGUEUR_MAX_FAIT} caractères.`;
		if (texte.includes(' | ') || texte.includes('~~')) return 'Le texte de l\'information ne doit contenir ni « | » entouré d\'espaces, ni « ~~ ».';
		if (/[\r\n]/u.test(demande.texte)) return 'Le texte de l\'information doit tenir sur une seule ligne.';
	}
	if (demande.categorie !== undefined && !estCategorie(demande.categorie)) {
		return `Catégorie invalide : « ${demande.categorie} » (minuscules, chiffres, « _ » ou « - », 40 caractères au plus).`;
	}
	return null;
}

/**
 * Retouche une information en place, en un commit `mnemo: retouche <chemin>#^f-X` : même ancre, mêmes sources, dates,
 * confiance et statut, rien de barré. Seulement la forme : refusé si le sens change (`retoucheDeSens` : nombre, date,
 * durée, montant, catégorie à fort enjeu, écart de texte au-delà d'une correction), le refus renvoyant à `proposer` avec
 * `remplace`. Refusé aussi : ancre absente, information barrée, rien de changé, consigne, profil, chemin fixe. Appelant
 * sous verrou.
 */
export async function retoucherInformation(dep: Dependances, demande: DemandeRetouche): Promise<Resultat> {
	const chemin = cheminDeFiche(demande.id);
	if (chemin === null) return refuse(motifCheminInvalide(demande.id));
	const motif = motifRetoucheInvalide(demande);
	if (motif !== null) return refuse(motif);
	const vise = ancreDeFait(demande.ancre, chemin);
	if ('motif' in vise) return refuse(vise.motif);
	const variante = await cheminExistant(dep, chemin);
	if (variante !== null) return refuse(variante);
	const texte = await dep.coffre.lire(chemin);
	if (texte === null) return refuse(`La fiche ${chemin} n'existe pas.`);
	const intouchable = motifIntouchable(chemin, analyserFiche(chemin, texte).fiche.type, [], false);
	if (intouchable !== null) return refuse(intouchable);
	const fiche = await lireFicheExistante(dep, chemin);
	if (typeof fiche === 'string') return refuse(fiche);
	let fait: Fait | undefined;
	for (const ligne of fiche.faits) if ('fait' in ligne && ligne.fait.ancre === vise.ancre) fait = ligne.fait;
	if (fait === undefined) return refuse(`L'information ^${vise.ancre} n'existe pas dans ${chemin}.`);
	if (fait.barre) return refuse(`L'information ^${vise.ancre} de ${chemin} est barrée : elle reste telle quelle, pour l'historique.`);

	const avant = { texte: fait.texte, ...(fait.categorie === undefined ? {} : { categorie: fait.categorie }) };
	const apres = { texte: demande.texte?.trim() ?? fait.texte, ...((demande.categorie ?? fait.categorie) === undefined ? {} : { categorie: demande.categorie ?? fait.categorie! }) };
	if (apres.texte === avant.texte && apres.categorie === avant.categorie) return refuse(`L'information ^${vise.ancre} est déjà ainsi : rien à retoucher.`);
	const regles = await chargerRegles(dep);
	const sens = retoucheDeSens(avant, apres, regles.categoriesAEnjeu);
	if (sens !== null) return refuse(`${sens} (information à remplacer : ${chemin}#^${vise.ancre})`);

	fait.texte = apres.texte;
	if (apres.categorie !== undefined) fait.categorie = apres.categorie;
	const lignes = ecrireFait(fait);
	if (!faitsEgaux(lireFait(lignes[0]!, ...lignes.slice(1)), fait)) {
		return refuse('Cette information ne survivrait pas à sa relecture depuis la fiche : reformuler le texte ou la catégorie.');
	}
	fiche.updated = aujourdhui(dep);
	const commit = await ecrireEtCommiter(dep, [enFichier(dep, fiche)], `mnemo: retouche ${chemin}#^${vise.ancre}`);
	const changements = [
		...(apres.texte === avant.texte ? [] : [`texte : « ${avant.texte} » → « ${apres.texte} »`]),
		...(apres.categorie === avant.categorie ? [] : [`catégorie : ${avant.categorie ?? 'aucune'} → ${apres.categorie ?? 'aucune'}`]),
	];
	return { statut: 'ecrit', fiche: chemin, ancre: vise.ancre, aConfirmer: false, commit, changements };
}
