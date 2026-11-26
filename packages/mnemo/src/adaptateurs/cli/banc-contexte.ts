import { copyFile, mkdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { JUGEMENTS, rejouerCas } from '../../application/banc-contexte.ts';
import type { CandidateAJuger, CasContexte, EchecContexte, Jugement, MesureContexte, Prejugement, VarianteRequete } from '../../application/banc-contexte.ts';
import { extraireJugements, fusionnerCas, messagesAExtraire, messagesDesCas, messagesDuJournal } from '../../application/banc-extraire.ts';
import type { MessageAExtraire } from '../../application/banc-extraire.ts';
import { progression } from '../../application/banc-juger.ts';
import { rejouerJugements } from '../../application/banc-rejeu.ts';
import type { MesuresNiveau, RejeuJugements } from '../../application/banc-rejeu.ts';
import { LISTES_DU_BANC } from '../../application/banc-signaux.ts';
import type { GestesDuBanc, Signaux } from '../../application/banc-signaux.ts';
import { DOSSIER_LOCAL } from '../../domaine/dossier-memoire.ts';
import { compterGestes, GESTES } from '../../domaine/gestes.ts';
import type { ComptesDesGestes } from '../../domaine/gestes.ts';
import { echelleDesSignaux } from '../../domaine/modele-de-note.ts';
import { requeteJointe } from '../../domaine/requete-du-message.ts';
import type { InjectionManuelle } from '../../domaine/signal-injection.ts';
import { estObjet } from '../../domaine/valeurs.ts';
import { ouvrirJournalEnLecture } from '../../infra/journal-en-lecture.ts';
import { lireReglagesDuDossier } from '../../infra/reglages-fichier.ts';
import { dependancesReelles, etatParesseux } from '../../infra/systeme.ts';
import { apprendreAuBanc, ggufInstalles } from './banc-apprendre.ts';
import { enregistrerCas, jugerAuTerminal } from './banc-juger.ts';
import { AUCUNE_MEMOIRE, ErreurCli } from './erreurs.ts';
import { prendreVerrouBanc } from './verrou-banc.ts';
import { trouverRacine } from './racine.ts';

const USAGE_CONTEXTE = [
	'Usage : mnemo banc contexte [--json] [--recalculer] [--empreintes exclure|garder]',
	'        mnemo banc contexte --extraire [<session>] [--nombre <n>] [--par-session <n>] [--json]',
	'        mnemo banc contexte --completer [--json]',
	'        mnemo banc contexte --juger',
	'        mnemo banc contexte --gestes [--json]',
	'        mnemo banc contexte --apprendre [--empreintes exclure|garder] [--module <chemin> [--depart]] [--json]',
].join('\n');
/** Messages extraits par défaut, et au plus par session (variété : 20 sessions au moins pour 120 messages). */
const NOMBRE_PAR_DEFAUT = 50;
const PAR_SESSION = 6;
/** Règle de la requête jointe, celle du hook (`domaine/requete-du-message.ts`). */
const REQUETE_JOINTE = requeteJointe;

/** Cas du banc `contexte` : `.mnemo/banc-contexte.json` (état local, ignoré par git, jamais commité). */
export function fichierBancContexte(racine: string): string {
	return join(racine, DOSSIER_LOCAL, 'banc-contexte.json');
}

const textes = (v: unknown, nom: string, i: number): string[] => {
	if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) throw new ErreurCli(`banc-contexte.json, cas ${i + 1} : « ${nom} » doit être une liste de textes.`);
	return v as string[];
};
const texteOuNull = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const nombreOuNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Signaux d'une candidate ; `signalSession`, `apriori` et `cosinusZ`, venus après les premières extractions, sont facultatifs. */
function lireSignaux(v: unknown): Signaux | undefined {
	if (!estObjet(v)) return undefined;
	const signalSession = nombreOuNull(v['signalSession']);
	const apriori = nombreOuNull(v['apriori']);
	// absent des cas extraits avant lui
	const cosinusZ = v['cosinusZ'] === null ? null : nombreOuNull(v['cosinusZ']);
	return {
		logit: nombreOuNull(v['logit']),
		cosinus: nombreOuNull(v['cosinus']),
		cosinusRelatif: nombreOuNull(v['cosinusRelatif']),
		// null : le message n'a pas de mots cherchables ; absent (ou illisible) : 0, comme aux premières extractions
		bm25Relatif: v['bm25Relatif'] === null ? null : (nombreOuNull(v['bm25Relatif']) ?? 0),
		...(signalSession === null ? {} : { signalSession }),
		...(apriori === null ? {} : { apriori }),
		...(v['cosinusZ'] === undefined ? {} : { cosinusZ }),
	};
}

