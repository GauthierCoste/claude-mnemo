import { DEFINITION_DOSSIER_DU_PROJET, EFFET_DU_RATTACHEMENT, texteDossierNonRattache } from '../domaine/rattachement.ts';
import { messageDErreur } from '../domaine/texte.ts';
import type { Session } from '../domaine/session.ts';
import { CONSIGNE_CHEMINS_MAX, OBJECTIF_MAX } from '@mnemo/commun';
import { projetDeSession } from './portees.ts';
import type { Dependances, EtatSessions } from './ports.ts';
import { declarationsDeDossier, lienDuDossier, positionDuProjet } from './position.ts';
import type { PositionDuProjet } from './position.ts';

/** Un dossier de projet sans lien vers la mémoire, tel que « À traiter » le montre. */
export type DossierNonRattache = { dossier: string; texte: string };

/**
 * Position du dossier (`positionDuProjet`), notée dans l'état : un dossier sans lien entre dans la liste des dossiers non
 * rattachés, un dossier couvert en sort. Une panne de l'état ne change pas la position.
 */
export async function positionNotee(
	dep: Dependances,
	etat: Pick<EtatSessions, 'noterRattachement'>,
	relatif: string,
	options: { sansSynchroniser?: boolean } = {},
): Promise<PositionDuProjet> {
	const trouvee = await positionDuProjet(dep, relatif, options);
	if (trouvee.rattachement !== null) {
		const { dossier, rattache } = trouvee.rattachement;
		await etat.noterRattachement(dossier, rattache, dep.systeme.maintenant().getTime()).catch(() => {});
	}
	return trouvee;
}

/**
 * Position servie à une session : la sienne. Celle d'une session dont le dossier n'était pas rattaché est recalculée ; si un
 * lien le couvre maintenant, la session prend cette position et son projet.
 */
export async function positionDeSession(
	dep: Dependances,
	etat: Pick<EtatSessions, 'noterRattachement' | 'modifier'>,
	session: Session,
	options: { sansSynchroniser?: boolean } = {},
): Promise<string> {
	if (session.dossierNonRattache !== true) return session.position;
	const trouvee = await positionNotee(dep, etat, session.dossier, options);
	if (trouvee.rattachement?.rattache !== true) return session.position;
	const projet = await projetDeSession(dep, trouvee.chemin);
	await etat.modifier(session.id, { position: trouvee.chemin, projet, dossierNonRattache: false }).catch(() => null);
	return trouvee.chemin;
}

/** Dossiers notés sans lien qu'aucune fiche ne couvre encore (d'après l'index tel qu'il est), les plus anciens d'abord. */
export async function dossiersNonRattaches(dep: Dependances, etat: Pick<EtatSessions, 'dossiersNonRattaches'>): Promise<DossierNonRattache[]> {
	const declarations = await declarationsDeDossier(dep);
	return (await etat.dossiersNonRattaches())
		.filter((d) => lienDuDossier(declarations, d.dossier) === null)
		.map((d) => ({ dossier: d.dossier, texte: texteDossierNonRattache(d.dossier) }));
}

/**
 * `dossiersNonRattaches` pour « À traiter » : une panne de l'état des sessions ou de l'index ne vide pas la page, elle est dite
 * dans `avertissements`, avec sa source.
 */
export async function dossiersNonRattachesAvecAvertissements(
	dep: Dependances,
	etat: Pick<EtatSessions, 'dossiersNonRattaches'>,
): Promise<{ dossiers: DossierNonRattache[]; avertissements: string[] }> {
	let declarations: Awaited<ReturnType<typeof declarationsDeDossier>>;
	try {
		declarations = await declarationsDeDossier(dep);
	} catch (erreur) {
		return { dossiers: [], avertissements: [`Index illisible : dossiers non rattachés inconnus (${messageDErreur(erreur)}).`] };
	}
	let notes: Awaited<ReturnType<typeof etat.dossiersNonRattaches>>;
	try {
		notes = await etat.dossiersNonRattaches();
	} catch (erreur) {
		return { dossiers: [], avertissements: [`État des sessions illisible : dossiers non rattachés inconnus (${messageDErreur(erreur)}).`] };
	}
	const dossiers = notes.filter((d) => lienDuDossier(declarations, d.dossier) === null).map((d) => ({ dossier: d.dossier, texte: texteDossierNonRattache(d.dossier) }));
	return { dossiers, avertissements: [] };
}

/**
 * Les dossiers qu'une consigne nomme : les premiers, `CONSIGNE_CHEMINS_MAX` au plus, tant que la consigne ne dépasse pas
 * `OBJECTIF_MAX` (un au moins) ; les suivants restent dans « À traiter ».
 */
export function lotDeDossiers(dossiers: readonly string[]): string[] {
	let n = Math.min(1, dossiers.length);
	while (n < Math.min(CONSIGNE_CHEMINS_MAX, dossiers.length) && texteDeConsigne(dossiers.slice(0, n + 1), dossiers.length - n - 1).length <= OBJECTIF_MAX) n++;
	return dossiers.slice(0, n);
}

/**
 * La consigne, une seule ligne, qui confie à l'archiviste le rattachement de ces dossiers : elle nomme ceux du lot
 * (`lotDeDossiers`) et dit combien restent dans « À traiter ».
 */
export function consigneDesDossiers(dossiers: readonly string[]): string {
	const lot = lotDeDossiers(dossiers);
	return texteDeConsigne(lot, dossiers.length - lot.length);
}

function texteDeConsigne(lot: readonly string[], reste: number): string {
	const designation = `${lot.length > 1 ? `les ${lot.length} dossiers non rattachés` : 'le dossier non rattaché'} ${lot.map((d) => `« ${d} »`).join(', ')}`;
	return (
		`Rattache ${designation} : pour chacun, trouve la fiche de lieu du projet ou du client qui y travaille ` +
		`(crée-la s'il n'y en a pas) et pose-lui \`dossier_projet\` : le dossier du projet, c'est-à-dire ${DEFINITION_DOSSIER_DU_PROJET} ` +
		'(pas forcément le sous-dossier noté), et, au besoin, `portee`, par `proposer` genre `modification`. ' +
		EFFET_DU_RATTACHEMENT +
		(reste > 0
			? ` ${reste} autre${reste > 1 ? 's restent' : ' reste'} dans « À traiter » : ${reste > 1 ? 'ils partiront' : 'il partira'} avec un prochain « Traiter » ou « Tout traiter » de l'utilisateur, ou au prochain lancement de l'archiviste ; ne ${reste > 1 ? 'les' : 'le'} cherche pas.`
			: '')
	);
}
