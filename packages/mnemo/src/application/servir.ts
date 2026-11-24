/**
 * Ce que Mnemo injecte dans une session : les consignes de la portée, la fiche de position entière si elle n'est pas déjà injectée,
 * les fiches que l'utilisateur a demandé d'injecter, puis des cartes (`calculerCartes`) au lieu de fiches entières.
 */
import { libelleRaison } from '@mnemo/commun';
import { ficheDePosition } from './chercher.ts';
import { consignesIndexees } from './commun.ts';
import { calculerCartes, fichesAEncadrer } from './cartes.ts';
import { sansFaitsBarres } from '../domaine/sans-faits-barres.ts';
import type { Carte, CartesCalculees, DemandeCartes, FicheDePositionServie } from './cartes.ts';
import { liensDeLaMemoire } from './liens.ts';
import type { LiensResolus } from './liens.ts';
import { porteesDe } from './portees.ts';
import { positionValide } from './position.ts';
import type { Position } from './position.ts';
import type { Dependances } from './ports.ts';
import { SANS_EXTRACTION, synchroniser } from './synchroniser.ts';
import { dossiersAscendants, ficheDeDossier } from '../domaine/chemin.ts';
import type { Niveau } from '../domaine/consigne.ts';
import { AVERTISSEMENT, encadrer } from '../domaine/contexte.ts';
import type { ElementIndexe } from '../domaine/elements.ts';
import { PORTEE_GLOBALE } from '../domaine/portee.ts';
import type { PorteeDeLieu } from '../domaine/portee.ts';
import type { RaisonMuet } from '../domaine/message-muet.ts';
import { expressionFts } from '../domaine/requete.ts';

const CONSIGNES_TROUVEES_MAX = 5;

export type { Position };
export type Moment = 'message' | 'contexte';

/** Fiches visées par les relations (`- verbe [[…]]`) de la fiche, résolues ; un lien qui ne mène à aucune fiche est omis. */
async function relations(liens: LiensResolus, chemin: string): Promise<string[]> {
	return (await liens.sortants(chemin)).flatMap((lien) => (lien.verbe !== null && lien.cible !== null ? [lien.cible] : []));
}

async function consignesDe(dep: Dependances, portees: Set<string>, niveaux: Niveau[]): Promise<ElementIndexe[]> {
	return (await consignesIndexees(dep, niveaux)).filter((e) => e.portee !== null && portees.has(e.portee));
}

/** « verifiee » prolonge « toujours » : elle est servie avec. */
const NIVEAUX_PERMANENTS: Niveau[] = ['toujours', 'verifiee'];

/**
 * Cadre d'une position (sur l'index déjà synchronisé) : les portées qui s'y appliquent, `globale`, celles de la position, celles
 * des fiches que visent les relations de la fiche de position et de ses dossiers (`nommees` : le détail, du plus proche au plus lointain).
 */
async function cadreDe(dep: Dependances, positionDemandee: Position): Promise<{ portees: Set<string>; nommees: PorteeDeLieu[] }> {
	// une position invalide (absolue, « .. ») vaut la racine
	const position: Position = { chemin: positionValide(positionDemandee.chemin) ?? '' };
	const ficheDePos = await ficheDePosition(dep, position.chemin);
	const nommees = await porteesDe(dep, position.chemin);
	if (ficheDePos !== null) {
		const liens = await liensDeLaMemoire(dep);
		const liees = new Set<string>();
		for (const chemin of [ficheDePos, ...dossiersAscendants(ficheDePos).map(ficheDeDossier)]) for (const cible of await relations(liens, chemin)) liees.add(cible);
		for (const cible of liees) nommees.push(...(await porteesDe(dep, cible)));
	}
	return { portees: new Set<string>([PORTEE_GLOBALE, ...nommees.map((p) => p.portee)]), nommees };
}

/** Textes des consignes permanentes (`toujours`, `verifiee`) qui s'appliquent à la position, choisies comme `servir`. Synchronise l'index. */
export async function consignesPermanentes(dep: Dependances, position: Position): Promise<string[]> {
	await synchroniser(dep, SANS_EXTRACTION);
	const { portees } = await cadreDe(dep, position);
	return (await consignesDe(dep, portees, NIVEAUX_PERMANENTS)).map((e) => e.texte);
}

