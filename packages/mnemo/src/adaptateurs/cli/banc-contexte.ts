import { mkdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { JUGEMENTS, rejouerCas } from '../../application/banc-contexte.ts';
import type { CandidateAJuger, CasContexte, EchecContexte, Jugement, MesureContexte, VarianteRequete } from '../../application/banc-contexte.ts';
import { extraireJugements, fusionnerCas, messagesAExtraire, messagesDuJournal } from '../../application/banc-extraire.ts';
import { progression } from '../../application/banc-juger.ts';
import { rejouerJugements } from '../../application/banc-rejeu.ts';
import type { MesuresNiveau, RejeuJugements } from '../../application/banc-rejeu.ts';
import { LISTES_DU_BANC } from '../../application/banc-signaux.ts';
import type { Signaux } from '../../application/banc-signaux.ts';
import { DOSSIER_LOCAL } from '../../domaine/dossier-memoire.ts';
import { estObjet } from '../../domaine/valeurs.ts';
import { dependancesReelles, etatParesseux } from '../../infra/systeme.ts';
import { enregistrerCas, jugerAuTerminal } from './banc-juger.ts';
import { AUCUNE_MEMOIRE, ErreurCli } from './erreurs.ts';
import { trouverRacine } from './racine.ts';

const USAGE_CONTEXTE = [
	'Usage : mnemo banc contexte [--json] [--recalculer]',
	'        mnemo banc contexte --extraire [<session>] [--nombre <n>] [--json]',
	'        mnemo banc contexte --juger',
].join('\n');
/** Messages extraits par défaut, et au plus par session (variété : 20 sessions au moins pour 120 messages). */
const NOMBRE_PAR_DEFAUT = 50;
const PAR_SESSION = 6;

/** Cas du banc `contexte` : `.mnemo/banc-contexte.json` (état local, ignoré par git, jamais commité). */
export function fichierBancContexte(racine: string): string {
	return join(racine, DOSSIER_LOCAL, 'banc-contexte.json');
}

const textes = (v: unknown, nom: string, i: number): string[] => {
	if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) throw new ErreurCli(`banc-contexte.json, cas ${i + 1} : « ${nom} » doit être une liste de textes.`);
	return v as string[];
};
const nombreOuNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function lireSignaux(v: unknown): Signaux | undefined {
	if (!estObjet(v)) return undefined;
	return { logit: nombreOuNull(v['logit']), cosinus: nombreOuNull(v['cosinus']), cosinusRelatif: nombreOuNull(v['cosinusRelatif']), bm25Relatif: nombreOuNull(v['bm25Relatif']) ?? 0 };
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
		};
	});
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

/** Les mesures du jugement, lisibles : une ligne par niveau et variante, puis ce qui reste à brancher. */
export function jugementsEnTexte(r: RejeuJugements): string {
	const lignes = [`Jugements : ${r.messagesJuges} messages jugés, ${r.sessions} sessions, ${r.paires.length} paires (${r.indecises} indécises exclues)`];
	for (const m of r.mesures) {
		if (m.messages === 0) {
			lignes.push(`  ${NOMS_NIVEAUX[m.niveau]}, ${m.variante === 'seule' ? 'message seul' : 'message joint'} : aucun message classé (modèle absent)`);
			continue;
		}
		const tete = `  ${NOMS_NIVEAUX[m.niveau]}, ${m.variante === 'seule' ? 'message seul' : 'message joint'} : ${m.messages} messages (${m.silences} silence), ${m.pertinentes} pertinentes / ${m.nonPertinentes} non`;
		const ordre = `rappel des 10 premières ${pourcent(m.rappel10)}, pistes : rappel ${pourcent(m.rappelPistes)}, précision ${pourcent(m.precisionPistes)}${m.nonJugeesEnTete === 0 ? '' : `, ${m.nonJugeesEnTete} non jugées en tête`}`;
		lignes.push(`${tete} ; ${ordre}`);
		if (m.note !== null) {
			const s = m.note.auSeuil;
			lignes.push(
				`    au seuil ${pourcent(s.seuil)} : ${s.injections} injections (${s.sessions} sessions), précision ${pourcent(s.precision)}, Wilson ${pourcent(s.wilsonBasse)}, ECE ${m.note.ece === null ? '-' : m.note.ece.toFixed(3)}, ${s.silencesAvecInjection} silences avec injection`,
			);
		}
	}
	if (r.modeles !== null && (!r.modeles.sens || !r.modeles.reranker)) {
		lignes.push(`  Modèles absents au recalcul : ${[r.modeles.sens ? null : 'sens', r.modeles.reranker ? null : 'reranker'].filter((x) => x !== null).join(', ')}`);
	}
	lignes.push(...r.aBrancher.map((a) => `  à brancher ${a}`));
	return lignes.join('\n');
}