function lireCandidates(v: unknown, i: number): CandidateAJuger[] {
	if (!Array.isArray(v)) throw new ErreurCli(`banc-contexte.json, cas ${i + 1} : « candidates » doit être une liste.`);
	return v.map((x: unknown): CandidateAJuger => {
		if (!estObjet(x) || typeof x['chemin'] !== 'string') throw new ErreurCli(`banc-contexte.json, cas ${i + 1} : chaque candidate doit avoir un « chemin ».`);
		const signaux: Partial<Record<VarianteRequete, Signaux>> = {};
		const brut = estObjet(x['signaux']) ? x['signaux'] : {};
		for (const variante of ['seule', 'jointe'] as const) {
			const s = lireSignaux(brut[variante]);
			if (s !== undefined) signaux[variante] = s;
		}
		const listes: unknown[] = Array.isArray(x['listes']) ? x['listes'] : [];
		return {
			chemin: x['chemin'],
			titre: typeof x['titre'] === 'string' ? x['titre'] : x['chemin'],
			ligne: typeof x['ligne'] === 'string' ? x['ligne'] : '',
			listes: LISTES_DU_BANC.filter((l) => listes.includes(l)),
			signaux,
			...(typeof x['empreinte'] === 'string' ? { empreinte: x['empreinte'] } : {}),
			...(x['horsPile'] === true ? { horsPile: true } : {}),
		};
	});
}

function lireInjections(v: unknown[]): InjectionManuelle[] {
	return v.flatMap((x) => (estObjet(x) && typeof x['chemin'] === 'string' && typeof x['messages'] === 'number' ? [{ chemin: x['chemin'], messages: x['messages'] }] : []));
}

function lireJugements(v: unknown, i: number): Record<string, Jugement> {
	if (!estObjet(v)) throw new ErreurCli(`banc-contexte.json, cas ${i + 1} : « jugements » doit être un objet (chemin → jugement).`);
	const jugements: Record<string, Jugement> = {};
	for (const [chemin, j] of Object.entries(v)) {
		if (!JUGEMENTS.includes(j as Jugement)) throw new ErreurCli(`banc-contexte.json, cas ${i + 1} : jugement inconnu pour ${chemin} (${JUGEMENTS.join(', ')}).`);
		jugements[chemin] = j as Jugement;
	}
	return jugements;
}

function lirePrejugements(v: unknown, i: number): Record<string, Prejugement> {
	if (!estObjet(v)) throw new ErreurCli(`banc-contexte.json, cas ${i + 1} : « prejugements » doit être un objet (chemin → proposition du juge).`);
	const prejugements: Record<string, Prejugement> = {};
	for (const [chemin, p] of Object.entries(v)) {
		const confiance = estObjet(p) ? p['confiance'] : undefined;
		if (!estObjet(p) || !JUGEMENTS.includes(p['jugement'] as Jugement) || typeof confiance !== 'number' || !(confiance >= 0 && confiance <= 1) || typeof p['raison'] !== 'string') {
			throw new ErreurCli(`banc-contexte.json, cas ${i + 1} : proposition du juge mal formée pour ${chemin} (jugement, confiance de 0 à 1, raison).`);
		}
		prejugements[chemin] = { jugement: p['jugement'] as Jugement, confiance, raison: p['raison'] };
	}
	return prejugements;
}

