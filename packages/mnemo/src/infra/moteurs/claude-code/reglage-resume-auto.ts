import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Seuil de résumé automatique de Claude Code (`autoCompactWindow`, en tokens), tel que ses réglages le fixent : celui du projet
 * (`.claude/settings.local.json`, puis `.claude/settings.json`), sinon celui de l'utilisateur (`~/.claude/settings.json`). Le
 * premier nombre fini > 0 l'emporte ; un fichier absent, illisible ou en JSON invalide est ignoré. Relu à chaque jauge : trois
 * petits fichiers, aucun cache à invalider.
 */
export async function seuilDeResumeAuto(dossierProjet: string | null, accueil: string = homedir()): Promise<number | undefined> {
	const fichiers = [
		...(dossierProjet === null || dossierProjet === '' ? [] : [join(dossierProjet, '.claude', 'settings.local.json'), join(dossierProjet, '.claude', 'settings.json')]),
		join(accueil, '.claude', 'settings.json'),
	];
	for (const fichier of fichiers) {
		const seuil = await seuilDuFichier(fichier);
		if (seuil !== undefined) return seuil;
	}
	return undefined;
}

async function seuilDuFichier(fichier: string): Promise<number | undefined> {
	try {
		const brut: unknown = JSON.parse(await readFile(fichier, 'utf8'));
		const valeur = typeof brut === 'object' && brut !== null ? (brut as { autoCompactWindow?: unknown }).autoCompactWindow : undefined;
		return typeof valeur === 'number' && Number.isFinite(valeur) && valeur > 0 ? valeur : undefined;
	} catch {
		return undefined;
	}
}
