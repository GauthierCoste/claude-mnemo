/**
 * Banc du contexte « sobre » : on rejoue des messages étiquetés par le vrai chemin de service (`servir`, moment `message`) et on
 * compte les cartes justes et indésirables. « Proposée » : la fiche de position servie ou une carte.
 */
import { ficheDePosition } from './chercher.ts';
import type { Dependances } from './ports.ts';
import { servir } from './servir.ts';
import { SANS_EXTRACTION, synchroniser } from './synchroniser.ts';
import { raisonDeMutisme } from '../domaine/message-muet.ts';
import type { ListeDuBanc, Signaux } from './banc-signaux.ts';

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
	/** Session d'origine (id) et rang du message parmi ses messages porteurs (1 = le premier), pour les plis groupés par session. */
	session?: string;
	rang?: number;
	/** Le message porteur d'avant dans la session (variante jointe de la requête, spec § 3.2) ; null s'il n'y en a pas. */
	precedent?: string | null;
	/**
	 * Jugement par mise en commun (spec § 6.1) : les fiches à juger, figées à l'extraction (l'union des premières selon le sens,
	 * les mots et le reranker). Un cas sans `candidates` est un cas étiqueté à la main (`attendues`, `interdites`).
	 */
	candidates?: CandidateAJuger[];
	/** Chemin → jugement ; une candidate absente n'est pas encore jugée. */
	jugements?: Record<string, Jugement>;
	/** Vrai : le message a été sauté au jugement ; il ne compte nulle part. */
	saute?: boolean;
};
export type Jugement = 'pertinente' | 'non_pertinente' | 'indecise';
export const JUGEMENTS: readonly Jugement[] = ['pertinente', 'non_pertinente', 'indecise'];
/** `seule` : le message ; `jointe` : le message joint au message porteur d'avant (spec § 3.2). */
export type VarianteRequete = 'seule' | 'jointe';
/**
 * Une fiche à juger : titre et première ligne figés à l'extraction (ce que l'on montre), les listes où elle était en tête
 * (jamais montrées) et ses signaux bruts par variante de requête, calculés à l'extraction.
 */
export type CandidateAJuger = { chemin: string; titre: string; ligne: string; listes: ListeDuBanc[]; signaux: Partial<Record<VarianteRequete, Signaux>> };
/** `indesirables` : fiches interdites proposées, et, dans un cas `silence`, tout ce qui est proposé (sauf la fiche de position d'un `premier` muet). */
export type MesureContexte = { cas: number; justes: number; attenduesProposees: number; attenduesTotal: number; indesirables: number; caracteres: number };
export type EchecContexte = { nom: string; manquees: string[]; indesirables: string[] };

const DELAI_MS = 5000;

/** Le nom désigne le chemin : égal, ou dernier segment (« Corvel.md » désigne `projets/clients/Corvel/Corvel.md`). */
export const designe = (nom: string, chemin: string) => chemin === nom || chemin.endsWith(`/${nom}`);

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