/** Cas d'un fichier `banc-contexte.json` (liste de cas) ; erreur lisible sur un cas mal formé. */
export function lireCasContexte(texte: string): CasContexte[] {
	let brut: unknown;
	try {
		brut = JSON.parse(texte);
	} catch {
		throw new ErreurCli('banc-contexte.json : JSON invalide.');
	}
	if (!Array.isArray(brut)) throw new ErreurCli('banc-contexte.json : une liste de cas est attendue.');
	return brut.map((c: unknown, i): CasContexte => {
		if (!estObjet(c) || typeof c['nom'] !== 'string' || typeof c['position'] !== 'string' || typeof c['message'] !== 'string') {
			throw new ErreurCli(`banc-contexte.json, cas ${i + 1} : « nom », « position » et « message » (textes) sont attendus.`);
		}
		const precedent = c['precedent'];
		return {
			nom: c['nom'],
			position: c['position'],
			message: c['message'],
			premier: c['premier'] === true,
			attendues: textes(c['attendues'] ?? [], 'attendues', i),
			interdites: textes(c['interdites'] ?? [], 'interdites', i),
			silence: c['silence'] === true,
			...(c['injectees'] === undefined ? {} : { injectees: textes(c['injectees'], 'injectees', i) }),
			...(typeof c['session'] === 'string' ? { session: c['session'] } : {}),
			...(typeof c['rang'] === 'number' ? { rang: c['rang'] } : {}),
			...(typeof precedent === 'string' || precedent === null ? { precedent } : {}),
			...(c['candidates'] === undefined ? {} : { candidates: lireCandidates(c['candidates'], i) }),
			...(c['jugements'] === undefined ? {} : { jugements: lireJugements(c['jugements'], i) }),
			...(c['saute'] === true ? { saute: true } : {}),
			...(c['prejugements'] === undefined ? {} : { prejugements: lirePrejugements(c['prejugements'], i) }),
			...(typeof c['valideLe'] === 'string' ? { valideLe: c['valideLe'] } : {}),
			...(typeof c['horodatageMs'] === 'number' ? { horodatageMs: c['horodatageMs'] } : {}),
			...(typeof c['extraitLe'] === 'string' ? { extraitLe: c['extraitLe'] } : {}),
			...(estObjet(c['modeles']) ? { modeles: { sens: c['modeles']['sens'] === true, reranker: c['modeles']['reranker'] === true } } : {}),
			...(estObjet(c['gguf']) ? { gguf: { sens: texteOuNull(c['gguf']['sens']), reranker: texteOuNull(c['gguf']['reranker']) } } : {}),
			...(Array.isArray(c['injectionsManuelles']) ? { injectionsManuelles: lireInjections(c['injectionsManuelles']) } : {}),
		};
	});
}

/** Cas du fichier ; aucun cas s'il n'existe pas encore. */
export async function lireCasDuFichier(fichier: string): Promise<CasContexte[]> {
	let texte: string;
	try {
		texte = await readFile(fichier, 'utf8');
	} catch (e) {
		if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
		throw e;
	}
	return lireCasContexte(texte);
}

export function contexteEnTexte(mesure: MesureContexte, echecs: EchecContexte[]): string {
	const moyenne = mesure.cas === 0 ? 0 : Math.round(mesure.caracteres / mesure.cas);
	return [
		`Contexte : ${mesure.justes} / ${mesure.cas} cas justes, ${mesure.attenduesProposees} / ${mesure.attenduesTotal} attendues proposées, ${mesure.indesirables} indésirables, ${moyenne} caractères par cas`,
		...echecs.map((e) => `  échec : ${e.nom}${e.manquees.length === 0 ? '' : ` ; manquées : ${e.manquees.join(', ')}`}${e.indesirables.length === 0 ? '' : ` ; indésirables : ${e.indesirables.join(', ')}`}`),
	].join('\n');
}

const pourcent = (x: number | null) => (x === null ? '-' : `${Math.round(x * 100)} %`);
const NOMS_NIVEAUX: Record<MesuresNiveau['niveau'], string> = { complets: 'Complets', sens: 'Sens seul', ordre: 'Coupés' };

