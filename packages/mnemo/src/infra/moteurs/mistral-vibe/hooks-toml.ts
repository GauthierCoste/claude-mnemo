import type { AppelHooksDuPoste, HooksDuPoste, LectureHooksDuPoste, ResultatInstallationHooks, ResultatRemplacementHooks, ResultatRetraitHooks } from '../../../application/ports.ts';
import { lanceCeNodeEtCeMain } from '../../../domaine/moteurs/commande-de-hook.ts';
import { blocsAttendus, etatDesHooksMistralVibe, hooksDeMnemo, texteAvecHooks } from '../../../domaine/moteurs/mistral-vibe/hooks-installes.ts';
import type { ElementDeTableau } from '../../../domaine/moteurs/toml-lecture.ts';
import { ecrireConfiguration, lireConfiguration } from '../../fichier-de-configuration.ts';
import type { ConfigurationLue } from '../../fichier-de-configuration.ts';
import { cheminHooksToml } from './dossier-vibe.ts';

/** `hooks.toml` lu et ses hooks de Mnemo, ou l'échec. */
async function lireFichier(chemin: string): Promise<{ lu: ConfigurationLue; elements: ElementDeTableau[] } | { echec: string }> {
	const lu = await lireConfiguration(chemin);
	if ('echec' in lu) return lu;
	const hooks = hooksDeMnemo(lu.texte);
	if ('echec' in hooks) return { echec: `${chemin} : ${hooks.echec} ; le corriger, Mnemo ne le réécrit pas.` };
	return { lu, elements: hooks.elements };
}

async function lire(a: AppelHooksDuPoste, plateforme: string): Promise<LectureHooksDuPoste> {
	const chemin = cheminHooksToml(a.env);
	const f = await lireFichier(chemin);
	if ('echec' in f) return f;
	// Vibe n'a pas d'approbation des hooks de l'utilisateur
	return { etat: etatDesHooksMistralVibe(f.lu.texte ?? '', f.elements, a.node, a.main, plateforme).etat, chemin };
}

/**
 * Installe les hooks de ce Node et ce `main.ts` s'il n'y en a aucun de Mnemo, ou refait ceux de cette même installation. Des
 * hooks d'une autre installation de Mnemo : échec `perime`, rien n'est écrit (`mnemo declarer --moteur mistral-vibe
 * --lier` les reprend).
 */
async function installer(a: AppelHooksDuPoste, plateforme: string): Promise<ResultatInstallationHooks> {
	const chemin = cheminHooksToml(a.env);
	const f = await lireFichier(chemin);
	if ('echec' in f) return f;
	const { etat, autres } = etatDesHooksMistralVibe(f.lu.texte ?? '', f.elements, a.node, a.main, plateforme);
	if (etat === 'a_jour') return 'deja';
	if (autres) return { echec: `${chemin} porte des hooks de Mnemo d’une autre installation (autre Node ou autre Mnemo) : « mnemo declarer --moteur mistral-vibe --lier » les reprend.`, perime: true };
	const echec = await ecrireConfiguration(chemin, f.lu, texteAvecHooks(f.lu.texte, f.elements, blocsAttendus(a.node, a.main, plateforme)));
	return echec ?? (etat === 'absent' ? 'installe' : 'mis_a_jour');
}

/** Refait tous les hooks de Mnemo (de toute installation) sur ce Node et ce `main.ts` ; n'installe rien s'il n'y en a aucun. */
async function remplacer(a: AppelHooksDuPoste, plateforme: string): Promise<ResultatRemplacementHooks> {
	const chemin = cheminHooksToml(a.env);
	const f = await lireFichier(chemin);
	if ('echec' in f) return f;
	const { etat } = etatDesHooksMistralVibe(f.lu.texte ?? '', f.elements, a.node, a.main, plateforme);
	if (etat !== 'perime') return etat === 'a_jour' ? 'deja' : 'absent';
	return (await ecrireConfiguration(chemin, f.lu, texteAvecHooks(f.lu.texte, f.elements, blocsAttendus(a.node, a.main, plateforme)))) ?? 'mis_a_jour';
}

/** Retire les hooks de ce Node et ce `main.ts`, jamais un autre hook, ni ceux d'une autre installation de Mnemo (`autre`). */
async function retirer(a: AppelHooksDuPoste): Promise<ResultatRetraitHooks> {
	const chemin = cheminHooksToml(a.env);
	const f = await lireFichier(chemin);
	if ('echec' in f) return f;
	if (f.elements.length === 0) return 'absent';
	const deCetteInstallation = (commande: string) => lanceCeNodeEtCeMain(commande, a.node, a.main);
	if (!f.elements.some((e) => deCetteInstallation(String(e.valeurs['command'])))) return 'autre';
	return (await ecrireConfiguration(chemin, f.lu, texteAvecHooks(f.lu.texte, f.elements, [], deCetteInstallation))) ?? 'retire';
}

/**
 * Mistral Vibe : `$VIBE_HOME/hooks.toml` (sinon `~/.vibe/hooks.toml`), ses autres hooks gardés tels quels ; aucune approbation.
 * `plateforme` : celle dont le shell lance les hooks (leur commande en dépend).
 */
export function hooksDuPosteMistralVibe(plateforme: string): HooksDuPoste {
	return {
		chemin: cheminHooksToml,
		lire: (a) => lire(a, plateforme),
		installer: (a) => installer(a, plateforme),
		remplacer: (a) => remplacer(a, plateforme),
		retirer,
	};
}
