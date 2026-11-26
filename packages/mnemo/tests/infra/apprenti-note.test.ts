import { describe, expect, it } from 'vitest';
import { apprendreNote, jeuDApprentissage } from '../../src/application/apprendre-note.ts';
import { apprentiNote } from '../../src/infra/apprenti-note.ts';
import { banc, GGUF_DE_TEST, SCENARIOS } from '../aides/banc-synthetique.ts';

const DATE = '2026-11-26T10:00:00.000Z';

describe("apprenti de la note : apprendreNote dans un fil d'exécution à part (D6)", () => {
	it('le vrai fil (TypeScript chargé sans compilation) rend le même rapport que l’apprentissage dans le processus', async () => {
		const jeu = jeuDApprentissage(banc(SCENARIOS.favorable, 3, 40, 12), null, { installes: GGUF_DE_TEST });
		const options = { date: DATE, graines: [1] };
		const rapport = await apprentiNote().apprendre(jeu, options);
		expect(rapport).toEqual(apprendreNote(jeu, options));
		expect(rapport.niveaux.map((n) => n.niveau)).toEqual(['complets', 'sens']);
	}, 60_000);

	it('arrêté : le fil est terminé et la promesse rejetée (AbortError) ; déjà arrêté : rien n’est lancé', async () => {
		const jeu = jeuDApprentissage(banc(SCENARIOS.favorable, 1000, 140, 28), null, { installes: GGUF_DE_TEST });
		const controle = new AbortController();
		const enCours = apprentiNote().apprendre(jeu, { date: DATE }, controle.signal);
		setTimeout(() => controle.abort(), 50);
		await expect(enCours).rejects.toMatchObject({ name: 'AbortError' });
		await expect(apprentiNote().apprendre(jeu, { date: DATE }, AbortSignal.abort())).rejects.toMatchObject({ name: 'AbortError' });
	}, 60_000);

	it('un fil qui échoue rend son erreur', async () => {
		const jeu = jeuDApprentissage([], null, { installes: GGUF_DE_TEST });
		const script = new URL('data:text/javascript,throw new Error("panne du fil")');
		await expect(apprentiNote({ script }).apprendre(jeu, { date: DATE })).rejects.toThrow('panne du fil');
	});
});