const variante = (v: MesuresNiveau['variante']) => (v === 'seule' ? 'message seul' : 'message joint');

/** Les mesures du jugement, lisibles : une ligne par niveau et variante, le biais de la pile, puis ce qui reste à brancher. */
export function jugementsEnTexte(r: RejeuJugements): string {
	const lignes = [`Jugements : ${r.messagesJuges} messages rejoués, ${r.sessions} sessions, ${r.paires.length} paires (${r.indecises} indécises exclues)`];
	for (const m of r.mesures) {
		if (m.messages === 0) {
			lignes.push(`  ${NOMS_NIVEAUX[m.niveau]}, ${variante(m.variante)} : aucun message classé (modèle absent)`);
			continue;
		}
		const tete = `  ${NOMS_NIVEAUX[m.niveau]}, ${variante(m.variante)} : ${m.messages} messages (${m.silences} silence), ${m.pertinentes} pertinentes / ${m.nonPertinentes} non`;
		const ordre = `rappel des 10 premières ${pourcent(m.rappel10)}, pistes : rappel ${pourcent(m.rappelPistes)}, précision ${pourcent(m.precisionPistes)}${m.nonJugeesEnTete === 0 ? '' : `, ${m.nonJugeesEnTete} non jugées en tête`}`;
		lignes.push(`${tete} ; ${ordre}`);
		if (m.note !== null) {
			const s = m.note.auSeuil;
			lignes.push(
				`    au seuil ${pourcent(s.seuil)} : ${s.injections} injections (${s.injectionsNonJugees} non jugées, ${s.sessions} sessions), précision ${pourcent(s.precision)} (pessimiste ${pourcent(s.precisionPessimiste)}), Wilson ${pourcent(s.wilsonBasse)} (pessimiste ${pourcent(s.wilsonBassePessimiste)}), ECE ${m.note.ece === null ? '-' : m.note.ece.toFixed(3)}, ${s.silencesAvecInjection} silences avec injection`,
			);
		}
	}
	const { pile, horsPile } = r.biais;
	lignes.push(`  Biais de la pile : pertinentes ${pile.pertinentes} / ${pile.jugees} dans la pile (${pourcent(pile.jugees === 0 ? null : pile.pertinentes / pile.jugees)}), ${horsPile.pertinentes} / ${horsPile.jugees} hors pile (${pourcent(horsPile.jugees === 0 ? null : horsPile.pertinentes / horsPile.jugees)})`);
	if (r.empreintesChangees.length > 0) lignes.push(`  ${r.empreintesChangees.length} fiche(s) jugée(s) changée(s) depuis l'extraction (voir --json) : leur jugement est exclu, sauf --empreintes garder`);
	if (r.modeles !== null && (!r.modeles.sens || !r.modeles.reranker)) {
		lignes.push(`  Modèles absents au recalcul : ${[r.modeles.sens ? null : 'sens', r.modeles.reranker ? null : 'reranker'].filter((x) => x !== null).join(', ')}`);
	}
	lignes.push(...r.aBrancher.map((a) => `  à brancher ${a}`));
	return lignes.join('\n');
}

type Options = {
	json: boolean;
	extraire: boolean;
	completer: boolean;
	session: string | null;
	nombre: number | null;
	parSession: number | null;
	juger: boolean;
	recalculer: boolean;
	gestes: boolean;
	apprendre: boolean;
	module: string | null;
	/** Avec `--apprendre --module` : les poids de départ livrés avec Mnemo, seulement le module (rien dans `.mnemo/`). */
	depart: boolean;
	empreintes: 'exclure' | 'garder';
};

