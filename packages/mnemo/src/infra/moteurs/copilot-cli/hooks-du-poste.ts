import type { AppelHooksDuPoste, HooksDuPoste, LectureHooksDuPoste, ResultatInstallationHooks, ResultatRemplacementHooks, ResultatRetraitHooks } from '../../../application/ports.ts';
import { etatDuFichierDeHooks, fichierDeHooksAttendu, fichierSansCetteInstallation, texteDuFichierDeHooks } from '../../../domaine/moteurs/copilot-cli/hooks-installes.ts';
import { estObjet, objetJson } from '../../../domaine/valeurs.ts';
import { ecrireConfiguration, lireConfiguration, supprimerConfiguration } from '../../fichier-de-configuration.ts';
import type { ConfigurationLue } from '../../fichier-de-configuration.ts';
import { cheminHooksCopilot } from './dossier-copilot.ts';

/** Le fichier lu : chemin réel, texte (null : absent) et racine JSON (null : absent), ou l'échec. */
async function lireFichier(chemin: string): Promise<{ lu: ConfigurationLue; racine: Record<string, unknown> | null } | { echec: string }> {
	const lu = await lireConfiguration(chemin);
	if ('echec' in lu) return lu;
	if (lu.texte === null) return { lu, racine: null };
	const racine = objetJson(lu.texte);
	if (racine === null || !estObjet(racine)) return { echec: `${chemin} : JSON illisible ; corrigez-le, Mnemo ne le réécrit pas.` };
	return { lu, racine };
}

/** Pourquoi Mnemo ne réécrit pas son fichier : il porte ce que Mnemo n'écrit pas. */
const refusPersonnels = (chemin: string, personnels: readonly string[]): { echec: string } => ({
	echec: `${chemin} porte ce que Mnemo n’écrit pas (${personnels.join(', ')}) : déplacez ces hooks dans un autre fichier de ce dossier ; Mnemo ne réécrit pas le sien.`,
});

async function lire(a: AppelHooksDuPoste): Promise<LectureHooksDuPoste> {
	const chemin = cheminHooksCopilot(a.env);
	const f = await lireFichier(chemin);
	if ('echec' in f) return f;
	// lu par Copilot sans approbation (lu dans son aide)
	return { etat: etatDuFichierDeHooks(f.racine, a.node, a.main).etat, chemin };
}

/**
 * Écrit le fichier attendu s'il n'y a aucun hook de Mnemo, ou refait ceux de cette même installation. Des hooks d'une autre
 * installation de Mnemo : échec `perime`, rien n'est écrit (`mnemo declarer --moteur copilot-cli --remplacer` les reprend).
 */
async function installer(a: AppelHooksDuPoste): Promise<ResultatInstallationHooks> {
	const chemin = cheminHooksCopilot(a.env);
	const f = await lireFichier(chemin);
	if ('echec' in f) return f;
	const { etat, autres, personnels } = etatDuFichierDeHooks(f.racine, a.node, a.main);
	if (etat === 'a_jour') return 'deja';
	if (personnels.length > 0) return refusPersonnels(chemin, personnels);
	if (autres) return { echec: `${chemin} porte des hooks de Mnemo d’une autre installation (autre Node ou autre Mnemo) : lancez « mnemo declarer --moteur copilot-cli --remplacer » pour les reprendre.`, perime: true };
	const echec = await ecrireConfiguration(chemin, f.lu, texteDuFichierDeHooks(fichierDeHooksAttendu(a.node, a.main)));
	return echec ?? (etat === 'absent' ? 'installe' : 'mis_a_jour');
}

/** Refait les hooks de Mnemo (de toute installation) sur ce Node et ce `main.ts` ; n'installe rien s'il n'y en a aucun. */
async function remplacer(a: AppelHooksDuPoste): Promise<ResultatRemplacementHooks> {
	const chemin = cheminHooksCopilot(a.env);
	const f = await lireFichier(chemin);
	if ('echec' in f) return f;
	const { etat, personnels } = etatDuFichierDeHooks(f.racine, a.node, a.main);
	if (etat !== 'perime') return etat === 'a_jour' ? 'deja' : 'absent';
	if (personnels.length > 0) return refusPersonnels(chemin, personnels);
	return (await ecrireConfiguration(chemin, f.lu, texteDuFichierDeHooks(fichierDeHooksAttendu(a.node, a.main)))) ?? 'mis_a_jour';
}

/**
 * Retire les commandes de ce Node et ce `main.ts` : le fichier est supprimé s'il ne lui reste rien, sinon réécrit sans elles
 * (une autre installation, ou ce qu'un utilisateur y a mis, gardés) ; jamais rien d'autre.
 */
async function retirer(a: AppelHooksDuPoste): Promise<ResultatRetraitHooks> {
	const chemin = cheminHooksCopilot(a.env);
	const f = await lireFichier(chemin);
	if ('echec' in f) return f;
	const { etat, deCetteInstallation } = etatDuFichierDeHooks(f.racine, a.node, a.main);
	if (f.racine === null || !deCetteInstallation) return etat === 'absent' ? 'absent' : 'autre';
	const reste = fichierSansCetteInstallation(f.racine, a.node, a.main);
	const echec = reste === null ? await supprimerConfiguration(chemin, f.lu) : await ecrireConfiguration(chemin, f.lu, texteDuFichierDeHooks(reste));
	return echec ?? 'retire';
}

/** GitHub Copilot CLI : `hooks/mnemo.json` de `$COPILOT_HOME` (sinon `~/.copilot`), un fichier propre à Mnemo. */
export const HOOKS_DU_POSTE_COPILOT_CLI: HooksDuPoste = { chemin: cheminHooksCopilot, lire, installer, remplacer, retirer };
