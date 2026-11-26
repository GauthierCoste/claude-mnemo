import { describe, expect, it } from 'vitest';
import { ROUTES } from '@mnemo/contrat';
import type { RefusSkill, ReponseEcritureSkill, SkillDetailVue, SkillEditableVue } from '@mnemo/contrat';
import { appeler, serviceFaux } from '../aides/service-faux.ts';
import type { ContexteService } from '../aides/service-faux.ts';

const chemin = (route: string, id: string) => route.replace(':id', encodeURIComponent(id));
const DEVIS: SkillEditableVue = { nom: 'devis', description: 'Rédiger un devis au format de la maison.', icone: '📜', contenu: '# Devis\n\nPérimètre, lots, jours, total HT.' };

function api(c: ContexteService) {
	const { port, jeton } = c.service;
	return {
		get: (route: string) => appeler(port, 'GET', route, { jeton }),
		post: (route: string, corps?: unknown) => appeler(port, 'POST', route, { jeton, ...(corps === undefined ? {} : { corps }) }),
		put: (route: string, corps: unknown) => appeler(port, 'PUT', route, { jeton, corps }),
		delete: (route: string) => appeler(port, 'DELETE', route, { jeton }),
	};
}

describe('routes : skills de la mémoire', () => {
	it('POST skills crée (201) ; GET skill la rend ; un profil qui la liste est un agent qui l\'équipe', async () => {
		const c = await serviceFaux();
		await c.dep.coffre.ecrire('profils/redaction/redaction.md', '---\ntype: profil\nskills_memoire: [devis]\n---\n# Rédaction\n\nRédige.\n');
		const cree = await api(c).post(ROUTES.skills, DEVIS);
		expect(cree.statut).toBe(201);
		expect(cree.corps).toEqual({ commit: expect.any(String), nom: 'devis' } satisfies ReponseEcritureSkill);
		const r = await api(c).get(chemin(ROUTES.skill, 'devis'));
		expect(r.statut).toBe(200);
		expect(r.corps as SkillDetailVue).toMatchObject({ ...DEVIS, origine: 'memoire', modifiee: false, agents: ['redaction', 'travail'], avertissements: [] });
	});

	it('GET skill inconnue ou nom invalide : 404', async () => {
		const c = await serviceFaux();
		expect((await api(c).get(chemin(ROUTES.skill, 'absente'))).statut).toBe(404);
		expect((await api(c).get(chemin(ROUTES.skill, '..'))).statut).toBe(404);
	});

	it('POST : 400 avec un motif par champ (nom pris, description vide) ; corps mal formé : 400', async () => {
		const c = await serviceFaux();
		await api(c).post(ROUTES.skills, DEVIS);
		const pris = await api(c).post(ROUTES.skills, DEVIS);
		expect(pris.statut).toBe(400);
		expect((pris.corps as RefusSkill).motifs).toEqual({ nom: 'la skill « devis » existe déjà' });
		expect(((await api(c).post(ROUTES.skills, { ...DEVIS, nom: 'autre', description: '' })).corps as RefusSkill).motifs).toHaveProperty('description');
		for (const corps of [{ ...DEVIS, pirate: 1 }, { ...DEVIS, icone: 3 }, { ...DEVIS, contenu: null }, { nom: 'x' }, [], 'texte']) expect((await api(c).post(ROUTES.skills, corps)).statut).toBe(400);
	});

	it('PUT : modifie, renomme (nom rendu), 409 sur une empreinte périmée, 404 inconnue', async () => {
		const c = await serviceFaux();
		await api(c).post(ROUTES.skills, DEVIS);
		const { empreinte } = (await api(c).get(chemin(ROUTES.skill, 'devis'))).corps as SkillDetailVue;
		expect((await api(c).put(chemin(ROUTES.skill, 'devis'), { ...DEVIS, contenu: 'Autre.', empreinte: 'perimee' })).statut).toBe(409);
		const r = await api(c).put(chemin(ROUTES.skill, 'devis'), { ...DEVIS, nom: 'devis-maison', contenu: 'Autre.', empreinte });
		expect(r.statut).toBe(200);
		expect(r.corps).toEqual({ commit: expect.any(String), nom: 'devis-maison' });
		expect(((await api(c).get(chemin(ROUTES.skill, 'devis-maison'))).corps as SkillDetailVue).contenu).toBe('Autre.');
		expect((await api(c).get(chemin(ROUTES.skill, 'devis'))).statut).toBe(404);
		expect((await api(c).put(chemin(ROUTES.skill, 'devis'), { ...DEVIS, empreinte })).statut).toBe(404);
		expect((await api(c).put(chemin(ROUTES.skill, 'devis-maison'), { ...DEVIS })).statut).toBe(400);
	});

	it('DELETE : supprime ; 404 ensuite', async () => {
		const c = await serviceFaux();
		await api(c).post(ROUTES.skills, DEVIS);
		const r = await api(c).delete(chemin(ROUTES.skill, 'devis'));
		expect(r.statut).toBe(200);
		expect(r.corps).toEqual({ commit: expect.any(String), nom: 'devis' });
		expect((await api(c).delete(chemin(ROUTES.skill, 'devis'))).statut).toBe(404);
	});

	it('POST skillOrigine : 400 pour une skill que Mnemo ne fournit pas, 404 inconnue', async () => {
		const c = await serviceFaux();
		await api(c).post(ROUTES.skills, DEVIS);
		const r = await api(c).post(chemin(ROUTES.skillOrigine, 'devis'));
		expect(r.statut).toBe(400);
		expect((r.corps as RefusSkill).motifs).toHaveProperty('nom');
		expect((await api(c).post(chemin(ROUTES.skillOrigine, 'absente'))).statut).toBe(404);
	});
});
