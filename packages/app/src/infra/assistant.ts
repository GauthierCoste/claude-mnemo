/**
 * Côté processus principal de l'assistant, sans Electron : vérification du poste (`mnemo verifier-poste --json`), examen du
 * dossier choisi, `mnemo init --json` lancé sans shell et lu ligne à ligne (une déclaration MCP faite pour une autre
 * installation de Mnemo est reprise aussitôt par `mnemo declarer --remplacer --json`), écriture de la configuration à la
 * fin. Le contrôleur garde l'état de confiance (le dossier vient du sélecteur natif, jamais de la page ; les choix de la
 * page sont relus) ; `electron/assistant.ts` ne fait que brancher ses méthodes sur les canaux IPC.
 */
import { execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { avecVariable } from '@mnemo/commun';
import type { EtapeInit, EvenementInit, FinInit, LigneInit } from '@mnemo/contrat';
import { argumentsInit, argumentsVerifierPoste, DOSSIER_MEMOIRE, lirePoste, type ChoixInstallation, type DossierChoisi, type ExecutableMnemo } from '../domaine/assistant.ts';
import { appliquerLigne, decoupeurLignes, installationVide, lireLigneInit, peutTerminer, type EtatInstallation, type ResultatInstallation } from '../domaine/assistant-lignes.ts';
import { validerChoix, type ReponseDossier, type ReponsePoste, type ReponseTerminer } from '../domaine/assistant-pont.ts';
import { estCheminAbsolu, type Configuration, type Lancement } from '../domaine/configuration.ts';
import { decisionDemarrage, type DecisionDemarrage, MESSAGE_PROVISOIRE } from '../domaine/assistant-demarrage.ts';
import { declarationAReprendre, finApresReprise, ligneApresReprise, type ResultatDeclarer } from '../domaine/assistant-reprise.ts';
import { declarer } from './commande-mnemo.ts';
import { ecrireConfiguration, lireConfiguration } from './configuration-fichier.ts';

/** `verifier-poste` lance `git --version` (10 s au plus) et cherche `claude` : abandonné au-delà. */
export const DELAI_VERIFICATION_MS = 30_000;
/** Fin de la sortie d'erreur gardée pour dire un échec. */
const ERREUR_MAX = 16 * 1024;
const LIGNES_ERREUR = 5;

export const MESSAGE_SANS_MNEMO =
	'Cette app ne sait pas encore où est Mnemo. Depuis le dépôt de l’app, dans un terminal, lance « pnpm installer-dev <dossier Mnemo> » (il écrit sa configuration), puis rouvre Mnemo.';

/**
 * Environnement de `mnemo` : celui de l'app, avec le `PATH` du terminal (sans lui, ni `git` ni `claude` ne sont trouvés) ;
 * sous Windows, sous la clé déjà présente (`Path`), sans doublon.
 */
export function environnementMnemo(executable: ExecutableMnemo, base: NodeJS.ProcessEnv, plateforme: NodeJS.Platform = process.platform): NodeJS.ProcessEnv {
	return avecVariable(base, 'PATH', executable.path, plateforme);
}

/** La racine a une mémoire Mnemo (`_mnemo/SCHEMA.md`). */
export function memoirePresente(racine: string): boolean {
	return existsSync(join(racine, DOSSIER_MEMOIRE, 'SCHEMA.md'));
}

/**
 * Au lancement de l'app : l'interface (configuration valide, mémoire présente) ou l'assistant, avec le Mnemo qu'il lancera.
 * `paquet` : le Node et le `main.ts` de l'app empaquetée (`lancementDuPaquet`) ; ils remplacent ceux de la configuration
 * (alors facultatifs) et, sans configuration, l'assistant les lance avec `path` (celui du terminal, `lirePathTerminal` ;
 * une fonction n'est appelée que dans ce cas : le shell n'est lancé que s'il le faut). Sans paquet (développement) : ceux
 * de la configuration, sinon rien à lancer. `provisoire` : l'app empaquetée tourne depuis un emplacement provisoire
 * (`emplacementProvisoire`) : l'assistant n'aura rien à lancer.
 */
export async function decisionAuLancement(home: string, paquet: Lancement | undefined, path: string | (() => Promise<string>), provisoire = false): Promise<DecisionDemarrage> {
	const lue = await lireConfiguration(home, paquet);
	// le `PATH` ne sert qu'à l'assistant sans configuration, quand il a un Mnemo à lancer
	const utile = paquet !== undefined && !lue.ok && !provisoire;
	const lu = typeof path === 'string' ? path : utile ? await path() : '';
	return decisionDemarrage(lue, lue.ok && memoirePresente(lue.configuration.racine), paquet === undefined ? null : { ...paquet, path: lu }, provisoire);
}

const dernieresLignes = (texte: string): string => texte.trimEnd().split('\n').slice(-LIGNES_ERREUR).join('\n');

/**
 * Dossier rendu par le sélecteur : chemin absolu d'un dossier existant. Le dossier `_mnemo` d'une mémoire désigne sa racine ;
 * un dossier dans `_mnemo` (ou un `_mnemo` sans `SCHEMA.md`) est refusé : la mémoire irait dans une autre mémoire.
 */
export async function examinerDossier(chemin: unknown): Promise<{ ok: true; dossier: DossierChoisi } | { ok: false; erreur: string }> {
	if (typeof chemin !== 'string' || chemin === '' || chemin.includes('\0') || !estCheminAbsolu(chemin)) return { ok: false, erreur: 'Chemin de dossier invalide.' };
	let racine = resolve(chemin);
	try {
		if (!(await stat(racine)).isDirectory()) return { ok: false, erreur: `Ce n’est pas un dossier : ${racine}` };
	} catch {
		return { ok: false, erreur: `Dossier introuvable : ${racine}` };
	}
	if (basename(racine) === DOSSIER_MEMOIRE && existsSync(join(racine, 'SCHEMA.md'))) racine = dirname(racine);
	if (racine.split(sep).includes(DOSSIER_MEMOIRE)) return { ok: false, erreur: `Ce dossier est dans une mémoire Mnemo (${DOSSIER_MEMOIRE}) : choisis le dossier qui la contient.` };
	return { ok: true, dossier: { racine, memoireExistante: memoirePresente(racine) } };
}

/**
 * `mnemo verifier-poste --json` ; depuis un emplacement provisoire, sans Mnemo à lancer, ou sortie illisible : l'erreur à
 * montrer, et sa cause.
 */
export function verifierPoste(executable: ExecutableMnemo | null, base: NodeJS.ProcessEnv = process.env, provisoire = false): Promise<ReponsePoste> {
	if (provisoire) return Promise.resolve({ ok: false, erreur: MESSAGE_PROVISOIRE, cause: 'provisoire' });
	if (executable === null) return Promise.resolve({ ok: false, erreur: MESSAGE_SANS_MNEMO, cause: 'sansMnemo' });
	return new Promise((resoudre) => {
		execFile(
			executable.node,
			argumentsVerifierPoste(executable.main),
			{ env: environnementMnemo(executable, base), timeout: DELAI_VERIFICATION_MS, windowsHide: true, maxBuffer: 1024 * 1024 },
			(erreur, sortie, erreurs) => {
				const poste = erreur ? null : lirePoste(`${sortie}`);
				if (poste !== null) return resoudre({ ok: true, poste });
				const fin = dernieresLignes(`${erreurs}`) || (erreur ? erreur.message : 'réponse illisible.');
				resoudre({ ok: false, erreur: `La vérification n’a pas pu se faire : ${fin}`, cause: 'echec' });
			},
		);
	});
}

/** Un `init` lancé : sa fin, et de quoi l'arrêter (fenêtre fermée en cours de route). */
export type InitLance = { resultat: Promise<ResultatInstallation>; arreter(): void };

/**
 * Lance `<node> <main> init <racine> --json …` sans shell ; chaque ligne valide va à `surLigne`, les autres sont ignorées.
 * Fin : la ligne `fin` si elle est venue ; sinon la fin de la sortie d'erreur (erreur d'usage, plantage).
 */
export function lancerInit(executable: ExecutableMnemo, racine: string, choix: ChoixInstallation, surLigne: (ligne: LigneInit) => void, base: NodeJS.ProcessEnv = process.env): InitLance {
	const enfant = spawn(executable.node, argumentsInit(executable.main, racine, choix), { cwd: racine, env: environnementMnemo(executable, base), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
	const decoupeur = decoupeurLignes();
	let fin: Extract<LigneInit, { fin: true }> | null = null;
	let erreurs = '';
	const lire = (lignes: string[]) => {
		for (const texte of lignes) {
			const ligne = lireLigneInit(texte);
			if (ligne === null) continue;
			if ('fin' in ligne) fin = ligne;
			surLigne(ligne);
		}
	};
	enfant.stdout.setEncoding('utf8');
	enfant.stdout.on('data', (morceau: string) => lire(decoupeur.ajouter(morceau)));
	enfant.stderr.setEncoding('utf8');
	enfant.stderr.on('data', (morceau: string) => {
		erreurs = (erreurs + morceau).slice(-ERREUR_MAX);
	});
	const resultat = new Promise<ResultatInstallation>((resoudre) => {
		let fini = false;
		enfant.on('error', (erreur) => {
			if (fini) return;
			fini = true;
			resoudre({ fin: null, erreur: `Mnemo ne se lance pas (${executable.node}) : ${erreur.message}` });
		});
		enfant.on('close', (code, signal) => {
			if (fini) return;
			fini = true;
			lire(decoupeur.finir());
			if (fin !== null) return resoudre({ fin, erreur: null });
			const raison = dernieresLignes(erreurs) || (signal !== null ? `arrêté (${signal}).` : `code de sortie ${code}.`);
			resoudre({ fin: null, erreur: `L’installation a échoué : ${raison}` });
		});
	});
	return { resultat, arreter: () => void (enfant.exitCode === null && enfant.signalCode === null && enfant.kill()) };
}

/** Fin de l'assistant : la configuration écrite, et le choix « ouvrir à l'ouverture de session » (l'app l'applique). */
export type FinAssistant = { configuration: Configuration; ouvrirALaSession: boolean };

export type DependancesAssistant = {
	/** Mnemo à lancer ; null : rien à lancer (la page dit comment installer l'app). */
	executable: ExecutableMnemo | null;
	/** L'app tourne depuis un emplacement provisoire : rien ne s'installe (la page demande de la glisser dans Applications). */
	provisoire?: boolean;
	home: string;
	/** `MNEMO_PORT` à garder dans la configuration écrite (celui de la configuration précédente). */
	port?: number;
	base?: NodeJS.ProcessEnv;
	/** Sélecteur natif : un chemin, ou null si fermé sans choix. */
	choisirDossierNatif(): Promise<string | null>;
	envoyerLigne(ligne: LigneInit): void;
	surTermine(fin: FinAssistant): void | Promise<void>;
	/**
	 * Reprise d'une déclaration MCP faite pour une autre installation de Mnemo (`domaine/assistant-reprise.ts`) ; par
	 * défaut `mnemo declarer --remplacer --json`, lancé comme `init`.
	 */
	reprendreDeclaration?(executable: ExecutableMnemo): Promise<ResultatDeclarer>;
};

export type ControleurAssistant = {
	verifierPoste(): Promise<ReponsePoste>;
	choisirDossier(): Promise<ReponseDossier>;
	installer(choix: unknown): Promise<ResultatInstallation>;
	terminer(): Promise<ReponseTerminer>;
	/** La fenêtre se ferme : un `init` en cours est arrêté. */
	abandonner(): void;
};

const refus = (erreur: string): ResultatInstallation => ({ fin: null, erreur });

/** L'état de confiance de l'assistant, et ce que chaque demande de la page a le droit de faire. */
export function controleurAssistant(d: DependancesAssistant): ControleurAssistant {
	const base = d.base ?? process.env;
	let dossier: DossierChoisi | null = null;
	let choix: ChoixInstallation | null = null;
	let installation: EtatInstallation | null = null;
	let enCours: InitLance | null = null;
	/** `terminer` est en cours (deux demandes ne s'y croisent pas). */
	let terminaison = false;
	/** Configuration écrite : plus rien ne se relance ; seule l'ouverture de l'interface peut être retentée. */
	let ecrite: FinAssistant | null = null;
	let termine = false;
	return {
		verifierPoste: () => verifierPoste(d.executable, base, d.provisoire === true),
		async choisirDossier() {
			if (enCours !== null || ecrite !== null || terminaison) return { ok: false, annule: false, erreur: 'L’installation est en cours.' };
			const chemin = await d.choisirDossierNatif();
			if (chemin === null) return { ok: false, annule: true };
			const r = await examinerDossier(chemin);
			// une installation lancée pendant que le sélecteur était ouvert garde son dossier
			if (enCours !== null || ecrite !== null || terminaison) return { ok: false, annule: false, erreur: 'L’installation est en cours.' };
			if (!r.ok) return { ok: false, annule: false, erreur: r.erreur };
			dossier = r.dossier;
			installation = null;
			return { ok: true, dossier: r.dossier };
		},
		async installer(brut) {
			const lus = validerChoix(brut);
			if (lus === null) return refus('Choix invalides.');
			if (d.provisoire === true) return refus(MESSAGE_PROVISOIRE);
			if (d.executable === null) return refus(MESSAGE_SANS_MNEMO);
			if (dossier === null) return refus('Aucun dossier choisi.');
			if (enCours !== null || ecrite !== null || terminaison) return refus('L’installation est déjà lancée.');
			choix = lus;
			const executable = d.executable;
			let etat = installationVide();
			installation = etat;
			const transmettre = (ligne: LigneInit) => {
				etat = appliquerLigne(etat, ligne);
				d.envoyerLigne(ligne);
			};
			// déclaration faite pour une autre installation de Mnemo : son échec (et la fin qui le compte) attend la reprise
			const retenu: { echec: EvenementInit | null; fin: FinInit | null } = { echec: null, fin: null };
			const enEchec = new Set<EtapeInit>();
			const lance = lancerInit(executable, dossier.racine, lus, (ligne) => {
				if (declarationAReprendre(ligne)) retenu.echec = ligne;
				else if ('fin' in ligne && retenu.echec !== null) retenu.fin = ligne;
				else {
					if (!('fin' in ligne) && ligne.etat === 'echec') enEchec.add(ligne.etape);
					transmettre(ligne);
				}
			}, base);
			enCours = lance;
			let resultat = await lance.resultat;
			if (retenu.echec !== null) {
				const reprendre = d.reprendreDeclaration ?? ((e: ExecutableMnemo) => declarer(e, '--remplacer', e.path, base));
				const r = await reprendre(executable).catch((e: unknown): ResultatDeclarer => ({ ok: false, raison: e instanceof Error ? e.message : String(e) }));
				const ligne = ligneApresReprise(retenu.echec, r);
				if (ligne.etat === 'echec') enEchec.add('mcp');
				transmettre(ligne);
				if (retenu.fin !== null) {
					const fin = finApresReprise(retenu.fin, enEchec);
					transmettre(fin);
					resultat = { fin, erreur: null };
				}
			}
			enCours = null;
			installation = { ...etat, fin: etat.fin ?? resultat.fin, erreur: resultat.erreur, enCours: false };
			return resultat;
		},
		async terminer() {
			if (termine) return { ok: false, erreur: 'Déjà terminé.' };
			if (terminaison) return { ok: false, erreur: 'Ouverture déjà en cours.' };
			terminaison = true;
			try {
				if (ecrite === null) {
					if (d.executable === null || dossier === null || choix === null || installation === null || !peutTerminer(installation)) return { ok: false, erreur: 'L’installation n’est pas finie.' };
					if (!memoirePresente(dossier.racine)) return { ok: false, erreur: `Pas de mémoire Mnemo dans ${dossier.racine}.` };
					const configuration: Configuration = { racine: dossier.racine, node: d.executable.node, main: d.executable.main, path: d.executable.path };
					if (d.port !== undefined) configuration.port = d.port;
					try {
						await ecrireConfiguration(d.home, configuration);
					} catch (erreur) {
						return { ok: false, erreur: `Configuration non écrite : ${erreur instanceof Error ? erreur.message : String(erreur)}` };
					}
					ecrite = { configuration, ouvrirALaSession: choix.ouvrirALaSession };
				}
				// configuration écrite : un échec de l'ouverture se retente (sans réécrire)
				try {
					await d.surTermine(ecrite);
				} catch (erreur) {
					return { ok: false, erreur: `Mnemo ne s’ouvre pas : ${erreur instanceof Error ? erreur.message : String(erreur)}` };
				}
				termine = true;
				return { ok: true };
			} finally {
				terminaison = false;
			}
		},
		abandonner: () => enCours?.arreter(),
	};
}