export function lireOptionsContexte(args: readonly string[]): Options {
	const o: Options = { json: false, extraire: false, completer: false, session: null, nombre: null, parSession: null, juger: false, recalculer: false, gestes: false, apprendre: false, module: null, depart: false, empreintes: 'exclure' };
	const refus = (motif: string) => new ErreurCli(`${motif}\n${USAGE_CONTEXTE}`, 2);
	const entier = (option: string, valeur: string | undefined): number => {
		const n = Number(valeur);
		if (!Number.isInteger(n) || n < 1) throw refus(`Nombre manquant ou invalide après ${option}.`);
		return n;
	};
	for (let k = 0; k < args.length; k++) {
		const a = args[k]!;
		if (a === '--json') o.json = true;
		else if (a === '--juger') o.juger = true;
		else if (a === '--recalculer') o.recalculer = true;
		else if (a === '--gestes') o.gestes = true;
		else if (a === '--completer') o.completer = true;
		else if (a === '--apprendre') o.apprendre = true;
		else if (a === '--depart') o.depart = true;
		else if (a === '--extraire') {
			o.extraire = true;
			const suivant = args[k + 1];
			if (suivant !== undefined && !suivant.startsWith('--')) {
				o.session = suivant;
				k += 1;
			}
		} else if (a === '--nombre') {
			o.nombre = entier(a, args[k + 1]);
			k += 1;
		} else if (a === '--par-session') {
			o.parSession = entier(a, args[k + 1]);
			k += 1;
		} else if (a === '--module') {
			const v = args[k + 1];
			if (v === undefined || v.startsWith('--')) throw refus('--module attend un chemin.');
			o.module = v;
			k += 1;
		} else if (a === '--empreintes') {
			const v = args[k + 1];
			if (v !== 'exclure' && v !== 'garder') throw refus('--empreintes attend « exclure » ou « garder ».');
			o.empreintes = v;
			k += 1;
		} else throw refus(a.startsWith('--') ? `Option inconnue : « ${a} ».` : `Argument inattendu : « ${a} ».`);
	}
	if ([o.extraire, o.completer, o.juger, o.recalculer, o.apprendre].filter(Boolean).length > 1) throw refus('--extraire, --completer, --juger, --recalculer et --apprendre ne vont pas ensemble.');
	if ((o.nombre !== null || o.parSession !== null) && !o.extraire) throw refus("--nombre et --par-session ne vont qu'avec --extraire.");
	if (o.juger && o.json) throw refus('--juger ne va pas avec --json.');
	if (o.module !== null && !o.apprendre) throw refus("--module ne va qu'avec --apprendre.");
	if (o.depart && (!o.apprendre || o.module === null)) throw refus("--depart ne va qu'avec --apprendre --module <chemin>.");
	if (o.gestes && (o.extraire || o.completer || o.juger || o.recalculer || o.apprendre || o.empreintes !== 'exclure')) throw refus("--gestes ne va qu'avec --json.");
	return o;
}

/** Comptes du journal des gestes, sans aucun texte de message : par geste, puis par fiche. */
export function gestesEnTexte(comptes: ComptesDesGestes): string {
	const parGeste = GESTES.map((g) => `${g} ${comptes.parGeste[g]}`).join(', ');
	return [
		`Gestes : ${comptes.total} (${parGeste})`,
		...comptes.parFiche.map((f) => `  ${f.fiche} : ${f.total} (${GESTES.filter((g) => f.parGeste[g] !== undefined).map((g) => `${g} ${f.parGeste[g]}`).join(', ')})`),
	].join('\n');
}

/** Avancement sur la sortie d'erreur, sur une seule ligne (seulement vers un terminal). */
function avancement(libelle: string): (faits: number, total: number) => void {
	return (faits, total) => {
		if (process.stderr.isTTY) process.stderr.write(`\r${libelle} : ${faits} / ${total}${faits === total ? '\n' : ''}`);
	};
}

/** Index lu tel qu'il est : celui du service en marche, jamais écrit, synchronisé ni reconstruit par le banc. */
const LECTURE_MAX_MS = 30 * 60_000;
const dependancesEnLecture = (racine: string) => dependancesReelles(racine, { indexEnLecture: { finMs: Date.now() + LECTURE_MAX_MS } });
const enErreurCli = (e: unknown) => new ErreurCli(e instanceof Error ? e.message : String(e));
const SUITE = 'Ensuite : la même commande avec --juger (au lieu de --extraire ou --completer)';

