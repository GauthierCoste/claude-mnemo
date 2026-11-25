import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import * as z from 'zod';
import { BUDGET_OUTIL_MS, chercherAvecAvis, chronologie, voisins } from '../../application/chercher.ts';
import { etendrePassages } from '../../application/etendre.ts';
import type { Requete } from '../../application/chercher.ts';
import { deplacer, destinationDuDeplacement } from '../../application/deplacer.ts';
import { diagnostiquer } from '../../application/diagnostiquer.ts';
import { entretenir } from '../../application/entretenir.ts';
import { extraireSource } from '../../application/extraire-source.ts';
import { lireEtendu, motifIntrouvable } from '../../application/lire.ts';
import { lister, listerATraiter } from '../../application/lister.ts';
import type { Position } from '../../application/position.ts';
import { journaliserAvertissements } from '../../application/commun.ts';
import { avertissementsDe } from '@mnemo/commun';
import type { AvecAvertissements } from '@mnemo/commun';
import type { Resultat } from '../../application/commun.ts';
import type { Dependances, EtatSessions } from '../../application/ports.ts';
import { LIMITE_SORTIE, presenterAvis, presenterFiche, presenterListing, presenterLotPropose, presenterResultat, presenterSource, presenterTrouves, presenterVoisins } from '../../application/presenter.ts';
import { proposer } from '../../application/proposer.ts';
import { cartesDuJournal, dejaLuesDe } from '../../application/cartes.ts';
import { exclusionDefinitive } from '../../application/apriori.ts';
import { servir } from '../../application/servir.ts';
import { modelesActifs } from '../../application/note-du-classement.ts';
import { modelesSuivis } from '../../application/suivi-injection.ts';
import { phraseDesTypes } from '../../application/types-du-coffre.ts';
import { demandeDEntretien, TABLES_ARGUMENTS, TABLES_DEMANDE, validerArguments, validerDemande, validerRequete } from '../../application/validation.ts';
import type { OutilSimple, Sorte, Table, Valide } from '../../application/validation.ts';
import { neutraliser } from '../../domaine/contexte.ts';
import { tronquerTexte } from '../../domaine/texte.ts';

/** Noms des outils exposés (caractères `[A-Za-z0-9_-]`, comme Claude Code l'exige). */
export const NOMS_OUTILS = ['chercher', 'lister', 'lire', 'voisins', 'chronologie', 'contexte', 'diagnostiquer', 'proposer', 'deplacer', 'entretenir', 'extraire_source'] as const;
type NomOutil = (typeof NOMS_OUTILS)[number];

const MENTION_TRONQUEE = '\n… (sortie tronquée)';
const DEBUT_DE_CADRE = '<donnees ';
const FIN_DE_CADRE = '</donnees>';
const FERMETURE = `\n${FIN_DE_CADRE}`;

/**
 * Dernière borne de toute sortie d'outil (défense en profondeur derrière les `presenter…`) : `limite` caractères au plus,
 * coupé entre deux caractères. Seules les balises `<donnees …>` / `</donnees>` comptent (un « < » d'une consigne n'en est
 * pas une ; le contenu des documents, lui, est neutralisé) : une balise de cadre coupée en son milieu est retirée, un cadre
 * resté ouvert est refermé.
 */
export function borner(texte: string, limite = LIMITE_SORTIE): string {
	if (texte.length <= limite) return texte;
	const budget = limite - MENTION_TRONQUEE.length - FERMETURE.length;
	let coupe = tronquerTexte(texte, budget, 'utf16');
	// balise ouvrante entamée (ses attributs échappent « > » : sans « > » après elle, elle est incomplète)
	const ouvrante = coupe.lastIndexOf('<donnees ');
	if (ouvrante > coupe.lastIndexOf('</donnees>') && !coupe.includes('>', ouvrante)) coupe = coupe.slice(0, ouvrante);
	// début de balise en toute fin (« <donn », « </donnee »)
	for (let k = Math.min(coupe.length, FIN_DE_CADRE.length); k > 0; k--) {
		const fin = coupe.slice(-k);
		if (fin.startsWith('<') && (FIN_DE_CADRE.startsWith(fin) || DEBUT_DE_CADRE.startsWith(fin))) {
			coupe = coupe.slice(0, -k);
			break;
		}
	}
	if (coupe.lastIndexOf('<donnees ') > coupe.lastIndexOf('</donnees>')) coupe += FERMETURE;
	return coupe + MENTION_TRONQUEE;
}

