/**
 * Démarrage du service : `<node> <main> ouvrir <racine>`, la commande qui démarre le service détaché s'il ne tourne pas et
 * attend qu'il réponde (30 s), journal dans `.mnemo/service.log`. Rien de cette logique n'est refait ici : la commande
 * finie, on relit `service.json` et on vérifie que le service répond.
 */
import { execFile } from 'node:child_process';
import type { Configuration } from '../domaine/configuration.ts';
import { TEXTES_FR, type TextesApp } from '../domaine/langue/textes.ts';
import { santeService } from './api-service.ts';
import { environnementAvecPath } from './environnement.ts';
import { lireServiceJson, type ServiceLocal } from './service-local.ts';

/** `mnemo ouvrir` attend le service 30 s ; la commande elle-même est abandonnée au-delà. */
export const DELAI_OUVRIR_MS = 60_000;
/** Lignes de la sortie de la commande recopiées dans la raison d'un échec. */
const LIGNES_ERREUR = 5;

export type ResultatDemarrage = { ok: true; service: ServiceLocal } | { ok: false; raison: string };

/**
 * Environnement de la commande : celui de l'app (`base`), le `PATH` de la configuration sous macOS (celui du terminal :
 * `git`, `claude`) ou le `Path` du processus de l'app sous Windows (`environnementAvecPath`), `MNEMO_SANS_NAVIGATEUR=1`
 * (la fenêtre est celle de l'app), `MNEMO_PORT` si la configuration en fixe un.
 */
export function environnementOuvrir(configuration: Configuration, base: NodeJS.ProcessEnv, plateforme: NodeJS.Platform = process.platform): NodeJS.ProcessEnv {
	const env: NodeJS.ProcessEnv = { ...environnementAvecPath(base, configuration.path, plateforme), MNEMO_SANS_NAVIGATEUR: '1' };
	if (configuration.port !== undefined) env['MNEMO_PORT'] = String(configuration.port);
	return env;
}

const dernieresLignes = (texte: string): string => texte.trimEnd().split('\n').slice(-LIGNES_ERREUR).join('\n');

/** Lance `ouvrir` et rend le service qui répond, ou la raison de l'échec (fin de la sortie de la commande), dans la langue de `t`. */
export function demarrerService(configuration: Configuration, base: NodeJS.ProcessEnv = process.env, t: TextesApp = TEXTES_FR): Promise<ResultatDemarrage> {
	return new Promise((resoudre) => {
		execFile(
			configuration.node,
			[configuration.main, 'ouvrir', configuration.racine],
			{ cwd: configuration.racine, env: environnementOuvrir(configuration, base), timeout: DELAI_OUVRIR_MS, windowsHide: true },
			(erreur, sortie, erreurs) => {
				if (erreur) {
					const fin = dernieresLignes(`${erreurs}`) || dernieresLignes(`${sortie}`) || erreur.message;
					resoudre({ ok: false, raison: t.service.pasDemarre(fin) });
					return;
				}
				const service = lireServiceJson(configuration.racine);
				if (service === null) {
					resoudre({ ok: false, raison: t.service.serviceJsonAbsent });
					return;
				}
				void santeService(service).then((sante) =>
					resoudre(sante === 'ok' ? { ok: true, service } : { ok: false, raison: t.service.neRepondPas }),
				);
			},
		);
	});
}
