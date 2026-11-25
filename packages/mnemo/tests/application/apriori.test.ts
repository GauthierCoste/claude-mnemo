import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { afterEach, describe, expect, it } from 'vitest';
import { aprioriDesGestes } from '../../src/application/apriori.ts';
import type { EtatSessions } from '../../src/application/ports.ts';
import { JOUR_MS } from '../../src/domaine/apriori-gestes.ts';
import type { Session } from '../../src/domaine/session.ts';
import { ouvrirEtat } from '../../src/infra/etat-sqlite.ts';
import { dossierTemporaire } from '../aides/dossier-temporaire.ts';

const ouverts: EtatSessions[] = [];
afterEach(() => {
	while (ouverts.length > 0) ouverts.pop()!.fermer();
});

async function etat(): Promise<EtatSessions> {
	const e = ouvrirEtat(join(await dossierTemporaire(), 'etat.sqlite'));
	ouverts.push(e);
	return e;
}

const session = (id: string): Session => ({
	id,
	profil: 'travail',
	dossier: 'atelier-vitrail',
	position: 'projets/vitrail',
	projet: 'vitrail',
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

const MAINTENANT = Date.UTC(2026, 10, 25, 12);
const contexte = { maintenantMs: MAINTENANT, sessionCourante: 'courante', dossier: 'atelier-vitrail', position: 'projets/vitrail', vecteur: null };

describe('a priori des gestes, tenu par le service', () => {
	it('relit les gestes nouveaux à chaque actualisation, recalcule la fiche touchée', async () => {
		const e = await etat();
		await e.creer(session('s1'));
		const a = aprioriDesGestes(e, { horloge: () => MAINTENANT });
		await a.actualiser();
		expect(a.aprioris(contexte).size).toBe(0);
		await e.noterGeste({ geste: 'injectee_main', session: 's1', fiche: 'projets/vitrail/devis.md', empreinte: null, horodatageMs: MAINTENANT - 1000 });
		expect(a.aprioris(contexte).size).toBe(0);
		await a.actualiser();
		const positif = a.aprioris(contexte).get('projets/vitrail/devis.md')!;
		expect(positif).toBeGreaterThan(0);
		await e.noterGeste({ geste: 'ecartee_ici', session: 's1', fiche: 'projets/vitrail/devis.md', empreinte: null, horodatageMs: MAINTENANT - 500 });
		await a.actualiser();
		expect(a.aprioris(contexte).get('projets/vitrail/devis.md')).toBeCloseTo(0, 6);
	});

	it('écartées toujours : exclues des candidates après actualisation, rendues au rétablissement', async () => {
		const e = await etat();
		const a = aprioriDesGestes(e, { horloge: () => MAINTENANT });
		await e.ecarterToujours({ fiche: 'projets/corvel/plan.md', session: null, horodatageMs: 1 });
		await a.actualiser();
		const candidates = ['projets/corvel/plan.md', 'projets/corvel/plan.md#^f-0002', 'projets/vitrail/devis.md'];
		expect(a.exclusDefinitivement(candidates)).toEqual(['projets/vitrail/devis.md']);
		expect(a.exclusDefinitivement([{ chemin: 'projets/corvel/plan.md' }])).toEqual([]);
		expect(await e.retablirToujours('projets/corvel/plan.md', 2)).toEqual({ fiche: 'projets/corvel/plan.md', session: null, horodatageMs: 1, retablieMs: 2 });
		await a.actualiser({ ecartees: true });
		expect(a.exclusDefinitivement(candidates)).toEqual(candidates);
	});

	it('coût : 1 000 gestes avec vecteurs (1 024 dimensions), lecture et calcul bornés', async () => {
		const e = await etat();
		for (let i = 0; i < 50; i++) await e.creer(session(`s${i}`));
		const dimension = 1024;
		const valeurs = (graine: number) => Float32Array.from({ length: dimension }, (_, k) => Math.sin(graine * 31 + k));
		for (let i = 0; i < 1000; i++) {
			const v = { rang: 0, vecteur: { modele: 'bge-m3@a1', valeurs: valeurs(i) } };
			await e.noterGeste({
				geste: i % 3 === 0 ? 'ecartee_ici' : 'injectee_main',
				session: `s${i % 50}`,
				fiche: `projets/fiche-${i % 120}.md`,
				empreinte: null,
				horodatageMs: MAINTENANT - i * 3_600_000,
				porteur: { texte: null, rang: 0 },
				vecteur: v,
			});
		}
		const a = aprioriDesGestes(e, { horloge: () => MAINTENANT });
		const t0 = performance.now();
		await a.actualiser();
		const lecture = performance.now() - t0;
		const t1 = performance.now();
		const resultat = a.aprioris({ ...contexte, vecteur: { modele: 'bge-m3@a1', valeurs: valeurs(7) } });
		const calcul = performance.now() - t1;
		const t2 = performance.now();
		await a.actualiser();
		const relecture = performance.now() - t2;
		console.log(`a priori, 1 000 gestes : lecture ${lecture.toFixed(1)} ms, calcul pour un message ${calcul.toFixed(1)} ms, actualisation sans geste nouveau ${relecture.toFixed(2)} ms`);
		expect(resultat.size).toBe(120);
		expect(Math.max(...resultat.values())).toBeLessThanOrEqual(1);
		expect(calcul).toBeLessThan(500);
		expect(relecture).toBeLessThan(50);
	});

	it('lecture initiale en échec (écartées toujours illisibles) : rien n’est changé, la lecture suivante réussit et recalcule tout', async () => {
		const e = await etat();
		await e.creer(session('s1'));
		await e.noterGeste({ geste: 'injectee_main', session: 's1', fiche: 'projets/vitrail/devis.md', empreinte: null, horodatageMs: MAINTENANT - 1000 });
		await e.ecarterToujours({ fiche: 'projets/corvel/plan.md', session: null, horodatageMs: 1 });
		let panne = true;
		const lecteur: Pick<EtatSessions, 'gestes' | 'ecarteesToujours'> = {
			gestes: (f) => e.gestes(f),
			ecarteesToujours: async () => {
				if (panne) throw new Error('base occupée');
				return e.ecarteesToujours();
			},
		};
		const a = aprioriDesGestes(lecteur, { horloge: () => MAINTENANT });
		await expect(a.actualiser()).rejects.toThrow('base occupée');
		expect(a.aprioris(contexte).size).toBe(0);
		panne = false;
		await a.actualiser();
		expect(a.aprioris(contexte).get('projets/vitrail/devis.md')).toBeGreaterThan(0);
		expect(a.exclusDefinitivement(['projets/corvel/plan.md'])).toEqual([]);
	});

	it('suggestions : sessions dont la liste change rendues par actualiser ; filtrées par les fiches de l’index', async () => {
		const e = await etat();
		for (const id of ['a', 'b', 'c']) await e.creer(session(id));
		const jours = [MAINTENANT - 3 * JOUR_MS, MAINTENANT - 2 * JOUR_MS, MAINTENANT - JOUR_MS];
		let index = ['projets/vitrail/devis.md'];
		const a = aprioriDesGestes(e, { horloge: () => MAINTENANT, chemins: async () => index });
		await a.actualiser();
		for (const [i, id] of ['a', 'b'].entries()) await e.noterGeste({ geste: 'ecartee_ici', session: id, fiche: 'projets/vitrail/devis.md', empreinte: null, horodatageMs: jours[i]! });
		expect(await a.actualiser()).toEqual(new Set());
		await e.noterGeste({ geste: 'ecartee_ici', session: 'c', fiche: 'projets/vitrail/devis.md', empreinte: null, horodatageMs: jours[2]! });
		expect(await a.actualiser()).toEqual(new Set(['a', 'b', 'c']));
		expect(a.suggestions('c').map((s) => s.fiche)).toEqual(['projets/vitrail/devis.md']);
		index = [];
		expect(await a.actualiser()).toEqual(new Set(['a', 'b', 'c']));
		expect(a.suggestions()).toEqual([]);
	});

	it('demandes regroupées : pendant une lecture, toutes celles qui arrivent n’en font qu’une suivante', async () => {
		const e = await etat();
		let lectures = 0;
		const lecteur: Pick<EtatSessions, 'gestes' | 'ecarteesToujours'> = {
			gestes: async (f) => {
				lectures++;
				return e.gestes(f);
			},
			ecarteesToujours: () => e.ecarteesToujours(),
		};
		const a = aprioriDesGestes(lecteur, { horloge: () => MAINTENANT });
		await Promise.all([a.actualiser(), a.actualiser(), a.actualiser(), a.actualiser({ ecartees: true })]);
		expect(lectures).toBe(2);
	});

	it('cache léger : un seul vecteur par message, partagé par ses gestes ; oublié avec la session', async () => {
		const e = await etat();
		await e.creer(session('s1'));
		await e.noterMessagePorteur('s1', 'Le devis Corvel ?');
		const v = { rang: 1, vecteur: { modele: 'bge-m3@a1', valeurs: Float32Array.from([1, 0]) } };
		for (const fiche of ['a.md', 'b.md', 'c.md']) await e.noterGeste({ geste: 'injectee_main', session: 's1', fiche, empreinte: null, horodatageMs: MAINTENANT - 10, vecteur: v });
		const a = aprioriDesGestes(e, { horloge: () => MAINTENANT });
		await a.actualiser();
		expect(a.taille()).toEqual({ gestes: 3, vecteurs: 1 });
		a.oublierSession('s1');
		expect(a.taille()).toEqual({ gestes: 3, vecteurs: 0 });
	});

	it('élagage au-delà du nombre gardé : des gestes de moins de 60 jours oubliés, signalé une seule fois', async () => {
		const e = await etat();
		await e.creer(session('s1'));
		const noter = (fiche: string, ilYa: number) => e.noterGeste({ geste: 'injectee_main', session: 's1', fiche, empreinte: null, horodatageMs: MAINTENANT - ilYa });
		const journal: string[] = [];
		const a = aprioriDesGestes(e, { horloge: () => MAINTENANT, gestesMax: 2, journal: (m) => journal.push(m) });
		await a.actualiser();
		for (const [i, fiche] of ['a.md', 'b.md', 'c.md'].entries()) await noter(fiche, 3000 - i);
		await a.actualiser();
		expect(a.taille().gestes).toBe(2);
		expect([...a.aprioris(contexte).keys()].sort()).toEqual(['b.md', 'c.md']);
		await noter('d.md', 100);
		await a.actualiser();
		expect(journal).toHaveLength(1);
		expect(journal[0]).toContain('moins de 60 jours');
	});

	it('horizon : un geste de plus d’un an n’est pas relu', async () => {
		const e = await etat();
		await e.creer(session('s1'));
		await e.noterGeste({ geste: 'injectee_main', session: 's1', fiche: 'projets/vitrail/devis.md', empreinte: null, horodatageMs: MAINTENANT - 400 * JOUR_MS });
		const a = aprioriDesGestes(e, { horloge: () => MAINTENANT });
		await a.actualiser();
		expect(a.aprioris(contexte).size).toBe(0);
	});
});
