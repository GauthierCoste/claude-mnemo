import { analyserFiche } from '../../domaine/fiche.ts';
import { aliasDeSuite, liensEcrits, reecrireLiens, sansMd } from '../../domaine/liens-ecrits.ts';
import { avecIdentifiant, cheminDeFiche, cheminExistant, ecrireEtCommiter, motifCheminInvalide, refuse } from '../commun.ts';
import type { Resultat } from '../commun.ts';
import type { Dependances } from '../ports.ts';
import { motifIntouchable } from './garde.ts';
import { lireLaMemoire } from './memoire-lue.ts';

/** Dans la fiche `id`, le lien `[[ancien]]` devient `[[nouveau]]`, ou son texte sans crochets si `nouveau` est null. */
export type DemandeCorrectionLien = { action: 'corriger_lien'; id: string; ancien: string; nouveau: string | null };

const LIENS_MONTRES = 20;
/** Lien donné avec ou sans ses crochets, espaces retirés. */
const sansCrochets = (brut: string): string => brut.trim().replace(/^\[\[/u, '').replace(/\]\]$/u, '').trim();

/**
 * Corrige un lien dans une fiche (une source comprise), en un commit : chaque `[[ancien…]]` (cible écrite, `.md` facultatif,
 * ou lien entier avec sa suite `#…`/`|…`) devient `[[nouveau…]]` (suite gardée si seule la cible était donnée), ou, sans
 * `nouveau`, son texte affiché sans crochets (l'alias s'il y en a un). La nouvelle cible doit désigner une fiche existante.
 * Le reste du texte est gardé octet pour octet. Refusé dans une consigne, un profil ou sous un chemin fixe. Appelant sous
 * verrou.
 */
export async function corrigerLien(dep: Dependances, demande: DemandeCorrectionLien): Promise<Resultat> {
	const chemin = cheminDeFiche(demande.id);
	if (chemin === null) return refuse(motifCheminInvalide(demande.id));
	const variante = await cheminExistant(dep, chemin);
	if (variante !== null) return refuse(variante);
	const ancien = sansCrochets(demande.ancien);
	if (ancien === '') return refuse('Le lien à corriger (`ancien`) est vide.');
	const nouveau = demande.nouveau === null ? '' : sansCrochets(demande.nouveau);
	if (/[[\]\r\n]/u.test(nouveau)) return refuse(`Nouvelle cible invalide : « ${demande.nouveau ?? ''} » (sans crochets ni saut de ligne).`);
	const memoire = await lireLaMemoire(dep);
	const texte = memoire.textes.get(chemin);
	if (texte === undefined) return refuse(`La fiche ${chemin} n'existe pas.`);
	const intouchable = motifIntouchable(chemin, analyserFiche(chemin, texte).fiche.type, memoire.textes.keys(), false);
	if (intouchable !== null) return refuse(intouchable);
	if (nouveau !== '') {
		if (memoire.designee(nouveau.split(/[#|]/u)[0]!) === null) return refuse(`[[${nouveau}]] ne désigne aucune fiche (ou plusieurs) : donne le chemin d'une fiche existante.`);
	}

	const memeCible = (a: string, b: string) => sansMd(a.trim()) === sansMd(b.trim());
	let corriges = 0;
	const neuf = reecrireLiens(texte, (cible, suite) => {
		const entier = memeCible(`${cible}${suite}`, ancien) && suite !== '';
		if (!entier && !memeCible(cible, ancien)) return null;
		corriges++;
		if (nouveau !== '') return `[[${nouveau}${entier ? '' : suite}]]`;
		const alias = aliasDeSuite(suite);
		return alias === '' ? `${cible.trim()}${suite}` : alias.slice(1);
	});
	if (corriges === 0) {
		const presents = [...new Set(liensEcrits(texte).map((l) => `[[${l.cible}${l.suite}]]`))];
		const montres = presents.length === 0 ? 'aucun' : `${presents.slice(0, LIENS_MONTRES).join(', ')}${presents.length > LIENS_MONTRES ? '…' : ''}`;
		return refuse(`Aucun lien [[${ancien}]] dans ${chemin}. Liens présents : ${montres}.`);
	}
	if (neuf === texte) return refuse(`Le lien [[${ancien}]] de ${chemin} est déjà celui demandé.`);
	const commit = await ecrireEtCommiter(dep, [{ chemin, texte: avecIdentifiant(dep, chemin, neuf) }], `mnemo: corrige_lien ${chemin}`);
	const quoi = nouveau === '' ? `[[${ancien}]] sans crochets` : `[[${ancien}]] → [[${nouveau}]]`;
	return { statut: 'ecrit', fiche: chemin, aConfirmer: false, commit, changements: [`${quoi} (${corriges} lien${corriges > 1 ? 's' : ''})`] };
}
