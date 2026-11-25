import { randomBytes } from 'node:crypto';
import { mkdir, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import type { AppelHooksDuPoste, HooksDuPoste, LectureHooksDuPoste, ResultatInstallationHooks, ResultatRemplacementHooks, ResultatRetraitHooks } from '../../../application/ports.ts';
import { approbationDesHooks } from '../../../domaine/moteurs/codex/approbation-hooks.ts';
import { etatDesHooks, hooksAttendus, lireHooksJson, remplacerHooks, texteHooksJson } from '../../../domaine/moteurs/codex/hooks-installes.ts';
import { dossierCodex } from './dossier-codex.ts';

/** `hooks.json` de l'utilisateur chez Codex : `$CODEX_HOME/hooks.json`, sinon `~/.codex/hooks.json`. */
export const cheminHooksJson = (env: Record<string, string | undefined>): string => join(dossierCodex(env), 'hooks.json');

/** Texte d'un fichier ; null s'il n'existe pas ; une autre erreur remonte. */
async function texteOuAbsent(chemin: string): Promise<string | null> {
	try {
		return await readFile(chemin, 'utf8');
	} catch (erreur) {
		if ((erreur as { code?: string }).code === 'ENOENT') return null;
		throw erreur;
	}
}

const message = (erreur: unknown): string => (erreur instanceof Error ? erreur.message : String(erreur));

/** Le fichier lu : son chemin réel (un lien est suivi, jamais remplacé), son texte (null : absent) et sa racine, ou l'échec. */
async function lireFichier(chemin: string): Promise<{ reel: string; texte: string | null; racine: Record<string, unknown> } | { echec: string }> {
	let reel = chemin;
	try {
		reel = await realpath(chemin);
	} catch {
		// absent : écrit à son chemin
	}
	let texte: string | null;
	try {
		texte = await texteOuAbsent(reel);
	} catch (erreur) {
		return { echec: `${chemin} illisible : ${message(erreur)}` };
	}
	const lu = lireHooksJson(texte);
	if ('echec' in lu) return { echec: `${chemin} : ${lu.echec} ; corrige-le, Mnemo ne le réécrit pas.` };
	return { reel, texte, racine: lu.racine };
}

/**
 * Écrit `texte` à la place de `reel` : provisoire dans le même dossier (droits du fichier remplacé, sinon 0644), puis renommé.
 * Le fichier est relu juste avant : changé depuis la lecture (`attendu`), rien n'est écrit.
 */
async function ecrireAtomique(reel: string, attendu: string | null, texte: string): Promise<void> {
	await mkdir(dirname(reel), { recursive: true });
	const mode = await stat(reel).then(
		(s) => s.mode & 0o777,
		() => 0o644,
	);
	const provisoire = join(dirname(reel), `.${basename(reel)}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`);
	try {
		await writeFile(provisoire, texte, { mode, flag: 'wx' });
		if ((await texteOuAbsent(reel)) !== attendu) throw new Error(`${reel} a changé pendant l’écriture : relance la commande.`);
		await rename(provisoire, reel);
	} finally {
		await rm(provisoire, { force: true });
	}
}

/** Lit, remplace les hooks de Mnemo par `attendus` (vide : les retire), écrit si quelque chose change. */
async function appliquer(a: AppelHooksDuPoste, installer: boolean): Promise<{ avant: 'a_jour' | 'perime' | 'absent'; ecrit: boolean } | { echec: string }> {
	const chemin = cheminHooksJson(a.env);
	const lu = await lireFichier(chemin);
	if ('echec' in lu) return lu;
	const attendus = hooksAttendus(a.node, a.main);
	const { etat } = etatDesHooks(lu.racine, attendus);
	const apres = remplacerHooks(lu.racine, installer ? attendus : new Map());
	// retrait : seulement les hooks de ce Node et ce `main.ts`, jamais ceux d'une autre installation
	if ((installer && etat === 'a_jour') || (!installer && etat !== 'a_jour')) return { avant: etat, ecrit: false };
	try {
		await ecrireAtomique(lu.reel, lu.texte, texteHooksJson(apres));
	} catch (erreur) {
		return { echec: `écriture de ${chemin} impossible : ${message(erreur)}` };
	}
	return { avant: etat, ecrit: true };
}

async function lire(a: AppelHooksDuPoste): Promise<LectureHooksDuPoste> {
	const chemin = cheminHooksJson(a.env);
	const lu = await lireFichier(chemin);
	if ('echec' in lu) return lu;
	const { etat, cles } = etatDesHooks(lu.racine, hooksAttendus(a.node, a.main));
	if (etat !== 'a_jour') return { etat, chemin };
	// absent : rien d'approuvé ; illisible : état inconnu
	const config = await texteOuAbsent(join(dossierCodex(a.env), 'config.toml')).then(
		(t) => t ?? '',
		() => null,
	);
	// Codex nomme le hook par le chemin de hooks.json qu'il a lu : tel quel, ou réel (liens résolus)
	const chemins = [...new Set([chemin, lu.reel, await realpath(dirname(chemin)).then((d) => join(d, basename(chemin)), () => chemin)])];
	return { etat, chemin, approbation: approbationDesHooks(config, chemins, cles) };
}

async function installer(a: AppelHooksDuPoste): Promise<ResultatInstallationHooks> {
	const r = await appliquer(a, true);
	if ('echec' in r) return r;
	return r.avant === 'a_jour' ? 'deja' : r.avant === 'absent' ? 'installe' : 'mis_a_jour';
}

async function remplacer(a: AppelHooksDuPoste): Promise<ResultatRemplacementHooks> {
	const lu = await lire(a);
	if ('echec' in lu) return lu;
	if (lu.etat === 'absent') return 'absent';
	if (lu.etat === 'a_jour') return 'deja';
	const r = await appliquer(a, true);
	return 'echec' in r ? r : 'mis_a_jour';
}

async function retirer(a: AppelHooksDuPoste): Promise<ResultatRetraitHooks> {
	const r = await appliquer(a, false);
	if ('echec' in r) return r;
	return r.ecrit ? 'retire' : r.avant === 'absent' ? 'absent' : 'autre';
}

/** Codex : `~/.codex/hooks.json` (ou `$CODEX_HOME`), approbation lue dans `config.toml`, jamais écrit par Mnemo. */
export const HOOKS_DU_POSTE_CODEX: HooksDuPoste = { lire, installer, remplacer, retirer };
