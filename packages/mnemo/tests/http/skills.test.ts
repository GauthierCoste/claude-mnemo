import { describe, expect, it } from 'vitest';
import { ROUTES } from '@mnemo/contrat';
import type { RefusSkill, ReponseEcritureSkill, SkillDetailVue, SkillEditableVue } from '@mnemo/contrat';
import { MOTIF_CONFLIT_SKILL } from '../../src/adaptateurs/http/skills.ts';
import { deposerSkillsParDefaut } from '../../src/application/profil.ts';
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

	it('GET skill inconnue, nom qui sort du dossier (encodé) ou profil qui sort de profils/ : 404', async () => {
		const c = await serviceFaux();
		await c.dep.coffre.ecrire('profils/archiviste/archiviste.md', '---\ntype: profil\n---\n# Profil archiviste\n\nRange.\n');
		expect((await api(c).get(chemin(ROUTES.skill, 'absente'))).statut).toBe(404);
		// « ../x » encodé reste un seul segment : l'identifiant reçu est « ../x », refusé comme nom de skill
		expect((await api(c).get(chemin(ROUTES.skill, '../x'))).statut).toBe(404);
		expect((await api(c).get(chemin(ROUTES.skill, '../profils/archiviste/archiviste'))).statut).toBe(404);
		expect((await api(c).get(`${chemin(ROUTES.skill, 'archiviste')}?profil=${encodeURIComponent('../x')}`)).statut).toBe(404);
		expect((await api(c).post(`${ROUTES.skills}?profil=${encodeURIComponent('../x')}`, DEVIS)).statut).toBe(404);
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
		const conflit = await api(c).put(chemin(ROUTES.skill, 'devis'), { ...DEVIS, contenu: 'Autre.', empreinte: 'perimee' });
		expect(conflit.statut).toBe(409);
		expect(conflit.corps).toMatchObject({ erreur: MOTIF_CONFLIT_SKILL });
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

	it('?profil= : une skill de ce profil ; skills par défaut de l\'archiviste : origine mnemo, suppression refusée, retour à l\'origine', async () => {
		const c = await serviceFaux();
		await deposerSkillsParDefaut(c.dep, 'archiviste');
		const archiviste = (route: string) => `${chemin(route, 'menage')}?profil=archiviste`;
		const detail = (await api(c).get(archiviste(ROUTES.skill))).corps as SkillDetailVue;
		expect(detail).toMatchObject({ nom: 'menage', profil: 'archiviste', origine: 'mnemo', modifiee: false, agents: ['archiviste'] });
		expect(detail.motifFixe).toMatch(/fournie par Mnemo/u);
		expect((await api(c).get(chemin(ROUTES.skill, 'menage'))).statut).toBe(404);
		expect((await api(c).delete(archiviste(ROUTES.skill))).statut).toBe(400);
		const r = await api(c).put(archiviste(ROUTES.skill), { nom: 'menage', description: detail.description, icone: '🧹', contenu: 'À ma façon.', empreinte: detail.empreinte });
		expect(r.statut).toBe(200);
		expect(((await api(c).get(archiviste(ROUTES.skill))).corps as SkillDetailVue).modifiee).toBe(true);
		expect((await api(c).post(archiviste(ROUTES.skillOrigine))).corps).toEqual({ commit: expect.any(String), nom: 'menage' });
		expect(((await api(c).get(archiviste(ROUTES.skill))).corps as SkillDetailVue).modifiee).toBe(false);
	});

	it('?profil= : créer puis supprimer une skill propre ; profil inconnu : 404', async () => {
		const c = await serviceFaux();
		expect((await api(c).post(`${ROUTES.skills}?profil=archiviste`, DEVIS)).statut).toBe(201);
		expect(((await api(c).get(`${chemin(ROUTES.skill, 'devis')}?profil=archiviste`)).corps as SkillDetailVue).origine).toBe('memoire');
		expect((await api(c).delete(`${chemin(ROUTES.skill, 'devis')}?profil=archiviste`)).statut).toBe(200);
		expect((await api(c).post(`${ROUTES.skills}?profil=inconnu`, DEVIS)).statut).toBe(404);
		expect((await api(c).get(`${chemin(ROUTES.skill, 'devis')}?profil=inconnu`)).statut).toBe(404);
	});
});