/**
 * Les gestes de l'état (a priori, écartées toujours), lus sans migration ni écriture ; undefined (a priori 0) : l'état n'a pas de
 * journal des gestes (version 12 ou moins) ou ne se lit pas.
 */
async function gestesEnLecture(racine: string): Promise<GestesDuBanc | undefined> {
	try {
		const lecture = ouvrirJournalEnLecture(join(racine, DOSSIER_LOCAL, 'etat.sqlite'));
		try {
			return (await lecture.gestes()) ?? undefined;
		} finally {
			lecture.fermer();
		}
	} catch {
		return undefined;
	}
}

/** Pourquoi il y a moins de messages que demandé. */
function raisonDuManque(demandes: number, choisis: number, nouveaux: number, parSession: number): string {
	if (choisis >= demandes) return '';
	if (nouveaux <= choisis) return ` (le journal n'a que ${nouveaux} message(s) porteur(s) nouveau(x))`;
	return ` (au plus ${parSession} par session : --par-session pour en prendre plus)`;
}

/**
 * `--extraire` (nouveaux messages) ou `--completer` (les cas déjà extraits, relancés : leurs nouvelles fiches s'ajoutent, et
 * `--juger` ne demandera qu'elles). Le fichier des jugements est sous verrou pendant tout le calcul.
 */
async function extraire(racine: string, fichier: string, o: Options): Promise<void> {
	await mkdir(dirname(fichier), { recursive: true });
	const rendre = prendreVerrouBanc(fichier, o.completer ? '--completer' : '--extraire');
	try {
		const existants = await lireCasDuFichier(fichier);
		let choisis: MessageAExtraire[];
		let manque = '';
		if (o.completer) {
			choisis = messagesDesCas(existants);
			if (choisis.length === 0) throw new ErreurCli(`Aucun cas à compléter dans ${fichier}.`);
		} else {
			// l'état des sessions est lu sans migration ni écriture : le service en marche (une autre version, peut-être) le garde tel quel
			let lecture: ReturnType<typeof ouvrirJournalEnLecture>;
			try {
				lecture = ouvrirJournalEnLecture(join(racine, DOSSIER_LOCAL, 'etat.sqlite'));
			} catch (e) {
				throw enErreurCli(e);
			}
			try {
				const journal = await messagesDuJournal(lecture, o.session ?? undefined).catch((e: unknown) => {
					throw enErreurCli(e);
				});
				// une session nommée : tous ses messages porteurs ; sinon, un choix varié parmi toutes les sessions
				const parSession = o.parSession ?? (o.session === null ? PAR_SESSION : Infinity);
				const nombre = o.nombre ?? (o.session === null ? NOMBRE_PAR_DEFAUT : Infinity);
				const pris = messagesAExtraire(journal, existants, { nombre, parSession });
				choisis = pris.choisis;
				manque = Number.isFinite(nombre) ? raisonDuManque(nombre, choisis.length, pris.nouveaux, parSession) : '';
				if (!o.json) console.error(`${choisis.length} message(s) pris${Number.isFinite(nombre) ? ` sur ${nombre} demandé(s)` : ''}${manque} ; calcul des fiches à juger, modèles compris…`);
			} finally {
				lecture.fermer();
			}
		}
		const gestes = await gestesEnLecture(racine);
		const dep = dependancesEnLecture(racine);
		try {
			const bilan = await extraireJugements(dep, choisis, { requeteJointe: REQUETE_JOINTE, gguf: ggufInstalles(), avancement: avancement('Messages'), ...(gestes === undefined ? {} : { gestes }) }).catch((e: unknown) => {
				throw enErreurCli(e);
			});
			// relu sous le verrou : rien n'a pu l'écrire entre-temps
			const { cas, ajoutes, completes, fichesAjoutees } = fusionnerCas(await lireCasDuFichier(fichier), bilan.cas);
			await enregistrerCas(fichier, cas);
			const p = progression(cas);
			if (o.json) {
				console.log(JSON.stringify({ pris: choisis.length, ajoutes, completes, fichesAjoutees, sansCandidate: bilan.sansCandidate, sansModele: bilan.sansModele, modeles: bilan.modeles, messages: p.messages, messagesJuges: p.messagesJuges }));
				return;
			}
			const fiches = bilan.cas.filter((c) => !existants.some((e) => e.message === c.message && e.position === c.position)).reduce((n, c) => n + (c.candidates?.length ?? 0), 0);
			const absents = [bilan.modeles.sens ? null : 'sens', bilan.modeles.reranker ? null : 'reranker'].filter((x) => x !== null);
			const laisses = [
				bilan.sansCandidate === 0 ? null : `${bilan.sansCandidate} sans aucune fiche candidate`,
				bilan.sansModele === 0 ? null : `${bilan.sansModele} dont un modèle n'a pas répondu (repris à la prochaine extraction)`,
			].filter((x) => x !== null);
			console.log(
				[
					`${choisis.length} message(s) pris${manque} : ${ajoutes} ajouté(s) (${fiches} fiches à juger), ${completes} complété(s) (${fichesAjoutees} fiches ajoutées)${laisses.length === 0 ? '' : ` ; laissés : ${laisses.join(', ')}`}.`,
					...(absents.length === 0 ? [] : [`Attention : modèle indisponible (${absents.join(', ')}) : les fiches à juger ne viennent que des autres listes.`]),
					`À juger : ${p.messages - p.messagesJuges} message(s). ${SUITE}`,
				].join('\n'),
			);
		} finally {
			dep.index.fermer();
		}
	} finally {
		rendre();
	}
}

