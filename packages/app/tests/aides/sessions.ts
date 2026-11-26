import { PROFIL_TRAVAIL } from '@mnemo/commun';
import type { SessionVue } from '@mnemo/contrat';

/** Une session de test : travaille dans `clients/exemple`, créée à l'instant 1000 ; `champs` remplace le reste. */
export function session(champs: Partial<SessionVue> & { id: string }): SessionVue {
	return {
		profil: PROFIL_TRAVAIL,
		dossier: 'clients/exemple',
		position: 'clients/exemple',
		projet: 'exemple',
		dossierNonRattache: null,
		objectif: `Objectif ${champs.id}`,
		etat: 'travaille',
		creeeMs: 1000,
		majMs: 1000,
		bilanDemandeMs: null,
		commitDebut: null,
		branche: null,
		terminal: true,
		dialogueOuvert: false,
		niveauModeles: null,
		...champs,
	};
}
