/**
 * Fichier de configuration de l'app : `config.json` du dossier de l'app (`dossierApp` : `~/Library/Application Support/Mnemo`
 * sous macOS, `%APPDATA%\Mnemo` sous Windows ; 0600, écrit par l'assistant ou par
 * `pnpm installer-dev`), lu puis validé par le domaine. Le dossier personnel est passé par l'appelant (`os.homedir()`, voir
 * `dossiers.ts` ; un dossier temporaire dans les tests).
 */
import { randomBytes } from 'node:crypto';
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { dossierApp } from './dossiers.ts';
import { type Configuration, type Lancement, type ResultatConfiguration, validerConfiguration } from '../domaine/configuration.ts';

/** Chemin de `config.json` dans le dossier de l'app de `home`. */
export function cheminConfiguration(home: string): string {
	return join(dossierApp(home), 'config.json');
}

/**
 * Lit et valide la configuration. Absente, illisible ou invalide : des erreurs lisibles, qui nomment le fichier (jamais
 * d'exception). `paquet` : le Node et le `main.ts` de l'app empaquetée (`lancementDuPaquet`), qui remplacent ceux du
 * fichier (alors facultatifs).
 */
export async function lireConfiguration(home: string, paquet?: Lancement): Promise<ResultatConfiguration> {
	const chemin = cheminConfiguration(home);
	let texte: string;
	try {
		texte = await readFile(chemin, 'utf8');
	} catch (e) {
		if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { ok: false, erreurs: [`Configuration absente : ${chemin} (l’assistant ou « pnpm installer-dev » l’écrit).`] };
		return { ok: false, erreurs: [`Configuration illisible : ${chemin} (${e instanceof Error ? e.message : String(e)}).`] };
	}
	let brut: unknown;
	try {
		brut = JSON.parse(texte);
	} catch {
		return { ok: false, erreurs: [`Configuration invalide : ${chemin} n’est pas du JSON.`] };
	}
	const r = validerConfiguration(brut, paquet);
	return r.ok ? r : { ok: false, erreurs: r.erreurs.map((e) => `${chemin} : ${e}`) };
}

/**
 * Écrit la configuration (celle de l'assistant et de `pnpm installer-dev`, `outils/installation-dev.ts`) :
 * JSON indenté d'une tabulation, 0600, dossier créé (0700) s'il manque, la précédente remplacée d'un coup. Validée avant
 * d'être écrite : une configuration que l'app ne relirait pas est refusée (exception). Rend le chemin écrit.
 */
export async function ecrireConfiguration(home: string, configuration: Configuration): Promise<string> {
	const r = validerConfiguration(configuration);
	if (!r.ok) throw new Error(`Configuration refusée : ${r.erreurs.join(' ')}`);
	const chemin = cheminConfiguration(home);
	await ecrireJson(chemin, r.configuration);
	return chemin;
}

/**
 * Remplace le seul champ `path` de la configuration existante (« Reprendre le PATH du terminal ») : les autres clés, même
 * inconnues, restent telles quelles. Refusé (exception) si le fichier ne se lit pas, n'est pas un objet JSON, ou si le
 * résultat ne se relirait pas (`paquet` : comme pour `lireConfiguration`). Rend le chemin écrit.
 */
export async function remplacerPathConfiguration(home: string, path: string, paquet?: Lancement): Promise<string> {
	const chemin = cheminConfiguration(home);
	const brut: unknown = JSON.parse(await readFile(chemin, 'utf8'));
	if (typeof brut !== 'object' || brut === null || Array.isArray(brut)) throw new Error(`Configuration invalide : ${chemin} n’est pas un objet JSON.`);
	const nouvelle = { ...(brut as Record<string, unknown>), path };
	const r = validerConfiguration(nouvelle, paquet);
	if (!r.ok) throw new Error(`Configuration refusée : ${r.erreurs.join(' ')}`);
	await ecrireJson(chemin, nouvelle);
	return chemin;
}

/** JSON indenté d'une tabulation, 0600, dossier créé (0700) s'il manque, le fichier précédent remplacé d'un coup. */
async function ecrireJson(chemin: string, contenu: unknown): Promise<void> {
	await mkdir(dirname(chemin), { recursive: true, mode: 0o700 });
	const provisoire = `${chemin}.${process.pid}.${randomBytes(4).toString('hex')}`;
	try {
		await writeFile(provisoire, `${JSON.stringify(contenu, null, '\t')}\n`, { mode: 0o600 });
		await chmod(provisoire, 0o600);
		await rename(provisoire, chemin);
	} catch (erreur) {
		await rm(provisoire, { force: true });
		throw erreur;
	}
}