/** Consignes `verifiee` de la position, lues dans l'index tel qu'il est, **sans synchroniser** : le hook `outil` doit rester rapide. */
export async function consignesVerifiees(dep: Dependances, position: Position): Promise<ElementIndexe[]> {
	const { portees } = await cadreDe(dep, position);
	return consignesDe(dep, portees, ['verifiee']);
}

export type DemandeServir = Omit<DemandeCartes, 'perimetre' | 'servirPosition' | 'question' | 'voisinage' | 'demandees'> & {
	moment: Moment;
	/** Le message ne porte pas de sens : ni cartes ni consigne trouvée, seule la fiche de position peut venir. */
	muet: RaisonMuet | null;
	/** Premier message non muet de la session, et de nouveau après /clear ou /compact : les cartes du périmètre de la position sont proposées. */
	premier: boolean;
	/** Premier contexte injecté dans la session : les consignes `rappelee` y sont jointes. */
	rappels: boolean;
	/**
	 * Fiches que l'utilisateur a demandé d'injecter (« Injecter dans la session ») : injectées entières, même déjà injectées ou écartées ;
	 * elles pèsent sur leurs voisines (âge 0), qui sont classées et proposées à ce message avec le périmètre restant.
	 */
	demandees?: readonly string[];
};

/** `consignes` : le texte des consignes seul (le banc vérifie qu'une consigne attendue est servie) ; `demandees` : les fiches demandées injectées. */
export type Servi = { texte: string; consignes: string; calcul: CartesCalculees; demandees: FicheDePositionServie[] };

function rendreConsignes(permanentes: readonly ElementIndexe[], rappels: readonly ElementIndexe[]): string {
	const bloc = (titre: string, elements: readonly ElementIndexe[]) => (elements.length === 0 ? '' : `## ${titre}\n${elements.map((e) => `- ${e.texte}`).join('\n')}`);
	return [bloc('Consignes', permanentes), bloc('Rappels', rappels)].filter((b) => b !== '').join('\n\n');
}

function rendreFiche(p: FicheDePositionServie): string {
	const lignes = [`### ${p.titre} (${p.chemin})`, ...p.texte.trim().split('\n')];
	return p.encadree ? encadrer(p.chemin, lignes) : lignes.join('\n');
}

function rendreCarte(c: Carte): string {
	const ligne = `- ${[c.titre, c.chemin, ...(c.ligne === '' ? [] : [c.ligne])].join(' — ')} (${c.typeFiche}, ${libelleRaison(c.raison, c.depuis?.titre)})`;
	return c.encadree ? encadrer(c.chemin, [ligne]) : ligne;
}

/**
 * Texte injecté : consignes, fiche de position entière, fiches demandées par l'utilisateur entières, puis une ligne par carte. Ce qui vient de documents est encadré
 * `<donnees>`, l'avertissement n'étant dit qu'une fois, en tête. Rien sans consigne, fiche ni carte.
 */
export function rendreServi(consignes: string, calcul: CartesCalculees, demandees: readonly FicheDePositionServie[] = []): string {
	const cartes = calcul.cartes.length === 0 ? '' : `## Pistes de Mnemo (lis avec \`lire\` celles qui servent ta tâche)\n${calcul.cartes.map(rendreCarte).join('\n')}`;
	const injectees = demandees.length === 0 ? '' : `## Fiches injectées à la demande de l’utilisateur\n\n${demandees.map(rendreFiche).join('\n\n')}`;
	const parties = [consignes, calcul.position === null ? '' : rendreFiche(calcul.position), injectees, cartes].filter((p) => p !== '');
	if (parties.length === 0) return '';
	const encadre = calcul.position?.encadree === true || demandees.some((f) => f.encadree) || calcul.cartes.some((c) => c.encadree);
	return encadre ? `${AVERTISSEMENT}\n\n${parties.join('\n\n')}` : parties.join('\n\n');
}

