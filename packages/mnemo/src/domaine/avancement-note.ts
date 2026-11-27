/**
 * Avancement de la note de confiance vers ses premiers % (page Entraîner) : tant qu'un modèle n'est pas accepté, ce qui manque
 * en volume pour que les critères de précision veuillent dire quelque chose. Trois volumes (spec § 4.3) : fiches que Mnemo
 * injecterait, sessions où il injecterait, messages « Rien d'utile ici » (et leurs sessions). L'avancement est celui du plus en
 * retard, qui bloque : un repère, pas une promesse (les fiches injectables dépendent du modèle lui-même). Pur.
 */
import { CRITERES } from './acceptation-note.ts';
import type { MesuresDuModele } from './modele-de-note.ts';

export type NomDeVolume = 'injections' | 'sessions' | 'silences';
/** Un volume : `fait` sur `cible` ; les silences disent aussi leurs sessions. */
export type Volume = { nom: NomDeVolume; fait: number; cible: number; sessions?: { fait: number; cible: number } };

const part = (fait: number, cible: number): number => Math.min(1, cible <= 0 ? 1 : fait / cible);

/** Les trois volumes d'un modèle mesuré ; sans les sessions des silences (modèle d'avant la 1.11.5) : seuls les messages comptent. */
export function volumesDe(m: Pick<MesuresDuModele, 'injections' | 'sessions' | 'silences' | 'sessionsSilence'>): Volume[] {
	return [
		{ nom: 'injections', fait: m.injections, cible: CRITERES.injectionsMin },
		{ nom: 'sessions', fait: m.sessions, cible: CRITERES.sessionsMin },
		{
			nom: 'silences',
			fait: m.silences,
			cible: CRITERES.silencesMin,
			...(m.sessionsSilence === undefined ? {} : { sessions: { fait: m.sessionsSilence, cible: CRITERES.sessionsSilenceMin } }),
		},
	];
}

/** La part d'un volume (les silences : le moins avancé des messages et de leurs sessions). */
export function partDuVolume(v: Volume): number {
	return Math.min(part(v.fait, v.cible), v.sessions === undefined ? 1 : part(v.sessions.fait, v.sessions.cible));
}

/** L'avancement : la part du volume le plus en retard, de 0 à 1. */
export function avancementDes(volumes: readonly Volume[]): number {
	return volumes.reduce((min, v) => Math.min(min, partDuVolume(v)), 1);
}
