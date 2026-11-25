import { describe, expect, it } from 'vitest';
import { chercherAvecAvis, chercherSansSynchro } from '../../src/application/chercher.ts';
import { synchroniser } from '../../src/application/synchroniser.ts';
import { vectoriser } from '../../src/application/vectoriser.ts';
import { normaliser, texteAVectoriser } from '../../src/domaine/sens.ts';
import { fauxPorts } from '../aides/faux-ports.ts';
import { fauxSens, vecteurFaux } from '../aides/faux-sens.ts';

const entete = `---\nid: 01ABC\ntype: sujet\nupdated: 2026-11-01\n---\n`;
const ligne = (texte: string, ancre: string) => `- ${texte} | declare | src: utilisateur oral | appris 2026-11-20 | confiance 100 % ^${ancre}`;
const ficheAvecFaits = (titre: string, faits: string[]) =>
	`${entete}# ${titre}\n\n## Faits\n${faits.map((f, i) => ligne(f, `f-${String(i + 1).padStart(4, '0')}`)).join('\n')}\n`;

/** Mémoire de `n` faits (plus l'élément de la fiche), synchronisée, avec un faux modèle de sens. */
async function memoire(n: number) {
	const dep = fauxPorts();
	const sens = fauxSens();
	dep.sens = sens;
	await dep.coffre.ecrire('a.md', ficheAvecFaits('Fiche A', Array.from({ length: n }, (_, i) => `Fait numéro ${i}`)));
	await synchroniser(dep);
	return { dep, sens };
}

const SANS_LIMITE = { budgetMs: 60_000, demarrer: true };

