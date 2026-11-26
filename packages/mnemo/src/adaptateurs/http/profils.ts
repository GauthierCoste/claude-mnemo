/**
 * Routes de gestion des profils (Réglages › Profils) : détail, enregistrement, duplication, suppression, aperçu. Canal de
 * l'utilisateur seulement (le serveur MCP n'expose rien de tout cela) ; mêmes protections que toute route de l'API.
 */
import { MODELE_MAX } from '@mnemo/commun';
import { ROUTES } from '@mnemo/contrat';
import type { ApercuProfilVue, EnregistrementProfil, ProfilDetailVue, RefusProfil, ReponseEcritureProfil } from '@mnemo/contrat';
import { apercuProfil } from '../../application/apercu-profil.ts';
import { detailProfil, dupliquerProfil, enregistrerProfil, supprimerProfil } from '../../application/gerer-profils.ts';
import type { ProfilEntree, ResultatProfil } from '../../application/gerer-profils.ts';
import type { Dependances } from '../../application/ports.ts';
import { estObjet } from '../../domaine/valeurs.ts';
import { ErreurHttp } from './routes.ts';
import type { Reponse, Route } from './routes.ts';

/** Message d'un conflit d'écriture (409). */
export const MOTIF_CONFLIT_PROFIL = 'La fiche du profil a changé depuis son ouverture : à recharger.';

const CLES_EDITABLES = ['avatar', 'consigne', 'lancement', 'hooks', 'skillsMemoire', 'plugins', 'moteur', 'modele'] as const;

/** Profil réglé reçu au `PUT` : forme vérifiée ici, contenu validé par le cas d'usage. */
function editableDe(brut: unknown): ProfilEntree {
	if (!estObjet(brut)) throw new ErreurHttp(400, 'Champ « editable » : objet attendu.');
	for (const cle of Object.keys(brut)) if (!(CLES_EDITABLES as readonly string[]).includes(cle)) throw new ErreurHttp(400, `Champ inconnu « editable.${cle} ».`);
	const { avatar, consigne, lancement, hooks, skillsMemoire, plugins, moteur, modele } = brut;
	if (!estObjet(avatar) || typeof avatar['forme'] !== 'string' || typeof avatar['couleur'] !== 'string') throw new ErreurHttp(400, 'Champ « editable.avatar » : { forme, couleur } attendu.');
	if (consigne !== null && typeof consigne !== 'string') throw new ErreurHttp(400, 'Champ « editable.consigne » : texte ou null attendu.');
	if (typeof consigne === 'string' && consigne.length > 100_000) throw new ErreurHttp(400, 'Champ « editable.consigne » : 100 000 caractères au plus.');
	if (typeof lancement !== 'string') throw new ErreurHttp(400, 'Champ « editable.lancement » : texte attendu.');
	const listeDeTextes = (v: unknown): v is string[] => Array.isArray(v) && v.length <= 200 && v.every((x) => typeof x === 'string');
	if (!listeDeTextes(hooks)) throw new ErreurHttp(400, 'Champ « editable.hooks » : liste de textes attendue.');
	if (skillsMemoire !== 'tous' && !listeDeTextes(skillsMemoire)) throw new ErreurHttp(400, 'Champ « editable.skillsMemoire » : « tous » ou liste de textes attendu.');
	if (!listeDeTextes(plugins)) throw new ErreurHttp(400, 'Champ « editable.plugins » : liste de textes attendue.');
	// `moteur` et `modele` absents (client d'avant les moteurs) : ceux déjà enregistrés sont gardés
	if (moteur !== undefined && typeof moteur !== 'string') throw new ErreurHttp(400, 'Champ « editable.moteur » : texte attendu.');
	if (modele !== undefined && (typeof modele !== 'string' || modele.length > MODELE_MAX)) throw new ErreurHttp(400, `Champ « editable.modele » : texte de ${MODELE_MAX} caractères au plus attendu (« » : le modèle par défaut du moteur).`);
	return { avatar, consigne, lancement, hooks, skillsMemoire, plugins, ...(moteur === undefined ? {} : { moteur }), ...(modele === undefined ? {} : { modele }) } as ProfilEntree;
}

/**
 * Réponse d'une écriture : 409 en conflit, 400 avec un motif par champ en refus ; sinon `statut` et, si un commit a eu lieu,
 * la diffusion « mémoire modifiée » aux clients.
 */
function reponseDe(r: ResultatProfil, diffuser: () => void, statut = 200): Reponse {
	if (!r.ok && 'conflit' in r) throw new ErreurHttp(409, MOTIF_CONFLIT_PROFIL);
	if (!r.ok) return { statut: 400, corps: { erreur: `Profil refusé : ${Object.values(r.motifs).join(' ; ')}`, motifs: r.motifs } satisfies RefusProfil };
	if (r.commit !== null) diffuser();
	return { statut, corps: { commit: r.commit } satisfies ReponseEcritureProfil };
}

/** Routes des profils ; `diffuser` prévient les clients qu'une écriture a changé la mémoire. */
export function routesProfils(dep: Dependances, diffuser: () => void): Route[] {
	return [
		{
			methode: 'GET',
			chemin: ROUTES.profil,
			action: async (r) => {
				const detail = await detailProfil(dep, r.id);
				if (detail === null) throw new ErreurHttp(404, `Profil inconnu : « ${r.id} ».`);
				return { statut: 200, corps: detail satisfies ProfilDetailVue };
			},
		},
		{
			methode: 'PUT',
			chemin: ROUTES.profil,
			corps: 'json',
			action: async (r) => {
				const corps = await r.json();
				if (!estObjet(corps)) throw new ErreurHttp(400, 'Corps attendu : { editable, empreinte }.');
				for (const cle of Object.keys(corps)) if (cle !== 'editable' && cle !== 'empreinte') throw new ErreurHttp(400, `Champ inconnu « ${cle} ».`);
				const empreinte = corps['empreinte'];
				if (empreinte !== null && typeof empreinte !== 'string') throw new ErreurHttp(400, 'Champ « empreinte » : texte ou null attendu.');
				const demande: EnregistrementProfil = { editable: editableDe(corps['editable']), empreinte };
				return reponseDe(await enregistrerProfil(dep, r.id, demande.editable as ProfilEntree, demande.empreinte), diffuser);
			},
		},
		{
			methode: 'DELETE',
			chemin: ROUTES.profil,
			action: async (r) => reponseDe(await supprimerProfil(dep, r.id), diffuser),
		},
		{
			methode: 'POST',
			chemin: ROUTES.profilDupliquer,
			corps: 'json',
			action: async (r) => {
				const corps = await r.json();
				if (!estObjet(corps) || typeof corps['nom'] !== 'string' || Object.keys(corps).length !== 1) throw new ErreurHttp(400, 'Corps attendu : { nom }.');
				return reponseDe(await dupliquerProfil(dep, r.id, corps['nom']), diffuser, 201);
			},
		},
		{
			methode: 'GET',
			chemin: ROUTES.profilApercu,
			action: async (r) => {
				if ((await detailProfil(dep, r.id)) === null) throw new ErreurHttp(404, `Profil inconnu : « ${r.id} ».`);
				const projet = r.params.get('projet');
				return { statut: 200, corps: (await apercuProfil(dep, r.id, projet === null || projet === '' ? undefined : projet)) satisfies ApercuProfilVue };
			},
		},
	];
}
