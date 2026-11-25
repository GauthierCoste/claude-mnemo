import { REGLAGES_PAR_DEFAUT } from '../../domaine/reglages.ts';
import { lireReglagesDuDossier } from '../reglages-fichier.ts';

/** Variable par laquelle l'inactivité tolérée (en ms) est transmise au gardien ; posée d'avance, elle l'emporte (tests). */
export const VARIABLE_INACTIVITE = 'MNEMO_MODELES_INACTIVITE_MS';

const valeurPosee = (env: NodeJS.ProcessEnv): number | null => (Number(env[VARIABLE_INACTIVITE]) > 0 ? Number(env[VARIABLE_INACTIVITE]) : null);

/**
 * Inactivité tolérée par le dossier qui lance le gardien : son réglage `modeles.inactiviteMinutes`, sauf si
 * `MNEMO_MODELES_INACTIVITE_MS` est déjà posée. Le gardien, un pour toute la machine, garde la valeur de qui l'a lancé.
 */
export function inactiviteDuDossier(racine: string, env: NodeJS.ProcessEnv, avertir: (message: string) => void = () => {}): number {
	const posee = valeurPosee(env);
	if (posee !== null) return posee;
	const { reglages, avertissements } = lireReglagesDuDossier(racine);
	for (const a of avertissements) avertir(a);
	return reglages.modeles.inactiviteMinutes * 60_000;
}

/** Inactivité reçue par le gardien à son lancement ; sans elle (lancé à la main), le défaut du réglage. */
export function inactiviteTransmise(env: NodeJS.ProcessEnv): number {
	return valeurPosee(env) ?? REGLAGES_PAR_DEFAUT.modeles.inactiviteMinutes * 60_000;
}
