import { randomBytes } from 'node:crypto';
import { lstat, mkdir, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import type { AppelHooksDuPoste, HooksDuPoste, LectureHooksDuPoste, ResultatInstallationHooks, ResultatRemplacementHooks, ResultatRetraitHooks } from '../../../application/ports.ts';
import { approbationDesHooks } from '../../../domaine/moteurs/codex/approbation-hooks.ts';
import { estHookDe, etatDesHooks, hooksAttendus, lireHooksJson, remplacerHooks, texteHooksJson } from '../../../domaine/moteurs/codex/hooks-installes.ts';
import { dossierCodex, lireConfigCodex } from './dossier-codex.ts';

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

/**
 * Le fichier lu : son chemin réel (un lien est suivi, jamais remplacé), son texte (null : absent) et sa racine, ou l'échec.
 * Un lien dont la cible manque est un échec : écrire à sa place remplacerait le lien.
 */
async function lireFichier(chemin: string): Promise<{ reel: string; texte: string | null; racine: Record<string, unknown> } | { echec: string }> {
	let reel = chemin;
	const lien = await lstat(chemin).then(
		(s) => s.isSymbolicLink(),
		() => false,
	);
	try {
		reel = await realpath(chemin);
	} catch (erreur) {
		if (lien) return { echec: `${chemin} est un lien symbolique dont la cible est introuvable (${message(erreur)}) : rétablissez sa cible ou retirez le lien ; Mnemo ne le remplace pas.` };
		// absent : écrit à son chemin
	}
	let texte: string | null;
	try {
		texte = await texteOuAbsent(reel);
	} catch (erreur) {
		return { echec: `${chemin} illisible : ${message(erreur)}` };
	}
	const lu = lireHooksJson(texte);
	if ('echec' in lu) return { echec: `${chemin} : ${lu.echec} ; corrigez-le, Mnemo ne le réécrit pas.` };
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
		if ((await texteOuAbsent(reel)) !== attendu) throw new Error(`${reel} a changé pendant l’écriture : relancez la commande.`);
		await rename(provisoire, reel);
	} finally {
		await rm(provisoire, { force: true });
	}
}

/** Écrit la racine à la place du fichier lu ; l'échec dit pourquoi. */
async function ecrire(chemin: string, lu: { reel: string; texte: string | null }, racine: Record<string, unknown>): Promise<{ echec: string } | null> {
	try {
		await ecrireAtomique(lu.reel, lu.texte, texteHooksJson(racine));
		return null;
	} catch (erreur) {
		return { echec: `écriture de ${chemin} impossible : ${message(erreur)}` };
	}
}

async function lire(a: AppelHooksDuPoste): Promise<LectureHooksDuPoste> {
	const chemin = cheminHooksJson(a.env);
	const lu = await lireFichier(chemin);
	if ('echec' in lu) return lu;
	const { etat, cles } = etatDesHooks(lu.racine, a.node, a.main);
	if (etat !== 'a_jour') return { etat, chemin };
	// absent : rien d'approuvé ; illisible : état inconnu
	const config = await lireConfigCodex(a.env).then(
		(t) => t ?? '',
		() => null,
	);
	// Codex nomme le hook par le chemin de hooks.json qu'il a lu : tel quel, ou réel (liens résolus)
	const chemins = [...new Set([chemin, lu.reel, await realpath(dirname(chemin)).then((d) => join(d, basename(chemin)), () => chemin)])];
	return { etat, chemin, approbation: approbationDesHooks(config, chemins, cles) };
}

/**
 * Installe les hooks de ce Node et ce `main.ts` s'il n'y en a aucun de Mnemo, ou complète et remet à jour ceux de cette même
 * installation. Des hooks d'une autre installation de Mnemo (autre Node, autre Mnemo) : échec `perime`, rien n'est écrit
 * (`mnemo declarer --moteur codex --remplacer` les reprend), comme pour la déclaration MCP.
 */
async function installer(a: AppelHooksDuPoste): Promise<ResultatInstallationHooks> {
	const chemin = cheminHooksJson(a.env);
	const lu = await lireFichier(chemin);
	if ('echec' in lu) return lu;
	const { etat, autres } = etatDesHooks(lu.racine, a.node, a.main);
	if (etat === 'a_jour') return 'deja';
	if (autres)
		return { echec: `${chemin} porte des hooks de Mnemo d’une autre installation (autre Node ou autre Mnemo) : lancez « mnemo declarer --moteur codex --remplacer » pour les reprendre.`, perime: true };
	const echec = await ecrire(chemin, lu, remplacerHooks(lu.racine, hooksAttendus(a.node, a.main)));
	return echec ?? (etat === 'absent' ? 'installe' : 'mis_a_jour');
}

/** Refait tous les hooks de Mnemo (de toute installation) sur ce Node et ce `main.ts` ; n'installe rien s'il n'y en a aucun. */
async function remplacer(a: AppelHooksDuPoste): Promise<ResultatRemplacementHooks> {
	const chemin = cheminHooksJson(a.env);
	const lu = await lireFichier(chemin);
	if ('echec' in lu) return lu;
	const { etat } = etatDesHooks(lu.racine, a.node, a.main);
	if (etat !== 'perime') return etat === 'a_jour' ? 'deja' : 'absent';
	return (await ecrire(chemin, lu, remplacerHooks(lu.racine, hooksAttendus(a.node, a.main)))) ?? 'mis_a_jour';
}

/**
 * Retire les commandes de ce Node et ce `main.ts`, quelle que soit la forme de leur groupe (un groupe ne disparaît que vidé) ;
 * jamais une autre commande, ni celles d'une autre installation de Mnemo (`autre`).
 */
async function retirer(a: AppelHooksDuPoste): Promise<ResultatRetraitHooks> {
	const chemin = cheminHooksJson(a.env);
	const lu = await lireFichier(chemin);
	if ('echec' in lu) return lu;
	const deCetteInstallation = (c: unknown) => estHookDe(c, a.node, a.main);
	const apres = remplacerHooks(lu.racine, new Map(), deCetteInstallation);
	if (JSON.stringify(apres) === JSON.stringify(remplacerHooks(lu.racine, new Map(), () => false))) return etatDesHooks(lu.racine, a.node, a.main).etat === 'absent' ? 'absent' : 'autre';
	return (await ecrire(chemin, lu, apres)) ?? 'retire';
}

/** Codex : `~/.codex/hooks.json` (ou `$CODEX_HOME`), approbation lue dans `config.toml`, jamais écrit par Mnemo. */
export const HOOKS_DU_POSTE_CODEX: HooksDuPoste = { lire, installer, remplacer, retirer };
