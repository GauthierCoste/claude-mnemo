/**
 * Modèles locaux de la démonstration (`?demo`) : installés (bge-m3 et bge-reranker-v2-m3 de BAAI, llama.cpp b11671), prêts ;
 * démarrer, arrêter et changer de niveau les font évoluer comme le service, et chaque changement est diffusé (`modeles`).
 * `&modeles=` fixe un autre état de départ, pour les captures (`DEPARTS_MODELES`), ou `anime` : un scénario qui boucle
 * (veille, chargement, prêts, vectorisation, recherche et injection de la première session), arrêté par le premier geste.
 */
import { estNiveauModeles, modelesPermis } from '@mnemo/commun';
import type { ActiviteModeleVue, EtatModelesVue, MessageServeur, ReponseArretModeles } from '@mnemo/contrat';
import { aDemarrer } from '../modeles/etat.ts';
import { ErreurApi } from './api.ts';

/** Délai du faux chargement après « Démarrer ». */
const CHARGEMENT_MS = 1500;
/** Inactivité tolérée par le faux gardien (celle du réglage de démonstration). */
const INACTIVITE_MINUTES = 15;

/** Une activité de la démonstration, de ce dossier. */
const activite = (operation: ActiviteModeleVue['operation'], session: string | null, avancement: ActiviteModeleVue['avancement'] = null): ActiviteModeleVue => ({
	operation,
	session,
	ceDossier: true,
	depuisMs: Date.now(),
	avancement,
});

const VEILLE = { gardien: 'arrete', sens: 'arrete', reranker: 'arrete' } as const;

/** États de départ de `&modeles=` ; `session` : celle à qui sont attribuées la recherche et l'injection. */
export const DEPARTS_MODELES: Record<string, (session: string | null) => Partial<EtatModelesVue>> = {
	veille: () => VEILLE,
	chargement: () => ({ ...VEILLE, gardien: 'demarrage' }),
	prets: () => ({}),
	vectorisation: () => ({ activites: [activite('vectorisation', null, { faits: 120, total: 800 })] }),
	recherche: (session) => ({ activites: [activite('recherche', session)] }),
	sens: () => ({ niveau: 'sens', reranker: 'exclu' }),
	coupes: () => ({ niveau: 'coupes', gardien: 'arrete', sens: 'exclu', reranker: 'exclu' }),
	echec: () => ({ ...VEILLE, gardien: 'echec' }),
};

/** Le scénario de `anime` : durée de chaque étape, et ce qu'elle change. */
function etapesAnimees(session: string | null): [number, Partial<EtatModelesVue>][] {
	const vecteurs = Array.from({ length: 16 }, (_, i): [number, Partial<EtatModelesVue>] => [350, { activites: [activite('vectorisation', null, { faits: Math.min(800, 50 * (i + 1)), total: 800 })] }]);
	return [
		[2500, { ...VEILLE, activites: [] }],
		[2500, { gardien: 'demarrage' }],
		[1500, { gardien: 'pret', sens: 'pret', reranker: 'pret' }],
		[350, { activites: [activite('vectorisation', null, { faits: 0, total: null })] }],
		...vecteurs,
		[1500, { activites: [] }],
		[1800, { activites: [activite('recherche', session)] }],
		[1500, { activites: [] }],
		[1800, { activites: [activite('injection', session)] }],
		[2500, { activites: [] }],
	];
}

function etatInitial(): EtatModelesVue {
	return {
		installes: true,
		niveau: 'complets',
		gardien: 'pret',
		inactiviteMinutes: INACTIVITE_MINUTES,
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

export function creerModelesDemo(diffuser: (m: MessageServeur) => void, o: { depart?: string | null; session?: string | null } = {}) {
	const session = o.session ?? null;
	const depart = o.depart == null ? undefined : DEPARTS_MODELES[o.depart];
	/** Le délai d'inactivité n'est connu que d'un gardien en marche. */
	const avecDelai = (e: EtatModelesVue): EtatModelesVue => ({ ...e, inactiviteMinutes: e.gardien === 'pret' || e.gardien === 'demarrage' ? INACTIVITE_MINUTES : null });
	let etat = avecDelai({ ...etatInitial(), ...depart?.(session) });
	let chargement: ReturnType<typeof setTimeout> | undefined;
	let scenario: ReturnType<typeof setTimeout> | undefined;
	const publier = (changement: Partial<EtatModelesVue>): EtatModelesVue => {
		etat = avecDelai({ ...etat, ...changement });
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
		clearTimeout(scenario);
		return publier({ gardien: 'arrete', activites: [], ...modelesSelon(etat.niveau, false) });
	};
	const arreterSurDemande = (): ReponseArretModeles => {
		const enMarche = etat.gardien !== 'arrete';
		return { ...arreter(), arret: enMarche ? 'arrete' : 'rien' };
	};
	// scénario animé : arrêté par le premier geste (démarrer, arrêter, niveau)
	if (o.depart === 'anime') {
		const etapes = etapesAnimees(session);
		let i = 0;
		const suivante = () => {
			const [duree, changement] = etapes[i % etapes.length]!;
			publier(changement);
			i++;
			scenario = setTimeout(suivante, duree);
		};
		suivante();
	}
	return {
		etat: (): EtatModelesVue => structuredClone(etat),
		demarrer(): EtatModelesVue {
			clearTimeout(scenario);
			// comme le service : un gardien prêt à qui manque un modèle permis (niveau élargi) est relancé
			if (etat.niveau === 'coupes' || !aDemarrer(etat)) return structuredClone(etat);
			clearTimeout(chargement);
			chargement = setTimeout(() => publier({ gardien: 'pret', ...modelesSelon(etat.niveau, true) }), CHARGEMENT_MS);
			return publier({ gardien: 'demarrage', ...modelesSelon(etat.niveau, false) });
		},
		arreter: arreterSurDemande,
		niveau(corps: unknown): EtatModelesVue {
			const niveau = (corps as { niveau?: unknown } | null)?.niveau;
			if (!estNiveauModeles(niveau)) throw new ErreurApi('Champ « niveau » invalide.', 400);
			clearTimeout(scenario);
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
