import type { Fiche } from './fiche.ts';
import type { Regles } from './regles.ts';
import { CLE_PORTEE, ecrirePortee, GENRES_DE_PORTEE, lirePortee, PORTEE_GLOBALE } from './portee.ts';
import type { PorteeLue } from './portee.ts';
import { estObjet } from './valeurs.ts';

export type Niveau = 'rappelee' | 'toujours' | 'verifiee';
export type Regle = { type: 'chemins_interdits' | 'commandes_interdites'; motifs: string[] };
/**
 * Montée de niveau ou règle proposée par une session : à confirmer par l'utilisateur, montrée dans le
 * fil ; tant qu'elle n'est pas appliquée, le niveau et la règle de la consigne ne changent pas. `regle` absente : celle de la
 * consigne. `source` : mention de la source (« session … »).
 */
export type Proposition = { niveau: Niveau; regle?: Regle; date: string; source: string };
export type Consigne = { texte: string; portee: PorteeLue; niveau: Niveau; repetitions: string[]; regle?: Regle; proposition?: Proposition };

/** Clés du frontmatter qui portent une consigne. */
export const CLES_DE_CONSIGNE: readonly string[] = ['niveau', 'regle', CLE_PORTEE, 'repetitions', 'proposition'];
const NIVEAUX: readonly string[] = ['rappelee', 'toujours', 'verifiee'];
const TYPES_REGLE: readonly string[] = ['chemins_interdits', 'commandes_interdites'];

/** Anomalie d'une consigne à montrer à l'utilisateur (portée mal écrite), sinon null. */
export function anomalieDe(consigne: Consigne): string | null {
	if (consigne.portee.genre !== 'invalide') return null;
	const attendues = [PORTEE_GLOBALE, ...GENRES_DE_PORTEE.map((g) => `${g}:nom`)].map((p) => `« ${p} »`);
	return `Portée invalide : « ${consigne.portee.brute} » (attendu ${attendues.slice(0, -1).join(', ')} ou ${attendues.at(-1)!}) : cette consigne n'est jamais injectée.`;
}

function lireRegle(valeur: unknown): Regle | undefined {
	if (!estObjet(valeur)) return undefined;
	const { type, motifs } = valeur;
	if (typeof type !== 'string' || !TYPES_REGLE.includes(type)) return undefined;
	if (!Array.isArray(motifs) || motifs.length === 0 || !motifs.every((m) => typeof m === 'string')) return undefined;
	return { type: type as Regle['type'], motifs: [...(motifs as string[])] };
}

/** Proposition lue ; absente si une valeur manque ou est invalide (on ne propose pas à moitié). */
function lireProposition(valeur: unknown): Proposition | undefined {
	if (!estObjet(valeur)) return undefined;
	const { niveau, regle, date, source } = valeur;
	if (typeof niveau !== 'string' || !NIVEAUX.includes(niveau) || typeof date !== 'string' || typeof source !== 'string') return undefined;
	const proposition: Proposition = { niveau: niveau as Niveau, date, source };
	if (regle !== undefined) {
		const lue = lireRegle(regle);
		if (lue === undefined) return undefined;
		proposition.regle = lue;
	}
	return proposition;
}

/**
 * Lit une consigne dans une fiche de type `consigne`, sans erreur : une valeur absente ou invalide prend son défaut, sauf
 * la portée, qui ne se devine pas (`invalide`, voir `anomalieDe`).
 */
export function lireConsigne(fiche: Fiche): Consigne {
	const { niveau, repetitions, regle, proposition } = fiche.donnees;
	const consigne: Consigne = {
		texte: fiche.synthese.trim(),
		portee: lirePortee(fiche.donnees[CLE_PORTEE]),
		niveau: typeof niveau === 'string' && NIVEAUX.includes(niveau) ? (niveau as Niveau) : 'rappelee',
		repetitions: Array.isArray(repetitions) ? repetitions.filter((d): d is string => typeof d === 'string') : [],
	};
	const regleLue = lireRegle(regle);
	if (regleLue !== undefined) consigne.regle = regleLue;
	const propositionLue = lireProposition(proposition);
	if (propositionLue !== undefined) consigne.proposition = propositionLue;
	return consigne;
}

/** Nouvelle fiche portant la consigne ; le titre et les autres données ne sont pas touchés. */
export function avecConsigne(fiche: Fiche, consigne: Consigne): Fiche {
	const donnees: Record<string, unknown> = { ...fiche.donnees };
	donnees[CLE_PORTEE] = ecrirePortee(consigne.portee);
	donnees['niveau'] = consigne.niveau;
	donnees['repetitions'] = [...consigne.repetitions];
	if (consigne.regle === undefined) {
		delete donnees['regle'];
	} else {
		donnees['regle'] = { type: consigne.regle.type, motifs: [...consigne.regle.motifs] };
	}
	if (consigne.proposition === undefined) {
		delete donnees['proposition'];
	} else {
		const { niveau, regle, date, source } = consigne.proposition;
		donnees['proposition'] = { niveau, ...(regle === undefined ? {} : { regle: { type: regle.type, motifs: [...regle.motifs] } }), date, source };
	}
	return { ...fiche, synthese: consigne.texte.trim(), donnees };
}

/** Chaque répétition est un événement : on ajoute la date, même déjà présente. */
export function repeter(consigne: Consigne, date: string): Consigne {
	return { ...consigne, repetitions: [...consigne.repetitions, date] };
}

/** Montée de niveau suggérée, ou null. `verifiee` exige une règle vérifiable. */
export function niveauPropose(regles: Regles, consigne: Consigne): Niveau | null {
	if (consigne.niveau === 'rappelee') {
		return consigne.repetitions.length >= regles.repetitionsPourMonter ? 'toujours' : null;
	}
	if (consigne.niveau === 'toujours') {
		return consigne.regle !== undefined ? 'verifiee' : null;
	}
	return null;
}
