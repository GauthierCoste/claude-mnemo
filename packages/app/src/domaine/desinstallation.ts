/**
 * « Désinstaller Mnemo… » : ce qui sera retiré (et seulement ce qui est à nous), ce qui reste, la question, puis le bilan.
 * « À nous » : la commande `mnemo`, la déclaration MCP et l'entrée de l'app Claude ne sont retirées que si elles lancent
 * cette app (état `nous`) ; celles d'une autre installation de Mnemo (`ailleurs` : le dépôt, une autre copie de l'app)
 * restent, comme ce qui n'est pas de Mnemo.
 * Chaque retrait est indépendant : un échec n'arrête pas les suivants, et le bilan les dit tous avant que l'app ne quitte.
 * La mémoire (`_mnemo/`) et le dossier local (`.mnemo/`) restent toujours.
 * L'app elle-même : sous macOS, mise à la corbeille ; sous Windows, retirée par son désinstalleur (`Uninstall Mnemo.exe`,
 * à côté de `Mnemo.exe`), ouvert quand Mnemo quitte ; sans désinstalleur, Paramètres › Applications.
 */
import type { EtatInstallation } from './installation.ts';
import type { PlateformeApp } from './plateforme.ts';

export type EtapeDesinstallation = 'ouvertureSession' | 'commande' | 'claudeCode' | 'appClaude' | 'configuration' | 'service' | 'corbeille' | 'desinstalleur';

export type EntreeDesinstallation = {
	plateforme: PlateformeApp;
	etat: EtatInstallation;
	/** L'app s'ouvre à l'ouverture de session. */
	ouvertureSession: boolean;
	serviceVivant: boolean;
	/**
	 * L'app empaquetée se retire : sous macOS, à un emplacement durable (mise à la corbeille) ; sous Windows, son désinstalleur
	 * est là. En développement, ou ouverte depuis l'image disque ou une copie de translocation, elle reste.
	 */
	empaquetee: boolean;
	racine: string;
	/** Chemins affichés (dossier personnel abrégé en `~` par l'appelant) ; `app` : sous Windows, le désinstalleur. */
	chemins: { commande: string; app: string; dossierApp: string };
};

export type PlanDesinstallation = { etapes: EtapeDesinstallation[]; message: string; detail: string };

/** Ordre des retraits : le service s'arrête après les retraits qui n'en ont pas besoin, l'app part en dernier. */
const ORDRE: readonly EtapeDesinstallation[] = ['ouvertureSession', 'commande', 'claudeCode', 'appClaude', 'configuration', 'service', 'corbeille', 'desinstalleur'];

export const BOUTONS_DESINSTALLER = ['Désinstaller', 'Annuler'] as const;
export const BOUTON_DESINSTALLER_ANNULER = 1;

/** Un dossier de la racine, avec le séparateur de la plateforme. */
const dansRacine = (e: EntreeDesinstallation, nom: string): string => `${e.racine}${e.plateforme === 'win32' ? '\\' : '/'}${nom}`;

function libelle(etape: EtapeDesinstallation, e: EntreeDesinstallation): string {
	switch (etape) {
		case 'ouvertureSession':
			return 'l’ouverture de Mnemo à l’ouverture de session';
		case 'commande':
			return `la commande « mnemo » (${e.chemins.commande})`;
		case 'claudeCode':
			return 'la déclaration de la mémoire à Claude Code (serveur MCP « mnemo »)';
		case 'appClaude':
			return 'l’entrée « mnemo » de l’app Claude';
		case 'configuration':
			return `la configuration et les préférences de l’app (${e.chemins.dossierApp})`;
		case 'service':
			return 'le service, arrêté avec ses sessions';
		case 'corbeille':
			return `l’app elle-même (${e.chemins.app}), mise à la corbeille`;
		case 'desinstalleur':
			return `l’app elle-même, par son désinstalleur (${e.chemins.app}), qui s’ouvre quand Mnemo quitte`;
	}
}

