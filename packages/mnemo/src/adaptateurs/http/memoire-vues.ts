/**
 * Vues de la mémoire pour l'interface (contrat : `DonneesGraphe`, `FicheVue`) : le graphe tiré de l'index, et une fiche mise
 * en forme avec ses liens (`liens-de-fiche.ts`) et les sessions qui l'ont utilisée.
 */
import type { DonneesGraphe, FicheVue } from '@mnemo/contrat';
import { SESSIONS_DE_FICHE_MAX } from '@mnemo/commun';
import { donneesGraphe } from '../../application/graphe.ts';
import { lireFicheEtLiens } from '../../application/liens-de-fiche.ts';
import { projetDe } from '../../application/portees.ts';
import type { Dependances, EtatSessions } from '../../application/ports.ts';
import { SANS_EXTRACTION, synchroniser } from '../../application/synchroniser.ts';
import { cheminValide, dansGit, estCache, EXTENSION_MARKDOWN, nomDeLaFiche } from '../../domaine/chemin.ts';
import { empreinte } from '../../domaine/empreinte.ts';
import { analyserFiche, CLE_ANCRE_MAX, separerFrontmatter, texteAnomalie } from '../../domaine/fiche.ts';

/** Chemin de fiche que la route `fiche` accepte (relatif à `_mnemo/`, `.md`, ni caché, ni dans `.git`), sinon null. */
export function cheminDeVue(brut: string): string | null {
	if (brut.includes('\\')) return null;
	const chemin = cheminValide(brut);
	if (chemin === null || dansGit(chemin) || estCache(chemin) || !chemin.endsWith(EXTENSION_MARKDOWN)) return null;
	return chemin;
}

/** Valeur d'une propriété du frontmatter, en texte : liste jointe par « , », date AAAA-MM-JJ, objet en JSON. */
function enTexte(valeur: unknown): string {
	if (valeur === null || valeur === undefined) return '';
	if (valeur instanceof Date) return valeur.toISOString().slice(0, 10);
	if (Array.isArray(valeur)) return valeur.map(enTexte).join(', ');
	if (typeof valeur === 'object') return JSON.stringify(valeur);
	return String(valeur);
}

/** Le graphe, l'index d'abord rattrapé (sans extraction de documents). */
export async function vueGraphe(dep: Dependances): Promise<DonneesGraphe> {
	await synchroniser(dep, SANS_EXTRACTION);
	return (await donneesGraphe(dep)) satisfies DonneesGraphe;
}

/**
 * La fiche `chemin` (déjà validé par `cheminDeVue`), ou null si elle n'existe pas. Une fiche au frontmatter illisible est
 * rendue quand même (aucune propriété, corps : le texte entier), pour être réparée par l'édition brute ; `avertissements`
 * dit ce que sa lecture a contourné (`analyserFiche`), puis, pour une source, ce que l'index a noté de son document.
 * `toutesLesSessions` faux : `SESSIONS_DE_FICHE_MAX` sessions au plus ; `sessionsTotal` les compte toutes.
 */
export async function vueFiche(dep: Dependances, etat: Pick<EtatSessions, 'sessionsAyantServi'>, chemin: string, toutesLesSessions: boolean): Promise<FicheVue | null> {
	const lue = await lireFicheEtLiens(dep, chemin);
	if (lue === null) return null;
	const { brut, liens } = lue;

	const { fiche, anomalies } = analyserFiche(chemin, brut);
	const titre = fiche.titre === '' ? nomDeLaFiche(chemin) : fiche.titre;
	let proprietes: [string, string][] = [];
	let corps = brut;
	try {
		const { entete, corps: sansEntete } = separerFrontmatter(chemin, brut);
		// `ancre_max` : tenue technique des ancres, pas une propriété de l'utilisateur
		const cles = Object.keys(entete).filter((k) => k !== 'id' && k !== 'updated' && k !== CLE_ANCRE_MAX);
		if (Object.hasOwn(entete, 'updated')) cles.push('updated');
		proprietes = cles.map((k) => [k, enTexte(entete[k])]);
		corps = sansEntete;
	} catch {
		// frontmatter illisible : texte entier
	}

	const servies = await etat.sessionsAyantServi(chemin, toutesLesSessions ? null : SESSIONS_DE_FICHE_MAX);
	const sessions: FicheVue['sessions'] = servies.sessions.map(({ session, horodatageMs }) => ({ id: session.id, objectif: session.objectif, etat: session.etat, horodatageMs }));

	return {
		chemin,
		titre,
		type: fiche.type,
		proprietes,
		corps,
		brut,
		empreinte: empreinte(brut),
		liens,
		sessions,
		sessionsTotal: servies.total,
		avertissements: [...anomalies.map(texteAnomalie), ...(await avertissementsDeSource(dep, chemin))],
		projet: await projetDe(dep, chemin),
	};
}

/** Avertissements de la dernière indexation du document de la fiche `chemin` ; aucun si l'index ne la connaît pas comme source. */
async function avertissementsDeSource(dep: Dependances, chemin: string): Promise<string[]> {
	const source = (await dep.index.sources()).find((s) => s.fiche === chemin);
	return source === undefined ? [] : source.avertissements;
}
