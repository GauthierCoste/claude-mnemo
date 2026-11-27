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
import { TEXTES_FR, type TextesApp } from './langue/textes.ts';
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

/** `boutons` : « Désinstaller », « Annuler » (indices de la réponse). */
export type PlanDesinstallation = { etapes: EtapeDesinstallation[]; message: string; detail: string; boutons: string[] };

/** Ordre des retraits : le service s'arrête après les retraits qui n'en ont pas besoin, l'app part en dernier. */
const ORDRE: readonly EtapeDesinstallation[] = ['ouvertureSession', 'commande', 'claudeCode', 'appClaude', 'configuration', 'service', 'corbeille', 'desinstalleur'];

export const BOUTON_DESINSTALLER_ANNULER = 1;

/** Un dossier de la racine, avec le séparateur de la plateforme. */
const dansRacine = (e: EntreeDesinstallation, nom: string): string => `${e.racine}${e.plateforme === 'win32' ? '\\' : '/'}${nom}`;

function libelle(etape: EtapeDesinstallation, e: EntreeDesinstallation, t: TextesApp): string {
	const l = t.desinstallation.etapes;
	switch (etape) {
		case 'ouvertureSession':
			return l.ouvertureSession;
		case 'commande':
			return l.commande(e.chemins.commande);
		case 'claudeCode':
			return l.claudeCode;
		case 'appClaude':
			return l.appClaude;
		case 'configuration':
			return l.configuration(e.chemins.dossierApp);
		case 'service':
			return l.service;
		case 'corbeille':
			return l.corbeille(e.chemins.app);
		case 'desinstalleur':
			return l.desinstalleur(e.chemins.app);
	}
}

/** Les étapes à mener, la question et son détail : ce qui sera retiré, ce qui reste. */
export function planDesinstallation(e: EntreeDesinstallation, t: TextesApp = TEXTES_FR): PlanDesinstallation {
	const d = t.desinstallation;
	const r = d.restent;
	const voulues = new Set<EtapeDesinstallation>(['configuration']);
	if (e.ouvertureSession) voulues.add('ouvertureSession');
	// la commande, la déclaration et l'entrée : seulement si elles lancent cette app
	if (e.etat.commande === 'nous') voulues.add('commande');
	if (e.etat.claudeCode === 'nous') voulues.add('claudeCode');
	if (e.etat.appClaude === 'nous') voulues.add('appClaude');
	if (e.serviceVivant) voulues.add('service');
	if (e.empaquetee) voulues.add(e.plateforme === 'win32' ? 'desinstalleur' : 'corbeille');
	const etapes = ORDRE.filter((x) => voulues.has(x));

	const restent = [r.memoire(dansRacine(e, '_mnemo'), dansRacine(e, '.mnemo'))];
	if (e.etat.commande === 'ailleurs') restent.push(r.commandeAilleurs(e.chemins.commande));
	if (e.etat.commande === 'autre') restent.push(r.commandeAutre(e.chemins.commande));
	if (e.etat.claudeCode === 'ailleurs') restent.push(r.claudeCodeAilleurs);
	if (e.etat.claudeCode === 'autre') restent.push(r.claudeCodeAutre);
	if (e.etat.appClaude === 'ailleurs') restent.push(r.appClaudeAilleurs);
	if (e.etat.appClaude === 'autre') restent.push(r.appClaudeAutre);
	if (!e.empaquetee && e.plateforme === 'win32') restent.push(r.appWindows);
	else if (!e.empaquetee) restent.push(r.app);

	const puces = (lignes: readonly string[]): string => lignes.map((l) => `• ${l}`).join('\n');
	return {
		etapes,
		message: d.message,
		detail: d.detail(puces(etapes.map((x) => libelle(x, e, t))), puces(restent)),
		boutons: [d.desinstaller, d.annuler],
	};
}

export type ResultatEtape = { etape: EtapeDesinstallation; ok: true; note?: string } | { etape: EtapeDesinstallation; ok: false; raison: string };

/** Le bilan montré avant de quitter : chaque étape, réussie ou non (avec sa raison). */
export function bilanDesinstallation(resultats: readonly ResultatEtape[], e: EntreeDesinstallation, t: TextesApp = TEXTES_FR): { ok: boolean; message: string; detail: string } {
	const b = t.desinstallation.bilan;
	const ok = resultats.every((r) => r.ok);
	const desinstalleur = resultats.some((r) => r.etape === 'desinstalleur' && r.ok);
	const lignes = resultats.map((r) => (r.ok ? `✓ ${libelle(r.etape, e, t)}${r.note === undefined ? '' : ` (${r.note})`}` : b.echec(libelle(r.etape, e, t), r.raison)));
	return {
		ok,
		message: desinstalleur ? (ok ? b.desinstalleurOk : b.desinstalleurPartiel) : ok ? b.ok : b.partiel,
		detail: `${lignes.join('\n')}\n\n${b.reste(dansRacine(e, '.mnemo'))}`,
	};
}
