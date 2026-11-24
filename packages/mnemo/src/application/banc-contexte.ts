/**
 * Banc du contexte « sobre » : on rejoue des messages étiquetés par le vrai chemin de service (`servir`, moment `message`) et on
 * compte les cartes justes et indésirables. « Proposée » : la fiche de position servie ou une carte.
 */
import { ficheDePosition } from './chercher.ts';
import type { Dependances, EtatSessions } from './ports.ts';
import { servir } from './servir.ts';
import { SANS_EXTRACTION, synchroniser } from './synchroniser.ts';
import { raisonDeMutisme } from '../domaine/message-muet.ts';

/**
 * Un message étiqueté. `attendues` / `interdites` : chemin complet de fiche ou dernier segment (« Corvel.md » désigne
 * `projets/clients/Corvel/Corvel.md`) ; `silence` : rien ne doit être proposé. `premier` : premier message de la session (le
 * périmètre de la position est proposé) ; sinon la fiche de position est déjà servie. Un cas `premier` dont le message est muet
 * ne propose pas le périmètre, mais sert quand même la fiche de position ; dans un cas `silence` de ce genre, cette fiche n'est pas
 * indésirable (seules les cartes le sont). `injectees` (facultatif, mêmes désignations) : fiches injectées à la main par
 * l'utilisateur (« Injecter dans la session ») juste avant ce message, qui part avec elles : injectées entières (ni attendues ni
 * indésirables), elles pèsent sur leurs voisines, classées et proposées avec le périmètre restant. Une désignation `injectees`
 * qui ne désigne aucune fiche de l'index fait échouer le cas, comme une attendue inconnue (jamais proposée) : elle est rendue
 * avec les manquées, suivie de « (injectée inconnue) ».
 */
export type CasContexte = {
	nom: string;
	position: string;
	message: string;
	premier: boolean;
	attendues: string[];
	interdites: string[];
	silence: boolean;
	injectees?: string[];
};
/** `indesirables` : fiches interdites proposées, et, dans un cas `silence`, tout ce qui est proposé (sauf la fiche de position d'un `premier` muet). */
export type MesureContexte = { cas: number; justes: number; attenduesProposees: number; attenduesTotal: number; indesirables: number; caracteres: number };
export type EchecContexte = { nom: string; manquees: string[]; indesirables: string[] };

const DELAI_MS = 5000;

/** Le nom désigne le chemin : égal, ou dernier segment (« Corvel.md » désigne `projets/clients/Corvel/Corvel.md`). */
const designe = (nom: string, chemin: string) => chemin === nom || chemin.endsWith(`/${nom}`);

/**
 * Rejoue un cas : les chemins proposés (fiche de position servie puis cartes), les cartes seules, si le message est muet, la taille
 * du texte injecté et les désignations `injectees` qui ne désignent aucune fiche de l'index.
 */
async function rejouer(dep: Dependances, cas: CasContexte): Promise<{ proposes: string[]; cartes: string[]; muet: boolean; caracteres: number; injecteesInconnues: string[] }> {
	const muet = raisonDeMutisme(cas.message);
	const dejaServies = new Map<string, string | null>();
	if (!cas.premier) {
		// après le premier message, la fiche de position a déjà été servie
		const fiche = await ficheDePosition(dep, cas.position);
		const empreinte = fiche === null ? undefined : (await dep.index.fiches()).find((f) => f.chemin === fiche)?.empreinte;
		if (fiche !== null && empreinte !== undefined) dejaServies.set(fiche, empreinte);
	}
	// une fiche injectée à la main est désignée comme les attendues (chemin ou dernier segment) ; inconnue de l'index, elle est signalée
	const chemins = (await dep.index.fiches()).map((f) => f.chemin);
	const injectees = (cas.injectees ?? []).flatMap((nom) => chemins.filter((c) => designe(nom, c)));
	const injecteesInconnues = (cas.injectees ?? []).filter((nom) => !chemins.some((c) => designe(nom, c)));
	const servi = await servir(dep, {
		position: cas.position,
		message: cas.message,
		dejaServies,
		dejaLues: new Map(),
		proposees: new Map(),
		ecartes: [],
		moment: 'message',
		muet,
		premier: cas.premier && muet === null,
		fin: Date.now() + DELAI_MS,
		rappels: false,
		...(injectees.length === 0 ? {} : { demandees: injectees }),
	});
	const { position, cartes } = servi.calcul;
	return {
		proposes: [...(position === null ? [] : [position.chemin]), ...cartes.map((c) => c.chemin)],
		cartes: cartes.map((c) => c.chemin),
		muet: muet !== null,
		caracteres: servi.texte.length,
		injecteesInconnues,
	};
}

export async function rejouerCas(dep: Dependances, cas: readonly CasContexte[]): Promise<{ mesure: MesureContexte; echecs: EchecContexte[] }> {
	// l'index doit être à jour avant de lire la position et les empreintes
	await synchroniser(dep, SANS_EXTRACTION);
	const mesure: MesureContexte = { cas: cas.length, justes: 0, attenduesProposees: 0, attenduesTotal: 0, indesirables: 0, caracteres: 0 };
	const echecs: EchecContexte[] = [];
	for (const c of cas) {
		const { proposes, cartes, muet, caracteres, injecteesInconnues } = await rejouer(dep, c);
		const attenduesManquees = c.attendues.filter((a) => !proposes.some((p) => designe(a, p)));
		const manquees = [...attenduesManquees, ...injecteesInconnues.map((nom) => `${nom} (injectée inconnue)`)];
		const interdites = c.interdites.filter((i) => proposes.some((p) => designe(i, p)));
		// un `premier` muet reçoit la fiche de position, légitimement : seules les cartes comptent
		const indesirables = c.silence ? (muet && c.premier ? cartes : proposes) : interdites;
		mesure.attenduesTotal += c.attendues.length;
		mesure.attenduesProposees += c.attendues.length - attenduesManquees.length;
		mesure.indesirables += indesirables.length;
		mesure.caracteres += caracteres;
		if (manquees.length === 0 && indesirables.length === 0) mesure.justes += 1;
		else echecs.push({ nom: c.nom, manquees, indesirables });
	}
	return { mesure, echecs };
}

/**
 * Les messages journalisés de la session, dans l'ordre, en cas à étiqueter (`attendues`, `interdites` vides). Le premier message
 * non muet est le `premier`.
 */
export async function extraireCas(etat: EtatSessions, session: string): Promise<CasContexte[]> {
	const journal = await etat.servis(session, 200);
	const positionDeLaSession = (await etat.lire(session))?.position;
	if (positionDeLaSession === undefined && journal.length === 0) throw new Error(`Session inconnue ou sans journal : ${session}`);
	const entrees = journal.filter((e) => e.moment === 'message' && e.demande !== null).sort((a, b) => a.horodatageMs - b.horodatageMs);
	let dejaPremier = false;
	return entrees.map((e, i): CasContexte => {
		const premier = !dejaPremier && e.muet === null;
		if (premier) dejaPremier = true;
		return { nom: `${session.slice(0, 8)} #${i + 1}`, position: e.position ?? positionDeLaSession ?? '', message: e.demande!, premier, attendues: [], interdites: [], silence: false };
	});
}