/** Les étapes à mener, la question et son détail : ce qui sera retiré, ce qui reste. */
export function planDesinstallation(e: EntreeDesinstallation): PlanDesinstallation {
	const voulues = new Set<EtapeDesinstallation>(['configuration']);
	if (e.ouvertureSession) voulues.add('ouvertureSession');
	// la commande, la déclaration et l'entrée : seulement si elles lancent cette app
	if (e.etat.commande === 'nous') voulues.add('commande');
	if (e.etat.claudeCode === 'nous') voulues.add('claudeCode');
	if (e.etat.appClaude === 'nous') voulues.add('appClaude');
	if (e.serviceVivant) voulues.add('service');
	if (e.empaquetee) voulues.add(e.plateforme === 'win32' ? 'desinstalleur' : 'corbeille');
	const etapes = ORDRE.filter((x) => voulues.has(x));

	const restent = [`ta mémoire (${dansRacine(e, '_mnemo')}) et le dossier local ${dansRacine(e, '.mnemo')} (index, journaux, réglages du dossier) : rien n’y est effacé`];
	if (e.etat.commande === 'ailleurs') restent.push(`la commande « mnemo » (${e.chemins.commande}), qui lance une autre installation de Mnemo`);
	if (e.etat.commande === 'autre') restent.push(`${e.chemins.commande}, qui n’a pas été écrit par Mnemo`);
	if (e.etat.claudeCode === 'ailleurs') restent.push('la déclaration « mnemo » de Claude Code, qui lance une autre installation de Mnemo');
	if (e.etat.claudeCode === 'autre') restent.push('la déclaration « mnemo » de Claude Code, qui ne lance pas Mnemo');
	if (e.etat.appClaude === 'ailleurs') restent.push('l’entrée « mnemo » de l’app Claude, qui lance une autre installation de Mnemo');
	if (e.etat.appClaude === 'autre') restent.push('l’entrée « mnemo » de l’app Claude, qui ne lance pas Mnemo');
	if (!e.empaquetee && e.plateforme === 'win32') restent.push('l’app elle-même : à désinstaller depuis Paramètres › Applications (version de développement lancée depuis le dépôt : à retirer à la main)');
	else if (!e.empaquetee) restent.push('l’app elle-même (version de développement lancée depuis le dépôt, ou app ouverte depuis l’image disque ou une copie provisoire de macOS : à retirer à la main)');

	return {
		etapes,
		message: 'Désinstaller Mnemo ?',
		detail: `Seront retirés :\n${etapes.map((x) => `• ${libelle(x, e)}`).join('\n')}\n\nResteront :\n${restent.map((r) => `• ${r}`).join('\n')}\n\nPuis Mnemo quittera.`,
	};
}

export type ResultatEtape = { etape: EtapeDesinstallation; ok: true; note?: string } | { etape: EtapeDesinstallation; ok: false; raison: string };

/** Le bilan montré avant de quitter : chaque étape, réussie ou non (avec sa raison). */
export function bilanDesinstallation(resultats: readonly ResultatEtape[], e: EntreeDesinstallation): { ok: boolean; message: string; detail: string } {
	const ok = resultats.every((r) => r.ok);
	const desinstalleur = resultats.some((r) => r.etape === 'desinstalleur' && r.ok);
	const lignes = resultats.map((r) => (r.ok ? `✓ ${libelle(r.etape, e)}${r.note === undefined ? '' : ` (${r.note})`}` : `✗ ${libelle(r.etape, e)} : ${r.raison}`));
	return {
		ok,
		message: desinstalleur
			? ok
				? 'Mnemo est désinstallé ; son désinstalleur retire l’app quand tu quittes.'
				: 'Mnemo est désinstallé, sauf ce qui n’a pas pu être retiré ; son désinstalleur retire l’app quand tu quittes.'
			: ok
				? 'Mnemo est désinstallé.'
				: 'Mnemo est désinstallé, sauf ce qui n’a pas pu être retiré.',
		detail: `${lignes.join('\n')}\n\nTa mémoire et ${dansRacine(e, '.mnemo')} sont restés en place.`,
	};
}
