import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { NiveauModeles } from '@mnemo/commun';
import { dependancesDeSession, modelesDeSession } from '../../src/application/modeles-de-session.ts';
import type { EtatSessions, Reranker, Sens } from '../../src/application/ports.ts';
import type { Session } from '../../src/domaine/session.ts';
import { ouvrirEtat } from '../../src/infra/etat-sqlite.ts';
import { dossierTemporaire } from '../aides/dossier-temporaire.ts';
import { fauxPorts } from '../aides/faux-ports.ts';

const OPTIONS = { budgetMs: 1000, demarrer: true };

/** Sens et reranker qui comptent leurs appels. */
function comptes(): { sens: Sens; reranker: Reranker; appels: { sens: number; reranker: number } } {
	const appels = { sens: 0, reranker: 0 };
	return {
		appels,
		sens: {
			modele: () => 'bge-m3@essai',
			vecteurs: async (textes) => {
				appels.sens++;
				return textes.map(() => new Float32Array(4));
			},
		},
		reranker: {
			noter: async (_requete, textes) => {
				appels.reranker++;
				return textes.map(() => 0.5);
			},
		},
	};
}

const ouverts: EtatSessions[] = [];
afterEach(() => {
	while (ouverts.length > 0) ouverts.pop()!.fermer();
});

function session(id: string, champs: Partial<Session> = {}): Session {
	return { id, profil: 'travail', dossier: '', position: '', projet: 'divers', objectif: null, etat: 'attend', creeeMs: 1, majMs: 1, arretAttendu: null, bilanDemandeMs: null, commitDebut: null, branche: null, pid: null, ...champs };
}

describe('modèles d’une session bornés par son niveau', () => {
	it('coupes : aucun appel au sens ni au reranker enveloppés ; modele() inchangé', async () => {
		const m = comptes();
		const e = modelesDeSession(m, async () => 'coupes');
		expect(await e.sens.vecteurs(['a'], OPTIONS)).toBeNull();
		expect(await e.reranker.noter('q', ['a'], OPTIONS)).toBeNull();
		expect(m.appels).toEqual({ sens: 0, reranker: 0 });
		expect(e.sens.modele()).toBe('bge-m3@essai');
	});

	it('sens : le reranker seul est coupé', async () => {
		const m = comptes();
		const e = modelesDeSession(m, async () => 'sens');
		expect(await e.sens.vecteurs(['a', 'b'], OPTIONS)).toHaveLength(2);
		expect(await e.reranker.noter('q', ['a'], OPTIONS)).toBeNull();
		expect(m.appels).toEqual({ sens: 1, reranker: 0 });
	});

	it('complets, aucun niveau propre ou lecture en échec : les modèles enveloppés sont appelés (ils appliquent le niveau de la machine)', async () => {
		for (const niveau of [async () => 'complets' as const, async () => null, async () => Promise.reject(new Error('base occupée'))]) {
			const m = comptes();
			const e = modelesDeSession(m, niveau);
			expect(await e.sens.vecteurs(['a'], OPTIONS)).toHaveLength(1);
			expect(await e.reranker.noter('q', ['a'], OPTIONS)).toEqual([0.5]);
			expect(m.appels).toEqual({ sens: 1, reranker: 1 });
		}
	});

	it('niveau relu à chaque appel : un changement en cours de session vaut aussitôt', async () => {
		const m = comptes();
		let niveau: NiveauModeles | null = null;
		const e = modelesDeSession(m, async () => niveau);
		expect(await e.sens.vecteurs(['a'], OPTIONS)).not.toBeNull();
		niveau = 'coupes';
		expect(await e.sens.vecteurs(['a'], OPTIONS)).toBeNull();
		niveau = null;
		expect(await e.sens.vecteurs(['a'], OPTIONS)).not.toBeNull();
		expect(m.appels.sens).toBe(2);
	});

	it('dependancesDeSession : le niveau lu dans l’état des sessions, à chaque appel ; le reste des dépendances inchangé', async () => {
		const etat = ouvrirEtat(join(await dossierTemporaire(), 'etat.sqlite'));
		ouverts.push(etat);
		const id = 'aaaaaaaa-0000-4000-8000-000000000001';
		await etat.creer(session(id));
		const m = comptes();
		const dep = { ...fauxPorts(), sens: m.sens, reranker: m.reranker };
		const d = dependancesDeSession(dep, etat, id);
		expect(d.coffre).toBe(dep.coffre);
		expect(d.index).toBe(dep.index);
		expect(await d.reranker.noter('q', ['a'], OPTIONS)).not.toBeNull();
		await etat.modifier(id, { niveauModeles: 'sens' });
		expect(await d.reranker.noter('q', ['a'], OPTIONS)).toBeNull();
		expect(await d.sens.vecteurs(['a'], OPTIONS)).not.toBeNull();
		await etat.modifier(id, { niveauModeles: 'coupes' });
		expect(await d.sens.vecteurs(['a'], OPTIONS)).toBeNull();
		expect(m.appels).toEqual({ sens: 1, reranker: 1 });
		// session inconnue : elle suit la machine
		const inconnue = dependancesDeSession(dep, etat, 'bbbbbbbb-0000-4000-8000-000000000002');
		expect(await inconnue.sens.vecteurs(['a'], OPTIONS)).not.toBeNull();
	});
});
