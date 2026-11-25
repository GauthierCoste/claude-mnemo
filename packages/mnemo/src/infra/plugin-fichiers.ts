import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { FichierPlugin } from '../application/ports.ts';
import { estUuid } from '../domaine/session.ts';
import { preparerDossierLocal } from './systeme.ts';

/** Chemin relatif au plugin, en « / », sans segment vide, « . » ou « .. », ni antislash. */
function cheminSur(chemin: string): boolean {
	if (chemin === '' || chemin.includes('\\') || chemin.startsWith('/') || /^[A-Za-z]:/u.test(chemin)) return false;
	return chemin.split('/').every((s) => s !== '' && s !== '.' && s !== '..');
}

/** `.mnemo/plugins/<session>/` (session vérifiée : un uuid). */
function dossierPlugin(racine: string, session: string): string {
	if (!estUuid(session)) throw new Error(`Identifiant de session invalide pour le plugin : « ${session} ».`);
	return join(preparerDossierLocal(racine), 'plugins', session);
}

/**
 * Écrit le plugin d'une session dans `.mnemo/plugins/<session>/` (en LF) et rend ce dossier. Un assemblage précédent est
 * remplacé en entier (une skill retirée disparaît). Session hors uuid ou chemin qui sortirait du plugin : refus, rien n'est écrit.
 */
export async function ecrirePlugin(racine: string, session: string, fichiers: FichierPlugin[]): Promise<string> {
	for (const f of fichiers) {
		if (!cheminSur(f.chemin)) throw new Error(`Chemin refusé dans le plugin : « ${f.chemin} ».`);
	}
	const dossier = dossierPlugin(racine, session);
	await rm(dossier, { recursive: true, force: true });
	for (const f of fichiers) {
		const chemin = join(dossier, ...f.chemin.split('/'));
		await mkdir(dirname(chemin), { recursive: true });
		await writeFile(chemin, f.texte.replace(/\r\n?/gu, '\n'));
	}
	await mkdir(dossier, { recursive: true });
	return dossier;
}

/** Supprime le plugin d'une session (`.mnemo/plugins/<session>/`) ; absent : rien à faire. Session hors uuid : refus. */
export async function retirerPlugin(racine: string, session: string): Promise<void> {
	await rm(dossierPlugin(racine, session), { recursive: true, force: true });
}