type Options = { json: boolean; extraire: boolean; session: string | null; nombre: number | null; juger: boolean; recalculer: boolean };

export function lireOptionsContexte(args: readonly string[]): Options {
	const o: Options = { json: false, extraire: false, session: null, nombre: null, juger: false, recalculer: false };
	const refus = (motif: string) => new ErreurCli(`${motif}\n${USAGE_CONTEXTE}`, 2);
	for (let k = 0; k < args.length; k++) {
		const a = args[k]!;
		if (a === '--json') o.json = true;
		else if (a === '--juger') o.juger = true;
		else if (a === '--recalculer') o.recalculer = true;
		else if (a === '--extraire') {
			o.extraire = true;
			const suivant = args[k + 1];
			if (suivant !== undefined && !suivant.startsWith('--')) {
				o.session = suivant;
				k += 1;
			}
		} else if (a === '--nombre') {
			const n = Number(args[k + 1]);
			if (!Number.isInteger(n) || n < 1) throw refus('Nombre manquant ou invalide après --nombre.');
			o.nombre = n;
			k += 1;
		} else throw refus(a.startsWith('--') ? `Option inconnue : « ${a} ».` : `Argument inattendu : « ${a} ».`);
	}
	if ([o.extraire, o.juger, o.recalculer].filter(Boolean).length > 1) throw refus('--extraire, --juger et --recalculer ne vont pas ensemble.');
	if (o.nombre !== null && !o.extraire) throw refus("--nombre ne va qu'avec --extraire.");
	if (o.juger && o.json) throw refus('--juger ne va pas avec --json.');
	return o;
}

/** Avancement sur la sortie d'erreur, sur une seule ligne (seulement vers un terminal). */
function avancement(libelle: string): (faits: number, total: number) => void {
	return (faits, total) => {
		if (process.stderr.isTTY) process.stderr.write(`\r${libelle} : ${faits} / ${total}${faits === total ? '\n' : ''}`);
	};
}

async function extraire(racine: string, fichier: string, existants: CasContexte[], o: Options): Promise<void> {
	const etat = etatParesseux(racine);
	const dep = dependancesReelles(racine);
	try {
		const journal = await messagesDuJournal(etat, o.session ?? undefined).catch((e: unknown) => {
			throw new ErreurCli(e instanceof Error ? e.message : String(e));
		});
		// une session nommée : tous ses messages porteurs ; sinon, un choix varié parmi toutes les sessions
		const choix = o.session === null ? { nombre: o.nombre ?? NOMBRE_PAR_DEFAUT, parSession: PAR_SESSION } : { nombre: o.nombre ?? Infinity, parSession: Infinity };
		const choisis = messagesAExtraire(journal, existants, choix);
		if (!o.json) console.error(`${choisis.length} message(s) à extraire (sur ${journal.length} messages porteurs au journal) ; calcul des fiches à juger, modèles compris…`);
		const bilan = await extraireJugements(dep, choisis, { avancement: avancement('Messages') });
		const { cas, ajoutes, completes } = fusionnerCas(existants, bilan.cas);
		await mkdir(dirname(fichier), { recursive: true });
		await enregistrerCas(fichier, cas);
		const fiches = bilan.cas.reduce((n, c) => n + (c.candidates?.length ?? 0), 0);
		const p = progression(cas);
		if (o.json) {
			console.log(JSON.stringify({ ajoutes, completes, sansCandidate: bilan.sansCandidate, fiches, modeles: bilan.modeles, messages: p.messages, messagesJuges: p.messagesJuges }));
			return;
		}
		const absents = [bilan.modeles.sens ? null : 'sens', bilan.modeles.reranker ? null : 'reranker'].filter((x) => x !== null);
		console.log(
			[
				`${ajoutes} message(s) ajouté(s), ${completes} complété(s), ${fiches} fiches à juger (${bilan.cas.length === 0 ? 0 : Math.round(fiches / bilan.cas.length)} par message)${bilan.sansCandidate === 0 ? '' : ` ; ${bilan.sansCandidate} sans aucune fiche candidate, laissé(s)`}.`,
				...(absents.length === 0 ? [] : [`Attention : modèle absent (${absents.join(', ')}) : les fiches à juger ne viennent que des autres listes.`]),
				`À juger : ${p.messages - p.messagesJuges} message(s). Lancez : mnemo banc contexte --juger`,
			].join('\n'),
		);
	} finally {
		dep.index.fermer();
		etat.fermer();
	}
}

