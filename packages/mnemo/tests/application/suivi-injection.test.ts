import { afterEach, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { coupuresDesInjections, suiviDesInjections } from '../../src/application/suivi-injection.ts';
import type { EtatSessions } from '../../src/application/ports.ts';
import type { ModelesDeNote } from '../../src/domaine/note-de-confiance.ts';
import { modeleNonAppris } from '../../src/domaine/modele-de-note.ts';
import type { Session } from '../../src/domaine/session.ts';
import { ouvrirEtat } from '../../src/infra/etat-sqlite.ts';
import { dossierTemporaire } from '../aides/dossier-temporaire.ts';

const ID = '11111111-2222-4333-8444-555555555555';
const T = Date.parse('2026-11-25T11:00:00.000Z');
const ouverts: EtatSessions[] = [];
afterEach(() => {
	while (ouverts.length > 0) ouverts.pop()?.fermer();
});

const session = (): Session => ({
	id: ID,
	profil: 'travail',
	dossier: '',
	position: 'projets/vela',
	projet: 'vela',
	objectif: null,
	etat: 'attend',
	creeeMs: 1,
	majMs: 1,
	arretAttendu: null,
	bilanDemandeMs: null,
	commitDebut: null,
	branche: null,
	pid: null,
});

async function etatAvecSession(): Promise<EtatSessions> {
	const etat = ouvrirEtat(join(await dossierTemporaire(), 'etat.sqlite'));
	ouverts.push(etat);
	await etat.creer(session());
	return etat;
}

const modeles = (apprisLe = '2026-11-25T10:00:00.000Z'): ModelesDeNote => ({
	complets: { modele: modeleNonAppris(), etat: 'non_appris' },
	sens: { modele: { ...modeleNonAppris(), accepte: true, refus: [], apprisLe }, etat: 'accepte' },
});

/** `n` injections automatiques Sens, dont les `ecartees` premières écartées juste après. */
async function serie(etat: EtatSessions, n: number, ecartees: number, t0 = T): Promise<void> {
	for (let i = 0; i < n; i++) {
		await etat.noterGeste({ geste: 'injectee_auto', session: ID, fiche: `f${t0}-${i}.md`, empreinte: null, horodatageMs: t0 + i * 10, note: { niveau: 'sens' } });
		if (i < ecartees) await etat.noterGeste({ geste: 'ecartee_ici', session: ID, fiche: `f${t0}-${i}.md`, empreinte: null, horodatageMs: t0 + i * 10 + 5, note: null });
	}
}

describe('coupuresDesInjections : lecture bornée', () => {
	it('ne compte que depuis l’apprentissage, et seulement les 100 dernières injections du niveau', async () => {
		const etat = await etatAvecSession();
		// 40 écartées avant l'apprentissage : ignorées
		await serie(etat, 40, 40, T - 3_600_000 * 2);
		expect((await coupuresDesInjections(etat, modeles())).sens).toBeNull();
		await serie(etat, 17, 17);
		expect((await coupuresDesInjections(etat, modeles())).sens).toMatchObject({ injections: 17, ecartees: 17 });
		// 100 justes ensuite : les écartées sortent de la fenêtre
		await serie(etat, 100, 0, T + 100_000);
		expect((await coupuresDesInjections(etat, modeles())).sens).toBeNull();
	});
});

describe('suiviDesInjections', () => {
	it('tenu en mémoire pour les modèles lus ; périmé par un nouvel apprentissage ; prévient à la première lecture et à chaque changement', async () => {
		const etat = await etatAvecSession();
		let m = modeles();
		const changements: unknown[] = [];
		const suivi = suiviDesInjections(etat, () => m, (c) => void changements.push(c));
		expect(suivi.coupures(m)).toBeNull();
		await suivi.actualiser();
		expect(changements).toHaveLength(1);
		expect(suivi.coupures(m)).toEqual({ complets: null, sens: null });
		await serie(etat, 17, 17);
		expect(await suivi.actualiser()).toBe(true);
		expect(changements).toHaveLength(2);
		expect(suivi.coupures(m)!.sens).toMatchObject({ ecartees: 17 });
		// un apprentissage plus récent : périmé, relu, la coupure tombe
		m = modeles('2026-11-25T12:00:00.000Z');
		expect(suivi.perime(m)).toBe(true);
		expect(suivi.coupures(m)).toBeNull();
		expect(await suivi.actualiser()).toBe(false);
		expect(suivi.coupures(m)).toEqual({ complets: null, sens: null });
		expect(changements).toHaveLength(3);
	});

	it('coalescence : une relecture à la fois, plus une seule en attente pour toutes les demandes', async () => {
		const etat = await etatAvecSession();
		let lectures = 0;
		const compte: Pick<EtatSessions, 'gestes'> = {
			gestes: async (f) => {
				lectures += 1;
				return etat.gestes(f);
			},
		};
		const suivi = suiviDesInjections(compte, () => modeles());
		await suivi.actualiser();
		const parRelecture = lectures;
		lectures = 0;
		await Promise.all(Array.from({ length: 20 }, () => suivi.actualiser()));
		expect(lectures).toBe(parRelecture * 2);
	});
});
