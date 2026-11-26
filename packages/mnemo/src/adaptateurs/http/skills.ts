/**
 * Routes de gestion des skills de la mémoire (Réglages › Agents) : détail, création, modification (renommage compris),
 * suppression, retour à la version d'origine. Canal de l'utilisateur seulement ; mêmes protections que toute route de l'API.
 */
import { ROUTES } from '@mnemo/contrat';
import type { EnregistrementSkill, RefusSkill, ReponseEcritureSkill, SkillDetailVue, SkillEditableVue } from '@mnemo/contrat';
import { creerSkill, detailSkill, modifierSkill, revenirALOrigine, supprimerSkill } from '../../application/gerer-skills.ts';
import type { ResultatSkill, SkillEntree } from '../../application/gerer-skills.ts';
import type { Dependances } from '../../application/ports.ts';
import { estObjet } from '../../domaine/valeurs.ts';
import { ErreurHttp } from './routes.ts';
import type { Reponse, Route } from './routes.ts';

/** Message d'un conflit d'écriture (409). */
export const MOTIF_CONFLIT_SKILL = 'Le SKILL.md de la skill a changé depuis son ouverture : rechargez-la.';

const CLES_SKILL = ['nom', 'description', 'icone', 'contenu'] as const;

/** Skill reçue : forme vérifiée ici (bornes larges), contenu validé par le cas d'usage ; `autres` : clés admises en plus. */
function skillDe(brut: unknown, autres: readonly string[] = []): SkillEntree {
	if (!estObjet(brut)) throw new ErreurHttp(400, `Corps attendu : { ${[...CLES_SKILL, ...autres].join(', ')} }.`);
	for (const cle of Object.keys(brut)) if (!(CLES_SKILL as readonly string[]).includes(cle) && !autres.includes(cle)) throw new ErreurHttp(400, `Champ inconnu « ${cle} ».`);
	const { nom, description, icone, contenu } = brut;
	if (typeof nom !== 'string' || nom.length > 200) throw new ErreurHttp(400, 'Champ « nom » : texte attendu.');
	if (typeof description !== 'string' || description.length > 10_000) throw new ErreurHttp(400, 'Champ « description » : texte attendu.');
	if (icone !== null && (typeof icone !== 'string' || icone.length > 100)) throw new ErreurHttp(400, 'Champ « icone » : texte ou null attendu.');
	if (typeof contenu !== 'string' || contenu.length > 1_000_000) throw new ErreurHttp(400, 'Champ « contenu » : texte attendu.');
	return { nom, description, icone, contenu } satisfies SkillEditableVue;
}

/** Réponse d'une écriture : 404, 409, 400 avec un motif par champ ; sinon `statut` et, si un commit a eu lieu, la diffusion. */
function reponseDe(r: ResultatSkill, diffuser: () => void, statut = 200): Reponse {
	if (!r.ok && 'introuvable' in r) throw new ErreurHttp(404, 'Skill inconnue.');
	if (!r.ok && 'conflit' in r) throw new ErreurHttp(409, MOTIF_CONFLIT_SKILL);
	if (!r.ok) return { statut: 400, corps: { erreur: `Skill refusée : ${Object.values(r.motifs).join(' ; ')}`, motifs: r.motifs } satisfies RefusSkill };
	if (r.commit !== null) diffuser();
	return { statut, corps: { commit: r.commit, nom: r.nom } satisfies ReponseEcritureSkill };
}

/** Routes des skills de la mémoire ; `diffuser` prévient les clients qu'une écriture a changé la mémoire. */
export function routesSkills(dep: Dependances, diffuser: () => void): Route[] {
	return [
		{
			methode: 'POST',
			chemin: ROUTES.skills,
			corps: 'json',
			action: async (r) => reponseDe(await creerSkill(dep, skillDe(await r.json())), diffuser, 201),
		},
		{
			methode: 'GET',
			chemin: ROUTES.skill,
			action: async (r) => {
				const detail = await detailSkill(dep, r.id);
				if (detail === null) throw new ErreurHttp(404, `Skill inconnue : « ${r.id} ».`);
				return { statut: 200, corps: detail satisfies SkillDetailVue };
			},
		},
		{
			methode: 'PUT',
			chemin: ROUTES.skill,
			corps: 'json',
			action: async (r) => {
				const corps = await r.json();
				const skill = skillDe(corps, ['empreinte']);
				const empreinte = (corps as Record<string, unknown>)['empreinte'];
				if (typeof empreinte !== 'string') throw new ErreurHttp(400, 'Champ « empreinte » : texte attendu.');
				const demande: EnregistrementSkill = { ...skill, empreinte };
				return reponseDe(await modifierSkill(dep, r.id, skill, demande.empreinte), diffuser);
			},
		},
		{
			methode: 'DELETE',
			chemin: ROUTES.skill,
			action: async (r) => reponseDe(await supprimerSkill(dep, r.id), diffuser),
		},
		{
			methode: 'POST',
			chemin: ROUTES.skillOrigine,
			action: async (r) => reponseDe(await revenirALOrigine(dep, r.id), diffuser),
		},
	];
}
