import { describe, expect, it } from 'vitest';
import { accepter } from '../../src/domaine/acceptation-note.ts';
import type { MesuresDAcceptation } from '../../src/domaine/acceptation-note.ts';
import { modeleNonAppris, REFUS_DEPART } from '../../src/domaine/modele-de-note.ts';
import { critereEnClair, criteresEnClair, verdictEnClair } from '../../src/domaine/verdict-note.ts';

const MAUVAISES: MesuresDAcceptation = {
	seuil: 0.9,
	messages: 40,
	injections: 2,
	justes: 1,
	nonJugees: 0,
	horsPileFausses: 0,
	precision: 0.5,
	precisionPessimiste: 0.5,
	wilsonBassePessimiste: 0.2,
	sessions: 1,
	injectionsParMessage: 0.62,
	silences: 4,
	sessionsSilence: 2,
	silencesAvecInjection: 0,
	partSilencesAvecInjection: 0,
	rappel: null,
	utilesAtteintes: null,
	rappel10: null,
	bootstrapP025: 0.3,
	pente: 2,
	ordonnee: 0,
	ece: null,
};

describe('verdict de la note en mots simples (D9)', () => {
	it('une phrase par état, sans « servir »', () => {
		expect(verdictEnClair('accepte')).toBe('Accepté : les % sont justes et Mnemo injecte seul au-dessus de 90 %');
		expect(verdictEnClair('refuse')).toBe('Refusé : la note ordonne le classement, sans %');
		for (const etat of ['accepte', 'coupe', 'refuse', 'depart', 'non_appris'] as const) expect(verdictEnClair(etat)).not.toMatch(/servi/u);
	});

	it("chaque critère manqué de l'acceptation est traduit (aucun n'est rendu tel quel)", () => {
		const { refus } = accepter(MAUVAISES);
		expect(refus).toHaveLength(8);
		for (const r of refus) expect(critereEnClair(r)).not.toBe(r);
		expect(refus.map(critereEnClair)).toEqual([
			'trop peu de fiches au-dessus de 90 % : 2, il en faut 25',
			'trop peu de sessions où Mnemo injecterait : 1, il en faut 10',
			'les fiches au-dessus de 90 % ne sont utiles que 50 % du temps, il en faut 90 %',
			'trop peu de jugements pour être sûr de la précision : 20 % au pire, il en faut 80 %',
			"précision trop variable d'un tirage à l'autre : 30 % au pire, il en faut 80 %",
			'les % ne suivent pas assez ce qui est utile (pente 2,00, attendue entre 0,8 et 1,25)',
			"trop peu de messages « Rien d'utile ici » : 4 venus de 2 sessions, il en faut 20 venus de 5",
			"trop d'injections par message : 0,62, 0,5 au plus",
		]);
		const servis = accepter({ ...MAUVAISES, silences: 30, sessionsSilence: 8, partSilencesAvecInjection: 0.1 }).refus.find((r) => r.includes('silence'))!;
		expect(critereEnClair(servis)).toBe("Mnemo injecterait une fiche dans 10 % des messages où rien n'est utile, 5 % au plus");
	});

	it('les refus de l’apprentissage et des modèles de départ ; inconnu : tel quel', () => {
		expect(critereEnClair('un découpage des sessions donne une précision de 81,2 % (au moins 85 % à chaque découpage)')).toBe('précision instable selon les sessions mises de côté : 81,2 % au pire, il en faut 85 %');
		expect(critereEnClair('aucune paire jugée pour ce niveau')).toBe('aucune fiche jugée utile ou pas utile pour ce niveau');
		expect(critereEnClair(REFUS_DEPART)).toMatch(/note de départ/u);
		expect(critereEnClair('autre chose')).toBe('autre chose');
	});

	it("critères d'un modèle : aucun s'il est accepté ; accepté mais refusé par l'état (autres modèles locaux) : dit", () => {
		const m = { ...modeleNonAppris(), accepte: true, refus: [] };
		expect(criteresEnClair(m, 'accepte')).toEqual([]);
		expect(criteresEnClair(m, 'refuse')[0]).toMatch(/autres modèles locaux/u);
		expect(criteresEnClair(modeleNonAppris(), 'non_appris')).toEqual(['pas encore entraînée']);
	});
});