/** `avertissements` : ceux d'une écriture faite (déjà dans `texte`), journalisés en plus. */
type Sortie = { texte: string; erreur: boolean } & AvecAvertissements;
const ok = (texte: string): Sortie => ({ texte, erreur: false });
const refus = (motif: string): Sortie => ({ texte: neutraliser(`Refusé : ${motif}`), erreur: true });

const sortieDEcriture = (r: Resultat): Sortie => ({ texte: presenterResultat(r), erreur: r.statut === 'refuse', ...avertissementsDe(r) });

function resultat({ texte, erreur }: Sortie): CallToolResult {
	return { content: [{ type: 'text', text: borner(texte) }], ...(erreur ? { isError: true } : {}) };
}

/** Exécute l'outil ; toute exception devient un résultat `isError` lisible : un outil qui échoue n'arrête pas le serveur. */
async function executer(action: () => Promise<Sortie>, journal: (message: string) => void): Promise<CallToolResult> {
	try {
		const sortie = await action();
		journaliserAvertissements(sortie, journal);
		return resultat(sortie);
	} catch (erreur) {
		return resultat({ texte: neutraliser(`Erreur : ${erreur instanceof Error ? erreur.message : String(erreur)}`), erreur: true });
	}
}

// --- Arguments ---------------------------------------------------------------------------------------------------
// Les schémas zod ne servent qu'à décrire les arguments (JSON Schema de `tools/list`) : ils acceptent tout, pour que la
// vérification réelle soit celle de `validation.ts` et qu'un refus soit un motif en français.

type Propriete = { schema: Record<string, unknown>; requis?: boolean };

function schemaDe(proprietes: Record<string, Propriete>) {
	const forme = Object.fromEntries(Object.entries(proprietes).map(([nom, p]) => [nom, z.unknown().optional().meta(p.schema)]));
	const requis = Object.entries(proprietes).filter(([, p]) => p.requis === true).map(([nom]) => nom);
	return z.looseObject(forme).meta({ additionalProperties: false, ...(requis.length > 0 ? { required: requis } : {}) });
}

/** JSON Schema d'une sorte de `validation.ts` (description pour Claude ; la validation reste dans `validation.ts`). */
function jsonDeSorte(sorte: Sorte): Record<string, unknown> {
	if (sorte === 'chaine') return { type: 'string' };
	if (sorte === 'booleen') return { type: 'boolean' };
	if (sorte === 'libre') return { type: 'object' };
	if ('choix' in sorte) return { type: 'string', enum: [...sorte.choix] };
	if ('entier' in sorte) return { type: 'integer', minimum: sorte.entier[0], maximum: sorte.entier[1] };
	if ('liste' in sorte) return { type: 'array', items: { type: 'string', enum: [...sorte.liste] } };
	if ('textes' in sorte) return { type: 'array', items: { type: 'string' }, minItems: sorte.textes[0], maxItems: sorte.textes[1] };
	if ('objets' in sorte) return { type: 'array', items: jsonDeTable(sorte.objets), minItems: sorte.nombre[0], maxItems: sorte.nombre[1] };
	return jsonDeTable(sorte.objet);
}

function jsonDeChamp(champ: Table[string]): Record<string, unknown> {
	return { ...jsonDeSorte(champ.sorte), ...(champ.description === undefined ? {} : { description: champ.description }) };
}

function jsonDeTable(table: Table, extra: Record<string, unknown> = {}): Record<string, unknown> {
	const requis = Object.entries(table).filter(([, c]) => c.requis).map(([nom]) => nom);
	return {
		type: 'object',
		properties: { ...extra, ...Object.fromEntries(Object.entries(table).map(([nom, c]) => [nom, jsonDeChamp(c)])) },
		required: [...Object.keys(extra), ...requis],
		additionalProperties: false,
	};
}

/** Une variante par genre de demande, tirée des tables de `validation.ts` (une seule source). */
const SCHEMA_DEMANDE = {
	description: 'Demande d\'écriture ; `genre` choisit la forme.',
	oneOf: Object.entries(TABLES_DEMANDE).map(([genre, table]) => jsonDeTable(table, { genre: { const: genre } })),
};

/** Requête validée par `validerRequete` ; les motifs parlent des noms d'arguments de l'outil (`noms`), pas des champs internes. */
function requete(brut: Requete | Record<string, unknown>, noms: Partial<Record<keyof Requete, string>>): Valide<Requete> {
	return validerRequete(Object.fromEntries(Object.entries(brut).filter(([, v]) => v !== undefined)), noms);
}

// --- Outils ------------------------------------------------------------------------------------------------------

