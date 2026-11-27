import { describe, expect, it } from 'vitest';
import type { RapportDApprentissage } from '../../src/application/apprendre-note.ts';
import { avancementDeLaNote, meilleurAvancement } from '../../src/application/entrainement.ts';
import type { DernierRapport, LigneHistorique, NoteDuNiveau, ResultatApprentissage } from '../../src/application/entrainement.ts';
import { modeleNonAppris } from '../../src/domaine/modele-de-note.ts';
import type { MesuresDuModele, NiveauDeNote } from '../../src/domaine/modele-de-note.ts';

const mesures = (m: Partial<MesuresDuModele>): MesuresDuModele => ({ seuil: 0.8, injections: 0, sessions: 0, silences: 0, sessionsSilence: 0, ...m }) as MesuresDuModele;
const rapport = (date: string, parNiveau: Partial<Record<NiveauDeNote, Partial<MesuresDuModele>>>): DernierRapport => ({
	remplace: true,
	rapport: { date, niveaux: (['complets', 'sens'] as const).map((niveau) => ({ niveau, modele: { ...modeleNonAppris(), mesures: parNiveau[niveau] === undefined ? null : mesures(parNiveau[niveau]!) } })) } as unknown as RapportDApprentissage,
});
const note = (etat: NoteDuNiveau['etat']): NoteDuNiveau[] =>
	(['complets', 'sens'] as const).map((niveau) => ({ niveau, etat, origine: 'appris', date: null, seuil: null, verdict: '', criteres: [], refus: [] }));
const ligne = (date: string, avancement?: number): LigneHistorique => ({ date, origine: 'manuel', verdicts: { complets: 'refuse', sens: 'refuse' }, remplace: true, ...(avancement === undefined ? {} : { avancement }) });

describe('avancement de la note (page Entraîner)', () => {
	const complets = { injections: 2, sessions: 2, silences: 16, sessionsSilence: 11 };

	it('le niveau le plus avancé, ses volumes, son seuil ; l’écart avec l’essai d’avant qui a mesuré un avancement', () => {
		const dernier = rapport('2026-11-27', { complets, sens: { silences: 16, sessionsSilence: 11 } });
		expect(meilleurAvancement(dernier.rapport)).toMatchObject({ niveau: 'complets', parNiveau: [{ niveau: 'complets' }, { niveau: 'sens', part: 0 }] });
		const historique = [ligne('2026-11-27', 0.08), { ...ligne('2026-11-26T20:00'), erreur: 'échec' }, ligne('2026-11-26', 0.05)];
		const a = avancementDeLaNote(note('refuse'), dernier, null, historique, 16)!;
		expect(a.part).toBeCloseTo(0.08);
		expect(a.niveau).toBe('complets');
		expect(a.seuil).toBe(0.8);
		expect(a.volumes.map((v) => v.fait)).toEqual([2, 2, 16]);
		expect(a.ecart).toEqual({ points: 3, depuis: '2026-11-26' });
		expect(a.qualite).toBeNull();
	});

	it('volume atteint : le premier critère manqué du niveau ; note acceptée : aucun avancement ; sans apprentissage : les silences jugés', () => {
		const dernier = rapport('2026-11-27', { complets: { injections: 30, sessions: 12, silences: 25, sessionsSilence: 6 } });
		const resultat = { niveaux: [{ niveau: 'complets', criteres: ['les fiches que Mnemo injecterait ne sont utiles que 72 % du temps'] }] } as unknown as ResultatApprentissage;
		expect(avancementDeLaNote(note('refuse'), dernier, resultat, [], 0)).toMatchObject({ part: 1, qualite: 'les fiches que Mnemo injecterait ne sont utiles que 72 % du temps', ecart: null });
		expect(avancementDeLaNote(note('accepte'), dernier, resultat, [], 0)).toBeNull();
		expect(avancementDeLaNote(note('depart'), null, null, [], 3)).toEqual({ part: null, niveau: null, parNiveau: [], volumes: [{ nom: 'silences', fait: 3, cible: 20 }], qualite: null, ecart: null, seuil: null });
	});
});
