/**
 * Routes des lots d'informations (page Archiviste › « À arbitrer ») : liste, validation (toutes les lignes ou une partie),
 * rejet. Canal de l'utilisateur seulement : le serveur MCP propose un lot, il ne le valide ni ne le rejette jamais.
 */
import { ROUTES } from '@mnemo/contrat';
import type { MessageServeur, ReponseLots, ReponseRejetLot, ReponseValidationLot } from '@mnemo/contrat';
import { lotsEnAttente, rejeterLot, validerLot } from '../../application/lots.ts';
import type { Dependances } from '../../application/ports.ts';
import { estObjet } from '../../domaine/valeurs.ts';
import { ErreurHttp } from './routes.ts';
import type { Reponse, Route } from './routes.ts';

/** Indices des lignes cochées (`{ lignes: number[] }`) ; sinon 400. */
function lignesDe(corps: unknown): number[] {
	if (!estObjet(corps)) throw new ErreurHttp(400, 'Corps attendu : { lignes }.');
	for (const cle of Object.keys(corps)) if (cle !== 'lignes') throw new ErreurHttp(400, `Champ inconnu « ${cle} ».`);
	const lignes = corps['lignes'];
	if (!Array.isArray(lignes) || lignes.length > 1000 || !lignes.every((i) => Number.isInteger(i))) throw new ErreurHttp(400, 'Champ « lignes » : liste des indices (entiers) des lignes à valider.');
	return lignes as number[];
}

/**
 * Routes des lots ; `diffuser` prévient les clients : `lots` à chaque décision, `memoire` après un commit. La version
 * diffusée est relue (`Lots.version`), comme le sondage du hub.
 */
export function routesLots(dep: Dependances, diffuser: (m: MessageServeur) => void): Route[] {
	const lotsChanges = async (): Promise<void> => diffuser({ type: 'lots', version: await dep.lots.version() });
	return [
		{
			methode: 'GET',
			chemin: ROUTES.lots,
			action: async () => ({ statut: 200, corps: { lots: await lotsEnAttente(dep) } satisfies ReponseLots }),
		},
		{
			methode: 'POST',
			chemin: ROUTES.lotValider,
			corps: 'json',
			action: async (r): Promise<Reponse> => {
				const lignes = lignesDe(await r.json());
				const resultat = await validerLot(dep, r.id, lignes);
				switch (resultat.statut) {
					case 'inconnu':
						throw new ErreurHttp(404, resultat.motif);
					case 'refuse':
						throw new ErreurHttp(400, `Refusé : ${resultat.motif}`);
					case 'perime':
					case 'deja_applique':
					case 'fiche_absente':
						await lotsChanges();
						throw new ErreurHttp(409, resultat.motif);
					case 'valide': {
						diffuser({ type: 'memoire', modifieeMs: Date.now() });
						await lotsChanges();
						const { lot, fiche, commit, changements, avertissements } = resultat;
						return { statut: 200, corps: { id: lot, fiche, commit, lignes: resultat.lignes, changements, ...(avertissements === undefined ? {} : { avertissements }) } satisfies ReponseValidationLot };
					}
				}
			},
		},
		{
			methode: 'POST',
			chemin: ROUTES.lotRejeter,
			action: async (r) => {
				if (!(await rejeterLot(dep, r.id))) throw new ErreurHttp(404, `Le lot ${r.id} n'existe pas ou a déjà été décidé.`);
				await lotsChanges();
				return { statut: 200, corps: { id: r.id } satisfies ReponseRejetLot };
			},
		},
	];
}