describe('vectoriser', () => {
	it('calcule les vecteurs (normalisés) par lots de 64, puis les réutilise', async () => {
		const { dep, sens } = await memoire(99);
		expect(await vectoriser(dep, SANS_LIMITE)).toEqual({ faits: 100, restants: 0 });
		expect(sens.appels.map((a) => a.textes.length)).toEqual([64, 36]);
		expect(sens.appels[0]!.options.demarrer).toBe(true);
		expect(sens.appels[0]!.textes).toContain(texteAVectoriser('Fiche A', 'Fait numéro 0'));
		// réutilisés : aucun appel de plus
		expect(await vectoriser(dep, SANS_LIMITE)).toEqual({ faits: 0, restants: 0 });
		expect(sens.appels).toHaveLength(2);
		// stockés normalisés : le texte d'un fait est son propre plus proche voisin, similarité 1
		const requete = normaliser(vecteurFaux(texteAVectoriser('Fiche A', 'Fait numéro 7')));
		const [premier] = await dep.index.plusProches(sens.nom!, requete, {}, 1);
		expect(premier!.id).toBe('a.md#^f-0008');
		expect(premier!.similarite).toBeCloseTo(1, 5);
	});

	it('texte modifié : seul cet élément est recalculé', async () => {
		const { dep, sens } = await memoire(3);
		await vectoriser(dep, SANS_LIMITE);
		await dep.coffre.ecrire('a.md', ficheAvecFaits('Fiche A', ['Fait numéro 0', 'Fait changé', 'Fait numéro 2']));
		await synchroniser(dep);
		sens.appels.length = 0;
		expect(await vectoriser(dep, SANS_LIMITE)).toEqual({ faits: 1, restants: 0 });
		expect(sens.appels.map((a) => a.textes)).toEqual([[texteAVectoriser('Fiche A', 'Fait changé')]]);
	});

	it('changement de modèle : tout est recalculé, les anciens vecteurs ignorés', async () => {
		const { dep, sens } = await memoire(3);
		await vectoriser(dep, SANS_LIMITE);
		const requete = normaliser(vecteurFaux(texteAVectoriser('Fiche A', 'Fait numéro 1')));
		sens.nom = 'faux@000000000002';
		expect(await dep.index.plusProches(sens.nom, requete, {}, 5)).toEqual([]);
		expect(await vectoriser(dep, SANS_LIMITE)).toEqual({ faits: 4, restants: 0 });
		expect((await dep.index.plusProches(sens.nom, requete, {}, 1))[0]!.id).toBe('a.md#^f-0002');
	});

	it('budget dépassé : s\'arrête, puis reprend au prochain appel', async () => {
		const { dep, sens } = await memoire(199);
		sens.delaiMs = 60;
		const premier = await vectoriser(dep, { budgetMs: 100, demarrer: true });
		expect(premier.faits).toBeGreaterThanOrEqual(64);
		expect(premier.faits).toBeLessThan(200);
		expect(premier.faits + premier.restants!).toBe(200);
		sens.delaiMs = 0;
		expect(await vectoriser(dep, SANS_LIMITE)).toEqual({ faits: premier.restants, restants: 0 });
	});

	it('modèle absent : rien à faire ; modèle en panne : arrêt sans erreur', async () => {
		const { dep, sens } = await memoire(2);
		sens.nom = null;
		expect(await vectoriser(dep, SANS_LIMITE)).toEqual({ faits: 0, restants: 0 });
		expect(sens.appels).toEqual([]);
		sens.nom = 'faux@1';
		sens.panne = true;
		expect(await vectoriser(dep, { budgetMs: 2000, demarrer: false })).toEqual({ faits: 0, restants: 3 });
		expect(sens.appels[0]!.options.demarrer).toBe(false);
	});

	it('compter: false : le reste n\'est jamais compté (ni au budget, ni en panne), le total de la passe une fois', async () => {
		const { dep, sens } = await memoire(199);
		const nombre = dep.index.nombreAVectoriser.bind(dep.index);
		let comptes = 0;
		dep.index = { ...dep.index, nombreAVectoriser: (m) => (comptes++, nombre(m)) };
		sens.delaiMs = 60;
		expect((await vectoriser(dep, { budgetMs: 100, demarrer: true, compter: false })).restants).toBeNull();
		sens.panne = true;
		expect(await vectoriser(dep, { budgetMs: 2000, demarrer: true, compter: false })).toEqual({ faits: 0, restants: null });
		// seul le total de chaque passe qui a à faire est compté, une fois, au premier lot (avancement affiché)
		expect(comptes).toBe(2);
		// la recherche d'un outil ne lit pas ce reste : seul le total de sa passe est compté
		await chercherAvecAvis(dep, { texte: 'numéro' });
		expect(comptes).toBe(3);
		// par défaut, le reste est compté aussi
		expect((await vectoriser(dep, { budgetMs: 2000, demarrer: true })).restants).toBeGreaterThan(0);
		expect(comptes).toBe(5);
	});

	it('activité : vectorisation, avec l’avancement de la passe entière (pas du lot)', async () => {
		const { dep, sens } = await memoire(140);
		await vectoriser(dep, { ...SANS_LIMITE, compter: false });
		expect(sens.appels.map((a) => a.options.activite)).toEqual([
			{ operation: 'vectorisation', avancement: { faits: 0, total: 141 } },
			{ operation: 'vectorisation', avancement: { faits: 64, total: 141 } },
			{ operation: 'vectorisation', avancement: { faits: 128, total: 141 } },
		]);
	});

	it('progression : appelée après chaque lot avec le total', async () => {
		const { dep } = await memoire(99);
		const vus: [number, number][] = [];
		await vectoriser(dep, { ...SANS_LIMITE, progression: (faits, total) => vus.push([faits, total]) });
		expect(vus).toEqual([[64, 100], [100, 100]]);
	});
});

describe('vectoriser dans la recherche', () => {
	it('chercherAvecAvis vectorise après la synchronisation (2 s, démarrage permis) ; chercherSansSynchro non', async () => {
		const dep = fauxPorts();
		const sens = fauxSens();
		dep.sens = sens;
		await dep.coffre.ecrire('a.md', ficheAvecFaits('Fiche A', ['Le tapir boit']));
		await chercherSansSynchro(dep, { texte: 'tapir' });
		expect(sens.appels).toEqual([]);
		await chercherAvecAvis(dep, { texte: 'tapir' });
		// les vecteurs manquants, puis la requête (étape « sens » de la recherche)
		expect(sens.appels.map((a) => a.textes)).toEqual([[expect.any(String), expect.any(String)], ['tapir']]);
		expect(sens.appels[0]!.options.demarrer).toBe(true);
		expect(sens.appels[0]!.options.budgetMs).toBeLessThanOrEqual(2000);
		expect(sens.appels[0]!.options.budgetMs).toBeGreaterThan(1500);
		expect(await dep.index.nombreAVectoriser(sens.nom!)).toBe(0);
	});
});
