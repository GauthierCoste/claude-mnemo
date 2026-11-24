import { empreinte } from '../domaine/empreinte.ts';
import { messageDErreur } from '../domaine/texte.ts';
import { elementsDeFiche } from '../domaine/elements.ts';
import { typeLePlusStrict } from '../domaine/regles.ts';
import { masquerSecrets } from '../domaine/secrets.ts';
import type { TypeSource } from '../domaine/regles.ts';
import { consignesIndexees, ficheDeMention, typeDeMention } from './commun.ts';
import type { AvecAvertissements } from '@mnemo/commun';
import { synchroniserPassages } from './passages-sources.ts';
import type { OptionsPassages } from './passages-sources.ts';
import { CHEMIN_SCHEMA } from './regles-du-coffre.ts';
import type { Dependances } from './ports.ts';

/** `motifs` (seulement s'il y en a) : pourquoi chaque illisible l'est, et les avis (« N fils nouveaux : relancer extraire_source »), en français. */
/** `avis` (seulement s'il y en a) : fiches de documents à compléter, par fiche (« N fils nouveaux : relancer extraire_source ») ; aussi dans `motifs`. */
/** `incompletes` (seulement s'il y en a) : sources indexées en partie, par fiche, et pourquoi (texte coupé, message écarté…). */
export type BilanSynchro = {
	ajoutees: number;
	modifiees: number;
	retirees: number;
	illisibles: string[];
	motifs?: Record<string, string>;
	avis?: Record<string, string>;
	incompletes?: Record<string, string>;
	/** Sans extraction (seulement s'il y en a) : sources dont le document a changé, pas encore réindexées. */
	differees?: string[];
};

const masque = (texte: string): string => masquerSecrets(texte).texte;

/** Pour les chemins sensibles à la latence (hooks, `servir`, proches avant écriture) : l'index sert tel quel, aucun document n'est extrait. */
export const SANS_EXTRACTION: OptionsPassages = { extraire: false };
const AVEC_EXTRACTION: OptionsPassages = { extraire: true };

const ILLISIBLE = Symbol('illisible');

/**
 * Met l'index d'accord avec le coffre : (mtime, taille) comme filtre rapide, l'empreinte du contenu pour confirmer.
 * Sans changement, aucune lecture de contenu. Le port `Index` reste inchangé : une fiche dont seul l'horodatage a bougé est
 * réindexée à l'identique par `remplacer` (le contenu a déjà été lu).
 * Une fiche qu'on ne peut pas lire (verrou, droits) est sautée et rendue dans `illisibles` : son ancienne entrée est gardée.
 * Une erreur de l'index, elle, remonte.
 * Puis les passages des documents (`synchroniserPassages`) : une source dont l'extraction échoue est aussi dans `illisibles`.
 * `options.extraire` faux (hooks) : aucun document n'est lu ni extrait, l'index sert tel quel.
 * Rien d'une fiche `source` (titre, synthèse, faits, alias) n'entre dans l'index sans que ses secrets soient masqués.
 */
/** La mémoire indexée contient-elle au moins une consigne vérifiée (toutes portées) ? */
async function contientDesConsignesVerifiees(dep: Dependances): Promise<boolean> {
	return (await consignesIndexees(dep, ['verifiee'])).length > 0;
}

