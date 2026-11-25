/**
 * Modèles locaux de la démonstration (`?demo`) : installés (bge-m3 et bge-reranker-v2-m3 de BAAI, llama.cpp b11671), prêts ;
 * démarrer, arrêter et changer de niveau les font évoluer comme le service, et chaque changement est diffusé (`modeles`).
 */
import { estNiveauModeles, modelesPermis } from '@mnemo/commun';
import type { EtatModelesVue, MessageServeur, ReponseArretModeles } from '@mnemo/contrat';
import { ErreurApi } from './api.ts';

/** Délai du faux chargement après « Démarrer ». */
const CHARGEMENT_MS = 1500;

function etatInitial(): EtatModelesVue {
	return {
		installes: true,
		niveau: 'complets',
		gardien: 'pret',
		sens: 'pret',
		reranker: 'pret',
		pieces: {
			sens: { modele: 'bge-m3', editeur: 'BAAI', quantification: 'Q8_0', octets: 634_553_888, empreinte: 'aa473d51' },
			reranker: { modele: 'bge-reranker-v2-m3', editeur: 'BAAI', quantification: 'Q8_0', octets: 635_768_640, empreinte: 'a43c7c9b' },
			moteur: { version: 'b11671', plateforme: 'macOS arm64' },
		},
		activites: [],
	};
}

export function creerModelesDemo(diffuser: (m: MessageServeur) => void) {
	let etat = etatInitial();
	let chargement: ReturnType<typeof setTimeout> | undefined;
	const publier = (changement: Partial<EtatModelesVue>): EtatModelesVue => {
		etat = { ...etat, ...changement };
		diffuser({ type: 'modeles', modeles: structuredClone(etat) });
		return structuredClone(etat);
	};
	/** État de chaque modèle d'après le niveau, le gardien étant `pret` ou non. */
	const modelesSelon = (niveau: EtatModelesVue['niveau'], prets: boolean): Pick<EtatModelesVue, 'sens' | 'reranker'> => {
		const permis = modelesPermis(niveau);
		const un = (t: 'sens' | 'reranker') => (!permis[t] ? 'exclu' : prets ? 'pret' : 'arrete');
		return { sens: un('sens'), reranker: un('reranker') };
	};
	const arreter = (): EtatModelesVue => {
		clearTimeout(chargement);
		return publier({ gardien: 'arrete', activites: [], ...modelesSelon(etat.niveau, false) });
	};
	const arreterSurDemande = (): ReponseArretModeles => {
		const enMarche = etat.gardien !== 'arrete';
		return { ...arreter(), arret: enMarche ? 'arrete' : 'rien' };
	};
	return {
		etat: (): EtatModelesVue => structuredClone(etat),
		demarrer(): EtatModelesVue {
			if (etat.niveau === 'coupes' || etat.gardien === 'pret') return structuredClone(etat);
			clearTimeout(chargement);
			chargement = setTimeout(() => publier({ gardien: 'pret', ...modelesSelon(etat.niveau, true) }), CHARGEMENT_MS);
			return publier({ gardien: 'demarrage' });
		},
		arreter: arreterSurDemande,
		niveau(corps: unknown): EtatModelesVue {
			const niveau = (corps as { niveau?: unknown } | null)?.niveau;
			if (!estNiveauModeles(niveau)) throw new ErreurApi('Champ « niveau » invalide.', 400);
			const avant = modelesPermis(etat.niveau);
			const apres = modelesPermis(niveau);
			etat = { ...etat, niveau };
			// un modèle retiré arrête les modèles en marche ; un modèle ajouté ne lance rien
			if ((avant.sens && !apres.sens) || (avant.reranker && !apres.reranker)) return arreter();
			const suivant = (t: 'sens' | 'reranker') => (!apres[t] ? 'exclu' : etat[t] === 'exclu' ? 'arrete' : etat[t]);
			return publier({ sens: suivant('sens'), reranker: suivant('reranker') });
		},
	};
}
