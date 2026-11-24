/**
 * Routes des réglages du dossier (`.mnemo/reglages.json`) : lecture, et modification validée par le domaine (tout ou rien),
 * écrite de façon atomique. Mêmes protections que toute route de l'API (jeton, `Host`, `Origin` : vérifiés par le serveur).
 */
import { ROUTES } from '@mnemo/contrat';
import type { ChampReglageVue, ReglagesVue } from '@mnemo/contrat';
import { CHAMPS_MEMOIRE } from '../../domaine/reglages-memoire.ts';
import { CHAMPS_REGLAGES, modifierReglages, valeurDuReglage } from '../../domaine/reglages.ts';
import type { ChampReglage, Reglages } from '../../domaine/reglages.ts';
import { ecrireReglagesDuDossier, lireReglagesDuDossier } from '../../infra/reglages-fichier.ts';
import { ErreurHttp } from './routes.ts';
import type { Route } from './routes.ts';
import { estObjet } from '../../domaine/valeurs.ts';

const egales = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** Réglages remplacés par une variable d'environnement (`{ "service.port": "MNEMO_PORT" }`) : sans effet tant qu'elle est posée. */
export type ReglagesFixes = Readonly<Partial<Record<string, string>>>;

type Choix = { valeur: string; libelle: string };
/** Choix des types de fiche (service d'application), selon les valeurs déjà cochées. */
export type ChoixDesTypes = (coches: readonly string[]) => Promise<Choix[]>;

/** Règles de SCHEMA.md (groupe « Mémoire »), lues et modifiées par l'application ; absentes : groupe non montré. */
export type ReglagesMemoire = {
	lire(): Promise<{ valeurs: Record<string, number>; anomalies: string[] }>;
	modifier(valeurs: Record<string, unknown>): Promise<{ ok: true; commit: string | null } | { ok: false; motifs: string[] }>;
};

const vueChamp = (c: ChampReglage, valeur: ChampReglageVue['valeur'], choix: readonly Choix[] | undefined, fixePar: string | undefined): ChampReglageVue => ({
	cle: c.cle,
	groupe: c.groupe,
	libelle: c.libelle,
	explication: c.explication,
	genre: c.genre,
	defaut: structuredClone(c.defaut),
	valeur: structuredClone(valeur),
	...(c.min === undefined ? {} : { min: c.min }),
	...(c.max === undefined ? {} : { max: c.max }),
	...(c.unite === undefined ? {} : { unite: c.unite }),
	...(choix === undefined ? {} : { choix: choix.map((x) => ({ ...x })) }),
	effet: c.effet,
	...(fixePar === undefined ? {} : { fixePar }),
});

/**
 * Vue des réglages ; `enAttente` : réglages « au redémarrage du service » changés depuis son démarrage (`auDemarrage`), sauf
 * ceux que fixe une variable d'environnement (`fixes`) : un redémarrage n'y changerait rien.
 */
export function vueReglages(reglages: Reglages, avertissements: string[], auDemarrage: Reglages, fixes: ReglagesFixes = {}, choixDesTypes: readonly Choix[] = [], memoire: Record<string, number> | null = null): ReglagesVue {
	const champs = CHAMPS_REGLAGES.map((c) => vueChamp(c, valeurDuReglage(reglages, c.cle), c.choixDynamiques === 'types-de-fiche' ? choixDesTypes : c.choix, fixes[c.cle]));
	if (memoire !== null) champs.push(...CHAMPS_MEMOIRE.map((c) => vueChamp(c, memoire[c.cle] ?? (c.defaut as number), undefined, undefined)));
	const enAttente = CHAMPS_REGLAGES.filter((c) => c.effet === 'service' && fixes[c.cle] === undefined && !egales(valeurDuReglage(reglages, c.cle), valeurDuReglage(auDemarrage, c.cle))).map((c) => c.cle);
	return { champs, avertissements, enAttente };
}

/**
 * `GET` et `PUT` de `ROUTES.reglages` pour le dossier `racine` ; les réglages du démarrage sont lus à la création. Un `PUT` ne
 * réécrit que les réglages envoyés.
 */
export function routesReglages(racine: string, fixes: ReglagesFixes = {}, choixDesTypes: ChoixDesTypes = async () => [], memoire: ReglagesMemoire | null = null): Route[] {
	const auDemarrage = lireReglagesDuDossier(racine).reglages;
	const vue = async (reglages: Reglages, avertissements: string[]): Promise<ReglagesVue> => {
		const regles = memoire === null ? null : await memoire.lire();
		return vueReglages(reglages, [...avertissements, ...(regles?.anomalies ?? [])], auDemarrage, fixes, await choixDesTypes(reglages.archiviste.typesAConfirmer), regles?.valeurs ?? null);
	};
	return [
		{
			methode: 'GET',
			chemin: ROUTES.reglages,
			action: async () => {
				const { reglages, avertissements } = lireReglagesDuDossier(racine);
				return { statut: 200, corps: await vue(reglages, avertissements) };
			},
		},
		{
			methode: 'PUT',
			chemin: ROUTES.reglages,
			corps: 'json',
			action: async (r) => {
				const corps = await r.json();
				if (!estObjet(corps)) throw new ErreurHttp(400, 'Corps attendu : { valeurs: { "<groupe>.<nom>": valeur | null } }.');
				for (const cle of Object.keys(corps)) if (cle !== 'valeurs') throw new ErreurHttp(400, `Champ inconnu « ${cle} ».`);
				if (!estObjet(corps['valeurs'])) throw new ErreurHttp(400, 'Champ « valeurs » : objet { "<groupe>.<nom>": valeur | null } attendu.');
				// les règles de SCHEMA.md (« memoire.* ») à part : elles s'écrivent dans la mémoire, par un commit
				const duDossier: Record<string, unknown> = {};
				const deLaMemoire: Record<string, unknown> = {};
				for (const [cle, v] of Object.entries(corps['valeurs'])) (CHAMPS_MEMOIRE.some((c) => c.cle === cle) ? deLaMemoire : duDossier)[cle] = v;
				if (Object.keys(deLaMemoire).length > 0 && memoire === null) throw new ErreurHttp(400, 'Réglages refusés : règles de la mémoire indisponibles.');
				// validation du dossier d'abord : un refus n'écrit rien, ni le fichier ni SCHEMA.md
				const modifies = modifierReglages(lireReglagesDuDossier(racine).reglages, duDossier);
				if (!modifies.ok) throw new ErreurHttp(400, `Réglages refusés : ${modifies.motifs.join(' ')}`);
				if (Object.keys(deLaMemoire).length > 0) {
					const r = await memoire!.modifier(deLaMemoire);
					if (!r.ok) throw new ErreurHttp(400, `Réglages refusés : ${r.motifs.join(' ')}`);
				}
				// relus après l'attente de SCHEMA.md : deux PUT ne se marchent pas dessus
				if (Object.keys(duDossier).length > 0) {
					const relus = modifierReglages(lireReglagesDuDossier(racine).reglages, duDossier);
					if (!relus.ok) throw new ErreurHttp(400, `Réglages refusés : ${relus.motifs.join(' ')}`);
					ecrireReglagesDuDossier(racine, relus.reglages, Object.keys(duDossier));
				}
				const relus = lireReglagesDuDossier(racine);
				return { statut: 200, corps: await vue(relus.reglages, relus.avertissements) };
			},
		},
	];
}