export async function synchroniser(dep: Dependances, options: OptionsPassages = AVEC_EXTRACTION): Promise<BilanSynchro> {
	const { coffre, index } = dep;
	const etats = (await coffre.etats()).filter((e) => e.chemin !== CHEMIN_SCHEMA);
	const etatDe = new Map(etats.map((e) => [e.chemin, e]));
	const indexees = new Map((await index.fiches()).map((f) => [f.chemin, f]));
	const cacheSources = new Map<string, TypeSource>();
	const refaites = new Set<string>();
	const aRefaire = new Set<string>();
	/** Chemin → motif. */
	const illisibles = new Map<string, string>();
	/** Texte des fiches `source` réindexées : leur descripteur (et leur contenu amorcé) en est tiré sans relecture. */
	const textesDeSources = new Map<string, string>();
	let ajoutees = 0;
	let modifiees = 0;
	let retirees = 0;

	// Les faits qui citent une fiche source en portent le type : ils sont réindexés quand elle change, disparaît ou apparaît.
	const noterCitants = async (chemin: string, estSource: boolean): Promise<void> => {
		if (!estSource) return;
		for (const lien of (await index.liens(chemin)).entrants) aRefaire.add(lien.de);
	};
	const etaitSource = async (chemin: string): Promise<boolean> => (await index.element(chemin))?.typeFiche === 'source';
	/** Fiche citée par une mention, si c'est une fiche `source` ; mise en cache le temps de la synchronisation. */
	const sourcesCitees = new Map<string, string | null>();
	const ficheCitee = async (mention: string): Promise<string | null> => {
		if (!sourcesCitees.has(mention)) sourcesCitees.set(mention, await ficheDeMention(dep, mention));
		return sourcesCitees.get(mention)!;
	};

	/** Contenu de la fiche, null si elle a disparu, ILLISIBLE si la lecture échoue pour une autre raison. */
	const lire = async (chemin: string): Promise<string | null | typeof ILLISIBLE> => {
		try {
			return await coffre.lire(chemin);
		} catch (erreur) {
			if ((erreur as { code?: unknown }).code === 'ENOENT') return null;
			illisibles.set(chemin, `lecture impossible : ${erreur instanceof Error ? erreur.message : String(erreur)}`);
			return ILLISIBLE;
		}
	};

	/** Réindexe un contenu lu ; rend son empreinte. */
	const indexer = async (chemin: string, mtimeMs: number, taille: number, texte: string): Promise<string> => {
		const nouvelle = empreinte(texte);
		const contenu = elementsDeFiche(chemin, texte);
		for (const element of contenu.elements) {
			// Source qui n'est pas un type personnel : un document, donc encadré ; « inconnue » à défaut de mieux.
			if (element.source !== null && element.typeSource === null) element.typeSource = await typeDeMention(dep, element.source, cacheSources);
			// Tout ce qu'une fiche source contient vient du document : marqué de son type (le plus strict l'emporte) et sourcé.
			if (contenu.typeDocument !== null) {
				element.typeSource = typeLePlusStrict(element.typeSource, contenu.typeDocument);
				element.source ??= chemin;
			}
			// Fiche source citée : son fichier disparu, l'élément prend le statut dérivé `source_disparue`.
			element.ficheCitee = (element.source === null ? null : await ficheCitee(element.source)) ?? (contenu.typeDocument !== null ? chemin : null);
		}
		if (contenu.typeDocument !== null) {
			textesDeSources.set(chemin, texte);
			// Une fiche source recopie son document (titre, résumé, note amorcée) : ses secrets restent hors de l'index.
			contenu.titre = masque(contenu.titre);
			contenu.alias = contenu.alias.map(masque);
			for (const element of contenu.elements) {
				element.texte = masque(element.texte);
				element.contexte = masque(element.contexte);
			}
		}
		await index.remplacer({ chemin, empreinte: nouvelle, mtimeMs, taille }, contenu);
		refaites.add(chemin);
		return nouvelle;
	};

	for (const chemin of indexees.keys()) {
		if (etatDe.has(chemin)) continue;
		await noterCitants(chemin, await etaitSource(chemin));
		await index.retirer(chemin);
		retirees++;
	}

	for (const etat of etats) {
		const connue = indexees.get(etat.chemin);
		if (connue !== undefined && connue.mtimeMs === etat.mtimeMs && connue.taille === etat.taille) continue;
		await noterCitants(etat.chemin, await etaitSource(etat.chemin));
		const texte = await lire(etat.chemin);
		// Illisible : l'ancienne entrée est gardée ; son horodatage indexé n'a pas bougé, elle est réessayée la fois suivante.
		if (texte === ILLISIBLE) continue;
		if (texte === null) {
			// disparue entre `etats` et `lire`
			if (connue !== undefined) {
				await index.retirer(etat.chemin);
				retirees++;
			}
			continue;
		}
		const nouvelle = await indexer(etat.chemin, etat.mtimeMs, etat.taille, texte);
		// une fiche devenue source (nouvelle, ou d'un autre type avant) : ses citants prennent son type
		await noterCitants(etat.chemin, await etaitSource(etat.chemin));
		if (connue === undefined) ajoutees++;
		else if (connue.empreinte !== nouvelle) modifiees++;
	}

	for (const chemin of aRefaire) {
		const etat = etatDe.get(chemin);
		if (etat === undefined || refaites.has(chemin)) continue;
		const texte = await lire(chemin);
		// Illisible : gardée telle quelle (signalée) ; disparue : retirée à la prochaine synchronisation.
		if (texte === ILLISIBLE || texte === null) continue;
		await indexer(chemin, etat.mtimeMs, etat.taille, texte);
	}

	const avis = new Map<string, string>();
	const incompletes = new Map<string, string>();
	const differees = new Set<string>();
	await synchroniserPassages(dep, textesDeSources, illisibles, options, avis, incompletes, differees);
	await dep.indicateur.noter(await contientDesConsignesVerifiees(dep), dep.systeme.maintenant().getTime());

	const bilan: BilanSynchro = { ajoutees, modifiees, retirees, illisibles: [...illisibles.keys()].sort() };
	// Les avis (fils nouveaux d'un `.mbox`) rejoignent les motifs, sans compter comme illisibles.
	if (illisibles.size > 0 || avis.size > 0) bilan.motifs = Object.fromEntries([...avis, ...illisibles]);
	if (avis.size > 0) bilan.avis = Object.fromEntries(avis);
	if (incompletes.size > 0) bilan.incompletes = Object.fromEntries(incompletes);
	if (differees.size > 0) bilan.differees = [...differees].sort();
	return bilan;
}