/**
 * `mnemo banc contexte` : rejoue les cas étiquetés à la main et mesure les messages jugés de `.mnemo/banc-contexte.json`
 * (sans `claude`) ; `--recalculer` recalcule les signaux avec les modèles. `--extraire [<session>]` ajoute des messages réels
 * à juger, avec leurs fiches figées ; `--juger` les fait juger une fiche à la fois ; `--json` rend aussi les paires jugées et
 * leurs signaux bruts (apprentissage de la note).
 */
export async function commandeContexte(args: string[]): Promise<void> {
	const o = lireOptionsContexte(args);
	const racine = trouverRacine(process.cwd());
	if (racine === null) throw new ErreurCli(AUCUNE_MEMOIRE);
	const fichier = fichierBancContexte(racine);
	const existants = await lireCasDuFichier(fichier);

	if (o.extraire) return extraire(racine, fichier, existants, o);
	if (o.juger) {
		if (progression(existants).messages === 0) throw new ErreurCli(`Aucun message à juger dans ${fichier}. Ajoutez-en avec : mnemo banc contexte --extraire`);
		const fin = await jugerAuTerminal(fichier, existants, { entree: process.stdin, sortie: process.stdout }).catch((e: unknown) => {
			throw new ErreurCli(e instanceof Error ? e.message : String(e));
		});
		const suite = fin.messagesJuges === fin.messages ? ' Tout est jugé : mnemo banc contexte --extraire pour en ajouter.' : ' Relancez --juger pour reprendre.';
		console.log(`${fin.messagesJuges} / ${fin.messages} messages jugés (${fin.silences} silence, ${fin.sautes} sautés), enregistrés dans ${fichier}.${suite}`);
		return;
	}
	const etiquetes = existants.filter((c) => c.candidates === undefined);
	const avecCandidates = existants.filter((c) => c.candidates !== undefined);
	if (existants.length === 0) throw new ErreurCli(`Aucun cas dans ${fichier}. Ajoutez-en avec : mnemo banc contexte --extraire`);
	const dep = dependancesReelles(racine);
	try {
		const etiquetage = etiquetes.length === 0 ? null : await rejouerCas(dep, etiquetes);
		const jugements = avecCandidates.length === 0 ? null : await rejouerJugements(dep, avecCandidates, { recalculer: o.recalculer, ...(o.recalculer ? { avancement: avancement('Rejeu') } : {}) });
		if (o.json) {
			console.log(JSON.stringify({ ...(etiquetage === null ? {} : { mesure: etiquetage.mesure, echecs: etiquetage.echecs }), ...(jugements === null ? {} : { jugements }) }, null, 2));
		} else {
			console.log([...(etiquetage === null ? [] : [contexteEnTexte(etiquetage.mesure, etiquetage.echecs)]), ...(jugements === null ? [] : [jugementsEnTexte(jugements)])].join('\n\n'));
		}
	} finally {
		dep.index.fermer();
	}
}
