import { lireFiche } from '../domaine/fiche.ts';
import { reecrireLiens as reecrireLiensEcrits, sansMd } from '../domaine/liens-ecrits.ts';
import type { Dependances } from './ports.ts';
import { aujourdhui, avecIdentifiant, cheminDeFiche, cheminExistant, commiter, dossiersManquants, ecrireEtCommiter, enFichier, lireFicheExistante, motifCheminInvalide, motifCollision, refuse, sousVerrou, texteDeFiche } from './commun.ts';
import type { Resultat } from './commun.ts';
import { reindexerApresEcriture } from './synchroniser.ts';
import { cleDeCasse, ficheDeDossier, nomDeLaFiche, positionDeFiche } from '../domaine/chemin.ts';
import { DOSSIERS_FIXES } from '@mnemo/commun';

/**
 * Réécrit les liens vers `cibles` (sans `.md`), écrits avec ou sans `.md` (hors blocs de code) ; le texte est conservé
 * octet pour octet ailleurs.
 */
function reecrireLiens(texte: string, cibles: Set<string>, nouvelle: string): string {
	return reecrireLiensEcrits(texte, (cible, suite) => (cibles.has(sansMd(cible.trim())) ? `[[${nouvelle}${suite}]]` : null));
}

/**
 * Déplace une fiche et réécrit les liens qui la désignent, en un seul commit. La fiche d'un dossier (`d/d.md`) emporte tout
 * son dossier : `vers` est alors la fiche du dossier d'arrivée (`<parent>/<nom>/<nom>.md`).
 */
export async function deplacer(dep: Dependances, de: string, vers: string): Promise<Resultat> {
	const resultat = await sousVerrou<Resultat>(dep, async () => {
		const ancien = cheminDeFiche(de);
		if (ancien === null) return refuse(motifCheminInvalide(de));
		const nouveau = cheminDeFiche(vers);
		if (nouveau === null) return refuse(motifCheminInvalide(vers));
		if (ancien === nouveau) return refuse('Le chemin de destination est identique au chemin d\'origine.');
		const variante = await cheminExistant(dep, ancien);
		if (variante !== null) return refuse(variante);
		const fiche = await lireFicheExistante(dep, ancien);
		if (typeof fiche === 'string') return refuse(fiche);
		if (positionDeFiche(ancien) !== ancien) return deplacerDossier(dep, ancien, nouveau);
		// Un profil est lu à son chemin fixe ; une note importée de Claude Code est retrouvée par l'amorçage à son origine.
		if (fiche.type === 'profil') return refuse(`${ancien} est un profil : il ne se déplace pas (son chemin est fixe).`);
		const collision = await motifCollision(dep, nouveau);
		if (collision !== null) return refuse(collision);
		const dossiers = await dossiersManquants(dep, nouveau);
		if (typeof dossiers === 'string') return refuse(dossiers);

		const toutes = await dep.coffre.toutesLesFiches();
		const ancienneBase = nomDeLaFiche(ancien);
		const cibles = new Set([sansMd(ancien)]);
		if (toutes.filter((c) => nomDeLaFiche(c) === ancienneBase).length === 1) cibles.add(ancienneBase);

		const reecrites: { chemin: string; texte: string }[] = [];
		for (const chemin of toutes) {
			if (chemin === ancien) continue;
			const texte = await dep.coffre.lire(chemin);
			if (texte === null) continue;
			const neuf = reecrireLiens(texte, cibles, sansMd(nouveau));
			if (neuf !== texte) reecrites.push({ chemin, texte: avecIdentifiant(dep, chemin, neuf) });
		}

		let texteDeplace = reecrireLiens((await dep.coffre.lire(ancien))!, cibles, sansMd(nouveau));
		const aliasManquant = ancienneBase !== fiche.titre && ancienneBase !== nomDeLaFiche(nouveau) && !fiche.alias.includes(ancienneBase);
		if (aliasManquant || fiche.id === '') {
			const aJour = lireFiche(nouveau, texteDeplace);
			if (aliasManquant) aJour.alias = [...aJour.alias, ancienneBase];
			aJour.updated = aujourdhui(dep);
			texteDeplace = texteDeFiche(dep, aJour);
		}

		const aEcrire = [{ chemin: nouveau, texte: texteDeplace }, ...reecrites, ...dossiers.map((f) => enFichier(dep, f))];
		const commit = await ecrireEtCommiter(dep, aEcrire, `mnemo: déplace ${ancien} → ${nouveau}`, [ancien]);
		return { statut: 'ecrit', fiche: nouveau, aConfirmer: false, commit };
	});
	if (resultat.statut === 'ecrit') return { ...resultat, ...(await reindexerApresEcriture(dep)) };
	return resultat;
}

/**
 * Destination d'un déplacement demandé par un outil : `dossier` d'arrivée (« » = racine) et nouveau `nom` facultatif. Une
 * fiche simple arrive en `<dossier>/<nom>.md` ; la fiche d'un dossier arrive en `<dossier>/<nom>/<nom>.md`, avec tout son dossier.
 */
export function destinationDuDeplacement(id: string, dossier: string, nom?: string): string {
	const parent = dossier.replace(/\/+$/u, '');
	const dansParent = (relatif: string) => (parent === '' ? relatif : `${parent}/${relatif}`);
	const position = positionDeFiche(id);
	const nomActuel = position === id ? nomDeLaFiche(id) : position.slice(position.lastIndexOf('/') + 1);
	const nouveauNom = nom === undefined || nom.trim() === '' ? nomActuel : nom.trim();
	return position === id ? dansParent(`${nouveauNom}.md`) : dansParent(ficheDeDossier(nouveauNom));
}