/**
 * Instant de l'apprentissage (ISO, UTC) : `apprisLe` du modèle. Le suivi des injections ne compte que celles d'après lui, à la
 * milliseconde (un apprentissage accepté plus récent qu'une coupure la lève).
 */
const instantDApprentissage = (): string => new Date().toISOString();

/**
 * `--apprendre` : la note de confiance apprise sur les jugements (empreintes vérifiées sur l'index lu tel qu'il est), le module
 * de coefficients et le rapport écrits. `--depart` : seulement le module, rien dans `.mnemo/`, pas même le verrou (le banc est
 * lu une fois, et ses écritures se font par renommage : la lecture voit un fichier entier).
 */
async function apprendre(racine: string, fichier: string, o: Options): Promise<void> {
	// sous le verrou du banc : aucun jugement ne change pendant l'apprentissage
	const rendre = o.depart ? () => {} : prendreVerrouBanc(fichier, '--apprendre');
	try {
		const cas = (await lireCasDuFichier(fichier)).filter((c) => c.candidates !== undefined);
		if (cas.length === 0) throw new ErreurCli(`Aucun message jugé dans ${fichier}. Ajoutez-en avec --extraire, puis --juger.`);
		const dep = dependancesEnLecture(racine);
		let empreinteDe: Map<string, string>;
		try {
			empreinteDe = new Map((await dep.index.fiches()).map((f) => [f.chemin, f.empreinte]));
		} finally {
			dep.index.fermer();
		}
		// l'échelle des signaux : les réglages de la mémoire, ceux avec lesquels le banc a calculé le signal de session
		const echelle = echelleDesSignaux(lireReglagesDuDossier(racine).reglages.contexte);
		const options = { empreinteDe, empreintes: o.empreintes, date: instantDApprentissage(), installes: ggufInstalles(), echelle, ...(o.module === null ? {} : { module: o.module }), depart: o.depart };
		const { rapport, texte } = await apprendreAuBanc(racine, cas, options).catch((e: unknown) => {
			throw e instanceof ErreurCli ? e : enErreurCli(e);
		});
		console.log(o.json ? JSON.stringify(rapport, null, 2) : texte);
	} finally {
		rendre();
	}
}

