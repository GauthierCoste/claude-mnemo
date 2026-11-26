/**
 * Réglages du groupe « Mémoire » : les règles de l'en-tête de `SCHEMA.md` (versionnées avec la mémoire), montrées et modifiées
 * dans Réglages › Mémoire comme les autres réglages. La modification réécrit seulement les lignes de ces clés dans l'en-tête ;
 * le reste du fichier (texte, autres clés, ordre) est gardé tel quel.
 */
import type { Nature } from './fait.ts';
import { FIABILITES_PAR_DEFAUT, POIDS_PAR_DEFAUT, REPETITIONS_PAR_DEFAUT, SEUIL_RAPPEL_PAR_DEFAUT, TYPES_SOURCE } from './regles.ts';
import type { Regles, TypeSource } from './regles.ts';
import { validerValeur } from './reglages.ts';
import type { ChampReglage } from './reglages.ts';
import { estObjet } from './valeurs.ts';

/** Un champ et sa place dans l'en-tête : une clé de premier niveau, ou une clé du bloc `fiabilites`. */
type ChampMemoire = ChampReglage & { schema: { cle: string; bloc?: 'fiabilites' } };

const proportion = (cle: string, libelle: string, explication: string, defaut: number, schema: ChampMemoire['schema']): ChampMemoire => ({
	cle,
	groupe: 'memoire',
	libelle,
	explication,
	genre: 'decimal',
	defaut,
	min: 0,
	max: 1,
	effet: 'immediat',
	schema,
});

const LIBELLES_SOURCES: Record<TypeSource, string> = {
	utilisateur: 'Utilisateur',
	contrat: 'Contrat',
	spec_validee: 'Spécification validée',
	compte_rendu: 'Compte rendu',
	email: 'Email',
	note: 'Note',
	session: 'Session',
	deduction: 'Déduction',
	inconnue: 'Source inconnue',
};

const LIBELLES_NATURES: Record<Nature, string> = { declare: 'déclaré', observe: 'observé', infere: 'inféré' };

export const CHAMPS_MEMOIRE: readonly ChampMemoire[] = [
	proportion('memoire.seuilRappel', 'Seuil de rappel', 'Pertinence minimale d’un résultat de recherche pour qu’il soit rappelé aux sessions ; la confiance d’un fait ne pèse que sur son rang.', SEUIL_RAPPEL_PAR_DEFAUT, { cle: 'seuil_rappel' }),
	{
		cle: 'memoire.repetitions',
		groupe: 'memoire',
		libelle: 'Répétitions pour monter une consigne',
		explication: 'Fois où une consigne est redite avant que Mnemo propose de la rendre toujours présente.',
		genre: 'entier',
		defaut: REPETITIONS_PAR_DEFAUT,
		min: 1,
		max: 20,
		effet: 'immediat',
		schema: { cle: 'repetitions_pour_monter' },
	},
	...(Object.keys(POIDS_PAR_DEFAUT) as Nature[]).map((n) =>
		proportion(`memoire.poids_${n}`, `Poids d’un fait ${LIBELLES_NATURES[n]}`, 'Multiplie la fiabilité de la source pour donner la confiance du fait.', POIDS_PAR_DEFAUT[n], { cle: `poids_${n}` }),
	),
	...TYPES_SOURCE.map((t) =>
		proportion(`memoire.fiabilite_${t}`, `Fiabilité : ${LIBELLES_SOURCES[t]}`, `Fiabilité d’une information de source « ${t} ».`, FIABILITES_PAR_DEFAUT[t], { cle: t, bloc: 'fiabilites' }),
	),
];

/** Valeurs actuelles des champs, lues dans les règles déjà chargées. */
export function valeursMemoire(regles: Regles): Record<string, number> {
	const valeurs: Record<string, number> = {};
	for (const c of CHAMPS_MEMOIRE) {
		const { cle, bloc } = c.schema;
		if (bloc === 'fiabilites') valeurs[c.cle] = regles.fiabilites[cle as TypeSource];
		else if (cle === 'seuil_rappel') valeurs[c.cle] = regles.seuilRappel;
		else if (cle === 'repetitions_pour_monter') valeurs[c.cle] = regles.repetitionsPourMonter;
		else valeurs[c.cle] = regles.poids[cle.slice('poids_'.length) as Nature];
	}
	return valeurs;
}

/** Valeur écrite dans l'en-tête : un nombre en notation simple. */
const enTexte = (v: number): string => String(v);

/** Remplace (ou ajoute) une ligne `cle: valeur` de l'en-tête ; `bloc` : dans le bloc indenté de ce nom (créé s'il manque). */
function poser(lignes: string[], fin: number, cle: string, valeur: string, bloc?: string): number {
	if (bloc === undefined) {
		const i = lignes.findIndex((l, j) => j > 0 && j < fin && new RegExp(`^${cle}\\s*:`, 'u').test(l));
		if (i >= 0) lignes[i] = `${cle}: ${valeur}`;
		else {
			lignes.splice(fin, 0, `${cle}: ${valeur}`);
			return fin + 1;
		}
		return fin;
	}
	let debutBloc = lignes.findIndex((l, j) => j > 0 && j < fin && new RegExp(`^${bloc}\\s*:\\s*$`, 'u').test(l));
	if (debutBloc < 0) {
		lignes.splice(fin, 0, `${bloc}:`);
		debutBloc = fin;
		fin += 1;
	}
	let j = debutBloc + 1;
	while (j < fin && /^\s+\S/u.test(lignes[j]!)) {
		if (new RegExp(`^\\s+${cle}\\s*:`, 'u').test(lignes[j]!)) {
			lignes[j] = `  ${cle}: ${valeur}`;
			return fin;
		}
		j += 1;
	}
	lignes.splice(j, 0, `  ${cle}: ${valeur}`);
	return fin + 1;
}

/**
 * Applique `valeurs` (`{ "memoire.<nom>": valeur }`, `null` : rétablir le défaut) au texte de `SCHEMA.md` ; tout ou rien,
 * avec un motif par erreur. Un fichier sans en-tête en reçoit un.
 */
export function modifierSchema(texte: string, valeurs: Record<string, unknown>): { ok: true; texte: string } | { ok: false; motifs: string[] } {
	if (!estObjet(valeurs)) return { ok: false, motifs: ['Objet { "memoire.<nom>": valeur } attendu.'] };
	const motifs: string[] = [];
	const aPoser: { champ: ChampMemoire; valeur: number }[] = [];
	for (const [cle, v] of Object.entries(valeurs)) {
		const champ = CHAMPS_MEMOIRE.find((c) => c.cle === cle);
		if (champ === undefined) {
			motifs.push(`Réglage inconnu « ${cle} ».`);
			continue;
		}
		if (v === null) {
			aPoser.push({ champ, valeur: champ.defaut as number });
			continue;
		}
		const r = validerValeur(champ, v);
		if (r.ok) aPoser.push({ champ, valeur: r.valeur as number });
		else motifs.push(`« ${champ.libelle} » : ${r.motif}.`);
	}
	if (motifs.length > 0) return { ok: false, motifs };
	const lignes = texte.replace(/^﻿/u, '').split('\n');
	if (lignes[0]?.trimEnd() !== '---' || lignes.findIndex((l, i) => i > 0 && l.trimEnd() === '---') < 0) lignes.unshift('---', '---');
	let fin = lignes.findIndex((l, i) => i > 0 && l.trimEnd() === '---');
	for (const { champ, valeur } of aPoser) fin = poser(lignes, fin, champ.schema.cle, enTexte(valeur), champ.schema.bloc);
	return { ok: true, texte: lignes.join('\n') };
}
