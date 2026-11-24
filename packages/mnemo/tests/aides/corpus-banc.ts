import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { synchroniser } from '../../src/application/synchroniser.ts';
import { fauxPorts } from './faux-ports.ts';

/** Mémoire fictive du banc (dossier `_mnemo/`) et ses questions, livrées avec Mnemo. */
export const CORPUS = join(import.meta.dirname, '../../banc/corpus/_mnemo');
export const QUESTIONS_DU_BANC = join(import.meta.dirname, '../../banc/questions.yaml');

/** Les fiches du corpus : chemin relatif à `_mnemo/` (en `/`) → Markdown. */
export function fichiersDuCorpus(): Map<string, string> {
	const fichiers = new Map<string, string>();
	const parcourir = (dossier: string): void => {
		for (const entree of readdirSync(dossier, { withFileTypes: true })) {
			const chemin = join(dossier, entree.name);
			if (entree.isDirectory()) parcourir(chemin);
			else if (entree.name.endsWith('.md')) fichiers.set(relative(CORPUS, chemin).split(sep).join('/'), readFileSync(chemin, 'utf8'));
		}
	};
	parcourir(CORPUS);
	return fichiers;
}

/** Le corpus écrit dans de faux ports et synchronisé (index à jour, sans modèle). */
export async function corpusIndexe() {
	const dep = fauxPorts();
	for (const [chemin, texte] of fichiersDuCorpus()) await dep.coffre.ecrire(chemin, texte);
	const bilan = await synchroniser(dep);
	return { dep, bilan };
}
