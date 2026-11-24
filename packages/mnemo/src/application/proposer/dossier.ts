import { cheminValide, cleDeCasse, estCache, ficheDeDossier } from '../../domaine/chemin.ts';
import { lireFiche } from '../../domaine/fiche.ts';
import type { Dependances, RetraitDossier } from '../ports.ts';
import { refuse } from '../commun.ts';
import type { Resultat } from '../commun.ts';

/** Retire un dossier vide de la mémoire (rien d'autre que des `.DS_Store`, des sous-dossiers vides, et sa propre fiche de dossier). */
export type DemandeRetraitDossier = { genre: 'retirer_dossier'; dossier: string };

const APERCU = 3;

/** Ce que contient un dossier non vide, pour le dire dans le refus. */
async function contenu(dep: Dependances, dossier: string): Promise<string> {
	const { fiches, dossiers } = await dep.coffre.lister(dossier);
	const noms = [...fiches, ...dossiers.map((d) => `${d}/`)].map((c) => c.slice(dossier.length + 1));
	if (noms.length === 0) return 'il contient des fichiers qui ne sont pas des fiches';
	const apercu = noms.slice(0, APERCU).join(', ');
	return `il contient ${apercu}${noms.length > APERCU ? ` et ${noms.length - APERCU} autre(s)` : ''}`;
}

/**
 * Le dossier dans sa casse sur le disque (« Clients » → « clients/ » existant), segment par segment ; un segment introuvable
 * est gardé tel quel (le retrait dira « absent »). Sur un disque insensible à la casse, git ne connaît que la casse réelle.
 */
async function casseReelle(dep: Dependances, dossier: string): Promise<string> {
	let courant = '';
	for (const segment of dossier.split('/')) {
		const voulu = courant === '' ? segment : `${courant}/${segment}`;
		const { dossiers } = await dep.coffre.lister(courant);
		courant = dossiers.find((d) => d === voulu) ?? dossiers.find((d) => cleDeCasse(d) === cleDeCasse(voulu)) ?? voulu;
	}
	return courant;
}

/**
 * Retrait d'un dossier qui ne contient plus que sa fiche de dossier (`d/d.md`, de type `dossier`) : la fiche part avec lui.
 * Rend la fiche retirée (chemin et texte, pour la remettre si le commit échoue), ou null si le dossier ne contient pas que sa fiche (rien n'est touché). Si le dossier reste
 * non vide une fois la fiche retirée (un fichier qui n'est pas une fiche), la fiche est remise.
 */
async function retraitAvecSaFiche(dep: Dependances, dossier: string): Promise<{ chemin: string; texte: string } | null> {
	const { fiches, dossiers } = await dep.coffre.lister(dossier);
	const fiche = ficheDeDossier(dossier);
	if (dossiers.length > 0 || fiches.length !== 1 || cleDeCasse(fiches[0]!) !== cleDeCasse(fiche)) return null;
	const chemin = fiches[0]!;
	const texte = await dep.coffre.lire(chemin);
	if (texte === null) return null;
	try {
		if (lireFiche(chemin, texte).type !== 'dossier') return null;
	} catch {
		return null;
	}
	await dep.coffre.supprimer(chemin);
	try {
		const retrait = await dep.coffre.retirerDossierVide(dossier);
		if (retrait !== 'retire') await dep.coffre.ecrire(chemin, texte);
		return retrait === 'retire' ? { chemin, texte } : null;
	} catch (erreur) {
		await dep.coffre.ecrire(chemin, texte).catch(() => {});
		throw erreur;
	}
}

/**
 * À appeler sous verrou. Retire le dossier s'il est vide (`Coffre.retirerDossierVide`) ; refusé s'il contient une fiche ou
 * tout autre fichier (hors `.DS_Store`), si c'est la racine, un dossier caché, ou si le chemin traverse un lien symbolique.
 * Un commit seulement si un fichier suivi par git disparaît (un `.DS_Store` versionné) : jamais de commit vide.
 */
export async function proposerRetraitDossier(dep: Dependances, demande: DemandeRetraitDossier): Promise<Resultat> {
	const brut = demande.dossier.replace(/\\/gu, '/').replace(/\/+$/u, '');
	if (brut === '' || brut === '.') return refuse('La racine de la mémoire ne se retire pas.');
	const valide = cheminValide(brut);
	if (valide === null) return refuse(`Dossier invalide : « ${demande.dossier} » (relatif à la mémoire, séparé par « / », sans « .. »).`);
	if (estCache(valide)) return refuse(`Dossier caché : « ${valide} » (commençant par « . ») : Mnemo n'y touche pas.`);
	const dossier = await casseReelle(dep, valide);

	let retrait = await dep.coffre.retirerDossierVide(dossier);
	let saFiche: { chemin: string; texte: string } | null = null;
	if (retrait === 'non_vide') {
		saFiche = await retraitAvecSaFiche(dep, dossier);
		if (saFiche !== null) retrait = 'retire';
	}
	switch (retrait) {
		case 'racine':
			return refuse('La racine de la mémoire ne se retire pas.');
		case 'lien':
			return refuse(`Le chemin « ${dossier} » traverse un lien symbolique : rien n'est retiré.`);
		case 'absent':
			return refuse(`Le dossier ${dossier} n'existe pas.`);
		case 'pas_un_dossier':
			return refuse(`${dossier} n'est pas un dossier.`);
		case 'non_vide':
			return refuse(`Le dossier ${dossier} n'est pas vide (${await contenu(dep, dossier)}) : range ou supprime d'abord son contenu.`);
		case 'retire': {
			// Le retrait et son commit forment une seule écriture : toute disparition suivie sous ce dossier (casse comprise) est commitée.
			const prefixe = cleDeCasse(`${dossier}/`);
			const suivis = (await dep.historique.modificationsEnCours()).filter((c) => cleDeCasse(c).startsWith(prefixe));
			let commit: string | null = null;
			try {
				if (suivis.length > 0) commit = await dep.historique.commit(`mnemo: retire dossier ${dossier}`, suivis, dep.origine?.session);
			} catch (erreur) {
				// comme `ecrireEtCommiter` : la fiche retirée est remise (le dossier recréé), l'erreur remonte
				if (saFiche !== null) await dep.coffre.ecrire(saFiche.chemin, saFiche.texte).catch(() => {});
				throw erreur;
			}
			return { statut: 'retire', dossier, commit };
		}
	}
}
