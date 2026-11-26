/**
 * Brouillon de la vue Réglages : le texte de chaque champ tel qu'il est saisi, sa conversion en valeur, et les modifications
 * à envoyer (seulement les champs changés ; `null` quand on revient au défaut). La validation reste au service.
 */
import type { ChampReglageVue, ValeurReglageVue } from '@mnemo/contrat';

/** Saisie d'un champ : texte (nombre, liste séparée par des virgules, choix, `oui`/`non` d'une case) ou cases cochées. */
export type Saisie = string | string[];

/** Saisie d'un réglage oui ou non (case à cocher). */
export const OUI = 'oui';
export const NON = 'non';

export const egales = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** Nombre décimal écrit à la française (virgule), dans le champ comme sur la ligne « Défaut ». */
const decimal = (n: number): string => String(n).replace('.', ',');

export function enSaisie(champ: ChampReglageVue, valeur: ValeurReglageVue): Saisie {
	if (champ.genre === 'choix-multiple') return Array.isArray(valeur) ? [...valeur] : [];
	if (Array.isArray(valeur)) return valeur.join(', ');
	if (typeof valeur === 'boolean') return valeur ? OUI : NON;
	if (champ.genre === 'decimal' && typeof valeur === 'number') return decimal(valeur);
	return String(valeur);
}

/**
 * Valeur d'une saisie : nombre (virgule ou point décimal) ; un nombre illisible part tel quel, en texte, pour que le service
 * dise pourquoi il le refuse ; liste : noms non vides, séparés par des virgules.
 */
export function enValeur(champ: ChampReglageVue, saisie: Saisie): ValeurReglageVue {
	if (Array.isArray(saisie)) return saisie;
	if (champ.genre === 'entier' || champ.genre === 'decimal') {
		const n = Number(saisie.trim().replace(',', '.'));
		return saisie.trim() !== '' && Number.isFinite(n) ? n : saisie;
	}
	if (champ.genre === 'booleen') return saisie === OUI ? true : saisie === NON ? false : saisie;
	if (champ.genre === 'liste') return saisie.split(',').map((x) => x.trim()).filter((x) => x !== '');
	return saisie;
}

/** Ce qui part au service : les champs dont la saisie diffère de la valeur enregistrée ; revenu au défaut : `null`. */
export function modifications(champs: readonly ChampReglageVue[], saisies: Readonly<Record<string, Saisie>>): Record<string, ValeurReglageVue | null> {
	const sortie: Record<string, ValeurReglageVue | null> = {};
	for (const c of champs) {
		const saisie = saisies[c.cle];
		if (saisie === undefined) continue;
		const v = enValeur(c, saisie);
		if (egales(v, c.valeur)) continue;
		sortie[c.cle] = egales(v, c.defaut) ? null : v;
	}
	return sortie;
}

/** Une valeur lisible : libellés des choix, « aucun » pour une liste vide, unité ajoutée. */
export function valeurLisible(champ: ChampReglageVue, valeur: ValeurReglageVue): string {
	const libelle = (v: string) => champ.choix?.find((c) => c.valeur === v)?.libelle ?? v;
	if (Array.isArray(valeur)) return valeur.length === 0 ? 'aucun' : valeur.map(libelle).join(', ');
	if (typeof valeur === 'boolean') return valeur ? 'oui' : 'non';
	const texte = typeof valeur === 'string' ? libelle(valeur) : champ.genre === 'decimal' ? decimal(valeur) : String(valeur);
	return champ.unite === undefined ? texte : `${texte} ${champ.unite}`;
}
