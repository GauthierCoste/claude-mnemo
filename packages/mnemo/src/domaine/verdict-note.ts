/**
 * Le verdict d'un modèle de note en mots simples (spec « entraîner la note », D9) : une phrase par état, et chaque critère
 * manqué (`refus` de l'apprentissage, `domaine/acceptation-note.ts` et `application/apprendre-note.ts`) traduit pour
 * l'utilisateur. Un critère inconnu est rendu tel quel. Vocabulaire : « note de confiance », « injecter », jamais « servir ».
 */
import { CRITERES } from './acceptation-note.ts';
import { REFUS_DEPART } from './modele-de-note.ts';
import type { ModeleDeNote } from './modele-de-note.ts';
import type { EtatDuModele } from './note-de-confiance.ts';

const SEUIL = `${Math.round(0.9 * 100)} %`;

/** Le verdict en une phrase. */
export function verdictEnClair(etat: EtatDuModele): string {
	switch (etat) {
		case 'accepte':
			return `Accepté : les % sont justes et Mnemo injecte seul au-dessus de ${SEUIL}`;
		case 'coupe':
			return 'Accepté, mais injection automatique coupée : trop de fiches injectées par Mnemo ont été écartées';
		case 'refuse':
			return 'Refusé : la note ordonne le classement, sans %';
		case 'depart':
			return 'Note de départ, à entraîner : elle ordonne le classement, sans %';
		case 'non_appris':
			return "Pas encore entraînée : le classement suit l'ordre de la recherche, sans %";
	}
}

/** Nombre écrit à la française (virgule décimale). */
const fr = (texte: string): string => texte.replace(/(\d)\.(\d)/gu, '$1,$2');

/** Chaque forme de critère manqué et sa phrase simple. */
const TRADUCTIONS: readonly [RegExp, (...m: string[]) => string][] = [
	[/^(\d+) injections simulées \(au moins (\d+)\)$/u, (n, min) => `trop peu de fiches au-dessus de ${SEUIL} : ${n}, il en faut ${min}`],
	[/^(\d+) sessions réelles servies \(au moins (\d+)\)$/u, (n, min) => `trop peu de sessions où Mnemo injecterait : ${n}, il en faut ${min}`],
	[/^précision au 2,5e centile du bootstrap (.+) \(au moins (.+)\)$/u, (x, min) => `précision trop variable d'un tirage à l'autre : ${fr(x)} au pire, il en faut ${fr(min)}`],
	[/^précision - \(au moins (.+)\)$/u, () => `aucune fiche au-dessus de ${SEUIL} pour mesurer si les % sont justes`],
	[/^précision (.+) \(au moins (.+)\)$/u, (x, min) => `les fiches au-dessus de ${SEUIL} ne sont utiles que ${fr(x)} du temps, il en faut ${fr(min)}`],
	[/^borne basse de Wilson (.+) \(au moins (.+)\)$/u, (x, min) => `trop peu de jugements pour être sûr de la précision : ${fr(x)} au pire, il en faut ${fr(min)}`],
	[/^pente de calibration (.+) \(entre (.+) et (.+)\)$/u, (x, a, b) => `les % ne suivent pas assez ce qui est utile (pente ${fr(x)}, attendue entre ${fr(a)} et ${fr(b)})`],
	[
		/^pas assez de messages silence : (\d+) de (\d+) sessions réelles \(au moins (\d+) de (\d+)\)$/u,
		(n, s, min, smin) => `trop peu de messages « Rien d'utile ici » : ${n} venus de ${s} sessions, il en faut ${min} venus de ${smin}`,
	],
	[/^(.+) des messages silence servis \(au plus (.+)\)$/u, (x, max) => `Mnemo injecterait une fiche dans ${fr(x)} des messages où rien n'est utile, ${fr(max)} au plus`],
	[/^(.+) injection par message \(au plus (.+)\)$/u, (x, max) => `trop d'injections par message : ${fr(x)}, ${fr(max)} au plus`],
	[
		/^un découpage des sessions donne une précision de (.+) \(au moins (.+) à chaque découpage\)$/u,
		(x, min) => `précision instable selon les sessions mises de côté : ${fr(x)} au pire, il en faut ${fr(min)}`,
	],
	[/^modèles installés inconnus$/u, () => 'les modèles locaux de cette machine sont inconnus : installe-les (Réglages › Modèles)'],
	[
		/^identité des modèles absente sur (\d+) cas/u,
		(n) => `${n} messages préparés sans l'identité des modèles locaux : prépare-les de nouveau (mnemo banc contexte --completer)`,
	],
	[/^aucune paire jugée pour ce niveau$/u, () => 'aucune fiche jugée utile ou pas utile pour ce niveau'],
	[/^pas encore appris$/u, () => 'pas encore entraînée'],
];

/** Un critère manqué en clair ; inconnu : tel quel. */
export function critereEnClair(refus: string): string {
	if (refus === REFUS_DEPART) return 'note de départ livrée avec Mnemo, pas encore entraînée sur tes jugements';
	for (const [forme, phrase] of TRADUCTIONS) {
		const m = forme.exec(refus);
		if (m !== null) return phrase(...m.slice(1));
	}
	return refus;
}

/**
 * Les critères manqués d'un modèle, en clair. Un modèle accepté que l'état refuse a été appris avec d'autres modèles locaux
 * (ou d'autres réglages du signal de session) : c'est dit.
 */
export function criteresEnClair(modele: Pick<ModeleDeNote, 'accepte' | 'refus'>, etat: EtatDuModele): string[] {
	if (etat === 'refuse' && modele.accepte) return ["apprise avec d'autres modèles locaux ou d'autres réglages du signal de session : à entraîner de nouveau"];
	if (etat === 'accepte' || etat === 'coupe') return [];
	return modele.refus.map(critereEnClair);
}

/** Les seuils d'acceptation, pour dire ce qu'il faut viser (nombre de fiches au-dessus du seuil, messages silence). */
export const CIBLES_D_ACCEPTATION = { injections: CRITERES.injectionsMin, sessions: CRITERES.sessionsMin, silences: CRITERES.silencesMin } as const;