type Outil = {
	description: string;
	proprietes: Record<string, Propriete>;
	lectureSeule: boolean;
	action: (args: Record<string, unknown>) => Promise<Sortie>;
};

/** Propriétés décrites d'un outil, tirées de sa table de `validation.ts`. */
function proprietesDe(outil: OutilSimple): Record<string, Propriete> {
	return Object.fromEntries(Object.entries(TABLES_ARGUMENTS[outil] as Table).map(([nom, c]) => [nom, { schema: jsonDeChamp(c), requis: c.requis }]));
}

function outils(dep: Dependances, positionCourante: () => Promise<Position>, phraseTypes: string): Record<NomOutil, Outil> {
	return {
		chercher: {
			description: 'Cherche dans la mémoire Mnemo (informations, fiches et leur texte libre, consignes, documents) ; les éléments proches de la position du projet passent devant. Rend une ligne par résultat avec son identifiant ; un passage vient avec sa section ou ses voisins (étendue indiquée). Par défaut, ni informations barrées ni informations à confirmer : `tout` les inclut.',
			proprietes: proprietesDe('chercher'),
			lectureSeule: true,
			action: async (brut) => {
				const a = validerArguments('chercher', brut);
				if (!a.ok) return refus(a.motif);
				const { requete: texte, dossier, tout, limite } = a.valeur;
				const r = requete(
					{ texte, perimetre: dossier || undefined, limite, position: (await positionCourante()).chemin, ...(tout === true ? { inclureAConfirmer: true, inclureInvalides: true } : {}) },
					{ texte: 'requete', perimetre: 'dossier' },
				);
				if (!r.ok) return refus(r.motif);
				const { trouves: bruts, avis } = await chercherAvecAvis(dep, r.valeur);
				// chaque passage est servi avec sa section ou ses voisins (référence inchangée)
				const trouves = await etendrePassages(dep, bruts);
				const ligne = presenterAvis(avis);
				return ok(ligne === '' ? presenterTrouves(trouves) : `${presenterTrouves(trouves, LIMITE_SORTIE - ligne.length - 1)}\n${ligne}`);
			},
		},
		lister: {
			description: 'Liste un dossier de la mémoire : sa fiche, ses fiches (chemin, titre, type) et ses sous-dossiers. Sans argument : la racine.',
			proprietes: proprietesDe('lister'),
			lectureSeule: true,
			action: async (brut) => {
				const a = validerArguments('lister', brut);
				if (!a.ok) return refus(a.motif);
				return ok(presenterListing(a.valeur.aTraiter === true ? await listerATraiter(dep) : await lister(dep, a.valeur.dossier ?? '')));
			},
		},
		lire: {
			description: 'Lit une fiche entière par son identifiant (chemin ; chemin#^ancre ou chemin#section : la fiche, avec l\'information ou le passage visé en tête ; chemin#p-… : le passage de document ; un passage vient avec ses voisins de section, étendue indiquée). Le contenu tiré d\'un document est encadré <donnees>.',
			proprietes: proprietesDe('lire'),
			lectureSeule: true,
			action: async (brut) => {
				const a = validerArguments('lire', brut);
				if (!a.ok) return refus(a.motif);
				const lu = await lireEtendu(dep, a.valeur.id);
				return lu === null ? refus(motifIntrouvable(a.valeur.id)) : ok(presenterFiche(lu));
			},
		},
		voisins: {
			description: 'Relations d\'une fiche : liens sortants (avec leur verbe) vers des fiches existantes, et liens entrants.',
			proprietes: proprietesDe('voisins'),
			lectureSeule: true,
			action: async (brut) => {
				const a = validerArguments('voisins', brut);
				if (!a.ok) return refus(a.motif);
				const v = await voisins(dep, a.valeur.id);
				return v === null ? refus(`fiche introuvable : « ${a.valeur.id} ».`) : ok(presenterVoisins(v));
			},
		},
		chronologie: {
			description: 'Historique d\'un sujet : tout ce qui correspond (informations à confirmer comprises), trié par date croissante.',
			proprietes: proprietesDe('chronologie'),
			lectureSeule: true,
			action: async (brut) => {
				const a = validerArguments('chronologie', brut);
				if (!a.ok) return refus(a.motif);
				const r = requete({ texte: a.valeur.sujet, limite: a.valeur.limite }, { texte: 'sujet' });
				if (!r.ok) return refus(r.motif);
				return ok(presenterTrouves(await chronologie(dep, r.valeur.texte, r.valeur.limite)));
			},
		},
		contexte: {
			description: 'Pistes de la mémoire utiles à `question` (cartes : titre, ligne, chemin), à lire avec `lire` : à appeler quand la tâche change de sujet ou demande plus de contexte.',
			proprietes: proprietesDe('contexte'),
			lectureSeule: true,
			action: async (brut) => {
				const a = validerArguments('contexte', brut);
				if (!a.ok) return refus(a.motif);
				const question = a.valeur.question ?? '';
				const debutMs = Date.now();
				// session lancée par Mnemo : ses fiches servies, lues ou écrites comptent, et les cartes rendues ici sont notées proposées
				const suivie = dep.origine !== undefined && dep.sessions !== undefined ? { session: dep.origine.session, etat: dep.sessions } : null;
				const serviesLuesEcrites = suivie === null ? [] : await suivie.etat.fichesServiesLuesOuEcrites(suivie.session).catch(() => []);
				// le poids encore actif des fiches injectées à la main s'ajoute à la note de leurs voisines
				const injectees = suivie === null ? [] : await suivie.etat.injectionsManuelles(suivie.session).catch(() => []);
				// la note de confiance comme au hook : coupures du suivi appliquées (un niveau coupé garde ses %, seule l'injection
				// automatique s'arrête ; l'outil n'injecte jamais), % seulement d'un modèle accepté
				const gestes = dep.sessions?.gestes;
				const modeles = gestes === undefined ? undefined : await modelesSuivis({ gestes: (f) => gestes(f) }, modelesActifs(dep));
				const servi = await servir(dep, {
					...(modeles === undefined ? {} : { modeles }),
					position: (await positionCourante()).chemin,
					message: question,
					dejaServies: new Map(serviesLuesEcrites.map((f) => [f.chemin, f.empreinteInjectee])),
					dejaLues: dejaLuesDe(serviesLuesEcrites),
					// l'outil peut reproposer une carte déjà proposée : la session la demande explicitement (question de sa part)
					proposees: new Map(),
					ecartes: [],
					injectees,
					moment: 'contexte',
					muet: null,
					premier: false,
					fin: Date.now() + BUDGET_OUTIL_MS,
					rappels: false,
					// écartées toujours : hors des pistes partout, aussi pour une session qui n'est pas suivie (état de la machine)
					...(dep.sessions?.ecarteesToujours === undefined ? {} : { exclusDefinitivement: await exclusionDefinitive(dep.sessions as Pick<EtatSessions, 'ecarteesToujours'>) }),
				});
				if (suivie !== null) {
					const horodatageMs = Date.now();
					for (const c of servi.calcul.cartes) await suivie.etat.noterCarteProposee(suivie.session, { chemin: c.chemin, empreinte: c.empreinte, horodatageMs }).catch(() => {});
					// l'appel est journalisé pour le panneau Contexte (cartes seulement : ni fiche de position, ni périmètre) ; sans carte, rien à montrer
					if (servi.calcul.cartes.length > 0) {
						await suivie.etat
							.journaliser({
								session: suivie.session,
								moment: 'contexte',
								horodatageMs,
								ids: [],
								texte: servi.texte,
								ms: Date.now() - debutMs,
								sens: servi.calcul.mesure !== 'aucune',
								demande: question === '' ? null : question.slice(0, 20_000),
								classement: [],
								// les notes des cartes ne sont des % que d'un modèle accepté : le panneau le lit ici
								calibree: servi.calcul.calibree,
								muet: null,
								cartes: cartesDuJournal(servi.calcul.cartes),
								position: null,
							})
							.catch(() => {});
					}
				}
				const aucunePiste = 'Aucune piste pour cette question.';
				return ok(servi.calcul.cartes.length > 0 ? servi.texte : servi.texte === '' ? aucunePiste : `${servi.texte}\n\n${aucunePiste}`);
			},
		},
		diagnostiquer: {
			description: 'Diagnostic de la mémoire pour le ménage, sans rien écrire : comptes en tête, puis par rubrique les chemins (et ancres) à reprendre. Liens cassés, fiches isolées ou sans synthèse, dossiers sans fiche, informations de confiance faible, à confirmer, barrées, doublons probables, fiches chargées, sources en double ou jamais citées, catégories rares, nom ≠ titre, lots en attente.',
			proprietes: proprietesDe('diagnostiquer'),
			lectureSeule: true,
			action: async (brut) => {
				const a = validerArguments('diagnostiquer', brut);
				if (!a.ok) return refus(a.motif);
				return ok(await diagnostiquer(dep, a.valeur));
			},
		},
		proposer: {
			description: 'Écrit dans la mémoire, un commit par écriture : information (« fait »), fiche, `modification` d\'une fiche (synthèse, sections, type, titre, alias), relation, `retirer_relation`, consigne, niveau d\'une consigne, `retirer_dossier` (dossier vide), épisode (au bilan). Consigne, profil : niveau et modification à confirmer. Réponse `proches` : rien n\'est écrit.',
			proprietes: { demande: { schema: { ...SCHEMA_DEMANDE, description: `${SCHEMA_DEMANDE.description} ${phraseTypes}` }, requis: true } },
			lectureSeule: false,
			action: async (brut) => {
				for (const nom of Object.keys(brut)) {
					if (nom !== 'demande') return refus(`champ inconnu « ${nom} ».`);
				}
				if (brut.demande === undefined) return refus('champ « demande » : obligatoire.');
				const d = validerDemande(brut.demande);
				if (!d.ok) return refus(d.motif);
				// seul un agent appelle par MCP : une montée de niveau y reste toujours une proposition
				return sortieDEcriture(await proposer(dep, d.valeur, { appliquerDirectement: false }));
			},
		},
		deplacer: {
			description: 'Range une fiche dans un autre dossier de la mémoire, ou tout un dossier si c\'est la fiche d\'un dossier (d/d.md) ; `nom` renomme. Réécrit les liens qui les désignent, en un commit.',
			proprietes: proprietesDe('deplacer'),
			lectureSeule: false,
			action: async (brut) => {
				const a = validerArguments('deplacer', brut);
				if (!a.ok) return refus(a.motif);
				const { id, dossier, nom } = a.valeur;
				return sortieDEcriture(await deplacer(dep, id, destinationDuDeplacement(id, dossier, nom)));
			},
		},
		entretenir: {
			description: 'Ménage de la mémoire, un commit par action (détail : champ `action`). Fiches : `supprimer` (refusé si citée, sauf `redirection`), `fusionner` `id` `dans` une autre, `corriger_lien`. Informations (`ancre`) : `corroborer` (une `source` de plus), `retoucher_information` (la forme, jamais le sens), `deplacer_informations` (`ancres` `dans` une fiche), `proposer_lot`. Renommer : `deplacer`.',
			proprietes: proprietesDe('entretenir'),
			lectureSeule: false,
			action: async (brut) => {
				const a = validerArguments('entretenir', brut);
				if (!a.ok) return refus(a.motif);
				const d = demandeDEntretien(a.valeur);
				if (!d.ok) return refus(d.motif);
				const r = await entretenir(dep, d.valeur);
				return r.statut === 'lot_propose' ? ok(presenterLotPropose(r)) : sortieDEcriture(r);
			},
		},
		extraire_source: {
			description: 'Référence un document du dossier (md, txt, pdf, docx, eml, mbox) par une fiche source, sans jamais le copier, et indexe ses passages pour `chercher`. `chemin` est relatif à la racine du dossier Mnemo. Rien de caché, sauf les instructions de Claude Code : tout CLAUDE.md et les .md sous un dossier .claude/. Réponse `proches` : quasi-copie existante, rien n\'est écrit.',
			proprietes: proprietesDe('extraire_source'),
			lectureSeule: false,
			action: async (brut) => {
				const a = validerArguments('extraire_source', brut);
				if (!a.ok) return refus(a.motif);
				const { chemin, type, version_de, apres_proches } = a.valeur;
				const r = await extraireSource(dep, {
					chemin,
					...(type !== undefined ? { type } : {}),
					...(version_de !== undefined ? { version_de } : {}),
					...(apres_proches !== undefined ? { apresProches: apres_proches } : {}),
				});
				return { texte: presenterSource(r), erreur: r.statut === 'refuse', ...avertissementsDe(r) };
			},
		},
	};
}

/**
 * Déclare les onze outils sur le serveur ; `positionCourante` : la position du projet de la session, relue à chaque appel ;
 * `phraseTypes` : les types de fiche du coffre, calculés au démarrage et fixes pour toute la session.
 */
export function enregistrerOutils(serveur: McpServer, dep: Dependances, positionCourante: () => Promise<Position>, journal: (message: string) => void, phraseTypes = phraseDesTypes([])): void {
	for (const [nom, outil] of Object.entries(outils(dep, positionCourante, phraseTypes))) {
		serveur.registerTool(
			nom,
			{ description: outil.description, inputSchema: schemaDe(outil.proprietes), annotations: { readOnlyHint: outil.lectureSeule, destructiveHint: false, openWorldHint: false } },
			(args: Record<string, unknown>) => executer(() => outil.action(args), journal),
		);
	}
}
