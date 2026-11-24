import TurndownService from 'turndown';

const LONGUEUR_MAX_METADONNEE = 300;

/** Métadonnée issue du document : rognée, sur une seule ligne, bornée ; null si vide. Ne masque pas les secrets (à l'appelant). */
export function metadonnee(valeur: unknown): string | null {
	if (typeof valeur !== 'string') return null;
	const propre = valeur.replace(/\s+/g, ' ').trim();
	if (propre === '') return null;
	return [...propre].slice(0, LONGUEUR_MAX_METADONNEE).join('');
}

export { nomDuFichier } from '../../domaine/chemin.ts';

/** HTML → Markdown (titres atx, listes `-`, blocs de code clôturés, images ignorées, tableaux en Markdown). */
export function htmlVersMarkdown(html: string): string {
	const turndown = new TurndownService({ headingStyle: 'atx', bulletListMarker: '-', codeBlockStyle: 'fenced' });
	turndown.remove('img');
	turndown.addRule('tableau', { filter: 'table', replacement: (_c, noeud) => tableau(noeud as HTMLElement) });
	return turndown.turndown(html).trim();
}

// Tableau HTML → tableau Markdown ; première ligne = en-tête.
function tableau(noeud: HTMLElement): string {
	const lignes = Array.from(noeud.getElementsByTagName('tr')).map((tr) =>
		Array.from(tr.children).map((c) => (c.textContent ?? '').replace(/\s+/g, ' ').replace(/\|/g, '\\|').trim()),
	);
	if (lignes.length === 0) return '';
	const largeur = Math.max(...lignes.map((l) => l.length));
	const cellules = (l: string[]) => `| ${Array.from({ length: largeur }, (_, i) => l[i] ?? '').join(' | ')} |`;
	const [entete, ...reste] = lignes;
	return `\n\n${[cellules(entete!), cellules(Array(largeur).fill('---')), ...reste.map(cellules)].join('\n')}\n\n`;
}
