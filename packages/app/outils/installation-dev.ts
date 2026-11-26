/**
 * Installation de développement (`pnpm installer-dev`, macOS seulement) : copie l'app construite (`app/dist/Mnemo.app`,
 * `pnpm construire-app`) dans `~/Applications/Mnemo.app` et écrit sa configuration
 * (`~/Library/Application Support/Mnemo/config.json`, 0600) pour un dossier Mnemo, sans passer par l'assistant : le Node qui
 * lance l'outil, le `main.ts` du paquet `mnemo`, le `PATH` du terminal, `MNEMO_PORT` s'il est posé. L'app empaquetée
 * lance son propre Node et sa copie de Mnemo ; `node` et `main` ne servent qu'à l'app lancée depuis ce dépôt (Electron non
 * empaqueté). Remplace notre lanceur (`mnemo lanceur`) ou une version précédente de l'app, jamais une autre application.
 * `--retirer` supprime l'app et la configuration, si elles sont les nôtres. Rien n'est lancé.
 *
 * Outil du dépôt : il importe le code de l'app (`src/infra/configuration-fichier.ts`) et du service (paquet `mnemo`), que l'app
 * elle-même n'importe jamais (seulement `@mnemo/commun` et `@mnemo/contrat`). Dossier personnel, paquet et environnement
 * passés par l'appelant (dossiers temporaires dans les tests).
 */
import { randomBytes } from 'node:crypto';
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { delimiter, join, sep } from 'node:path';
import { trouverRacine } from '../../mnemo/src/adaptateurs/cli/racine.ts';
import { IDENTIFIANT_LANCEUR } from '../../mnemo/src/infra/lanceur-macos.ts';
import { IDENTIFIANT_APP } from '../src/domaine/identite-app.ts';
import { cheminConfiguration, ecrireConfiguration } from '../src/infra/configuration-fichier.ts';

const NOM = 'Mnemo.app';

const RACINE = join(import.meta.dirname, '..', '..', '..');
/** Le paquet construit par `pnpm construire-app`. */
export const PAQUET = join(RACINE, 'packages', 'app', 'dist', NOM);
/** Le `main.ts` du paquet `mnemo`, celui que lance l'app non empaquetée. */
export const MAIN = join(RACINE, 'packages', 'mnemo', 'src', 'adaptateurs', 'cli', 'main.ts');

export const USAGE = `Usage : pnpm installer-dev [<dossier Mnemo>] [--retirer]
  installe ~/Applications/Mnemo.app (construite par « pnpm construire-app ») pour ce dossier (par défaut : celui d'où la
  commande est lancée) et écrit sa configuration ; --retirer les supprime`;

/** Arrêt de l'outil : `code` 2 pour une erreur d'usage, 1 sinon. */
export class ErreurInstallation extends Error {
	readonly code: number;
	constructor(message: string, code = 1) {
		super(message);
		this.code = code;
	}
}

/** `CFBundleIdentifier` de l'`Info.plist` (XML) d'un paquet, ou `null` (absent, illisible). */
export function identifiantPaquet(app: string): string | null {
	try {
		const plist = readFileSync(join(app, 'Contents', 'Info.plist'), 'utf8');
		return /<key>CFBundleIdentifier<\/key>\s*<string>([^<]*)<\/string>/u.exec(plist)?.[1] ?? null;
	} catch {
		return null;
	}
}

/** Notre `Mnemo.app` : l'app (une version précédente) ou le lanceur de `mnemo lanceur`. */
const estLeNotre = (app: string): boolean => {
	const id = identifiantPaquet(app);
	return id === IDENTIFIANT_APP || id === IDENTIFIANT_LANCEUR;
};

/** Présent, même en lien symbolique cassé (que `existsSync` dit absent, et qu'un renommage ne remplacerait pas). */
const present = (chemin: string): boolean => lstatSync(chemin, { throwIfNoEntry: false }) !== undefined;

export type ResultatInstallation = { app: string; remplace: 'app' | 'lanceur' | null } | { absent: string } | { refus: string };

/**
 * Copie le paquet construit `paquet` dans `applications/Mnemo.app` (créé s'il manque). Remplace notre app ou notre lanceur ;
 * refuse toute autre application du même nom. `absent` : le paquet n'est pas construit.
 */
