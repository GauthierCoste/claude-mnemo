import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { CommandeMoteur } from '../../application/ports.ts';
import { estFichier } from './executables.ts';

/** Un shim npm (ou un script batch) : il ne se lance pas sans shell. */
export const SHIM = /\.(?:cmd|bat)$/iu;

/** Cibles citées par un shim npm : `"%dp0%\chemin\cli.js"` (ou `%~dp0`), chemins relatifs au dossier du shim. */
function ciblesDuShim(texte: string): string[] {
	return [...texte.matchAll(/"%~?dp0%?[\\/]*([^"%*]+?\.(?:mjs|cjs|js|exe))"/giu)].map((m) => m[1]!);
}

/**
 * Windows : un shim npm (`claude.cmd`, `codex.cmd`) ne se lance pas sans shell. On lance sa cible à la place : un script
 * Node par le Node courant, un exécutable natif directement (jamais `node.exe`, l'interpréteur du shim) ; à défaut le
 * script du paquet à côté du shim (`repli`, chemin relatif au dossier du shim). Rien de trouvé : null (mode dégradé).
 */
export function cibleDuShim(shim: string, repli: readonly string[]): CommandeMoteur | null {
	const dossier = dirname(shim);
	let texte = '';
	try {
		texte = readFileSync(shim, 'utf8');
	} catch {
		texte = '';
	}
	const cibles = ciblesDuShim(texte).map((relatif) => join(dossier, ...relatif.split(/[\\/]/u).filter((s) => s !== '')));
	const scripts = cibles.filter((c) => /\.(?:mjs|cjs|js)$/iu.test(c));
	const natifs = cibles.filter((c) => /\.exe$/iu.test(c) && !/(?:^|[\\/])node\.exe$/iu.test(c));
	for (const script of scripts) if (estFichier(script)) return { commande: process.execPath, avant: [script] };
	for (const natif of natifs) if (estFichier(natif)) return { commande: natif, avant: [] };
	const paquet = join(dossier, ...repli);
	return estFichier(paquet) ? { commande: process.execPath, avant: [paquet] } : null;
}