/**
 * `mnemo banc contexte` : rejoue les cas étiquetés à la main et mesure les messages jugés de `.mnemo/banc-contexte.json`
 * (sans `claude`, sans rien écrire dans `.mnemo`) ; `--recalculer` recalcule les signaux avec les modèles. `--extraire
 * [<session>]` ajoute des messages réels à juger, avec leurs fiches figées ; `--completer` relance l'extraction sur les cas
 * existants ; `--juger` les fait juger une fiche à la fois ; `--json` rend aussi les paires jugées et leurs signaux bruts.
 * `--gestes` : comptes du journal durable des gestes, par geste et par fiche (sans texte de message). `--apprendre` : apprend la
 * note de confiance et écrit son module de coefficients et le rapport.
 */
export async function commandeContexte(args: string[]): Promise<void> {
	const o = lireOptionsContexte(args);
	const racine = trouverRacine(process.cwd());
	if (racine === null) throw new ErreurCli(AUCUNE_MEMOIRE);
	if (o.gestes) {
		const etat = etatParesseux(racine);
		try {
			const comptes = compterGestes(await etat.comptesGestes());
			console.log(o.json ? JSON.stringify(comptes, null, 2) : gestesEnTexte(comptes));
		} finally {
			etat.fermer();
		}
		return;
	}
	const fichier = fichierBancContexte(racine);

	if (o.extraire || o.completer) return extraire(racine, fichier, o);
	if (o.apprendre) return apprendre(racine, fichier, o);
	if (o.juger) {
		const rendre = prendreVerrouBanc(fichier, '--juger');
		try {
			const existants = await lireCasDuFichier(fichier);
			if (progression(existants).messages === 0) throw new ErreurCli(`Aucun message à juger dans ${fichier}. Ajoutez-en avec --extraire.`);
			// copie de sûreté du fichier tel qu'il était au lancement
			await copyFile(fichier, `${fichier}.bak`);
			const fin = await jugerAuTerminal(fichier, existants, { entree: process.stdin, sortie: process.stdout }).catch((e: unknown) => {
				throw enErreurCli(e);
			});
			const suite = fin.messagesJuges === fin.messages ? ' Tout est jugé : --extraire pour en ajouter.' : ' Relancez --juger pour reprendre.';
			console.log(`${fin.messagesJuges} / ${fin.messages} messages jugés (${fin.silences} silence, ${fin.sautes} sautés), enregistrés dans ${fichier} (copie d'avant la séance : ${fichier}.bak).${suite}`);
		} finally {
			rendre();
		}
		return;
	}
	const existants = await lireCasDuFichier(fichier);
	const etiquetes = existants.filter((c) => c.candidates === undefined);
	const avecCandidates = existants.filter((c) => c.candidates !== undefined);
	if (existants.length === 0) throw new ErreurCli(`Aucun cas dans ${fichier}. Ajoutez-en avec --extraire.`);
	// index en lecture seule et jamais synchronisé : le rejeu n'écrit rien dans `.mnemo`
	const gestes = o.recalculer && avecCandidates.length > 0 ? await gestesEnLecture(racine) : undefined;
	const dep = dependancesEnLecture(racine);
	try {
		const etiquetage = etiquetes.length === 0 ? null : await rejouerCas(dep, etiquetes, { synchroniser: false }).catch((e: unknown) => {
			throw enErreurCli(e);
		});
		const jugements =
			avecCandidates.length === 0
				? null
				: await rejouerJugements(dep, avecCandidates, {
						recalculer: o.recalculer,
						empreintes: o.empreintes,
						requeteJointe: REQUETE_JOINTE,
						...(o.recalculer ? { avancement: avancement('Rejeu') } : {}),
						...(gestes === undefined ? {} : { gestes }),
					}).catch((e: unknown) => {
						throw enErreurCli(e);
					});
		if (o.json) {
			console.log(JSON.stringify({ ...(etiquetage === null ? {} : { mesure: etiquetage.mesure, echecs: etiquetage.echecs }), ...(jugements === null ? {} : { jugements }) }, null, 2));
		} else {
			console.log([...(etiquetage === null ? [] : [contexteEnTexte(etiquetage.mesure, etiquetage.echecs)]), ...(jugements === null ? [] : [jugementsEnTexte(jugements)])].join('\n\n'));
		}
	} finally {
		dep.index.fermer();
	}
}