const dansDossier = (chemin: string, dossier: string): boolean => cleDeCasse(chemin).startsWith(`${cleDeCasse(dossier)}/`);
const estDossierFixe = (chemin: string): boolean => Object.values(DOSSIERS_FIXES).some((d) => cleDeCasse(chemin) === cleDeCasse(d) || dansDossier(chemin, d));

/**
 * Déplace le dossier de la fiche `ancien` (`d/d.md`) vers celui de `nouveau` (fiche de dossier d'arrivée) : toutes ses fiches
 * et sous-dossiers, les liens qui les visent réécrits en une passe, l'ancien nom en alias de la fiche du dossier renommé.
 * Tout ou rien : un échec en cours d'écriture remet les fichiers dans leur état d'avant. Appelant sous verrou.
 */
async function deplacerDossier(dep: Dependances, ancien: string, nouveau: string): Promise<Resultat> {
	const ancienDossier = positionDeFiche(ancien);
	const nouveauDossier = positionDeFiche(nouveau);
	if (estDossierFixe(ancienDossier) || estDossierFixe(nouveauDossier)) return refuse(`Les dossiers ${Object.values(DOSSIERS_FIXES).join(' et ')} ont un chemin fixe : rien n'y entre ni n'en sort par un déplacement.`);
	if (nouveauDossier === nouveau) return refuse(`${ancien} est la fiche du dossier ${ancienDossier} : sa destination doit être la fiche d'un dossier (« <dossier>/<nom>/<nom>.md »).`);
	if (cleDeCasse(nouveauDossier) === cleDeCasse(ancienDossier) || dansDossier(nouveauDossier, ancienDossier)) return refuse(`${nouveauDossier} est dans le dossier déplacé ${ancienDossier}.`);
	const toutes = await dep.coffre.toutesLesFiches();
	const deplacees = toutes.filter((c) => dansDossier(c, ancienDossier));
	if (toutes.some((c) => cleDeCasse(c) === cleDeCasse(nouveau) || dansDossier(c, nouveauDossier))) return refuse(`Le dossier ${nouveauDossier} existe déjà.`);
	const nomAncien = nomDeLaFiche(ancien);
	const nomNouveau = nomDeLaFiche(nouveau);
	const table = new Map<string, string>();
	for (const chemin of deplacees) {
		const relatif = chemin.slice(ancienDossier.length + 1);
		table.set(chemin, chemin === ancien ? nouveau : `${nouveauDossier}/${relatif}`);
	}
	for (const chemin of deplacees) {
		const texte = await dep.coffre.lire(chemin);
		if (texte === null) continue;
		try {
			if (lireFiche(chemin, texte).type === 'profil') return refuse(`${chemin} est un profil : il ne se déplace pas (son chemin est fixe).`);
		} catch {
			// fiche illisible : déplacée telle quelle
		}
	}
	const dossiers = await dossiersManquants(dep, nouveau);
	if (typeof dossiers === 'string') return refuse(dossiers);

	const parBase = new Map<string, number>();
	for (const c of toutes) parBase.set(nomDeLaFiche(c), (parBase.get(nomDeLaFiche(c)) ?? 0) + 1);
	const reecrire = (texte: string): string => {
		let neuf = texte;
		for (const [de, vers] of table) {
			const cibles = new Set([sansMd(de)]);
			if (parBase.get(nomDeLaFiche(de)) === 1) cibles.add(nomDeLaFiche(de));
			neuf = reecrireLiens(neuf, cibles, sansMd(vers));
		}
		return neuf;
	};

	const aEcrire: { chemin: string; texte: string }[] = [];
	for (const chemin of toutes) {
		const texte = await dep.coffre.lire(chemin);
		if (texte === null) continue;
		const destination = table.get(chemin);
		let neuf = reecrire(texte);
		if (destination === nouveau && nomNouveau !== nomAncien) {
			const fiche = lireFiche(nouveau, neuf);
			if (!fiche.alias.includes(nomAncien) && fiche.titre !== nomAncien) fiche.alias = [...fiche.alias, nomAncien];
			fiche.updated = aujourdhui(dep);
			neuf = texteDeFiche(dep, fiche);
		}
		if (destination !== undefined) aEcrire.push({ chemin: destination, texte: avecIdentifiant(dep, destination, neuf) });
		else if (neuf !== texte) aEcrire.push({ chemin, texte: avecIdentifiant(dep, chemin, neuf) });
	}
	aEcrire.push(...dossiers.map((f) => enFichier(dep, f)));

	const avant = new Map<string, string | null>();
	for (const chemin of [...aEcrire.map((f) => f.chemin), ...deplacees]) if (!avant.has(chemin)) avant.set(chemin, await dep.coffre.lire(chemin));
	try {
		for (const f of aEcrire) await dep.coffre.ecrire(f.chemin, f.texte);
		for (const chemin of deplacees) await dep.coffre.supprimer(chemin);
		const commit = await commiter(dep, `mnemo: déplace ${ancienDossier} → ${nouveauDossier}`, [...aEcrire.map((f) => f.chemin), ...deplacees]);
		return { statut: 'ecrit', fiche: nouveau, aConfirmer: false, commit };
	} catch (erreur) {
		for (const [chemin, texte] of avant) {
			if (texte === null) await dep.coffre.supprimer(chemin).catch(() => {});
			else await dep.coffre.ecrire(chemin, texte).catch(() => {});
		}
		throw erreur;
	}
}