/** Avertissements des fiches de `fiches` dont les passages n'ont pas pu être indexés par la synchronisation `bilan`. */
export function avertissementsPassages(bilan: BilanSynchro, fiches: ReadonlySet<string>): string[] {
	return Object.entries(bilan.motifs ?? {})
		.filter(([fiche]) => fiches.has(fiche))
		.map(([fiche, motif]) => `Passages non indexés pour ${fiche} : ${motif}`);
}

/** Avertissement d'une écriture faite dont la réindexation a échoué (`message` : la cause). */
export function avertissementIndex(message: string): string {
	return `Écriture faite, mais l'index n'a pas pu être mis à jour : ${message} ; il le sera à la prochaine synchronisation.`;
}

/**
 * Synchronise après une écriture faite, hors verrou : rend le bilan. Un échec n'annule pas l'écriture : il rend des
 * avertissements, et l'indicateur des consignes vérifiées devient illisible (strict pour le hook `outil`) ; s'il ne peut
 * pas l'être, cette erreur s'ajoute aux avertissements.
 */
export async function synchroniserApresEcriture(dep: Dependances, options: OptionsPassages): Promise<{ bilan: BilanSynchro } | { avertissements: string[] }> {
	try {
		return { bilan: await synchroniser(dep, options) };
	} catch (erreur) {
		const avertissements = [avertissementIndex(messageDErreur(erreur))];
		try {
			await dep.indicateur.marquerIllisible(dep.systeme.maintenant().getTime());
		} catch (autre) {
			avertissements.push(`L'indicateur des consignes vérifiées n'a pas pu être marqué « pas à jour » : ${messageDErreur(autre)}.`);
		}
		return { avertissements };
	}
}

/** Réindexe après une écriture (sans extraction par défaut) : un succès, avec des avertissements si l'index a échoué. */
export async function reindexerApresEcriture(dep: Dependances, options: OptionsPassages = SANS_EXTRACTION): Promise<AvecAvertissements> {
	const r = await synchroniserApresEcriture(dep, options);
	return 'bilan' in r ? {} : r;
}
