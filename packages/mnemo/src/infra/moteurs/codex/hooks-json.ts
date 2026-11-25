import { realpath } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import type { AppelHooksDuPoste, HooksDuPoste, LectureHooksDuPoste, ResultatInstallationHooks, ResultatRemplacementHooks, ResultatRetraitHooks } from '../../../application/ports.ts';
import { approbationDesHooks } from '../../../domaine/moteurs/codex/approbation-hooks.ts';
import { estHookDe, etatDesHooks, hooksAttendus, lireHooksJson, remplacerHooks, texteHooksJson } from '../../../domaine/moteurs/codex/hooks-installes.ts';
import { ecrireConfiguration, lireConfiguration } from '../../fichier-de-configuration.ts';
import type { ConfigurationLue } from '../../fichier-de-configuration.ts';
import { dossierCodex, lireConfigCodex } from './dossier-codex.ts';

/** `hooks.json` de l'utilisateur chez Codex : `$CODEX_HOME/hooks.json`, sinon `~/.codex/hooks.json`. */
export const cheminHooksJson = (env: Record<string, string | undefined>): string => join(dossierCodex(env), 'hooks.json');

/** Le fichier lu : son chemin réel, son texte (null : absent) et sa racine JSON, ou l'échec. */
async function lireFichier(chemin: string): Promise<{ reel: string; texte: string | null; racine: Record<string, unknown> } | { echec: string }> {
	const lu = await lireConfiguration(chemin);
	if ('echec' in lu) return lu;
	const json = lireHooksJson(lu.texte);
	if ('echec' in json) return { echec: `${chemin} : ${json.echec} ; corrigez-le, Mnemo ne le réécrit pas.` };
	return { ...lu, racine: json.racine };
}

/** Écrit la racine à la place du fichier lu ; l'échec dit pourquoi. */
const ecrire = (chemin: string, lu: ConfigurationLue, racine: Record<string, unknown>): Promise<{ echec: string } | null> => ecrireConfiguration(chemin, lu, texteHooksJson(racine));

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