/** Fiches demandées par l'utilisateur, entières, sauf celles que l'index ne connaît plus et la fiche de position déjà injectée par ce calcul. */
async function fichesDemandees(dep: Dependances, chemins: readonly string[], position: string | null): Promise<FicheDePositionServie[]> {
	const voulues = [...new Set(chemins)].filter((c) => c !== position);
	if (voulues.length === 0) return [];
	const [indexees, elements, titres] = await Promise.all([dep.index.fiches(), dep.index.elements({ chemins: voulues, genres: ['fiche'] }), dep.index.titres()]);
	const empreintes = new Map(indexees.map((f) => [f.chemin, f.empreinte]));
	const types = new Map(elements.map((e) => [e.chemin, e.typeFiche]));
	const titreDe = new Map(titres.map((t) => [t.chemin, t.titre]));
	const presentes = voulues.filter((c) => empreintes.has(c));
	const encadrees = await fichesAEncadrer(dep, presentes.map((chemin) => ({ chemin, typeFiche: types.get(chemin) ?? '' })));
	const fiches: FicheDePositionServie[] = [];
	for (const chemin of presentes) {
		const texte = await dep.coffre.lire(chemin);
		if (texte !== null) fiches.push({ chemin, titre: titreDe.get(chemin) ?? chemin, texte: sansFaitsBarres(texte), empreinte: empreintes.get(chemin) ?? '', encadree: encadrees.has(chemin) });
	}
	return fiches;
}

/** Consignes rappelées que la recherche par mots trouve dans le message : rappelées au moment où elles s'appliquent. */
async function consignesTrouvees(dep: Dependances, rappelees: readonly ElementIndexe[], mots: string): Promise<ElementIndexe[]> {
	const expression = expressionFts(mots, await dep.index.alias());
	if (expression === null || rappelees.length === 0) return [];
	const trouvees = new Set((await dep.index.chercher(expression.une, { genres: ['consigne'], statuts: ['servi'] }, CONSIGNES_TROUVEES_MAX)).map((e) => e.id));
	return rappelees.filter((c) => trouvees.has(c.id));
}

export async function servir(dep: Dependances, demande: DemandeServir): Promise<Servi> {
	await synchroniser(dep, SANS_EXTRACTION);
	const { moment, muet, premier, rappels: tousLesRappels, demandees: voulues, injectees: anciennes, ...cartes } = demande;
	// les fiches injectées à la main à ce message ont l'âge 0 (une réinjection fait repartir le poids)
	const aInjecter = [...new Set(voulues ?? [])];
	const aLaMain = [...(anciennes ?? []).filter((i) => !aInjecter.includes(i.chemin)), ...aInjecter.map((chemin) => ({ chemin, messages: 0 }))];
	const { portees } = await cadreDe(dep, { chemin: demande.position });
	const permanentes = await consignesDe(dep, portees, NIVEAUX_PERMANENTS);
	const rappelees = await consignesDe(dep, portees, ['rappelee']);
	const rappels = tousLesRappels ? rappelees : muet !== null ? [] : await consignesTrouvees(dep, rappelees, demande.message);
	const consignes = rendreConsignes(permanentes, rappels);
	const calcul = await calculerCartes(dep, {
		...cartes,
		// un message muet ne nomme rien et ne demande pas de périmètre : seule la fiche de position peut venir
		message: muet === null ? demande.message : '',
		perimetre: muet === null && premier,
		servirPosition: moment === 'message',
		question: moment === 'contexte',
		injectees: aLaMain,
		// le geste vaut désignation, même sur un message muet : le message ne donne que la base de la note
		voisinage: moment === 'message' && aInjecter.length > 0,
		// une fiche demandée, injectée entière, n'est pas aussi candidate : écartée avant le plafond, elle ne prend la place d'aucune carte
		demandees: aInjecter,
	});
	const demandees = await fichesDemandees(dep, aInjecter, calcul.position?.chemin ?? null);
	return { texte: rendreServi(consignes, calcul, demandees), consignes, calcul, demandees };
}