export function installerApp(paquet: string, applications: string): ResultatInstallation {
	if (identifiantPaquet(paquet) !== IDENTIFIANT_APP) return { absent: paquet };
	const app = join(applications, NOM);
	const precedent = present(app) ? identifiantPaquet(app) : null;
	if (present(app) && !estLeNotre(app)) return { refus: `${app} existe et n'a été créé ni par « pnpm installer-dev » ni par « mnemo lanceur » : laissé en place.` };
	mkdirSync(applications, { recursive: true });
	// copié à côté, puis mis en place d'un coup ; liens du framework d'Electron gardés tels quels (la signature en dépend).
	// L'ancien est d'abord écarté (pas effacé) : remis en place si la mise en place échoue.
	const suffixe = `${process.pid}.${randomBytes(4).toString('hex')}`;
	const provisoire = join(applications, `.${NOM}.${suffixe}`);
	const ancien = join(applications, `.${NOM}.ancien.${suffixe}`);
	let ecarte = false;
	try {
		cpSync(paquet, provisoire, { recursive: true, verbatimSymlinks: true });
		if (present(app)) {
			renameSync(app, ancien);
			ecarte = true;
		}
		renameSync(provisoire, app);
	} catch (erreur) {
		if (ecarte && !present(app)) renameSync(ancien, app);
		rmSync(provisoire, { recursive: true, force: true });
		throw erreur;
	}
	if (ecarte) rmSync(ancien, { recursive: true, force: true });
	return { app, remplace: precedent === IDENTIFIANT_APP ? 'app' : precedent === IDENTIFIANT_LANCEUR ? 'lanceur' : null };
}

/** Retire `applications/Mnemo.app` si c'est notre app (le lanceur se retire par « mnemo lanceur --retirer »). */
export function retirerApp(applications: string): { retire: string } | { absent: string } | { refus: string } {
	const app = join(applications, NOM);
	if (!existsSync(app)) return { absent: app };
	if (identifiantPaquet(app) !== IDENTIFIANT_APP) return { refus: `${app} n'est pas l'app Mnemo : laissé en place.` };
	rmSync(app, { recursive: true, force: true });
	return { retire: app };
}

/**
 * Retire la configuration si elle est la nôtre (un objet JSON avec `racine`, `path` et, s'ils y sont, `node` et `main` en
 * texte) ; le reste du dossier (préférences, journal, données d'Electron) est laissé.
 */
export function retirerConfiguration(home: string): { retire: string } | { absent: string } | { refus: string } {
	const chemin = cheminConfiguration(home);
	let texte: string;
	try {
		texte = readFileSync(chemin, 'utf8');
	} catch (e) {
		if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { absent: chemin };
		throw e;
	}
	let brut: unknown;
	try {
		brut = JSON.parse(texte);
	} catch {
		brut = null;
	}
	const objet = typeof brut === 'object' && brut !== null && !Array.isArray(brut) ? (brut as Record<string, unknown>) : null;
	const texteOuAbsent = (cle: string) => objet !== null && (objet[cle] === undefined || typeof objet[cle] === 'string');
	if (objet === null || typeof objet['racine'] !== 'string' || typeof objet['path'] !== 'string' || !texteOuAbsent('node') || !texteOuAbsent('main')) {
		return { refus: `${chemin} n'a pas le format de la configuration de l'app : laissé en place.` };
	}
	rmSync(chemin, { force: true });
	return { retire: chemin };
}

/**
 * `PATH` du terminal, sans ce que `pnpm` ajoute devant pour lancer un script (`node_modules/.bin` des paquets et de la
 * racine, `node-gyp-bin` de pnpm) ; vide : celui par défaut.
 */
export function pathDuTerminal(path: string | undefined): string {
	const gardes = (path ?? '').split(delimiter).filter((d) => d !== '' && !d.endsWith(`${sep}node_modules${sep}.bin`) && !d.endsWith(`${sep}node-gyp-bin`));
	return gardes.length > 0 ? gardes.join(delimiter) : '/usr/bin:/bin';
}

