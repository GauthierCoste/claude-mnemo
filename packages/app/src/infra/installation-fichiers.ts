/**
 * Les fichiers que Mnemo installe hors de l'app, lus tels quels (l'app n'importe pas le code de `mnemo`) : la commande
 * `~/.local/bin/mnemo`, `~/.claude.json` (déclarations MCP de Claude Code, portée utilisateur) et la configuration de l'app
 * Claude (même règle de chemin que le service, `@mnemo/commun` : sous Windows, `%APPDATA%\Claude`). Le dossier personnel
 * est passé par l'appelant (un dossier temporaire dans les tests ; sous Windows, `APPDATA` aussi). Rien ici ne lève : un
 * fichier illisible vaut « autre » (jamais touché).
 */
import { randomBytes } from 'node:crypto';
import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fichierConfigClaudeDesktop } from '@mnemo/commun';
import type { Lancement } from '../domaine/configuration.ts';
import { plateformeApp } from '../domaine/plateforme.ts';
import { environnementDuDossier } from './dossiers.ts';
import { type Attendu, entreeMnemo, type EtatElement, etatCommande, etatEntreeMcp, type EtatInstallation, texteSansEntreeMnemo } from '../domaine/installation.ts';

export type CheminsInstallation = { commande: string; claudeCode: string; appClaude: string };

/** `env` : par défaut `environnementDuDossier` (un dossier personnel de travail ne lit jamais le vrai `%APPDATA%`). */
export function cheminsInstallation(home: string, plateforme: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = environnementDuDossier(home, plateforme)): CheminsInstallation {
	return {
		commande: join(home, '.local', 'bin', 'mnemo'),
		claudeCode: join(home, '.claude.json'),
		appClaude: fichierConfigClaudeDesktop(plateformeApp(plateforme), home, env),
	};
}

/** Le Node, le `main.ts` et l'adresse `file://` de celui-ci (celle qu'écrit `mnemo commande`). */
export function attenduDe(lancement: Lancement): Attendu {
	return { ...lancement, mainUrl: pathToFileURL(lancement.main).href };
}

/** Texte du fichier ; null s'il est absent ; `illisible` sinon. */
function lire(chemin: string): string | null | 'illisible' {
	try {
		return readFileSync(chemin, 'utf8');
	} catch (e) {
		return (e as NodeJS.ErrnoException).code === 'ENOENT' ? null : 'illisible';
	}
}

/** État d'une entrée `mcpServers.mnemo` d'un fichier JSON. */
function etatFichierMcp(chemin: string, lancement: Lancement): EtatElement {
	const texte = lire(chemin);
	if (texte === null) return 'absent';
	if (texte === 'illisible') return 'autre';
	try {
		return etatEntreeMcp(entreeMnemo(JSON.parse(texte)), lancement, plateformeApp(process.platform));
	} catch {
		return 'autre';
	}
}

/** L'entrée `mnemo` de la configuration de l'app Claude (`undefined` : absente, fichier absent ou illisible). */
export function lireEntreeAppClaude(home: string): unknown {
	const texte = lire(cheminsInstallation(home).appClaude);
	if (texte === null || texte === 'illisible') return undefined;
	try {
		return entreeMnemo(JSON.parse(texte));
	} catch {
		return undefined;
	}
}

export function lireEtatInstallation(home: string, lancement: Lancement): EtatInstallation {
	const chemins = cheminsInstallation(home);
	const commande = lire(chemins.commande);
	return {
		commande: commande === 'illisible' ? 'autre' : etatCommande(commande, attenduDe(lancement)),
		claudeCode: etatFichierMcp(chemins.claudeCode, lancement),
		appClaude: etatFichierMcp(chemins.appClaude, lancement),
	};
}

/**
 * Retire l'entrée `mnemo` de la configuration de l'app Claude si elle lance ce Node et ce `main.ts` (relu juste avant :
 * rien d'autre n'est touché) ; écriture à côté (0600) puis renommage. Rend `retire`, `absent` (rien à nous), ou lève.
 */
export function retirerEntreeAppClaude(fichier: string, lancement: Lancement): 'retire' | 'absent' {
	const texte = lire(fichier);
	if (texte === null) return 'absent';
	if (texte === 'illisible') throw new Error(`${fichier} illisible.`);
	const brut = JSON.parse(texte) as unknown;
	if (etatEntreeMcp(entreeMnemo(brut), lancement, plateformeApp(process.platform)) !== 'nous') return 'absent';
	const provisoire = join(dirname(fichier), `.${basename(fichier)}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`);
	try {
		writeFileSync(provisoire, texteSansEntreeMnemo(brut as Record<string, unknown>), { mode: 0o600, flag: 'wx' });
		renameSync(provisoire, fichier);
	} catch (e) {
		rmSync(provisoire, { force: true });
		throw e;
	}
	return 'retire';
}

/** Retire les fichiers donnés (absents : rien) ; rend ceux qui ont été retirés. */
export function retirerFichiers(fichiers: readonly string[]): string[] {
	const retires: string[] = [];
	for (const f of fichiers) {
		if (lire(f) === null) continue;
		rmSync(f, { force: true });
		retires.push(f);
	}
	return retires;
}