/** `MNEMO_PORT` posé (non vide) : un port de 0 à 65535 ; sinon rien. Invalide : erreur d'usage. */
export function portDemande(env: Record<string, string | undefined>): number | undefined {
	const brut = env['MNEMO_PORT'];
	if (brut === undefined || brut === '') return undefined;
	if (!/^\d+$/u.test(brut) || Number(brut) > 65535) throw new ErreurInstallation(`MNEMO_PORT invalide : « ${brut} » (0 à 65535 ; 0 : un port libre).`, 2);
	return Number(brut);
}

export type OptionsInstallerDev = {
	/** Dossier personnel (`~/Applications`, `~/Library/Application Support/Mnemo`). */
	home: string;
	/** Dossier d'où la commande est lancée (`INIT_CWD` de pnpm), où chercher le dossier Mnemo sans argument. */
	dossierCourant: string;
	/** Paquet à installer ; par défaut `app/dist/Mnemo.app`. */
	paquet?: string;
	/** Node écrit dans la configuration ; par défaut celui de ce processus. */
	node?: string;
	env: Record<string, string | undefined>;
	ecrire: (ligne: string) => void;
};

/** `pnpm installer-dev [<dossier Mnemo>] [--retirer]` : voir l'en-tête. */
export async function installerDev(args: readonly string[], o: OptionsInstallerDev): Promise<void> {
	const options = args.filter((a) => a.startsWith('-'));
	const dossiers = args.filter((a) => !a.startsWith('-'));
	const inconnue = options.find((a) => a !== '--retirer');
	if (inconnue !== undefined) throw new ErreurInstallation(`Option inconnue : « ${inconnue} ».\n${USAGE}`, 2);
	if (dossiers.length > 1) throw new ErreurInstallation(`Un seul dossier Mnemo à la fois.\n${USAGE}`, 2);
	if (process.platform !== 'darwin') throw new ErreurInstallation('L’app Mnemo est une application macOS.');
	const applications = join(o.home, 'Applications');

	if (options.includes('--retirer')) {
		if (dossiers.length > 0) throw new ErreurInstallation(`--retirer ne prend pas de dossier.\n${USAGE}`, 2);
		const app = retirerApp(applications);
		if ('refus' in app) throw new ErreurInstallation(app.refus);
		const configuration = retirerConfiguration(o.home);
		o.ecrire('absent' in app ? `Aucune app à retirer (${app.absent}).` : `App retirée : ${app.retire}.`);
		if ('refus' in configuration) throw new ErreurInstallation(configuration.refus);
		if ('retire' in configuration) o.ecrire(`Configuration retirée : ${configuration.retire}.`);
		return;
	}

	const depart = dossiers[0] ?? o.dossierCourant;
	const racine = trouverRacine(depart);
	if (racine === null) throw new ErreurInstallation(`Aucune mémoire Mnemo dans ${depart} ni dans ses dossiers parents : donnez le dossier Mnemo (pnpm installer-dev <dossier>), ou créez-y une mémoire (mnemo init).`);
	const port = portDemande(o.env);
	const r = installerApp(o.paquet ?? PAQUET, applications);
	if ('absent' in r) throw new ErreurInstallation(`App non construite (${r.absent}) : lancez « pnpm construire-app » à la racine de ce dépôt, puis « pnpm installer-dev ».`);
	if ('refus' in r) throw new ErreurInstallation(r.refus);
	const configuration = await ecrireConfiguration(o.home, { racine, node: o.node ?? process.execPath, main: MAIN, path: pathDuTerminal(o.env['PATH']), ...(port === undefined ? {} : { port }) });
	o.ecrire(`${r.remplace === 'lanceur' ? 'App installée à la place du lanceur' : r.remplace === 'app' ? 'App remplacée' : 'App installée'} : ${r.app} (dossier ${racine}).`);
	o.ecrire(`Configuration : ${configuration}.`);
	o.ecrire('Elle lance le service avec son propre Node et sa copie de Mnemo : après une mise à jour des sources, relancez « pnpm construire-app » puis « pnpm installer-dev ».');
	o.ecrire('L’ouvrir : Launchpad, Spotlight ou le Finder (si elle tournait déjà, quittez-la puis rouvrez-la). La retirer : pnpm installer-dev --retirer.');
}
